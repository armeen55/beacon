export type PatternConfidence = "high" | "medium" | "low";

export type PatternTrend = "improving" | "stable" | "declining" | "new";

export type Pattern = {
  id: string;
  label: string;
  patternKey: string;

  changeIds: string[];
  clusterIds: string[];
  eventIds: string[];

  executionCount: number;
  clustersImpacted: number;

  attributedEventCount: number;
  totalEventCount: number;

  successRate: number;
  failureRate: number;

  avgTimeToImpact: number;

  dominantOpportunityTypes: string[];
  dominantPlatforms: string[];
  dominantGeo: string[];

  lastSeenAt: string;

  score: number;
  confidenceBand: PatternConfidence;
  trend: PatternTrend;

  untappedContexts: string[];
};

export const PATTERN_CONFIDENCE_COLORS: Record<PatternConfidence, string> = {
  high: "text-status-success",
  medium: "text-status-warning",
  low: "text-muted-foreground",
};

export const PATTERN_TREND_LABELS: Record<PatternTrend, string> = {
  improving: "Improving",
  stable: "Stable",
  declining: "Declining",
  new: "New",
};

export const PATTERN_TREND_COLORS: Record<PatternTrend, string> = {
  improving: "text-status-success",
  stable: "text-muted-foreground",
  declining: "text-status-danger",
  new: "text-accent-primary",
};
