import * as path from "path";
import * as vscode from "vscode";
import { FeatureRule, GherkinStepInfo, RuleTrace } from "../model/types";

export async function generateMissingSteps(trace: RuleTrace): Promise<void> {
  if (trace.tests.missingSteps.length === 0) {
    await openFirstExistingStep(trace);
    return;
  }

  const targetUri = await resolveTargetStepFile(trace);
  if (!targetUri) {
    return;
  }

  await ensureParentDirectory(targetUri);
  const existingContent = await readIfExists(targetUri);
  const insertionStart = existingContent.length > 0 ? existingContent.replace(/\s*$/u, "").length + 2 : 0;
  const snippet = buildMissingStepsSnippet(trace.rule, trace.tests.missingSteps, existingContent.length > 0);
  const nextContent = existingContent.length > 0
    ? `${existingContent.replace(/\s*$/u, "")}\n\n${snippet}\n`
    : `${snippet}\n`;

  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(nextContent, "utf8"));
  const firstGeneratedStep = trace.tests.missingSteps[0];
  const gherkinStep = findGherkinStep(trace.rule.gherkinSteps, firstGeneratedStep);
  const firstStepToken = `${gherkinStep?.keyword ?? "Given"}(${JSON.stringify(firstGeneratedStep)}`;
  const firstStepIndex = nextContent.indexOf(firstStepToken, insertionStart);
  const targetLine = firstStepIndex >= 0 ? getLineNumber(nextContent, firstStepIndex) : getLineNumber(nextContent, insertionStart);
  await openFileAtLine(targetUri, targetLine);
}

async function resolveTargetStepFile(trace: RuleTrace): Promise<vscode.Uri | undefined> {
  const candidateFiles = Array.from(new Set(trace.tests.stepMatches.map((match) => match.file)));
  if (candidateFiles.length === 1) {
    return vscode.Uri.file(candidateFiles[0]);
  }

  if (candidateFiles.length > 1) {
    const selected = await vscode.window.showQuickPick(
      candidateFiles.map((file) => ({
        label: path.basename(file),
        description: file,
        file
      })),
      {
        title: "Choose where to generate missing steps",
        placeHolder: "Existing step definition file"
      }
    );
    if (selected) {
      return vscode.Uri.file(selected.file);
    }
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(trace.rule.featureFile));
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Gherkin Rule Trace: cannot generate steps outside a workspace folder.");
    return undefined;
  }

  const featureBaseName = path.basename(trace.rule.featureFile, path.extname(trace.rule.featureFile));
  return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "tests", "bdd", `${featureBaseName}.steps.ts`));
}

function buildMissingStepsSnippet(rule: FeatureRule, missingSteps: string[], hasExistingContent: boolean): string {
  const importLine = `import { Given, When, Then, And, But } from "@cucumber/cucumber";`;
  const shouldAddImport = !hasExistingContent;
  const snippets = missingSteps.map((step) => {
    const gherkinStep = findGherkinStep(rule.gherkinSteps, step);
    const keyword = gherkinStep?.keyword ?? "Given";
    return `${keyword}(${JSON.stringify(step)}, async () => {\n  throw new Error("Not implemented");\n});`;
  });

  return [
    shouldAddImport ? importLine : undefined,
    ...snippets
  ]
    .filter(Boolean)
    .join("\n\n");
}

function findGherkinStep(steps: GherkinStepInfo[], stepText: string): GherkinStepInfo | undefined {
  return steps.find((step) => step.text === stepText);
}

async function readIfExists(uri: vscode.Uri): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return "";
  }
}

async function ensureParentDirectory(uri: vscode.Uri): Promise<void> {
  const parent = vscode.Uri.file(path.dirname(uri.fsPath));
  await vscode.workspace.fs.createDirectory(parent);
}

async function openFirstExistingStep(trace: RuleTrace): Promise<void> {
  const firstStep = trace.tests.stepMatches[0];
  if (!firstStep) {
    vscode.window.showInformationMessage("Gherkin Rule Trace: no missing steps, and no step definition was found to open.");
    return;
  }

  await openFileAtLine(vscode.Uri.file(firstStep.file), firstStep.line);
}

async function openFileAtLine(uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(Math.max(line - 1, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}
