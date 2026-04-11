export type OutcomeActionType =
  | "recommendation_accepted"
  | "recommendation_dismissed"
  | "recommendation_deferred"
  | "experiment_started"
  | "experiment_promising"
  | "experiment_inconclusive"
  | "experiment_negative"
  | "experiment_dropped"
  | "scorecard_validated"
  | "scorecard_partial"
  | "scorecard_negative"
  | "scorecard_inconclusive"
  | "scorecard_too_early";

export type OutcomeRecord = {
  outcome_id: string;
  action_type: OutcomeActionType;
  action_detail: string;
  rec_id: string | null;
  experiment_id: string | null;
  change_id: string | null;
  target_page: string | null;
  target_topic: string | null;
  started_at: string;
  resolved_at: string | null;
  verdict: string | null;
  citation_delta: number | null;
  confidence: string | null;
  source_signal_tier: "explicit" | "inferred";
  pattern_id: string | null;
};

export type OutcomeSummary = {
  total: number;
  by_action_type: Record<string, number>;
  by_verdict: Record<string, number>;
  positive_rate: number | null;
  avg_citation_delta: number | null;
  earliest: string | null;
  latest: string | null;
};
