import type { Pattern } from "./types";

export function topPatterns(patterns: Pattern[], n: number): Pattern[] {
  return [...patterns].sort((a, b) => b.score - a.score).slice(0, n);
}

export function decliningPatterns(patterns: Pattern[]): Pattern[] {
  return patterns.filter((p) => p.trend === "declining");
}

export function highConfidencePatterns(patterns: Pattern[]): Pattern[] {
  return patterns.filter((p) => p.confidenceBand === "high");
}

export function patternsWithUntapped(patterns: Pattern[]): Pattern[] {
  return patterns.filter(
    (p) => p.untappedContexts.length > 0 && p.confidenceBand !== "low"
  );
}

export type PatternSummary = {
  total: number;
  highConfidence: number;
  improving: number;
  declining: number;
  totalExecutions: number;
  totalAttributed: number;
  avgSuccessRate: number;
  bestPattern: Pattern | null;
  untappedOpportunities: number;
};

export function summarizePatterns(patterns: Pattern[]): PatternSummary {
  let high = 0;
  let improving = 0;
  let declining = 0;
  let executions = 0;
  let attributed = 0;
  let rateSum = 0;
  let untapped = 0;

  for (const p of patterns) {
    if (p.confidenceBand === "high") high++;
    if (p.trend === "improving") improving++;
    if (p.trend === "declining") declining++;
    executions += p.executionCount;
    attributed += p.attributedEventCount;
    rateSum += p.successRate;
    untapped += p.untappedContexts.length;
  }

  return {
    total: patterns.length,
    highConfidence: high,
    improving,
    declining,
    totalExecutions: executions,
    totalAttributed: attributed,
    avgSuccessRate:
      patterns.length > 0 ? Math.round(rateSum / patterns.length) : 0,
    bestPattern:
      patterns.length > 0
        ? [...patterns].sort((a, b) => b.score - a.score)[0]
        : null,
    untappedOpportunities: untapped,
  };
}
