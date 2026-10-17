import * as vscode from 'vscode';
import { applyMinimalTextEdit, buildWebviewHtml, localResourceRoots } from '../util';

/**
 * WYSIWYG Markdown editor. VS Code owns the TextDocument (dirty state, save, hot exit);
 * the webview edits a rendered copy and both sides are kept in sync.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'docdeck.markdown';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(MarkdownEditorProvider.viewType, new MarkdownEditorProvider(context), {
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
    // Relative image paths in the markdown are resolved against the document's folder.
    const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..')).toString() + '/';
    webview.html = buildWebviewHtml(webview, this.context.extensionUri, 'markdown', 'Markdown Editor', { baseUri });

    const toWebview = (text: string) => text.replace(/\r\n/g, '\n');
    const fromWebview = (text: string) => (document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text);

    /** Text most recently applied from the webview, so its echo in onDidChangeTextDocument is ignored. */
    let lastFromWebview: string | undefined;
    let editQueue = Promise.resolve();

    const disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || !e.contentChanges.length) {
          return;
        }
        const text = document.getText();
        if (text !== lastFromWebview) {
          webview.postMessage({ type: 'update', text: toWebview(text) });
        }
      }),
      webview.onDidReceiveMessage((msg) => {
        switch (msg.type) {
          case 'ready':
            webview.postMessage({ type: 'init', text: toWebview(document.getText()) });
            break;
          case 'edit': {
            const text = fromWebview(msg.text);
            // Serialize edits so a slow applyEdit never interleaves with the next one.
            editQueue = editQueue.then(async () => {
              lastFromWebview = text;
              await applyMinimalTextEdit(document, text);
            });
            break;
          }
          case 'openLink':
            this.openLink(document, String(msg.href));
            break;
        }
      }),
    ];
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }

  private openLink(document: vscode.TextDocument, href: string) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const [path] = href.split('#');
    if (path) {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(document.uri, '..', decodeURIComponent(path)));
    }
  }
}
