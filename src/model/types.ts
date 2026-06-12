import * as vscode from "vscode";

export interface ScenarioInfo {
  name: string;
  line: number;
  steps: string[];
}

export interface GherkinStepInfo {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  text: string;
  line: number;
}

export interface FeatureRule {
  id: string;
  name: string;
  featureFile: string;
  line: number;
  featureName?: string;
  scenarios: ScenarioInfo[];
  steps: string[];
  gherkinSteps: GherkinStepInfo[];
}

export type ImplementationLayer = "backend" | "frontend" | "unknown";

export interface RuleImplementationMatch {
  file: string;
  line: number;
  preview: string;
  layer: ImplementationLayer;
}

export interface RuleTestMatch {
  tested: boolean;
  reason: "describe" | "tag" | "steps" | "none";
  describeMatches: Array<{ file: string; line: number; preview: string }>;
  tagMatches: Array<{ file: string; line: number; preview: string }>;
  stepMatches: Array<{ step: string; file: string; line: number; preview: string }>;
  missingSteps: string[];
}

export interface RuleTrace {
  rule: FeatureRule;
  implementations: RuleImplementationMatch[];
  tests: RuleTestMatch;
}

export interface WorkspaceScanResult {
  rules: RuleTrace[];
  scannedAt: Date;
  stats?: {
    mode: "full" | "incremental";
    durationMs: number;
    featureFiles: number;
    codeFiles: number;
    rules: number;
    changedFiles: number;
    cacheHits: number;
    cacheMisses: number;
  };
}

export interface RuleTraceNode {
  label: string;
  kind: "folder" | "file" | "rule";
  children?: RuleTraceNode[];
  resourceUri?: vscode.Uri;
  trace?: RuleTrace;
}
