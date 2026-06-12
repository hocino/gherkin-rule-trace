import { FeatureRule, RuleTestMatch } from "../model/types";
import { createRuleSearchIndex } from "./ruleSearchIndex";

export interface TestFile {
  file: string;
  content: string;
}

export interface StepDefinitionMatch {
  step: string;
  file: string;
  line: number;
  preview: string;
}

export interface DescribeMatch {
  ruleId: string;
  file: string;
  line: number;
  preview: string;
}

export interface RuleTagMatch {
  ruleId: string;
  file: string;
  line: number;
  preview: string;
}

export interface IndexedTestScan {
  describeMatches: DescribeMatch[];
  tagMatches: RuleTagMatch[];
  stepDefinitions: StepDefinitionMatch[];
}

interface IndexedTestFile extends TestFile {
  lines: string[];
  lineStarts: number[];
}

const describeRegex = /\bdescribe\s*\(\s*(["'`])([\s\S]*?)\1/g;
const jsStepRegex = /\b(Given|When|Then|And|But)\s*\(\s*(["'`])([\s\S]*?)\2/g;
const pythonStepRegex = /@(given|when|then|step)\s*\(\s*(["'])([\s\S]*?)\2/g;
const dotnetStepRegex = /\[(Given|When|Then|And|But|StepDefinition)\s*\(\s*(["'])([\s\S]*?)\2\s*\)\]/g;

export function findTestMatches(rules: FeatureRule[], files: TestFile[]): Map<string, RuleTestMatch> {
  const describeMatchesByRule = new Map<string, RuleTestMatch["describeMatches"]>();
  const tagMatchesByRule = new Map<string, RuleTestMatch["tagMatches"]>();
  const stepDefinitionsByStep = new Map<string, StepDefinitionMatch[]>();
  const ruleIndex = createRuleSearchIndex(rules);

  for (const rule of rules) {
    describeMatchesByRule.set(rule.id, []);
    tagMatchesByRule.set(rule.id, []);
  }

  for (const file of files) {
    const scan = scanTestFile(file, ruleIndex);
    for (const describeMatch of scan.describeMatches) {
      describeMatchesByRule.get(describeMatch.ruleId)?.push({
        file: describeMatch.file,
        line: describeMatch.line,
        preview: describeMatch.preview
      });
    }
    for (const tagMatch of scan.tagMatches) {
      tagMatchesByRule.get(tagMatch.ruleId)?.push({
        file: tagMatch.file,
        line: tagMatch.line,
        preview: tagMatch.preview
      });
    }

    for (const stepDefinition of scan.stepDefinitions) {
      const step = stepDefinition.step.trim();
      const matches = stepDefinitionsByStep.get(step) ?? [];
      matches.push(stepDefinition);
      stepDefinitionsByStep.set(step, matches);
    }
  }

  const result = new Map<string, RuleTestMatch>();
  for (const rule of rules) {
    const describeMatches = describeMatchesByRule.get(rule.id) ?? [];
    const tagMatches = tagMatchesByRule.get(rule.id) ?? [];
    const expectedSteps = Array.from(new Set(rule.steps.map((step) => step.trim()).filter(Boolean)));
    const stepMatches = findRuleStepMatches(expectedSteps, stepDefinitionsByStep);
    const foundSteps = new Set(stepMatches.map((match) => match.step));
    const missingSteps = expectedSteps.filter((step) => !foundSteps.has(step));
    const stepsCovered = expectedSteps.length > 0 && missingSteps.length === 0;
    const tested = describeMatches.length > 0 || tagMatches.length > 0 || stepsCovered;

    result.set(rule.id, {
      tested,
      reason: describeMatches.length > 0 ? "describe" : tagMatches.length > 0 ? "tag" : stepsCovered ? "steps" : "none",
      describeMatches,
      tagMatches,
      stepMatches,
      missingSteps
    });
  }

  return result;
}

export function buildTestMatches(
  rules: FeatureRule[],
  describeMatchesByFile: Iterable<DescribeMatch[]>,
  tagMatchesByFile: Iterable<RuleTagMatch[]>,
  stepDefinitionsByFile: Iterable<StepDefinitionMatch[]>
): Map<string, RuleTestMatch> {
  const describeMatchesByRule = new Map<string, RuleTestMatch["describeMatches"]>();
  const tagMatchesByRule = new Map<string, RuleTestMatch["tagMatches"]>();
  const stepDefinitionsByStep = new Map<string, StepDefinitionMatch[]>();

  for (const rule of rules) {
    describeMatchesByRule.set(rule.id, []);
    tagMatchesByRule.set(rule.id, []);
  }

  for (const matches of describeMatchesByFile) {
    for (const match of matches) {
      describeMatchesByRule.get(match.ruleId)?.push({
        file: match.file,
        line: match.line,
        preview: match.preview
      });
    }
  }

  for (const matches of tagMatchesByFile) {
    for (const match of matches) {
      tagMatchesByRule.get(match.ruleId)?.push({
        file: match.file,
        line: match.line,
        preview: match.preview
      });
    }
  }

  for (const definitions of stepDefinitionsByFile) {
    for (const definition of definitions) {
      const step = definition.step.trim();
      const matches = stepDefinitionsByStep.get(step) ?? [];
      matches.push(definition);
      stepDefinitionsByStep.set(step, matches);
    }
  }

  const result = new Map<string, RuleTestMatch>();
  for (const rule of rules) {
    const describeMatches = describeMatchesByRule.get(rule.id) ?? [];
    const tagMatches = tagMatchesByRule.get(rule.id) ?? [];
    const expectedSteps = Array.from(new Set(rule.steps.map((step) => step.trim()).filter(Boolean)));
    const stepMatches = findRuleStepMatches(expectedSteps, stepDefinitionsByStep);
    const foundSteps = new Set(stepMatches.map((match) => match.step));
    const missingSteps = expectedSteps.filter((step) => !foundSteps.has(step));
    const stepsCovered = expectedSteps.length > 0 && missingSteps.length === 0;
    const tested = describeMatches.length > 0 || tagMatches.length > 0 || stepsCovered;

    result.set(rule.id, {
      tested,
      reason: describeMatches.length > 0 ? "describe" : tagMatches.length > 0 ? "tag" : stepsCovered ? "steps" : "none",
      describeMatches,
      tagMatches,
      stepMatches,
      missingSteps
    });
  }

  return result;
}

export function scanTestFile(file: TestFile, ruleIndex: ReturnType<typeof createRuleSearchIndex>): IndexedTestScan {
  const indexedFile = indexTestFile(file);
  const describeMatches: DescribeMatch[] = [];
  for (const describeMatch of findDescribeMatches(indexedFile)) {
    for (const rule of ruleIndex.candidatesForText(describeMatch.text)) {
      if (describeMatch.text.includes(rule.name)) {
        describeMatches.push({
          ruleId: rule.id,
          file: describeMatch.file,
          line: describeMatch.line,
          preview: describeMatch.preview
        });
      }
    }
  }

  return {
    describeMatches,
    tagMatches: findRuleTagMatches(indexedFile, ruleIndex),
    stepDefinitions: findStepDefinitions(indexedFile)
  };
}

function findRuleTagMatches(file: IndexedTestFile, ruleIndex: ReturnType<typeof createRuleSearchIndex>): RuleTagMatch[] {
  const matches: RuleTagMatch[] = [];
  for (let index = 0; index < file.lines.length; index += 1) {
    const line = file.lines[index];
    for (const rule of ruleIndex.candidatesForText(line)) {
      if (line.includes(rule.name)) {
        matches.push({
          ruleId: rule.id,
          file: file.file,
          line: index + 1,
          preview: line.trim()
        });
      }
    }
  }

  return uniqueBy(matches, (match) => `${match.ruleId}:${match.file}:${match.line}`);
}

function indexTestFile(file: TestFile): IndexedTestFile {
  return {
    ...file,
    lines: file.content.split(/\r?\n/),
    lineStarts: getLineStarts(file.content)
  };
}

function findDescribeMatches(file: IndexedTestFile): Array<{ text: string; file: string; line: number; preview: string }> {
  const matches: Array<{ text: string; file: string; line: number; preview: string }> = [];
  for (const match of matchAllWithLine(describeRegex, file.content, file.lineStarts)) {
    const text = match.match[2];
    matches.push({
      text,
      file: file.file,
      line: match.line,
      preview: getLinePreview(file.lines, match.line)
    });
  }

  return matches;
}

function findStepDefinitions(file: IndexedTestFile): StepDefinitionMatch[] {
  const matches: StepDefinitionMatch[] = [];
  for (const regex of [jsStepRegex, pythonStepRegex, dotnetStepRegex]) {
    for (const match of matchAllWithLine(regex, file.content, file.lineStarts)) {
      const step = match.match[3]?.trim();
      if (!step) {
        continue;
      }

      matches.push({
        step,
        file: file.file,
        line: match.line,
        preview: getLinePreview(file.lines, match.line)
      });
    }
  }

  return uniqueBy(matches, (match) => `${match.step}:${match.file}:${match.line}`);
}

function findRuleStepMatches(
  expectedSteps: string[],
  stepDefinitionsByStep: Map<string, StepDefinitionMatch[]>
): RuleTestMatch["stepMatches"] {
  return expectedSteps.flatMap((step) =>
    (stepDefinitionsByStep.get(step) ?? []).map((match) => ({
      step: match.step.trim(),
      file: match.file,
      line: match.line,
      preview: match.preview
    }))
  );
}

function matchAllWithLine(
  regex: RegExp,
  content: string,
  lineStarts: number[]
): Array<{ match: RegExpExecArray; line: number }> {
  const results: Array<{ match: RegExpExecArray; line: number }> = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push({
      match,
      line: getLineNumber(lineStarts, match.index)
    });

    if (match.index === regex.lastIndex) {
      regex.lastIndex += 1;
    }
  }

  return results;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function getLineNumber(lineStarts: number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= index) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return high + 1;
}

function getLinePreview(lines: string[], line: number): string {
  return lines[line - 1]?.trim() ?? "";
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
