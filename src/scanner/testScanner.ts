import { FeatureRule, RuleTestMatch } from "../model/types";

interface TestFile {
  file: string;
  content: string;
}

interface StepDefinitionMatch {
  step: string;
  file: string;
  line: number;
  preview: string;
}

const describeRegex = /\bdescribe\s*\(\s*(["'`])([\s\S]*?)\1/g;
const jsStepRegex = /\b(Given|When|Then|And|But)\s*\(\s*(["'`])([\s\S]*?)\2/g;
const pythonStepRegex = /@(given|when|then|step)\s*\(\s*(["'])([\s\S]*?)\2/g;
const dotnetStepRegex = /\[(Given|When|Then|And|But|StepDefinition)\s*\(\s*(["'])([\s\S]*?)\2\s*\)\]/g;

export function findTestMatches(rules: FeatureRule[], files: TestFile[]): Map<string, RuleTestMatch> {
  const describeMatchesByRule = new Map<string, RuleTestMatch["describeMatches"]>();
  const allStepDefinitions: StepDefinitionMatch[] = [];

  for (const rule of rules) {
    describeMatchesByRule.set(rule.id, []);
  }

  for (const file of files) {
    for (const rule of rules) {
      describeMatchesByRule.get(rule.id)?.push(...findDescribeMatches(file, rule.name));
    }

    allStepDefinitions.push(...findStepDefinitions(file));
  }

  const result = new Map<string, RuleTestMatch>();
  for (const rule of rules) {
    const describeMatches = describeMatchesByRule.get(rule.id) ?? [];
    const expectedSteps = Array.from(new Set(rule.steps.map((step) => step.trim()).filter(Boolean)));
    const stepMatches = findRuleStepMatches(expectedSteps, allStepDefinitions);
    const foundSteps = new Set(stepMatches.map((match) => match.step));
    const missingSteps = expectedSteps.filter((step) => !foundSteps.has(step));
    const stepsCovered = expectedSteps.length > 0 && missingSteps.length === 0;
    const tested = describeMatches.length > 0 || stepsCovered;

    result.set(rule.id, {
      tested,
      reason: describeMatches.length > 0 ? "describe" : stepsCovered ? "steps" : "none",
      describeMatches,
      stepMatches,
      missingSteps
    });
  }

  return result;
}

function findDescribeMatches(file: TestFile, ruleName: string): RuleTestMatch["describeMatches"] {
  const matches: RuleTestMatch["describeMatches"] = [];
  for (const match of matchAllWithLine(describeRegex, file.content)) {
    const text = match.match[2];
    if (text.includes(ruleName)) {
      matches.push({
        file: file.file,
        line: match.line,
        preview: getLinePreview(file.content, match.line)
      });
    }
  }

  return matches;
}

function findStepDefinitions(file: TestFile): StepDefinitionMatch[] {
  const matches: StepDefinitionMatch[] = [];
  for (const regex of [jsStepRegex, pythonStepRegex, dotnetStepRegex]) {
    for (const match of matchAllWithLine(regex, file.content)) {
      const step = match.match[3]?.trim();
      if (!step) {
        continue;
      }

      matches.push({
        step,
        file: file.file,
        line: match.line,
        preview: getLinePreview(file.content, match.line)
      });
    }
  }

  return uniqueBy(matches, (match) => `${match.step}:${match.file}:${match.line}`);
}

function findRuleStepMatches(expectedSteps: string[], allStepDefinitions: StepDefinitionMatch[]): RuleTestMatch["stepMatches"] {
  const expected = new Set(expectedSteps);
  return allStepDefinitions
    .filter((match) => expected.has(match.step.trim()))
    .map((match) => ({
      step: match.step.trim(),
      file: match.file,
      line: match.line,
      preview: match.preview
    }));
}

function matchAllWithLine(regex: RegExp, content: string): Array<{ match: RegExpExecArray; line: number }> {
  const results: Array<{ match: RegExpExecArray; line: number }> = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push({
      match,
      line: getLineNumber(content, match.index)
    });

    if (match.index === regex.lastIndex) {
      regex.lastIndex += 1;
    }
  }

  return results;
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function getLinePreview(content: string, line: number): string {
  return content.split(/\r?\n/)[line - 1]?.trim() ?? "";
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const itemKey = key(item);
    if (!seen.has(itemKey)) {
      seen.add(itemKey);
      result.push(item);
    }
  }

  return result;
}
