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
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const commentLine = looksLikeCommentLine(line, inBlockComment);
    inBlockComment = updateBlockCommentState(line, inBlockComment);

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
    trimmed.startsWith("/**")
  ) {
    return true;
  }

  if (trimmed.includes("//") || trimmed.includes("#") || trimmed.includes("/*")) {
    return true;
  }

  return false;
}

function updateBlockCommentState(line: string, inBlockComment: boolean): boolean {
  const blockStart = line.indexOf("/*");
  const blockEnd = line.indexOf("*/");

  if (inBlockComment) {
    return blockEnd === -1;
  }

  return blockStart !== -1 && (blockEnd === -1 || blockStart < blockEnd);
}
