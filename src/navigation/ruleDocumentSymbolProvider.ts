import * as vscode from "vscode";
import { parseFeatureFile } from "../scanner/featureParser";

const featureRegex = /^\s*Feature:\s*(.+?)\s*$/m;

export class RuleDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    if (document.languageId !== "feature" && !document.fileName.endsWith(".feature")) {
      return [];
    }

    const text = document.getText();
    const rules = parseFeatureFile(document.uri.fsPath, text);
    if (rules.length === 0) {
      return [];
    }

    const featureMatch = text.match(featureRegex);
    const featureName = featureMatch?.[1]?.trim() || "Feature";
    const featureLine = featureMatch ? document.positionAt(featureMatch.index ?? 0).line : 0;
    const fullRange = new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0);
    const featureRange = document.lineAt(Math.min(featureLine, document.lineCount - 1)).range;
    const featureSymbol = new vscode.DocumentSymbol(
      featureName,
      "",
      vscode.SymbolKind.Module,
      fullRange,
      featureRange
    );

    for (const rule of rules) {
      const line = Math.max(rule.line - 1, 0);
      if (line >= document.lineCount) {
        continue;
      }

      featureSymbol.children.push(
        new vscode.DocumentSymbol(
          rule.name,
          "",
          vscode.SymbolKind.Event,
          document.lineAt(line).range,
          document.lineAt(line).range
        )
      );
    }

    return [featureSymbol];
  }
}
