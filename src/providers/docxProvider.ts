import * as vscode from 'vscode';
import mammoth from 'mammoth';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { buildWebviewHtml, localResourceRoots } from '../util';

const BACKUP_PREFIX = '<!--docdeck-docx-backup-->';

class DocxDocument implements vscode.CustomDocument {
  /** Set once the user has agreed to overwrite the original file during this session. */
  overwriteConfirmed = false;

  constructor(
    public readonly uri: vscode.Uri,
    /** Current editor content as HTML. */
    public html: string,
    /** Conversion warnings from mammoth (unsupported features in the original file). */
    public warnings: string[],
  ) {}

  static async load(uri: vscode.Uri, backupId?: string): Promise<DocxDocument> {
    if (backupId) {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(backupId)));
      if (text.startsWith(BACKUP_PREFIX)) {
        return new DocxDocument(uri, text.slice(BACKUP_PREFIX.length), []);
      }
    }
    const { html, warnings } = await DocxDocument.convert(uri);
    return new DocxDocument(uri, html, warnings);
  }

  static async convert(uri: vscode.Uri): Promise<{ html: string; warnings: string[] }> {
    const data = await vscode.workspace.fs.readFile(uri);
    if (data.byteLength === 0) {
      return { html: '<p></p>', warnings: [] };
    }
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(data) },
      {
        styleMap: ['u => u', 'strike => s', "p[style-name='Title'] => h1.title:fresh", "p[style-name='Subtitle'] => h2.subtitle:fresh"],
        includeDefaultStyleMap: true,
      },
    );
    const warnings = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
    return { html: result.value || '<p></p>', warnings };
  }

  async toDocx(): Promise<Uint8Array> {
    const title = this.uri.path.split('/').pop()?.replace(/\.docx$/i, '') ?? 'Document';
    const body = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${this.html}</body></html>`;
    const result = await HTMLtoDOCX(body, null, {
      title,
      table: { row: { cantSplit: true } },
      font: 'Calibri',
      fontSize: 22,
      decodeUnicode: true,
    } as never);
    if (result instanceof ArrayBuffer) {
      return new Uint8Array(result);
    }
    if (typeof Blob !== 'undefined' && result instanceof Blob) {
      return new Uint8Array(await result.arrayBuffer());
    }
    return new Uint8Array(result as Buffer);
  }

  dispose() {}
}

/**
 * Word document editor. Opens .docx as rich text (via mammoth) and saves back to .docx (via html-to-docx).
 * Undo/redo is handled by the editor inside the webview.
 */
export class DocxEditorProvider implements vscode.CustomEditorProvider<DocxDocument> {
  static readonly viewType = 'docdeck.docx';

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<DocxDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  private readonly panels = new Map<DocxDocument, Set<vscode.WebviewPanel>>();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(DocxEditorProvider.viewType, new DocxEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<DocxDocument> {
    return DocxDocument.load(uri, openContext.backupId);
  }

  resolveCustomEditor(document: DocxDocument, panel: vscode.WebviewPanel): void {
    const { webview } = panel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots(this.context.extensionUri, document.uri),
    };
    webview.html = buildWebviewHtml(webview, this.context.extensionUri, 'docx', 'Word Document');

    const set = this.panels.get(document) ?? new Set();
    set.add(panel);
    this.panels.set(document, set);
    panel.onDidDispose(() => set.delete(panel));

    webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          webview.postMessage({ type: 'load', html: document.html, warnings: document.warnings });
          break;
        case 'change':
          document.html = msg.html;
          this._onDidChangeCustomDocument.fire({ document });
          break;
      }
    });
  }

  private async confirmOverwrite(document: DocxDocument): Promise<'save' | 'copy' | 'cancel'> {
    const confirm = vscode.workspace.getConfiguration('docdeck').get<boolean>('docx.confirmBeforeSave', true);
    if (!confirm || document.overwriteConfirmed) {
      return 'save';
    }
    const overwrite = 'Overwrite';
    const copy = 'Save as Copy…';
    const choice = await vscode.window.showWarningMessage(
      `Saving rewrites "${document.uri.path.split('/').pop()}" with simplified formatting.`,
      {
        modal: true,
        detail:
          'Text, headings, lists, tables, links, images and basic styling are kept. Headers/footers, comments, tracked changes, custom styles and page layout may be lost. Save a copy if you need to keep the original.',
      },
      overwrite,
      copy,
    );
    if (choice === overwrite) {
      document.overwriteConfirmed = true;
      return 'save';
    }
    return choice === copy ? 'copy' : 'cancel';
  }

  async saveCustomDocument(document: DocxDocument): Promise<void> {
    const choice = await this.confirmOverwrite(document);
    if (choice === 'cancel') {
      throw new vscode.CancellationError();
    }
    if (choice === 'copy') {
      const target = await vscode.window.showSaveDialog({
        defaultUri: document.uri.with({ path: document.uri.path.replace(/\.docx$/i, ' (edited).docx') }),
        filters: { 'Word Document': ['docx'] },
      });
      if (target) {
        await vscode.workspace.fs.writeFile(target, await document.toDocx());
        vscode.window.showInformationMessage(`Saved a copy to ${vscode.workspace.asRelativePath(target)}. The original is unchanged.`);
      }
      // The original stays dirty, since it was not written.
      throw new vscode.CancellationError();
    }
    await vscode.workspace.fs.writeFile(document.uri, await document.toDocx());
  }

  async saveCustomDocumentAs(document: DocxDocument, destination: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.writeFile(destination, await document.toDocx());
  }

  async revertCustomDocument(document: DocxDocument): Promise<void> {
    const { html, warnings } = await DocxDocument.convert(document.uri);
    document.html = html;
    document.warnings = warnings;
    for (const panel of this.panels.get(document) ?? []) {
      panel.webview.postMessage({ type: 'load', html, warnings });
    }
  }

  async backupCustomDocument(document: DocxDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    // Back up the editor HTML (lossless for the editor) rather than a converted .docx.
    await vscode.workspace.fs.writeFile(context.destination, new TextEncoder().encode(BACKUP_PREFIX + document.html));
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
