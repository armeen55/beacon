export type DecayStatus =
  | "stable"
  | "soft_decline"
  | "meaningful_decline"
  | "insufficient_history";

export type CitationDecayResult = {
  page_url: string;
  topic: string | null;
  status: DecayStatus;
  current_period_citations: number;
  previous_period_citations: number;
  change_pct: number | null;
  periods_analyzed: number;
  last_citation_date: string | null;
  explanation: string;
};

export type DecayConfig = {
  /** Minimum total citations to analyze (below = insufficient_history) */
  min_citations: number;
  /** Minimum number of date periods required */
  min_periods: number;
  /** Threshold for soft decline (e.g. -0.15 = 15% drop) */
  soft_decline_threshold: number;
  /** Threshold for meaningful decline (e.g. -0.30 = 30% drop) */
  meaningful_decline_threshold: number;
};

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  min_citations: 5,
  min_periods: 4,
  soft_decline_threshold: -0.15,
  meaningful_decline_threshold: -0.30,
};
