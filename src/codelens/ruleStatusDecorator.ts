import * as vscode from "vscode";
import { summarizeImplementations } from "../model/implementationSummary";
import { RuleTrace, WorkspaceScanResult } from "../model/types";

export class RuleStatusDecorator implements vscode.Disposable {
  private tracesByFile = new Map<string, RuleTrace[]>();
  private readonly okDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("testing.iconPassed"),
      margin: "0 0 0 1.5em",
      fontWeight: "600"
    }
  });
  private readonly warnDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("testing.iconQueued"),
      margin: "0 0 0 1.5em",
      fontWeight: "600"
    }
  });
  private readonly badDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("testing.iconFailed"),
      margin: "0 0 0 1.5em",
      fontWeight: "600"
    }
  });

  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisibleEditors()),
      vscode.workspace.onDidCloseTextDocument(() => this.refreshVisibleEditors())
    );
  }

  update(result: WorkspaceScanResult): void {
    this.tracesByFile.clear();
    for (const trace of result.rules) {
      const traces = this.tracesByFile.get(trace.rule.featureFile) ?? [];
      traces.push(trace);
      this.tracesByFile.set(trace.rule.featureFile, traces);
    }
    this.refreshVisibleEditors();
  }

  dispose(): void {
    this.okDecoration.dispose();
    this.warnDecoration.dispose();
    this.badDecoration.dispose();
  }

  private refreshVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (!editor.document.fileName.endsWith(".feature")) {
        continue;
      }

      this.apply(editor);
    }
  }

  private apply(editor: vscode.TextEditor): void {
    const ok: vscode.DecorationOptions[] = [];
    const warn: vscode.DecorationOptions[] = [];
    const bad: vscode.DecorationOptions[] = [];
    const traces = this.tracesByFile.get(editor.document.uri.fsPath) ?? [];

    for (const trace of traces) {
      const implementationSummary = summarizeImplementations(trace);
      const implemented = implementationSummary.total > 0;
      const tested = trace.tests.tested;
      const line = Math.max(trace.rule.line - 1, 0);
      if (line >= editor.document.lineCount) {
        continue;
      }

      const end = editor.document.lineAt(line).range.end;
      const range = new vscode.Range(end, end);
      const option: vscode.DecorationOptions = {
        range,
        renderOptions: {
          after: {
            contentText: `  ${implemented ? "✓" : "✕"} Back: ${implementationSummary.backend} | Front: ${implementationSummary.frontend} | ${tested ? "✓" : "✕"} Tested: ${tested ? "Yes" : "No"}`
          }
        }
      };

      if (implemented && tested) {
        ok.push(option);
      } else if (implemented) {
        warn.push(option);
      } else {
        bad.push(option);
      }
    }

    editor.setDecorations(this.okDecoration, ok);
    editor.setDecorations(this.warnDecoration, warn);
    editor.setDecorations(this.badDecoration, bad);
  }
}
