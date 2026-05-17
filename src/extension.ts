import * as vscode from "vscode";
import { RuleTrace, WorkspaceScanResult } from "./model/types";
import { RuleCodeLensProvider } from "./codelens/ruleCodeLensProvider";
import { RuleStatusDecorator } from "./codelens/ruleStatusDecorator";
import { generateMissingSteps } from "./scanner/missingStepGenerator";
import { WorkspaceScanner } from "./scanner/workspaceScanner";
import { RuleDetailsWebview } from "./views/ruleDetailsWebview";
import { RuleTraceTreeProvider } from "./views/ruleTraceTreeProvider";

let latestTraces = new Map<string, RuleTrace>();

export function activate(context: vscode.ExtensionContext): void {
  const scanner = new WorkspaceScanner();
  const treeProvider = new RuleTraceTreeProvider();
  const detailsWebview = new RuleDetailsWebview(context.extensionUri);
  const codeLensProvider = new RuleCodeLensProvider();
  const statusDecorator = new RuleStatusDecorator(context);

  context.subscriptions.push(
    statusDecorator,
    vscode.window.registerTreeDataProvider("ruleTraceView", treeProvider),
    vscode.languages.registerCodeLensProvider({ pattern: "**/*.feature" }, codeLensProvider),
    vscode.commands.registerCommand("ruleTrace.refresh", async () => {
      const currentTrace = detailsWebview.getCurrentTrace();
      await refresh(scanner, treeProvider, codeLensProvider, statusDecorator);
      await revealRefreshedRule(currentTrace, detailsWebview);
    }),
    vscode.commands.registerCommand("ruleTrace.openRuleDetails", async (trace?: RuleTrace) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      await openFeatureAtRule(resolved);
      detailsWebview.show(resolved);
    }),
    vscode.commands.registerCommand("ruleTrace.openImplementation", async (trace?: RuleTrace) => {
      const resolved = resolveTrace(trace);
      const firstMatch = resolved?.implementations[0];
      if (!firstMatch) {
        vscode.window.showInformationMessage("No implementation found for this rule.");
        return;
      }

      await openFileAtLine(firstMatch.file, firstMatch.line);
    }),
    vscode.commands.registerCommand("ruleTrace.openTest", async (trace?: RuleTrace) => {
      const resolved = resolveTrace(trace);
      const firstDescribe = resolved?.tests.describeMatches[0];
      const firstStep = resolved?.tests.stepMatches[0];
      const firstMatch = firstDescribe ?? firstStep;
      if (!firstMatch) {
        vscode.window.showInformationMessage("No test found for this rule.");
        return;
      }

      await openFileAtLine(firstMatch.file, firstMatch.line);
    }),
    vscode.commands.registerCommand("ruleTrace.generateMissingSteps", async (trace?: RuleTrace) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      await generateMissingSteps(resolved);
      await refresh(scanner, treeProvider, codeLensProvider, statusDecorator);
      await refreshDetailsIfCurrentRule(resolved, detailsWebview);
    }),
    vscode.commands.registerCommand("ruleTrace.copyRuleTag", async (trace?: RuleTrace) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      const tagComment = `// ${resolved.rule.name}`;
      await vscode.env.clipboard.writeText(tagComment);
      vscode.window.showInformationMessage(`Rule Trace: copied "${tagComment}".`);
    }),
    vscode.commands.registerCommand("ruleTrace.refreshRule", async (trace?: RuleTrace) => {
      const resolved = resolveTrace(trace) ?? detailsWebview.getCurrentTrace();
      await refresh(scanner, treeProvider, codeLensProvider, statusDecorator);
      await revealRefreshedRule(resolved, detailsWebview);
    })
  );

  refresh(scanner, treeProvider, codeLensProvider, statusDecorator);

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.feature");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => refresh(scanner, treeProvider, codeLensProvider, statusDecorator)),
    watcher.onDidChange(() => refresh(scanner, treeProvider, codeLensProvider, statusDecorator)),
    watcher.onDidDelete(() => refresh(scanner, treeProvider, codeLensProvider, statusDecorator))
  );
}

export function deactivate(): void {}

async function refresh(
  scanner: WorkspaceScanner,
  treeProvider: RuleTraceTreeProvider,
  codeLensProvider: RuleCodeLensProvider,
  statusDecorator: RuleStatusDecorator
): Promise<WorkspaceScanResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: "Rule Trace: scanning workspace"
    },
    async () => {
      const result = await scanner.scan();
      latestTraces = new Map(result.rules.map((trace) => [trace.rule.id, trace]));
      treeProvider.update(result);
      codeLensProvider.update(result);
      statusDecorator.update(result);
      return result;
    }
  );
}

function resolveTrace(trace: RuleTrace | undefined): RuleTrace | undefined {
  if (!trace) {
    return undefined;
  }

  return latestTraces.get(trace.rule.id) ?? trace;
}

async function openFeatureAtRule(trace: RuleTrace): Promise<void> {
  await openFileAtLine(trace.rule.featureFile, trace.rule.line);
}

async function openFileAtLine(file: string, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(Math.max(line - 1, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function revealRefreshedRule(trace: RuleTrace | undefined, detailsWebview: RuleDetailsWebview): Promise<void> {
  const refreshed = resolveTrace(trace);
  if (!refreshed) {
    return;
  }

  await openFeatureAtRule(refreshed);
  detailsWebview.show(refreshed);
}

async function refreshDetailsIfCurrentRule(trace: RuleTrace, detailsWebview: RuleDetailsWebview): Promise<void> {
  const currentTrace = detailsWebview.getCurrentTrace();
  if (!currentTrace || currentTrace.rule.id !== trace.rule.id) {
    return;
  }

  const refreshed = resolveTrace(trace);
  if (refreshed) {
    detailsWebview.show(refreshed);
  }
}
