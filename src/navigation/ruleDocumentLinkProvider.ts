import * as vscode from "vscode";
import { RuleTrace, WorkspaceScanResult } from "../model/types";

export class RuleDocumentLinkProvider implements vscode.DocumentLinkProvider {
  private traces: RuleTrace[] = [];

  update(result: WorkspaceScanResult): void {
    this.traces = result.rules;
  }

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (document.fileName.endsWith(".feature")) {
      return [];
    }

    const links: vscode.DocumentLink[] = [];
    const text = document.getText();
    for (const trace of this.traces) {
      if (!isLinkedFile(trace, document.uri.fsPath)) {
        continue;
      }

      let startIndex = 0;
      while (startIndex < text.length) {
        const index = text.indexOf(trace.rule.name, startIndex);
        if (index === -1) {
          break;
        }

        const start = document.positionAt(index);
        const end = document.positionAt(index + trace.rule.name.length);
        const target = vscode.Uri.parse(
          `command:ruleTrace.openRuleFeature?${encodeURIComponent(JSON.stringify([trace]))}`
        );
        const link = new vscode.DocumentLink(new vscode.Range(start, end), target);
        link.tooltip = `Open ${trace.rule.name} in feature file`;
        links.push(link);
        startIndex = index + trace.rule.name.length;
      }
    }

    return links;
  }
}

function isLinkedFile(trace: RuleTrace, file: string): boolean {
  return (
    trace.implementations.some((match) => match.file === file) ||
    trace.tests.describeMatches.some((match) => match.file === file) ||
    trace.tests.tagMatches.some((match) => match.file === file) ||
    trace.tests.stepMatches.some((match) => match.file === file)
  );
}
