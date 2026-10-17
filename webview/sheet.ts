import './sheet.css';
import { h, keepUndoInsideEditable, vscode } from './common';

interface Sheet {
  name: string;
  rows: number;
  cols: number;
  display: ((string | null)[] | null)[];
  raw: Record<string, string>;
  colWidths: (number | null)[];
}
interface Pos {
  r: number;
  c: number;
}

const ROW_H = 24;
const HEADER_H = 24;
const DEFAULT_COL_W = 100;
const MIN_COL_W = 30;
const BUFFER = 3;

let sheets: Sheet[] = [];
let active = 0;
let singleSheet = false;
let totalRows = 0;
let totalCols = 0;
let rowHeaderW = 50;
let colLeft: number[] = [0];

let anchor: Pos = { r: 0, c: 0 };
let focus: Pos = { r: 0, c: 0 };
let editing: { pos: Pos; original: string } | null = null;

// ---------- DOM ----------
const cellName = h('div', { className: 'cell-name' });
const formulaInput = h('input', { className: 'formula-input', spellcheck: false });
const formulaBar = h('div', { className: 'formula-bar' }, cellName, h('span', { className: 'fx', textContent: 'fx' }), formulaInput);

const corner = h('div', { className: 'corner', title: 'Select all' });
const colHeaderInner = h('div', { className: 'header-inner' });
const colHeader = h('div', { className: 'col-header' }, colHeaderInner);
const rowHeaderInner = h('div', { className: 'header-inner' });
const rowHeader = h('div', { className: 'row-header' }, rowHeaderInner);
const cellsLayer = h('div', { className: 'cells' });
const selectionBox = h('div', { className: 'selection' });
const activeBox = h('div', { className: 'active-cell' });
const editor = h('input', { className: 'cell-editor', spellcheck: false });
const spacer = h('div', { className: 'spacer' }, cellsLayer, selectionBox, activeBox, editor);
const body = h('div', { className: 'body', tabIndex: 0 }, spacer);
const gridWrap = h('div', { className: 'grid-wrap' }, corner, colHeader, rowHeader, body);
const tabs = h('div', { className: 'tabs' });
const menu = h('div', { className: 'context-menu', hidden: true });
const status = h('div', { className: 'status' });

document.getElementById('app')!.append(formulaBar, gridWrap, h('div', { className: 'footer' }, tabs, status), menu);
editor.hidden = true;
keepUndoInsideEditable();

// ---------- Model helpers ----------
const sheet = () => sheets[active];

function getDisplay(r: number, c: number): string {
  return sheet().display[r]?.[c] ?? '';
}

function getRaw(r: number, c: number): string {
  return sheet().raw[`${r},${c}`] ?? getDisplay(r, c);
}

function setLocal(r: number, c: number, display: string, raw: string) {
  const s = sheet();
  (s.display[r] ??= [])[c] = display;
  if (raw !== display) s.raw[`${r},${c}`] = raw;
  else delete s.raw[`${r},${c}`];
  s.rows = Math.max(s.rows, display ? r + 1 : 0);
  s.cols = Math.max(s.cols, display ? c + 1 : 0);
}

function colName(c: number): string {
  let s = '';
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

function colWidth(c: number): number {
  return sheet().colWidths[c] ?? DEFAULT_COL_W;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isNumeric = (s: string) => /^[-+]?[$€£₹]?[\d,]*\.?\d+([eE][-+]?\d+)?%?$/.test(s.trim());

function selRange() {
  return {
    r0: Math.min(anchor.r, focus.r),
    r1: Math.max(anchor.r, focus.r),
    c0: Math.min(anchor.c, focus.c),
    c1: Math.max(anchor.c, focus.c),
  };
}

// ---------- Layout ----------
function ensureSize(r = 0, c = 0) {
  const s = sheet();
  const rows = Math.max(s.rows + 100, 200, r + 50, totalRows);
  const cols = Math.max(s.cols + 10, 26, c + 5, totalCols);
  if (rows !== totalRows || cols !== totalCols) {
    totalRows = rows;
    totalCols = cols;
    relayout();
  }
}

function relayout() {
  colLeft = [0];
  for (let c = 0; c < totalCols; c++) colLeft.push(colLeft[c] + colWidth(c));
  rowHeaderW = Math.max(46, String(totalRows).length * 8 + 20);
  gridWrap.style.setProperty('--row-header-w', `${rowHeaderW}px`);
  spacer.style.width = `${colLeft[totalCols]}px`;
  spacer.style.height = `${totalRows * ROW_H}px`;
  scheduleRender();
}

function colAt(x: number): number {
  let lo = 0;
  let hi = totalCols - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (colLeft[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

let renderQueued = false;
function scheduleRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }
}

function render() {
  if (!sheet()) return;
  const { scrollTop, scrollLeft, clientHeight, clientWidth } = body;
  const r0 = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const r1 = Math.min(totalRows - 1, Math.ceil((scrollTop + clientHeight) / ROW_H) + BUFFER);
  const c0 = Math.max(0, colAt(scrollLeft) - 1);
  const c1 = Math.min(totalCols - 1, colAt(scrollLeft + clientWidth) + 1);

  let html = '';
  for (let r = r0; r <= r1; r++) {
    const row = sheet().display[r];
    for (let c = c0; c <= c1; c++) {
      const text = row?.[c] ?? '';
      const cls = text && isNumeric(text) ? 'cell num' : 'cell';
      html += `<div class="${cls}" style="top:${r * ROW_H}px;left:${colLeft[c]}px;width:${colWidth(c)}px">${text && escapeHtml(text)}</div>`;
    }
  }
  cellsLayer.innerHTML = html;

  const sel = selRange();
  let colHtml = '';
  for (let c = c0; c <= c1; c++) {
    const on = c >= sel.c0 && c <= sel.c1 ? ' on' : '';
    colHtml += `<div class="hcell${on}" data-c="${c}" style="left:${colLeft[c]}px;width:${colWidth(c)}px">${colName(c)}<span class="resizer" data-c="${c}"></span></div>`;
  }
  colHeaderInner.innerHTML = colHtml;
  colHeaderInner.style.transform = `translateX(${-scrollLeft}px)`;

  let rowHtml = '';
  for (let r = r0; r <= r1; r++) {
    const on = r >= sel.r0 && r <= sel.r1 ? ' on' : '';
    rowHtml += `<div class="hcell${on}" data-r="${r}" style="top:${r * ROW_H}px">${r + 1}</div>`;
  }
  rowHeaderInner.innerHTML = rowHtml;
  rowHeaderInner.style.transform = `translateY(${-scrollTop}px)`;

  placeBox(selectionBox, sel.r0, sel.c0, sel.r1, sel.c1);
  selectionBox.hidden = sel.r0 === sel.r1 && sel.c0 === sel.c1;
  placeBox(activeBox, focus.r, focus.c, focus.r, focus.c);
}

function placeBox(el: HTMLElement, r0: number, c0: number, r1: number, c1: number) {
  el.style.top = `${r0 * ROW_H}px`;
  el.style.left = `${colLeft[c0]}px`;
  el.style.width = `${colLeft[c1 + 1] - colLeft[c0]}px`;
  el.style.height = `${(r1 - r0 + 1) * ROW_H}px`;
}

function updateFormulaBar() {
  const sel = selRange();
  cellName.textContent =
    sel.r0 === sel.r1 && sel.c0 === sel.c1
      ? `${colName(focus.c)}${focus.r + 1}`
      : `${colName(sel.c0)}${sel.r0 + 1}:${colName(sel.c1)}${sel.r1 + 1}`;
  if (document.activeElement !== formulaInput) {
    formulaInput.value = getRaw(focus.r, focus.c);
  }
  const s = sheet();
  status.textContent = `${s.rows.toLocaleString()} rows × ${s.cols.toLocaleString()} columns`;
}

function scrollIntoView(p: Pos) {
  const top = p.r * ROW_H;
  const left = colLeft[p.c];
  const right = colLeft[p.c + 1];
  if (top < body.scrollTop) body.scrollTop = top;
  else if (top + ROW_H > body.scrollTop + body.clientHeight) body.scrollTop = top + ROW_H - body.clientHeight;
  if (left < body.scrollLeft) body.scrollLeft = left;
  else if (right > body.scrollLeft + body.clientWidth) body.scrollLeft = right - body.clientWidth;
}

function select(p: Pos, extend = false) {
  p = { r: Math.max(0, p.r), c: Math.max(0, p.c) };
  ensureSize(p.r, p.c);
  focus = p;
  if (!extend) anchor = { ...p };
  scrollIntoView(p);
  updateFormulaBar();
  scheduleRender();
}

// ---------- Editing ----------
function startEdit(initial?: string) {
  const pos = { ...focus };
  const original = getRaw(pos.r, pos.c);
  editing = { pos, original };
  editor.value = initial ?? original;
  placeBox(editor, pos.r, pos.c, pos.r, pos.c);
  editor.style.minWidth = editor.style.width;
  editor.hidden = false;
  editor.focus();
  if (initial === undefined) editor.select();
}

function commitEdit(move?: Pos) {
  if (!editing) return;
  const { pos, original } = editing;
  const value = editor.value;
  editing = null;
  editor.hidden = true;
  if (value !== original) sendChanges([{ r: pos.r, c: pos.c, value }]);
  body.focus();
  if (move) select({ r: pos.r + move.r, c: pos.c + move.c });
  else updateFormulaBar();
}

function cancelEdit() {
  editing = null;
  editor.hidden = true;
  body.focus();
  updateFormulaBar();
}

function sendChanges(changes: { r: number; c: number; value: string }[]) {
  if (!changes.length) return;
  for (const { r, c, value } of changes) setLocal(r, c, value, value);
  scheduleRender();
  vscode.postMessage({ type: 'setCells', sheet: sheet().name, changes });
}

function clearSelection() {
  const { r0, r1, c0, c1 } = selRange();
  const changes = [];
  for (let r = r0; r <= Math.min(r1, sheet().rows - 1); r++) {
    for (let c = c0; c <= Math.min(c1, sheet().cols - 1); c++) {
      if (getRaw(r, c) !== '') changes.push({ r, c, value: '' });
    }
  }
  sendChanges(changes);
  updateFormulaBar();
}

function structure(op: string, extra: Record<string, unknown> = {}) {
  vscode.postMessage({ type: 'structure', op, sheet: sheet().name, ...extra });
}

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit({ r: e.shiftKey ? -1 : 1, c: 0 });
  } else if (e.key === 'Tab') {
    e.preventDefault();
    commitEdit({ r: 0, c: e.shiftKey ? -1 : 1 });
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    commitEdit(); // let the keystroke continue to VS Code so the file is saved
  }
});
editor.addEventListener('blur', () => {
  if (editing) commitEdit();
});

formulaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's')) {
    if (formulaInput.value !== getRaw(focus.r, focus.c)) {
      sendChanges([{ r: focus.r, c: focus.c, value: formulaInput.value }]);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      body.focus();
      select({ r: focus.r + 1, c: focus.c });
    }
  } else if (e.key === 'Escape') {
    formulaInput.value = getRaw(focus.r, focus.c);
    body.focus();
  }
});

// ---------- Keyboard ----------
body.addEventListener('keydown', (e) => {
  if (editing) return;
  const mod = e.metaKey || e.ctrlKey;
  const s = sheet();
  const moves: Record<string, Pos> = {
    ArrowUp: { r: -1, c: 0 },
    ArrowDown: { r: 1, c: 0 },
    ArrowLeft: { r: 0, c: -1 },
    ArrowRight: { r: 0, c: 1 },
  };
  if (moves[e.key]) {
    e.preventDefault();
    const d = moves[e.key];
    let target = { r: focus.r + d.r, c: focus.c + d.c };
    if (mod) {
      target = {
        r: d.r < 0 ? 0 : d.r > 0 ? Math.max(0, s.rows - 1) : focus.r,
        c: d.c < 0 ? 0 : d.c > 0 ? Math.max(0, s.cols - 1) : focus.c,
      };
    }
    select(target, e.shiftKey);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    select({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) select({ r: focus.r - 1, c: focus.c });
    else startEdit();
  } else if (e.key === 'F2') {
    e.preventDefault();
    startEdit();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    clearSelection();
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    const page = Math.floor(body.clientHeight / ROW_H) - 1;
    select({ r: focus.r + (e.key === 'PageDown' ? page : -page), c: focus.c }, e.shiftKey);
  } else if (e.key === 'Home') {
    e.preventDefault();
    select({ r: mod ? 0 : focus.r, c: 0 }, e.shiftKey);
  } else if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    anchor = { r: 0, c: 0 };
    focus = { r: Math.max(0, s.rows - 1), c: Math.max(0, s.cols - 1) };
    updateFormulaBar();
    scheduleRender();
  } else if (e.key.length === 1 && !mod && !e.altKey) {
    e.preventDefault();
    startEdit(e.key);
  }
});

// ---------- Clipboard ----------
function selectionAsTsv(): string {
  const { r0, r1, c0, c1 } = selRange();
  const lines: string[] = [];
  for (let r = r0; r <= Math.min(r1, sheet().rows - 1); r++) {
    const cells: string[] = [];
    for (let c = c0; c <= Math.min(c1, sheet().cols - 1); c++) {
      const v = getDisplay(r, c);
      cells.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const gridHasFocus = () => document.activeElement === body;

document.addEventListener('copy', (e) => {
  if (!gridHasFocus()) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', selectionAsTsv());
});
document.addEventListener('cut', (e) => {
  if (!gridHasFocus()) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', selectionAsTsv());
  clearSelection();
});
document.addEventListener('paste', (e) => {
  if (!gridHasFocus()) return;
  e.preventDefault();
  const rows = parseTsv(e.clipboardData?.getData('text/plain') ?? '');
  const changes = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      changes.push({ r: focus.r + i, c: focus.c + j, value: rows[i][j] });
    }
  }
  sendChanges(changes);
  if (rows.length) {
    anchor = { ...focus };
    select({ r: focus.r + rows.length - 1, c: focus.c + Math.max(...rows.map((r) => r.length)) - 1 }, true);
  }
});

// ---------- Mouse ----------
function posFromEvent(e: MouseEvent): Pos {
  const rect = spacer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  return { r: Math.max(0, Math.min(totalRows - 1, Math.floor(y / ROW_H))), c: colAt(Math.max(0, x)) };
}

let dragging = false;
body.addEventListener('mousedown', (e) => {
  if (e.target === editor) return;
  if (e.button === 2) {
    const p = posFromEvent(e);
    const sel = selRange();
    if (p.r < sel.r0 || p.r > sel.r1 || p.c < sel.c0 || p.c > sel.c1) select(p);
    return;
  }
  if (editing) commitEdit();
  dragging = true;
  select(posFromEvent(e), e.shiftKey);
});
body.addEventListener('dblclick', (e) => {
  if (e.target !== editor) startEdit();
});
window.addEventListener('mousemove', (e) => {
  if (dragging) select(posFromEvent(e), true);
});
window.addEventListener('mouseup', () => (dragging = false));
body.addEventListener('scroll', scheduleRender);
new ResizeObserver(scheduleRender).observe(body);

corner.addEventListener('click', () => {
  anchor = { r: 0, c: 0 };
  focus = { r: Math.max(0, sheet().rows - 1), c: Math.max(0, sheet().cols - 1) };
  updateFormulaBar();
  scheduleRender();
  body.focus();
});

let resizing: { c: number; startX: number; startW: number } | null = null;
colHeader.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('resizer')) {
    const c = Number(target.dataset.c);
    resizing = { c, startX: e.clientX, startW: colWidth(c) };
    e.preventDefault();
    return;
  }
  const c = Number(target.closest<HTMLElement>('[data-c]')?.dataset.c);
  if (Number.isNaN(c)) return;
  if (e.button === 2 && c >= selRange().c0 && c <= selRange().c1) return;
  if (!e.shiftKey) anchor = { r: 0, c };
  focus = { r: Math.max(totalRows - 1, 0), c };
  updateFormulaBar();
  scheduleRender();
  body.focus();
});
window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  sheet().colWidths[resizing.c] = Math.max(MIN_COL_W, resizing.startW + e.clientX - resizing.startX);
  relayout();
});
window.addEventListener('mouseup', () => (resizing = null));

rowHeader.addEventListener('mousedown', (e) => {
  const r = Number((e.target as HTMLElement).closest<HTMLElement>('[data-r]')?.dataset.r);
  if (Number.isNaN(r)) return;
  if (e.button === 2 && r >= selRange().r0 && r <= selRange().r1) return;
  if (!e.shiftKey) anchor = { r, c: 0 };
  focus = { r, c: Math.max(totalCols - 1, 0) };
  updateFormulaBar();
  scheduleRender();
  body.focus();
});

// ---------- Context menu ----------
type MenuItem = { label: string; action: () => void } | 'sep';

function showMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  menu.replaceChildren(
    ...items.map((item) =>
      item === 'sep'
        ? h('div', { className: 'sep' })
        : h('div', {
            className: 'item',
            textContent: item.label,
            onclick: () => {
              hideMenu();
              item.action();
            },
          }),
    ),
  );
  menu.hidden = false;
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - rect.height - 4)}px`;
}
function hideMenu() {
  menu.hidden = true;
}
window.addEventListener('mousedown', (e) => {
  if (!menu.contains(e.target as Node)) hideMenu();
});
window.addEventListener('blur', hideMenu);

function rowItems(): MenuItem[] {
  const { r0, r1 } = selRange();
  const n = r1 - r0 + 1;
  return [
    { label: `Insert ${n > 1 ? n + ' rows' : 'row'} above`, action: () => structure('insertRows', { index: r0, count: n }) },
    { label: `Insert ${n > 1 ? n + ' rows' : 'row'} below`, action: () => structure('insertRows', { index: r1 + 1, count: n }) },
    { label: `Delete ${n > 1 ? n + ' rows' : 'row'}`, action: () => structure('deleteRows', { index: r0, count: n }) },
  ];
}
function colItems(): MenuItem[] {
  const { c0, c1 } = selRange();
  const n = c1 - c0 + 1;
  return [
    { label: `Insert ${n > 1 ? n + ' columns' : 'column'} left`, action: () => structure('insertCols', { index: c0, count: n }) },
    { label: `Insert ${n > 1 ? n + ' columns' : 'column'} right`, action: () => structure('insertCols', { index: c1 + 1, count: n }) },
    { label: `Delete ${n > 1 ? n + ' columns' : 'column'}`, action: () => structure('deleteCols', { index: c0, count: n }) },
  ];
}

rowHeader.addEventListener('contextmenu', (e) => showMenu(e, rowItems()));
colHeader.addEventListener('contextmenu', (e) => showMenu(e, colItems()));
body.addEventListener('contextmenu', (e) =>
  showMenu(e, [
    { label: 'Copy', action: () => document.execCommand('copy') },
    { label: 'Clear contents', action: clearSelection },
    'sep',
    ...rowItems(),
    'sep',
    ...colItems(),
  ]),
);

// ---------- Tabs ----------
function renderTabs() {
  tabs.replaceChildren(
    ...sheets.map((s, i) => {
      const tab = h('button', { className: i === active ? 'tab on' : 'tab', textContent: s.name, title: singleSheet ? s.name : 'Double-click to rename' });
      tab.onclick = () => switchSheet(i);
      if (!singleSheet) {
        tab.ondblclick = () => renameTab(tab, s.name);
        tab.oncontextmenu = (e) =>
          showMenu(e, [
            { label: 'Rename', action: () => renameTab(tab, s.name) },
            { label: 'Delete sheet', action: () => structure('deleteSheet', { sheet: s.name }) },
          ]);
      }
      return tab;
    }),
  );
  if (!singleSheet) {
    tabs.append(h('button', { className: 'tab add', textContent: '+', title: 'Add sheet', onclick: () => structure('addSheet') }));
  }
}

function renameTab(tab: HTMLElement, name: string) {
  const input = h('input', { className: 'tab-input', value: name });
  tab.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() && input.value !== name) structure('renameSheet', { sheet: name, newName: input.value });
    else renderTabs();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

function switchSheet(i: number) {
  if (editing) commitEdit();
  active = i;
  totalRows = 0;
  totalCols = 0;
  anchor = { r: 0, c: 0 };
  focus = { r: 0, c: 0 };
  body.scrollTop = 0;
  body.scrollLeft = 0;
  ensureSize();
  relayout();
  renderTabs();
  updateFormulaBar();
  body.focus();
}

// ---------- Messages ----------
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const prevName = sheets[active]?.name;
    const prevFocus = focus;
    const prevScroll = { top: body.scrollTop, left: body.scrollLeft };
    sheets = msg.sheets;
    singleSheet = msg.singleSheet;
    const wanted = msg.activeSheet ?? prevName;
    const idx = sheets.findIndex((s) => s.name === wanted);
    if (idx >= 0 && sheets[idx].name === prevName) {
      // Same sheet re-sent (e.g. after inserting rows): keep the view where it was.
      active = idx;
      totalRows = 0;
      totalCols = 0;
      ensureSize(prevFocus.r, prevFocus.c);
      relayout();
      renderTabs();
      body.scrollTop = prevScroll.top;
      body.scrollLeft = prevScroll.left;
      select(prevFocus);
    } else {
      switchSheet(Math.max(0, idx));
    }
  } else if (msg.type === 'cells') {
    const i = sheets.findIndex((s) => s.name === msg.sheet);
    if (i < 0) return;
    if (i !== active) switchSheet(i);
    for (const cell of msg.cells) setLocal(cell.r, cell.c, cell.display, cell.raw);
    if (msg.select) select(msg.select);
    else updateFormulaBar();
    scheduleRender();
  }
});

vscode.postMessage({ type: 'ready' });
