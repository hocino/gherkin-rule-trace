import * as path from "path";
import * as vscode from "vscode";

export function normalizeFsPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function getWorkspaceRelativePath(filePath: string): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  if (!workspaceFolder) {
    return normalizeFsPath(filePath);
  }

  return normalizeFsPath(path.relative(workspaceFolder.uri.fsPath, filePath));
}

export function getWorkspaceFolderLabel(filePath: string): string | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  return workspaceFolder?.name;
}

export function isTestFile(filePath: string): boolean {
  const normalized = normalizeFsPath(filePath).toLowerCase();
  const baseName = path.basename(normalized);
  const segments = normalized.split("/");

  return (
    baseName.includes(".test.") ||
    baseName.includes(".spec.") ||
    segments.includes("test") ||
    segments.includes("tests") ||
    segments.includes("__tests__") ||
    segments.includes("bdd") ||
    segments.includes("e2e")
  );
}

export function pathDepth(relativePath: string): number {
  return normalizeFsPath(relativePath).split("/").filter(Boolean).length;
}
