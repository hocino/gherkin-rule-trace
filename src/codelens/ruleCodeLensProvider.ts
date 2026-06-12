import * as vscode from "vscode";
import { summarizeImplementations } from "../model/implementationSummary";
import { FeatureRule, RuleTrace, WorkspaceScanResult } from "../model/types";
import { parseFeatureFile } from "../scanner/featureParser";

export class RuleCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
  private traces = new Map<string, RuleTrace>();

  update(result: WorkspaceScanResult): void {
    this.traces.clear();
    for (const trace of result.rules) {
      this.traces.set(trace.rule.id, trace);
    }
    this.onDidChangeCodeLensesEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "feature" && !document.fileName.endsWith(".feature")) {
      return [];
    }

    const rules = parseFeatureFile(document.uri.fsPath, document.getText());
    return rules.flatMap((rule) => {
      const trace = this.traces.get(rule.id);
      const resolvedTrace = trace ?? createFallbackTrace(rule);
      const implementationSummary = summarizeImplementations(resolvedTrace);
      const implementedIcon = implementationSummary.total > 0 ? "$(check)" : "$(error)";
      const testedIcon = trace?.tests.tested ? "$(check)" : "$(error)";
      const tested = trace?.tests.tested ? "Yes" : "No";
      const range = new vscode.Range(rule.line - 1, 0, rule.line - 1, 0);
      const hasMissingSteps = resolvedTrace.tests.missingSteps.length > 0;

      return [
        new vscode.CodeLens(range, {
          command: "ruleTrace.openRuleDetails",
          title: `${implementedIcon} Back: ${implementationSummary.backend} | Front: ${implementationSummary.frontend} | ${testedIcon} Tested: ${tested}`,
          arguments: [resolvedTrace]
        }),
        new vscode.CodeLens(range, {
          command: "ruleTrace.copyRuleTag",
          title: "$(copy) Copy tag",
          arguments: [resolvedTrace]
        }),
        new vscode.CodeLens(range, {
          command: "ruleTrace.generateMissingSteps",
          title: hasMissingSteps ? "$(wand) Generate missing step" : "$(go-to-file) Open first step",
          arguments: [resolvedTrace]
        }),
        new vscode.CodeLens(range, {
          command: "ruleTrace.generateAllSteps",
          title: "$(new-file) Generate steps",
          arguments: [resolvedTrace]
        }),
        new vscode.CodeLens(range, {
          command: "ruleTrace.refreshRule",
          title: "$(refresh) Refresh rule",
          arguments: [resolvedTrace]
        })
      ];
    });
  }
}

function createFallbackTrace(rule: FeatureRule): RuleTrace {
  return {
    rule,
    implementations: [],
    tests: {
      tested: false,
      reason: "none",
      describeMatches: [],
      tagMatches: [],
      stepMatches: [],
      missingSteps: rule.steps
    }
  };
}
