import * as vscode from "vscode";
import { RuleTrace, RuleTraceNode, WorkspaceScanResult } from "./model/types";
import { RuleCodeLensProvider } from "./codelens/ruleCodeLensProvider";
import { RuleStatusDecorator } from "./codelens/ruleStatusDecorator";
import { openFileAtLine } from "./navigation/openFile";
import { generateMissingSteps } from "./scanner/missingStepGenerator";
import { WorkspaceScanner } from "./scanner/workspaceScanner";
import { RuleDetailsWebview } from "./views/ruleDetailsWebview";
import { RuleTraceTreeProvider } from "./views/ruleTraceTreeProvider";

let latestTraces = new Map<string, RuleTrace>();
const pendingFileRefreshes = new Map<string, NodeJS.Timeout>();

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
    vscode.commands.registerCommand("ruleTrace.openRuleFeature", async (trace?: RuleTrace | RuleTraceNode) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      await openFeatureAtRule(resolved);
    }),
    vscode.commands.registerCommand("ruleTrace.openRuleDetails", async (trace?: RuleTrace | RuleTraceNode) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      await openFeatureAtRule(resolved);
      detailsWebview.show(resolved);
    }),
    vscode.commands.registerCommand("ruleTrace.openImplementation", async (trace?: RuleTrace | RuleTraceNode) => {
      const resolved = resolveTrace(trace);
      const firstMatch = resolved?.implementations[0];
      if (!firstMatch) {
        vscode.window.showInformationMessage("No implementation found for this rule.");
        return;
      }

      await openFileAtLine(firstMatch.file, firstMatch.line);
    }),
    vscode.commands.registerCommand("ruleTrace.openTest", async (trace?: RuleTrace | RuleTraceNode) => {
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
    vscode.commands.registerCommand("ruleTrace.generateMissingSteps", async (trace?: RuleTrace | RuleTraceNode) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      await generateMissingSteps(resolved);
      await refresh(scanner, treeProvider, codeLensProvider, statusDecorator);
      await refreshDetailsIfCurrentRule(resolved, detailsWebview);
    }),
    vscode.commands.registerCommand("ruleTrace.copyRuleTag", async (trace?: RuleTrace | RuleTraceNode) => {
      const resolved = resolveTrace(trace);
      if (!resolved) {
        vscode.window.showInformationMessage("No rule selected.");
        return;
      }

      const tagComment = `// ${resolved.rule.name}`;
      await vscode.env.clipboard.writeText(tagComment);
      vscode.window.showInformationMessage(`Gherkin Rule Trace: copied "${tagComment}".`);
    }),
    vscode.commands.registerCommand("ruleTrace.refreshRule", async (trace?: RuleTrace | RuleTraceNode) => {
      const resolved = resolveTrace(trace) ?? detailsWebview.getCurrentTrace();
      await refresh(scanner, treeProvider, codeLensProvider, statusDecorator);
      await revealRefreshedRule(resolved, detailsWebview);
    })
  );

  refresh(scanner, treeProvider, codeLensProvider, statusDecorator);

  const featureWatcher = vscode.workspace.createFileSystemWatcher("**/*.feature");
  const codeWatcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,js,jsx,mts,cts,py,cs,java,go,rs,php,rb,html}");
  context.subscriptions.push(
    featureWatcher,
    codeWatcher,
    featureWatcher.onDidCreate((uri) => scheduleFileRefresh(scanner, treeProvider, codeLensProvider, statusDecorator, uri, false)),
    featureWatcher.onDidChange((uri) => scheduleFileRefresh(scanner, treeProvider, codeLensProvider, statusDecorator, uri, false)),
    featureWatcher.onDidDelete((uri) => scheduleFileRefresh(scanner, treeProvider, codeLensProvider, statusDecorator, uri, true)),
    codeWatcher.onDidCreate((uri) => scheduleFileRefresh(scanner, treeProvider, codeLensProvider, statusDecorator, uri, false)),
    codeWatcher.onDidChange((uri) => scheduleFileRefresh(scanner, treeProvider, codeLensProvider, statusDecorator, uri, false)),
    codeWatcher.onDidDelete((uri) => scheduleFileRefresh(scanner, treeProvider, codeLensProvider, statusDecorator, uri, true))
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
      title: "Gherkin Rule Trace: scanning workspace"
    },
    async () => {
      const result = await scanner.scan();
      applyScanResult(result, treeProvider, codeLensProvider, statusDecorator);
      showScanStats(result);
      return result;
    }
  );
}

async function refreshFile(
  scanner: WorkspaceScanner,
  treeProvider: RuleTraceTreeProvider,
  codeLensProvider: RuleCodeLensProvider,
  statusDecorator: RuleStatusDecorator,
  uri: vscode.Uri
): Promise<void> {
  const result = await scanner.updateFile(uri);
  applyScanResult(result, treeProvider, codeLensProvider, statusDecorator);
  showScanStats(result);
}

function scheduleFileRefresh(
  scanner: WorkspaceScanner,
  treeProvider: RuleTraceTreeProvider,
  codeLensProvider: RuleCodeLensProvider,
  statusDecorator: RuleStatusDecorator,
  uri: vscode.Uri,
  deleted: boolean
): void {
  if (!vscode.workspace.getConfiguration("ruleTrace").get<boolean>("autoScan", true)) {
    return;
  }

  const key = uri.fsPath;
  const pending = pendingFileRefreshes.get(key);
  if (pending) {
    clearTimeout(pending);
  }

  pendingFileRefreshes.set(
    key,
    setTimeout(async () => {
      pendingFileRefreshes.delete(key);
      if (deleted) {
        await deleteFile(scanner, treeProvider, codeLensProvider, statusDecorator, uri);
      } else {
        await refreshFile(scanner, treeProvider, codeLensProvider, statusDecorator, uri);
      }
    }, 150)
  );
}

async function deleteFile(
  scanner: WorkspaceScanner,
  treeProvider: RuleTraceTreeProvider,
  codeLensProvider: RuleCodeLensProvider,
  statusDecorator: RuleStatusDecorator,
  uri: vscode.Uri
): Promise<void> {
  const result = await scanner.deleteFile(uri);
  applyScanResult(result, treeProvider, codeLensProvider, statusDecorator);
  showScanStats(result);
}

function applyScanResult(
  result: WorkspaceScanResult,
  treeProvider: RuleTraceTreeProvider,
  codeLensProvider: RuleCodeLensProvider,
  statusDecorator: RuleStatusDecorator
): void {
  latestTraces = new Map(result.rules.map((trace) => [trace.rule.id, trace]));
  treeProvider.update(result);
  codeLensProvider.update(result);
  statusDecorator.update(result);
}

function showScanStats(result: WorkspaceScanResult): void {
  if (!result.stats) {
    return;
  }

  const stats = result.stats;
  vscode.window.setStatusBarMessage(
    `Gherkin Rule Trace: ${stats.mode} scan, ${stats.rules} rules, ${stats.featureFiles + stats.codeFiles} files, ${stats.durationMs}ms`,
    3000
  );
}

function resolveTrace(input: RuleTrace | RuleTraceNode | undefined): RuleTrace | undefined {
  const trace = unwrapTrace(input);
  if (!trace?.rule) {
    return undefined;
  }

  return latestTraces.get(trace.rule.id) ?? trace;
}

function unwrapTrace(input: RuleTrace | RuleTraceNode | undefined): RuleTrace | undefined {
  if (!input) {
    return undefined;
  }

  if ("trace" in input) {
    return input.trace;
  }

  if ("rule" in input && "implementations" in input && "tests" in input) {
    return input;
  }

  return undefined;
}

async function openFeatureAtRule(trace: RuleTrace): Promise<void> {
  await openFileAtLine(trace.rule.featureFile, trace.rule.line);
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
