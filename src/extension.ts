import * as vscode from 'vscode';
import { PdfEditorProvider } from './providers/pdfProvider';
import { SheetEditorProvider } from './providers/sheetProvider';
import { DocxEditorProvider } from './providers/docxProvider';
import { MarkdownEditorProvider } from './providers/markdownProvider';
import { MermaidEditorProvider } from './providers/mermaidProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    PdfEditorProvider.register(context),
    SheetEditorProvider.register(context),
    DocxEditorProvider.register(context),
    MarkdownEditorProvider.register(context),
    MermaidEditorProvider.register(context),

    vscode.commands.registerCommand('docdeck.openMarkdownEditor', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) {
        return vscode.commands.executeCommand('vscode.openWith', target, MarkdownEditorProvider.viewType);
      }
    }),

    vscode.commands.registerCommand('docdeck.openSource', async (uri?: vscode.Uri) => {
      const target = uri ?? activeCustomEditorUri();
      if (target) {
        const document = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
      }
    }),
  );
}

function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

export function deactivate() {}
