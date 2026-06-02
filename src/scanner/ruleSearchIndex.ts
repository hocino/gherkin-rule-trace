import { FeatureRule } from "../model/types";

export interface RuleSearchCandidate {
  id: string;
  name: string;
}

export interface RuleSearchIndex {
  candidatesForText(text: string): RuleSearchCandidate[];
}

const tokenRegex = /[#A-Za-z0-9_:-]{3,}/g;

export function createRuleSearchIndex(rules: FeatureRule[]): RuleSearchIndex {
  const tokenFrequency = new Map<string, number>();
  const ruleTokens = new Map<string, string[]>();
  const ruleById = new Map<string, RuleSearchCandidate>();

  for (const rule of rules) {
    ruleById.set(rule.id, { id: rule.id, name: rule.name });
    const tokens = tokenize(rule.name);
    ruleTokens.set(rule.id, tokens);
    for (const token of new Set(tokens)) {
      tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    }
  }

  const rulesByAnchorToken = new Map<string, RuleSearchCandidate[]>();
  const fallbackRules: RuleSearchCandidate[] = [];

  for (const rule of rules) {
    const tokens = ruleTokens.get(rule.id) ?? [];
    const anchor = chooseAnchorToken(tokens, tokenFrequency);
    const candidate = ruleById.get(rule.id);
    if (!candidate) {
      continue;
    }

    if (!anchor) {
      fallbackRules.push(candidate);
      continue;
    }

    const candidates = rulesByAnchorToken.get(anchor) ?? [];
    candidates.push(candidate);
    rulesByAnchorToken.set(anchor, candidates);
  }

  return {
    candidatesForText(text: string): RuleSearchCandidate[] {
      const textTokens = tokenize(text);
      const candidates = new Map<string, RuleSearchCandidate>();

      for (const token of textTokens) {
        for (const candidate of rulesByAnchorToken.get(token) ?? []) {
          candidates.set(candidate.id, candidate);
        }
      }

      for (const candidate of fallbackRules) {
        candidates.set(candidate.id, candidate);
      }

      return Array.from(candidates.values());
    }
  };
}

function chooseAnchorToken(tokens: string[], tokenFrequency: Map<string, number>): string | undefined {
  let bestToken: string | undefined;
  let bestFrequency = Number.MAX_SAFE_INTEGER;

  for (const token of tokens) {
    const frequency = tokenFrequency.get(token) ?? Number.MAX_SAFE_INTEGER;
    if (
      frequency < bestFrequency ||
      (frequency === bestFrequency && token.length > (bestToken?.length ?? 0))
    ) {
      bestToken = token;
      bestFrequency = frequency;
    }
  }

  return bestToken;
}

function tokenize(text: string): string[] {
  return Array.from(text.matchAll(tokenRegex), (match) => match[0].toLowerCase());
}
