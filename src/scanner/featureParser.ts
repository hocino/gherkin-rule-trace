import { createHash } from "crypto";
import { FeatureRule, GherkinStepInfo, ScenarioInfo } from "../model/types";

const featureRegex = /^\s*Feature:\s*(.+?)\s*$/;
const ruleRegex = /^\s*Rule:\s*(.+?)\s*$/;
const scenarioRegex = /^\s*(Scenario(?: Outline)?):\s*(.+?)\s*$/;
const stepRegex = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/;

interface MutableRule extends FeatureRule {
  scenarios: ScenarioInfo[];
  steps: string[];
  gherkinSteps: GherkinStepInfo[];
}

export function parseFeatureFile(featureFile: string, content: string): FeatureRule[] {
  const rules: MutableRule[] = [];
  const lines = content.split(/\r?\n/);
  let featureName: string | undefined;
  let currentRule: MutableRule | undefined;
  let currentScenario: ScenarioInfo | undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const featureMatch = line.match(featureRegex);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      return;
    }

    const ruleMatch = line.match(ruleRegex);
    if (ruleMatch) {
      const name = ruleMatch[1].trim();
      currentScenario = undefined;
      currentRule = {
        id: createRuleId(featureFile, name),
        name,
        featureFile,
        line: lineNumber,
        featureName,
        scenarios: [],
        steps: [],
        gherkinSteps: []
      };
      rules.push(currentRule);
      return;
    }

    if (!currentRule) {
      return;
    }

    const scenarioMatch = line.match(scenarioRegex);
    if (scenarioMatch) {
      currentScenario = {
        name: scenarioMatch[2].trim(),
        line: lineNumber,
        steps: []
      };
      currentRule.scenarios.push(currentScenario);
      return;
    }

    const stepMatch = line.match(stepRegex);
    if (stepMatch) {
      const keyword = stepMatch[1] as GherkinStepInfo["keyword"];
      const normalizedStep = normalizeStep(line);
      if (!normalizedStep) {
        return;
      }

      currentRule.steps.push(normalizedStep);
      currentRule.gherkinSteps.push({
        keyword,
        text: normalizedStep,
        line: lineNumber
      });
      if (currentScenario) {
        currentScenario.steps.push(normalizedStep);
      }
    }
  });

  for (const rule of rules) {
    rule.steps = Array.from(new Set(rule.steps));
  }

  return rules;
}

export function normalizeStep(stepLine: string): string {
  return stepLine.replace(/^\s*(Given|When|Then|And|But)\s+/i, "").trim();
}

function createRuleId(featureFile: string, ruleName: string): string {
  return createHash("sha1").update(`${featureFile}\n${ruleName}`).digest("hex");
}
