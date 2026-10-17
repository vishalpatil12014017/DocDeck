import * as vscode from 'vscode';

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

/** Folders a webview may load local files from: the bundled assets, the document's folder and the workspace. */
export function localResourceRoots(extensionUri: vscode.Uri, documentUri: vscode.Uri): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'dist')];
  roots.push(vscode.Uri.joinPath(documentUri, '..'));
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.push(folder.uri);
  }
  return roots;
}

/**
 * Builds the HTML shell for one of the bundled webview apps (dist/webview/<name>.js + .css).
 * `extraData` is exposed to the page as `window.__DOCDECK__`.
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  name: string,
  title: string,
  extraData: Record<string, unknown> = {},
): string {
  const nonce = getNonce();
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file)).toString();
  const data = { assetBase: asset(''), ...extraData };
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'`,
    `worker-src blob:`,
    `connect-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="${asset(`${name}.css`)}">
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.__DOCDECK__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
  <script nonce="${nonce}" type="module" src="${asset(`${name}.js`)}"></script>
</body>
</html>`;
}

/** Replace a text document's content with the smallest single edit (keeps undo granular and cursor stable). */
export async function applyMinimalTextEdit(document: vscode.TextDocument, newText: string): Promise<boolean> {
  const oldText = document.getText();
  if (oldText === newText) {
    return true;
  }
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start++;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(start), document.positionAt(oldEnd)),
    newText.slice(start, newEnd),
  );
  return vscode.workspace.applyEdit(edit);
}

/** Re-sends a file to its webview whenever it changes on disk (for read-only viewers). */
export function watchFile(uri: vscode.Uri, onChange: () => void): vscode.Disposable {
  if (uri.scheme !== 'file') {
    return new vscode.Disposable(() => {});
  }
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop()!),
  );
  let timer: NodeJS.Timeout | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  };
  watcher.onDidChange(fire);
  watcher.onDidCreate(fire);
  return new vscode.Disposable(() => {
    clearTimeout(timer);
    watcher.dispose();
  });
}
