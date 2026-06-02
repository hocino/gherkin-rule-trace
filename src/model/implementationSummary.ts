import { RuleTrace } from "./types";

export interface ImplementationSummary {
  backend: number;
  frontend: number;
  unknown: number;
  total: number;
}

export function summarizeImplementations(trace: RuleTrace): ImplementationSummary {
  const summary: ImplementationSummary = {
    backend: 0,
    frontend: 0,
    unknown: 0,
    total: trace.implementations.length
  };

  for (const implementation of trace.implementations) {
    summary[implementation.layer] += 1;
  }

  return summary;
}
