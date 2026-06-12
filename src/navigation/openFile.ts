import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFile = promisify(childProcess.execFile);
const access = promisify(fs.access);

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

  const devenvPath = await resolveVisualStudioExecutable();
  if (!devenvPath) {
    vscode.window.showWarningMessage(
      "Gherkin Rule Trace: Visual Studio is running, but devenv.exe was not found. Add the Visual Studio IDE folder to your user PATH and restart VS Code."
    );
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
      processList.includes("visualstudio") ||
      processList.includes("servicehub")
    );
  } catch {
    return false;
  }
}

async function resolveVisualStudioExecutable(): Promise<string | undefined> {
  const vswherePath = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (await fileExists(vswherePath)) {
    try {
      const { stdout } = await execFile(
        vswherePath,
        ["-latest", "-products", "*", "-requires", "Microsoft.Component.MSBuild", "-find", "Common7\\IDE\\devenv.exe"],
        { windowsHide: true }
      );
      const detectedPath = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
      if (detectedPath && await fileExists(detectedPath)) {
        return detectedPath;
      }
    } catch {
      // Fall back to less restrictive vswhere and known locations below.
    }
  }

  if (await fileExists(vswherePath)) {
    try {
      const { stdout } = await execFile(
        vswherePath,
        ["-latest", "-products", "*", "-find", "Common7\\IDE\\devenv.exe"],
        { windowsHide: true }
      );
      const detectedPath = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
      if (detectedPath && await fileExists(detectedPath)) {
        return detectedPath;
      }
    } catch {
      // Fall back to PATH and known locations below.
    }
  }

  const pathResolved = await resolveFromPath();
  if (pathResolved) {
    return pathResolved;
  }

  for (const candidate of getCommonVisualStudioPaths()) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function resolveFromPath(): Promise<string | undefined> {
  try {
    const { stdout } = await execFile(
      "where.exe",
      ["devenv.exe"],
      { windowsHide: true }
    );
    const detectedPath = stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
    if (detectedPath && await fileExists(detectedPath)) {
      return detectedPath;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getCommonVisualStudioPaths(): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const editions = ["Enterprise", "Professional", "Community", "BuildTools"];
  const years = ["2026", "2022", "2019", "2017"];
  const roots = [
    path.join(programFiles, "Microsoft Visual Studio"),
    path.join(programFilesX86, "Microsoft Visual Studio")
  ];

  return roots.flatMap((root) =>
    years.flatMap((year) =>
      editions.map((edition) => path.join(root, year, edition, "Common7", "IDE", "devenv.exe"))
    )
  );
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
