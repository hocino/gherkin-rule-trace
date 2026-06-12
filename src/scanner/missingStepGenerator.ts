import * as path from "path";
import * as vscode from "vscode";
import { FeatureRule, GherkinStepInfo, RuleTrace } from "../model/types";
import { openFileAtLine } from "../navigation/openFile";

type StepGenerationLanguage = "typescript" | "javascript" | "csharp" | "python";

export async function generateMissingSteps(trace: RuleTrace): Promise<void> {
  if (trace.tests.missingSteps.length === 0) {
    await openFirstExistingStep(trace);
    return;
  }

  await generateSteps(trace, trace.tests.missingSteps);
}

export async function generateAllSteps(trace: RuleTrace): Promise<void> {
  const steps = Array.from(new Set(trace.rule.steps.map((step) => step.trim()).filter(Boolean)));
  if (steps.length === 0) {
    vscode.window.showInformationMessage("Gherkin Rule Trace: no Gherkin steps found for this rule.");
    return;
  }

  await generateSteps(trace, steps);
}

async function generateSteps(trace: RuleTrace, steps: string[]): Promise<void> {
  const language = await resolveStepGenerationLanguage(trace);
  const targetUri = await resolveTargetStepFile(trace, language);
  if (!targetUri) {
    return;
  }

  await ensureParentDirectory(targetUri);
  const existingContent = await readIfExists(targetUri);
  const insertionStart = existingContent.length > 0 ? existingContent.replace(/\s*$/u, "").length + 2 : 0;
  const snippet = buildStepsSnippet(trace.rule, steps, existingContent.length > 0, language);
  const nextContent = existingContent.length > 0
    ? `${existingContent.replace(/\s*$/u, "")}\n\n${snippet}\n`
    : `${snippet}\n`;

  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(nextContent, "utf8"));
  const firstGeneratedStep = steps[0];
  const gherkinStep = findGherkinStep(trace.rule.gherkinSteps, firstGeneratedStep);
  const firstStepToken = getFirstStepToken(gherkinStep?.keyword ?? "Given", firstGeneratedStep, language);
  const firstStepIndex = nextContent.indexOf(firstStepToken, insertionStart);
  const targetLine = firstStepIndex >= 0 ? getLineNumber(nextContent, firstStepIndex) : getLineNumber(nextContent, insertionStart);
  await openFileAtLine(targetUri.fsPath, targetLine);
}

async function resolveTargetStepFile(trace: RuleTrace, language: StepGenerationLanguage): Promise<vscode.Uri | undefined> {
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
  return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "tests", "bdd", `${featureBaseName}.steps${getStepFileExtension(language)}`));
}

function buildStepsSnippet(
  rule: FeatureRule,
  steps: string[],
  hasExistingContent: boolean,
  language: StepGenerationLanguage
): string {
  const shouldAddHeader = !hasExistingContent;
  const snippets = steps.map((step) => {
    const gherkinStep = findGherkinStep(rule.gherkinSteps, step);
    const keyword = gherkinStep?.keyword ?? "Given";
    return buildStepSnippet(keyword, step, language);
  });
  const footer = language === "csharp" && shouldAddHeader ? "}" : undefined;

  return [
    shouldAddHeader ? getFileHeader(language) : undefined,
    ...snippets,
    footer
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildStepSnippet(keyword: GherkinStepInfo["keyword"], step: string, language: StepGenerationLanguage): string {
  switch (language) {
    case "csharp":
      return `[${keyword}(${JSON.stringify(step)})]\npublic void ${buildCsharpMethodName(keyword, step)}()\n{\n    throw new NotImplementedException();\n}`;
    case "python":
      return `@${keyword.toLowerCase()}(${JSON.stringify(step)})\ndef ${buildPythonFunctionName(keyword, step)}(context):\n    raise NotImplementedError()`;
    case "javascript":
      return `${keyword}(${JSON.stringify(step)}, async () => {\n  throw new Error("Not implemented");\n});`;
    case "typescript":
    default:
      return `${keyword}(${JSON.stringify(step)}, async () => {\n  throw new Error("Not implemented");\n});`;
  }
}

function getFileHeader(language: StepGenerationLanguage): string | undefined {
  switch (language) {
    case "csharp":
      return "using TechTalk.SpecFlow;\n\nnamespace StepDefinitions;\n\n[Binding]\npublic class GeneratedSteps\n{";
    case "python":
      return "from behave import given, when, then, step";
    case "javascript":
      return `const { Given, When, Then, And, But } = require("@cucumber/cucumber");`;
    case "typescript":
    default:
      return `import { Given, When, Then, And, But } from "@cucumber/cucumber";`;
  }
}

function getStepFileExtension(language: StepGenerationLanguage): string {
  switch (language) {
    case "csharp":
      return ".cs";
    case "python":
      return ".py";
    case "javascript":
      return ".js";
    case "typescript":
    default:
      return ".ts";
  }
}

async function resolveStepGenerationLanguage(trace: RuleTrace): Promise<StepGenerationLanguage> {
  const configured = vscode.workspace
    .getConfiguration("ruleTrace")
    .get<string>("stepGenerationLanguage", "auto");

  if (isStepGenerationLanguage(configured)) {
    return configured;
  }

  const existingStepFile = trace.tests.stepMatches[0]?.file;
  if (existingStepFile) {
    return languageFromExtension(path.extname(existingStepFile)) ?? "typescript";
  }

  return (await detectWorkspaceLanguage(trace)) ?? "typescript";
}

async function detectWorkspaceLanguage(trace: RuleTrace): Promise<StepGenerationLanguage | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(trace.rule.featureFile));
  if (!workspaceFolder) {
    return undefined;
  }

  const candidates: Array<{ language: StepGenerationLanguage; pattern: string }> = [
    { language: "csharp", pattern: "**/*.cs" },
    { language: "typescript", pattern: "**/*.{ts,tsx}" },
    { language: "python", pattern: "**/*.py" },
    { language: "javascript", pattern: "**/*.{js,jsx}" }
  ];

  for (const candidate of candidates) {
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, candidate.pattern),
      "{**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.git/**}",
      1
    );
    if (matches.length > 0) {
      return candidate.language;
    }
  }

  return undefined;
}

function isStepGenerationLanguage(value: string | undefined): value is StepGenerationLanguage {
  return value === "typescript" || value === "javascript" || value === "csharp" || value === "python";
}

function languageFromExtension(extension: string): StepGenerationLanguage | undefined {
  switch (extension.toLowerCase()) {
    case ".cs":
      return "csharp";
    case ".py":
      return "python";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".ts":
    case ".tsx":
      return "typescript";
    default:
      return undefined;
  }
}

function buildCsharpMethodName(keyword: string, step: string): string {
  return toPascalIdentifier(`${keyword} ${step}`);
}

function buildPythonFunctionName(keyword: string, step: string): string {
  return `step_${toSnakeIdentifier(`${keyword} ${step}`)}`;
}

function toPascalIdentifier(value: string): string {
  const words = value.match(/[A-Za-z0-9]+/g) ?? ["Step"];
  const identifier = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return /^\d/.test(identifier) ? `Step${identifier}` : identifier;
}

function toSnakeIdentifier(value: string): string {
  const words = value.match(/[A-Za-z0-9]+/g) ?? ["step"];
  const identifier = words.map((word) => word.toLowerCase()).join("_");
  return /^\d/.test(identifier) ? `step_${identifier}` : identifier;
}

function getFirstStepToken(keyword: GherkinStepInfo["keyword"], step: string, language: StepGenerationLanguage): string {
  switch (language) {
    case "csharp":
      return `[${keyword}(${JSON.stringify(step)})]`;
    case "python":
      return `@${keyword.toLowerCase()}(${JSON.stringify(step)})`;
    case "javascript":
    case "typescript":
    default:
      return `${keyword}(${JSON.stringify(step)}`;
  }
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

  await openFileAtLine(firstStep.file, firstStep.line);
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}
