import * as vscode from 'vscode';
import { applyMinimalTextEdit, buildWebviewHtml, localResourceRoots } from '../util';

/**
 * Mermaid diagram viewer for .mmd / .mermaid files, with a Raw tab for editing the source.
 * The diagram re-renders live as the source changes from either the Raw tab or a text editor.
 */
export class MermaidEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'docdeck.mermaid';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(MermaidEditorProvider.viewType, new MermaidEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const { webview } = panel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots(this.context.extensionUri, document.uri),
    };
    webview.html = buildWebviewHtml(webview, this.context.extensionUri, 'mermaid', 'Mermaid Diagram');

    // The webview works with \n line endings; CRLF files get theirs back when edits are applied.
    const sendText = () => webview.postMessage({ type: 'update', text: document.getText().replace(/\r\n/g, '\n') });
    const fromWebview = (text: string) => (document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text);

    const disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) {
          sendText();
        }
      }),
      webview.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
          case 'ready':
            sendText();
            break;
          case 'edit':
            await applyMinimalTextEdit(document, fromWebview(msg.text));
            break;
          case 'export':
            await this.export(document.uri, msg.format, msg.data);
            break;
        }
      }),
    ];
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }

  private async export(source: vscode.Uri, format: 'svg' | 'png', data: string) {
    const target = await vscode.window.showSaveDialog({
      defaultUri: source.with({ path: source.path.replace(/\.(mmd|mermaid)$/i, '') + `.${format}` }),
      filters: format === 'svg' ? { 'SVG Image': ['svg'] } : { 'PNG Image': ['png'] },
    });
    if (!target) {
      return;
    }
    const bytes = format === 'svg' ? new TextEncoder().encode(data) : Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64');
    await vscode.workspace.fs.writeFile(target, bytes);
    vscode.window.showInformationMessage(`Exported diagram to ${vscode.workspace.asRelativePath(target)}`);
  }
}
