import * as vscode from "vscode";

export async function openFileAtLine(file: string, line: number): Promise<void> {
  const uri = vscode.Uri.file(file);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await showDocumentWithoutDuplicate(document);
  const position = new vscode.Position(Math.max(line - 1, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function showDocumentWithoutDuplicate(document: vscode.TextDocument): Promise<vscode.TextEditor> {
  const visibleEditor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === document.uri.toString());
  if (visibleEditor) {
    await vscode.window.showTextDocument(visibleEditor.document, visibleEditor.viewColumn, false);
    return visibleEditor;
  }

  const existingTab = findOpenTextTab(document.uri);
  if (existingTab) {
    return vscode.window.showTextDocument(document, {
      viewColumn: existingTab.viewColumn,
      preview: false
    });
  }

  return vscode.window.showTextDocument(document, { preview: false });
}

function findOpenTextTab(uri: vscode.Uri): { viewColumn: vscode.ViewColumn } | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) {
        return { viewColumn: group.viewColumn };
      }
    }
  }

  return undefined;
}
