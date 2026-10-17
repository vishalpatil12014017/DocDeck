import * as vscode from 'vscode';
import * as XLSX from 'xlsx';
import { buildWebviewHtml, localResourceRoots, MAX_RAW_BYTES, rawFileMessage, RawMessage } from '../util';

/** Shape of one sheet as sent to the webview. */
export interface SheetPayload {
  name: string;
  rows: number;
  cols: number;
  /** Display text per cell, row-major, sparse rows allowed. */
  display: string[][];
  /** Editable source text where it differs from the display text (formulas, dates, formatted numbers). */
  raw: Record<string, string>;
  colWidths: (number | null)[];
}

interface CellChange {
  r: number;
  c: number;
  value: string;
}

type TextFormat = { kind: 'text'; separator: string; bom: boolean };
type BinaryFormat = { kind: 'binary'; bookType: XLSX.BookType };

function formatFor(uri: vscode.Uri): TextFormat | BinaryFormat {
  const ext = uri.path.split('.').pop()!.toLowerCase();
  switch (ext) {
    case 'csv':
      return { kind: 'text', separator: ',', bom: false };
    case 'tsv':
      return { kind: 'text', separator: '\t', bom: false };
    case 'xls':
      return { kind: 'binary', bookType: 'biff8' };
    case 'ods':
      return { kind: 'binary', bookType: 'ods' };
    case 'xlsm':
      return { kind: 'binary', bookType: 'xlsm' };
    default:
      return { kind: 'binary', bookType: 'xlsx' };
  }
}

function parseWorkbook(data: Uint8Array, format: TextFormat | BinaryFormat): XLSX.WorkBook {
  if (format.kind === 'text') {
    let text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(data);
    format.bom = text.charCodeAt(0) === 0xfeff;
    if (format.bom) {
      text = text.slice(1);
    }
    return parseDelimited(text, format);
  }
  return XLSX.read(data, { type: 'array', cellDates: true, cellNF: true, bookVBA: true });
}

function parseDelimited(text: string, format: TextFormat): XLSX.WorkBook {
  // raw: keep every value as typed (no "00123" -> 123 or date mangling on round-trip)
  return XLSX.read(text, { type: 'string', raw: true, FS: format.separator, dense: false });
}

function cellRaw(cell: XLSX.CellObject | undefined): string {
  if (!cell) {
    return '';
  }
  if (cell.f) {
    return `=${cell.f}`;
  }
  if (cell.t === 'd' && cell.w) {
    return cell.w;
  }
  if (cell.v === undefined || cell.v === null) {
    return '';
  }
  if (cell.t === 'b') {
    return cell.v ? 'TRUE' : 'FALSE';
  }
  return String(cell.v);
}

function cellDisplay(cell: XLSX.CellObject | undefined): string {
  if (!cell) {
    return '';
  }
  if (cell.f && (cell.v === undefined || cell.v === null)) {
    return `=${cell.f}`;
  }
  if (cell.w !== undefined) {
    return cell.w;
  }
  try {
    return XLSX.utils.format_cell(cell);
  } catch {
    return cellRaw(cell);
  }
}

function sheetPayload(name: string, ws: XLSX.WorkSheet): SheetPayload {
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
  const display: string[][] = [];
  const raw: Record<string, string> = {};
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const d = cellDisplay(cell);
      row[c] = d;
      const rv = cellRaw(cell);
      if (rv !== d) {
        raw[`${r},${c}`] = rv;
      }
    }
    display[r] = row;
  }
  const colWidths = (ws['!cols'] ?? []).map((col) => (col?.wpx ? col.wpx : col?.wch ? Math.round(col.wch * 7 + 10) : null));
  return { name, rows: range.e.r + 1, cols: range.e.c + 1, display, raw, colWidths };
}

function parseInput(value: string, textOnly: boolean): XLSX.CellObject | undefined {
  if (value === '') {
    return undefined;
  }
  if (textOnly) {
    return { t: 's', v: value };
  }
  if (value.startsWith('=') && value.length > 1) {
    return { t: 'n', f: value.slice(1) } as XLSX.CellObject;
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value.trim())) {
    return { t: 'n', v: Number(value) };
  }
  const upper = value.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') {
    return { t: 'b', v: upper === 'TRUE' };
  }
  return { t: 's', v: value };
}

function extendRef(ws: XLSX.WorkSheet, r: number, c: number) {
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r, c }, e: { r, c } };
  range.s.r = Math.min(range.s.r, r);
  range.s.c = Math.min(range.s.c, c);
  range.e.r = Math.max(range.e.r, r);
  range.e.c = Math.max(range.e.c, c);
  ws['!ref'] = XLSX.utils.encode_range(range);
}

/** Shifts cells to insert (count > 0) or delete (count < 0) rows/columns starting at `index`. */
function shiftCells(ws: XLSX.WorkSheet, axis: 'row' | 'col', index: number, count: number): XLSX.WorkSheet {
  const out: XLSX.WorkSheet = {};
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) {
      out[key] = ws[key];
      continue;
    }
    const addr = XLSX.utils.decode_cell(key);
    const pos = axis === 'row' ? addr.r : addr.c;
    if (count < 0 && pos >= index && pos < index - count) {
      continue;
    }
    if (pos >= index) {
      if (axis === 'row') {
        addr.r += count;
      } else {
        addr.c += count;
      }
    }
    out[XLSX.utils.encode_cell(addr)] = ws[key];
    maxR = Math.max(maxR, addr.r);
    maxC = Math.max(maxC, addr.c);
  }
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (axis === 'row') {
      range.e.r = Math.max(range.s.r, range.e.r + count, maxR);
    } else {
      range.e.c = Math.max(range.s.c, range.e.c + count, maxC);
    }
    out['!ref'] = XLSX.utils.encode_range(range);
  }
  if (ws['!merges']) {
    out['!merges'] = ws['!merges']
      .map((m) => {
        const s = { ...m.s };
        const e = { ...m.e };
        const key = axis === 'row' ? 'r' : 'c';
        if (s[key] >= index) s[key] = Math.max(index, s[key] + count);
        if (e[key] >= index) e[key] = e[key] + count;
        return { s, e };
      })
      .filter((m) => m.e.r >= m.s.r && m.e.c >= m.s.c);
  }
  if (axis === 'col' && ws['!cols']) {
    const cols = [...ws['!cols']];
    if (count > 0) cols.splice(index, 0, ...new Array(count).fill(undefined));
    else cols.splice(index, -count);
    out['!cols'] = cols;
  }
  if (axis === 'row' && ws['!rows']) {
    const rows = [...ws['!rows']];
    if (count > 0) rows.splice(index, 0, ...new Array(count).fill(undefined));
    else rows.splice(index, -count);
    out['!rows'] = rows;
  }
  return out;
}

class SheetDocument implements vscode.CustomDocument {
  workbook: XLSX.WorkBook;
  readonly format: TextFormat | BinaryFormat;
  /** True once the workbook differs from the file on disk (the Raw tab then shows the unsaved text). */
  edited = false;

  constructor(
    public readonly uri: vscode.Uri,
    data: Uint8Array,
  ) {
    this.format = formatFor(uri);
    this.workbook = parseWorkbook(data, this.format);
  }

  get isText(): boolean {
    return this.format.kind === 'text';
  }

  payload(): SheetPayload[] {
    return this.workbook.SheetNames.map((name) => sheetPayload(name, this.workbook.Sheets[name]));
  }

  sheet(name: string): XLSX.WorkSheet {
    const ws = this.workbook.Sheets[name];
    if (!ws) {
      throw new Error(`Unknown sheet ${name}`);
    }
    return ws;
  }

  /** Writes cell values; returns the previous values so the change can be undone. */
  setCells(sheetName: string, changes: CellChange[]): CellChange[] {
    const ws = this.sheet(sheetName);
    const previous: CellChange[] = [];
    this.edited = true;
    for (const { r, c, value } of changes) {
      const addr = XLSX.utils.encode_cell({ r, c });
      previous.push({ r, c, value: cellRaw(ws[addr]) });
      const cell = parseInput(value, this.isText);
      if (cell) {
        ws[addr] = cell;
        extendRef(ws, r, c);
      } else {
        delete ws[addr];
      }
    }
    return previous;
  }

  displayFor(sheetName: string, changes: CellChange[]): { r: number; c: number; display: string; raw: string }[] {
    const ws = this.sheet(sheetName);
    return changes.map(({ r, c }) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      return { r, c, display: cellDisplay(cell), raw: cellRaw(cell) };
    });
  }

  snapshot() {
    return { names: [...this.workbook.SheetNames], sheets: { ...this.workbook.Sheets } };
  }

  restore(snap: ReturnType<SheetDocument['snapshot']>) {
    this.workbook.SheetNames = [...snap.names];
    this.workbook.Sheets = { ...snap.sheets };
    this.edited = true;
  }

  /** Replaces the whole sheet with edited CSV/TSV text from the Raw tab. */
  replaceFromText(text: string) {
    if (this.format.kind !== 'text') {
      throw new Error('Only CSV/TSV files can be edited as raw text');
    }
    const parsed = parseDelimited(text, this.format);
    this.workbook.SheetNames = parsed.SheetNames;
    this.workbook.Sheets = parsed.Sheets;
    this.edited = true;
  }

  async rawMessage(): Promise<RawMessage> {
    if (this.format.kind !== 'text') {
      return rawFileMessage(this.uri);
    }
    const bytes = this.edited ? this.serialize() : await vscode.workspace.fs.readFile(this.uri);
    const text = new TextDecoder('utf-8').decode(bytes);
    if (bytes.byteLength > MAX_RAW_BYTES) {
      return { type: 'raw', text, readOnly: true, language: 'csv', notice: 'Large file: the raw view is read-only. Edit it in the grid instead.' };
    }
    return { type: 'raw', text, readOnly: false, language: 'csv' };
  }

  async save(target: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.writeFile(target, this.serialize());
    if (target.toString() === this.uri.toString()) {
      this.edited = false;
    }
  }

  serialize(): Uint8Array {
    if (this.format.kind === 'text') {
      const ws = this.workbook.Sheets[this.workbook.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: this.format.separator, blankrows: true, strip: false });
      return new TextEncoder().encode((this.format.bom ? '﻿' : '') + csv + (csv.endsWith('\n') ? '' : '\n'));
    }
    const out = XLSX.write(this.workbook, { type: 'array', bookType: this.format.bookType, compression: true });
    return new Uint8Array(out as ArrayBuffer);
  }

  async reload(): Promise<void> {
    const data = await vscode.workspace.fs.readFile(this.uri);
    this.workbook = parseWorkbook(data, this.format);
    this.edited = false;
  }

  dispose() {}
}

/** Editable spreadsheet (xlsx, xls, ods, csv, tsv) with undo/redo, save, save-as and hot-exit backups. */
export class SheetEditorProvider implements vscode.CustomEditorProvider<SheetDocument> {
  static readonly viewType = 'docdeck.sheet';

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<SheetDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  private readonly panels = new Map<SheetDocument, Set<vscode.WebviewPanel>>();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(SheetEditorProvider.viewType, new SheetEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<SheetDocument> {
    const data = await vscode.workspace.fs.readFile(openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri);
    return new SheetDocument(uri, data);
  }

  resolveCustomEditor(document: SheetDocument, panel: vscode.WebviewPanel): void {
    const { webview } = panel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots(this.context.extensionUri, document.uri),
    };
    webview.html = buildWebviewHtml(webview, this.context.extensionUri, 'sheet', 'Spreadsheet');

    const set = this.panels.get(document) ?? new Set();
    set.add(panel);
    this.panels.set(document, set);
    panel.onDidDispose(() => set.delete(panel));

    webview.onDidReceiveMessage((msg) => {
      try {
        this.handleMessage(document, msg);
      } catch (err) {
        vscode.window.showErrorMessage(`Spreadsheet: ${(err as Error).message}`);
      }
    });
  }

  private post(document: SheetDocument, message: unknown) {
    for (const panel of this.panels.get(document) ?? []) {
      panel.webview.postMessage(message);
    }
  }

  private sendAll(document: SheetDocument, activeSheet?: string) {
    this.post(document, {
      type: 'init',
      sheets: document.payload(),
      textOnly: document.isText,
      singleSheet: document.isText,
      activeSheet,
    });
  }

  private handleMessage(document: SheetDocument, msg: any) {
    switch (msg.type) {
      case 'ready':
        this.sendAll(document);
        return;
      case 'setCells': {
        const sheet: string = msg.sheet;
        const changes: CellChange[] = msg.changes;
        const previous = document.setCells(sheet, changes);
        // Webview already shows the typed text; send back the canonical display text (e.g. "1.50" -> "1.5").
        this.post(document, { type: 'cells', sheet, cells: document.displayFor(sheet, changes) });
        this._onDidChangeCustomDocument.fire({
          document,
          label: changes.length === 1 ? 'Edit cell' : 'Edit cells',
          undo: () => {
            document.setCells(sheet, previous);
            this.post(document, { type: 'cells', sheet, cells: document.displayFor(sheet, previous), select: previous[0] });
          },
          redo: () => {
            document.setCells(sheet, changes);
            this.post(document, { type: 'cells', sheet, cells: document.displayFor(sheet, changes), select: changes[0] });
          },
        });
        return;
      }
      case 'structure':
        this.applyStructural(document, msg);
        return;
      case 'getRaw':
        document.rawMessage().then((raw) => this.post(document, raw));
        return;
      case 'rawEdit':
        this.applyRawEdit(document, String(msg.text));
        return;
    }
  }

  /** CSV/TSV text edited in the Raw tab replaces the sheet; undo restores the previous workbook. */
  private applyRawEdit(document: SheetDocument, text: string) {
    const before = document.snapshot();
    document.replaceFromText(text);
    const after = document.snapshot();
    this.sendAll(document);
    const refresh = async () => {
      this.sendAll(document);
      this.post(document, await document.rawMessage());
    };
    this._onDidChangeCustomDocument.fire({
      document,
      label: 'Edit raw text',
      undo: async () => {
        document.restore(before);
        await refresh();
      },
      redo: async () => {
        document.restore(after);
        await refresh();
      },
    });
  }

  /** Row/column/sheet operations, undone by restoring a shallow workbook snapshot. */
  private applyStructural(document: SheetDocument, msg: any) {
    const before = document.snapshot();
    const wb = document.workbook;
    let active: string = msg.sheet;
    document.edited = true;
    switch (msg.op) {
      case 'insertRows':
      case 'deleteRows':
      case 'insertCols':
      case 'deleteCols': {
        const axis = msg.op.endsWith('Rows') ? 'row' : 'col';
        const count = msg.op.startsWith('insert') ? msg.count : -msg.count;
        wb.Sheets[msg.sheet] = shiftCells(document.sheet(msg.sheet), axis, msg.index, count);
        break;
      }
      case 'addSheet': {
        let i = wb.SheetNames.length + 1;
        while (wb.SheetNames.includes(`Sheet${i}`)) i++;
        active = `Sheet${i}`;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), active);
        break;
      }
      case 'renameSheet': {
        const name = String(msg.newName).trim().slice(0, 31);
        if (!name || /[\\/?*[\]:]/.test(name) || wb.SheetNames.includes(name)) {
          vscode.window.showWarningMessage(`Invalid or duplicate sheet name: "${name}"`);
          this.sendAll(document, msg.sheet);
          return;
        }
        wb.SheetNames = wb.SheetNames.map((n) => (n === msg.sheet ? name : n));
        wb.Sheets = { ...wb.Sheets, [name]: wb.Sheets[msg.sheet] };
        delete wb.Sheets[msg.sheet];
        active = name;
        break;
      }
      case 'deleteSheet': {
        if (wb.SheetNames.length <= 1) {
          vscode.window.showWarningMessage('A workbook must contain at least one sheet.');
          return;
        }
        const idx = wb.SheetNames.indexOf(msg.sheet);
        wb.SheetNames = wb.SheetNames.filter((n) => n !== msg.sheet);
        wb.Sheets = { ...wb.Sheets };
        delete wb.Sheets[msg.sheet];
        active = wb.SheetNames[Math.max(0, idx - 1)];
        break;
      }
      default:
        return;
    }
    const after = document.snapshot();
    this.sendAll(document, active);
    this._onDidChangeCustomDocument.fire({
      document,
      label: msg.op,
      undo: () => {
        document.restore(before);
        this.sendAll(document, msg.sheet);
      },
      redo: () => {
        document.restore(after);
        this.sendAll(document, active);
      },
    });
  }

  saveCustomDocument(document: SheetDocument): Thenable<void> {
    return document.save(document.uri);
  }

  saveCustomDocumentAs(document: SheetDocument, destination: vscode.Uri): Thenable<void> {
    const sourceFormat = formatFor(document.uri);
    const targetFormat = formatFor(destination);
    if (sourceFormat.kind !== targetFormat.kind || (sourceFormat.kind === 'text' && targetFormat.kind === 'text' && sourceFormat.separator !== targetFormat.separator)) {
      // Different format: write through a temporary document of the target type.
      const temp = Object.create(SheetDocument.prototype) as SheetDocument;
      Object.assign(temp, { uri: destination, workbook: document.workbook, format: targetFormat });
      return temp.save(destination);
    }
    return document.save(destination);
  }

  async revertCustomDocument(document: SheetDocument): Promise<void> {
    await document.reload();
    this.sendAll(document);
  }

  async backupCustomDocument(document: SheetDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(context.destination, document.serialize());
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // already gone
        }
      },
    };
  }
}
