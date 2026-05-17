import { FeatureRule, RuleImplementationMatch } from "../model/types";

export function findImplementationMatches(
  rules: FeatureRule[],
  files: Array<{ file: string; content: string }>
): Map<string, RuleImplementationMatch[]> {
  const matches = new Map<string, RuleImplementationMatch[]>();

  for (const rule of rules) {
    matches.set(rule.id, []);
  }

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const rule of rules) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.includes(rule.name) && looksLikeCommentLine(line, file.content, index)) {
          matches.get(rule.id)?.push({
            file: file.file,
            line: index + 1,
            preview: line.trim()
          });
        }
      }
    }
  }

  return matches;
}

function looksLikeCommentLine(line: string, content: string, lineIndex: number): boolean {
  const trimmed = line.trim();
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

  const beforeLine = content.split(/\r?\n/).slice(0, lineIndex + 1).join("\n");
  const openBlock = beforeLine.lastIndexOf("/*");
  const closeBlock = beforeLine.lastIndexOf("*/");
  return openBlock > closeBlock;
}
