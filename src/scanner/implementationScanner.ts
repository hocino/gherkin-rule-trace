import { FeatureRule, RuleImplementationMatch } from "../model/types";
import { createRuleSearchIndex, RuleSearchIndex } from "./ruleSearchIndex";

export interface IndexedImplementationMatch extends RuleImplementationMatch {
  ruleId: string;
}

export function findImplementationMatches(
  rules: FeatureRule[],
  files: Array<{ file: string; content: string }>
): Map<string, RuleImplementationMatch[]> {
  const matches = new Map<string, RuleImplementationMatch[]>();

  for (const rule of rules) {
    matches.set(rule.id, []);
  }

  const ruleIndex = createRuleSearchIndex(rules);

  for (const file of files) {
    for (const match of scanImplementationFile(file, ruleIndex)) {
        matches.get(match.ruleId)?.push({
          file: match.file,
          line: match.line,
          preview: match.preview,
          layer: match.layer
        });
    }
  }

  return matches;
}

export function scanImplementationFile(
  file: { file: string; content: string },
  ruleIndex: RuleSearchIndex
): IndexedImplementationMatch[] {
  const matches: IndexedImplementationMatch[] = [];
  const lines = file.content.split(/\r?\n/);
  let blockCommentEnd: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const commentLine = looksLikeCommentLine(line, blockCommentEnd !== undefined);
    blockCommentEnd = updateBlockCommentState(line, blockCommentEnd);

    if (!commentLine) {
      continue;
    }

    for (const rule of ruleIndex.candidatesForText(line)) {
      if (line.includes(rule.name)) {
        matches.push({
          ruleId: rule.id,
          file: file.file,
          line: index + 1,
          preview: line.trim(),
          layer: "unknown"
        });
      }
    }
  }

  return matches;
}

function looksLikeCommentLine(line: string, inBlockComment: boolean): boolean {
  const trimmed = line.trim();
  if (inBlockComment) {
    return true;
  }

  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("/**") ||
    trimmed.startsWith("<!--")
  ) {
    return true;
  }

  if (trimmed.includes("//") || trimmed.includes("#") || trimmed.includes("/*") || trimmed.includes("<!--")) {
    return true;
  }

  return false;
}

function updateBlockCommentState(line: string, activeEndToken: string | undefined): string | undefined {
  if (activeEndToken) {
    return line.includes(activeEndToken) ? undefined : activeEndToken;
  }

  const starts = [
    { start: line.indexOf("/*"), endToken: "*/" },
    { start: line.indexOf("<!--"), endToken: "-->" }
  ].filter((candidate) => candidate.start >= 0);

  const firstStart = starts.sort((a, b) => a.start - b.start)[0];
  if (!firstStart) {
    return undefined;
  }

  const end = line.indexOf(firstStart.endToken, firstStart.start + 1);
  return end === -1 ? firstStart.endToken : undefined;
}
