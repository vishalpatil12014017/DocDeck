import * as vscode from 'vscode';
import { buildWebviewHtml, localResourceRoots, rawFileMessage, watchFile } from '../util';

class PdfDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose() {}
}

/** Read-only PDF viewer backed by pdf.js (zoom, page navigation, text selection, search). */
export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider<PdfDocument> {
  static readonly viewType = 'docdeck.pdf';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, new PdfEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: false },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): PdfDocument {
    return new PdfDocument(uri);
  }

  resolveCustomEditor(document: PdfDocument, panel: vscode.WebviewPanel): void {
    const { webview } = panel;
    webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots(this.context.extensionUri, document.uri),
    };
    webview.html = buildWebviewHtml(webview, this.context.extensionUri, 'pdf', 'PDF Viewer');

    const sendFile = async () => {
      try {
        const data = await vscode.workspace.fs.readFile(document.uri);
        // readFile returns a Node Buffer, which serializes to {type:'Buffer', data:[...]};
        // a plain Uint8Array is transferred to the webview as binary.
        webview.postMessage({ type: 'load', data: new Uint8Array(data) });
      } catch (err) {
        webview.postMessage({ type: 'error', message: String(err) });
      }
    };

    const disposables: vscode.Disposable[] = [
      webview.onDidReceiveMessage((msg) => {
        if (msg.type === 'ready') {
          sendFile();
        } else if (msg.type === 'getRaw') {
          rawFileMessage(document.uri).then((raw) => webview.postMessage(raw));
        } else if (msg.type === 'openLink' && typeof msg.url === 'string') {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
      }),
      watchFile(document.uri, sendFile),
    ];
    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }
}
