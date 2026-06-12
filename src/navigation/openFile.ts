import * as childProcess from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFile = promisify(childProcess.execFile);

export async function openFileAtLine(file: string, line: number): Promise<void> {
  if (await tryOpenCsFileInVisualStudio(file, line)) {
    return;
  }

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

async function tryOpenCsFileInVisualStudio(file: string, line: number): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("ruleTrace");
  const enabled = config.get<boolean>("openCsFilesInVisualStudio", true);
  if (!enabled || process.platform !== "win32" || path.extname(file).toLowerCase() !== ".cs") {
    return false;
  }

  if (!(await isVisualStudioRunning())) {
    return false;
  }

  const devenvPath = await resolveVisualStudioExecutable(config.get<string>("visualStudioPath", ""));
  if (!devenvPath) {
    return false;
  }

  try {
    await execFile(devenvPath, ["/edit", file], { windowsHide: true });
    if (line > 0) {
      setTimeout(() => {
        execFile(devenvPath, ["/command", `Edit.GoTo ${line}`], { windowsHide: true }).catch(() => undefined);
      }, 250);
    }
    return true;
  } catch {
    return false;
  }
}

async function isVisualStudioRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFile("tasklist.exe", ["/FO", "CSV"], { windowsHide: true });
    const processList = stdout.toLowerCase();
    return (
      processList.includes("devenv.exe") ||
      processList.includes("devhub") ||
      processList.includes("visualstudio")
    );
  } catch {
    return false;
  }
}

async function resolveVisualStudioExecutable(configuredPath: string): Promise<string | undefined> {
  if (configuredPath.trim()) {
    return configuredPath.trim();
  }

  const vswherePath = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  try {
    const { stdout } = await execFile(
      vswherePath,
      ["-latest", "-products", "*", "-find", "Common7\\IDE\\devenv.exe"],
      { windowsHide: true }
    );
    const detectedPath = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
    if (detectedPath) {
      return detectedPath;
    }
  } catch {
    // Fall back to PATH lookup below.
  }

  return "devenv.exe";
}
