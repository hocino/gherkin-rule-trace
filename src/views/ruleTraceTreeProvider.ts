import * as path from "path";
import * as vscode from "vscode";
import { summarizeImplementations } from "../model/implementationSummary";
import { RuleTrace, RuleTraceNode, WorkspaceScanResult } from "../model/types";
import { getWorkspaceFolderLabel, getWorkspaceRelativePath, normalizeFsPath } from "../scanner/pathUtils";

export class RuleTraceTreeProvider implements vscode.TreeDataProvider<RuleTraceNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RuleTraceNode | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private roots: RuleTraceNode[] = [];

  update(result: WorkspaceScanResult): void {
    this.roots = buildTree(result.rules);
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: RuleTraceNode): vscode.TreeItem {
    const collapsibleState =
      element.kind === "rule" ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded;
    const item = new vscode.TreeItem(element.label, collapsibleState);
    item.resourceUri = element.resourceUri;

    if (element.kind === "rule" && element.trace) {
      item.contextValue = "rule";
      item.command = {
        command: "ruleTrace.openRuleFeature",
        title: "Gherkin Rule Trace: Open Rule Feature",
        arguments: [element.trace]
      };
      item.description = getRuleDescription(element.trace);
      item.iconPath = new vscode.ThemeIcon(getRuleIcon(element.trace));
      item.tooltip = getRuleTooltip(element.trace);
    } else if (element.kind === "file") {
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = "file";
    } else {
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = "folder";
    }

    return item;
  }

  getChildren(element?: RuleTraceNode): RuleTraceNode[] {
    if (!element) {
      return this.roots;
    }

    return element.children ?? [];
  }
}

function buildTree(traces: RuleTrace[]): RuleTraceNode[] {
  const root: RuleTraceNode[] = [];

  for (const trace of traces.sort((a, b) => a.rule.featureFile.localeCompare(b.rule.featureFile) || a.rule.line - b.rule.line)) {
    const relativePath = getWorkspaceRelativePath(trace.rule.featureFile);
    const workspaceLabel = getWorkspaceFolderLabel(trace.rule.featureFile);
    const parts = normalizeFsPath(relativePath).split("/");
    const displayParts = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1 && workspaceLabel
      ? [workspaceLabel, ...parts]
      : parts;

    let cursor = root;
    for (let index = 0; index < displayParts.length; index += 1) {
      const part = displayParts[index];
      const isFile = index === displayParts.length - 1;
      let node = cursor.find((candidate) => candidate.label === part && candidate.kind === (isFile ? "file" : "folder"));

      if (!node) {
        node = {
          label: part,
          kind: isFile ? "file" : "folder",
          children: [],
          resourceUri: isFile ? vscode.Uri.file(trace.rule.featureFile) : undefined
        };
        cursor.push(node);
        cursor.sort(sortNodes);
      }

      cursor = node.children ?? [];
    }

    cursor.push({
      label: `${getRuleStatusPrefix(trace)} ${trace.rule.name}`,
      kind: "rule",
      trace
    });
    cursor.sort(sortNodes);
  }

  return root;
}

function sortNodes(a: RuleTraceNode, b: RuleTraceNode): number {
  const order = { folder: 0, file: 1, rule: 2 };
  if (order[a.kind] !== order[b.kind]) {
    return order[a.kind] - order[b.kind];
  }

  if (a.kind === "rule" && b.kind === "rule") {
    return (a.trace?.rule.line ?? 0) - (b.trace?.rule.line ?? 0);
  }

  return a.label.localeCompare(b.label);
}

function getRuleIcon(trace: RuleTrace): string {
  if (trace.implementations.length > 0 && trace.tests.tested) {
    return "pass-filled";
  }

  if (trace.implementations.length > 0) {
    return "warning";
  }

  return "error";
}

function getRuleStatusPrefix(trace: RuleTrace): string {
  if (trace.implementations.length > 0 && trace.tests.tested) {
    return "✅";
  }

  if (trace.implementations.length > 0) {
    return "🟡";
  }

  return "🔴";
}

function getRuleDescription(trace: RuleTrace): string {
  const summary = summarizeImplementations(trace);
  if (trace.implementations.length > 0 && trace.tests.tested) {
    return `Back ${summary.backend}, Front ${summary.frontend}, tested`;
  }

  if (trace.implementations.length > 0) {
    return `Back ${summary.backend}, Front ${summary.frontend}, not tested`;
  }

  return "not implemented";
}

function getRuleTooltip(trace: RuleTrace): string {
  const summary = summarizeImplementations(trace);
  return [
    trace.rule.name,
    `Feature: ${path.basename(trace.rule.featureFile)}:${trace.rule.line}`,
    `Backend implementations: ${summary.backend}`,
    `Frontend implementations: ${summary.frontend}`,
    `Other implementations: ${summary.unknown}`,
    `Tested: ${trace.tests.tested ? "yes" : "no"}`
  ].join("\n");
}
