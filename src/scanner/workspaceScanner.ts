import * as path from "path";
import * as vscode from "vscode";
import { FeatureRule, RuleTrace, WorkspaceScanResult } from "../model/types";
import { parseFeatureFile } from "./featureParser";
import { findImplementationMatches } from "./implementationScanner";
import { isTestFile } from "./pathUtils";
import { findTestMatches } from "./testScanner";

interface CodeFile {
  file: string;
  content: string;
}

export class WorkspaceScanner {
  async scan(): Promise<WorkspaceScanResult> {
    if (!vscode.workspace.workspaceFolders?.length) {
      return { rules: [], scannedAt: new Date() };
    }

    const config = vscode.workspace.getConfiguration("ruleTrace");
    const include = config.get<string[]>("include", ["**/*.feature"]);
    const exclude = config.get<string[]>("exclude", [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.git/**"
    ]);
    const codeExtensions = config.get<string[]>("codeExtensions", [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mts",
      ".cts",
      ".py",
      ".cs",
      ".java",
      ".go",
      ".rs",
      ".php",
      ".rb"
    ]);

    const rules: FeatureRule[] = [];
    for (const pattern of include) {
      const uris = await vscode.workspace.findFiles(pattern, `{${exclude.join(",")}}`);
      for (const uri of uris) {
        const content = await readTextFile(uri);
        rules.push(...parseFeatureFile(uri.fsPath, content));
      }
    }

    const codeFiles = await this.readCodeFiles(codeExtensions, exclude);
    const implementationFiles = codeFiles.filter((file) => !isTestFile(file.file));
    const testFiles = codeFiles.filter((file) => isTestFile(file.file));
    const implementations = findImplementationMatches(rules, implementationFiles);
    const tests = findTestMatches(rules, testFiles);

    const traces: RuleTrace[] = rules.map((rule) => ({
      rule,
      implementations: implementations.get(rule.id) ?? [],
      tests:
        tests.get(rule.id) ?? {
          tested: false,
          reason: "none",
          describeMatches: [],
          stepMatches: [],
          missingSteps: rule.steps
        }
    }));

    return { rules: traces, scannedAt: new Date() };
  }

  private async readCodeFiles(codeExtensions: string[], exclude: string[]): Promise<CodeFile[]> {
    const globExtensions = codeExtensions.map((extension) => extension.replace(/^\./, ""));
    const pattern = `**/*.{${globExtensions.join(",")}}`;
    const uris = await vscode.workspace.findFiles(pattern, `{${exclude.join(",")}}`);
    const result: CodeFile[] = [];

    for (const uri of uris) {
      if (!codeExtensions.includes(path.extname(uri.fsPath))) {
        continue;
      }

      result.push({
        file: uri.fsPath,
        content: await readTextFile(uri)
      });
    }

    return result;
  }
}

async function readTextFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}
