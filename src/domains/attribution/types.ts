import type { SignalType } from "@/lib/constants";

export type MatchStrength = "strong" | "partial" | "none" | "unknown";

export type CandidateLinkStatus = "suggested" | "confirmed" | "rejected";

export type CandidateLink = {
  id: string;
  result_id: string;
  change_id: string;
  status: CandidateLinkStatus;
  attribution: Attribution;
  created_at: string;
  reviewed_at: string | null;
};

export type TruthRelation = "causal" | "contributing" | "unrelated" | "unknown";

export type TruthLabel = {
  id: string;
  result_id: string;
  change_id: string;
  relation: TruthRelation;
  labeled_at: string;
  notes: string | null;
};

export type AttributionRole = "primary" | "contributing" | "supporting";

export type AttributionConfidence = "high" | "medium" | "low" | "uncertain";

export type Attribution = {
  change_id: string;
  result_id: string;
  role: AttributionRole;
  confidence: AttributionConfidence;
  matches: {
    platform: MatchStrength;
    topic: MatchStrength;
    url: MatchStrength;
    geo: MatchStrength;
    temporal: MatchStrength;
  };
  temporal_distance_days: number;
  within_impact_window: boolean;
  explanation: string;
};

export type ChangeVerdict =
  | "validated"
  | "partial"
  | "inconclusive"
  | "no_impact"
  | "pending";

export type ChangeVerdictData = {
  verdict: ChangeVerdict;
  attributions: Attribution[];
  summary: string;
};

export type BriefVerdict =
  | "validated"
  | "partially_validated"
  | "not_validated"
  | "mixed"
  | "pending";

export type BriefVerdictData = {
  verdict: BriefVerdict;
  hit_rate: number;
  summary: string;
};

export type SignalEffectiveness = {
  signal_type: SignalType;
  total_changes: number;
  with_results: number;
  positive_impact: number;
  hit_rate: number;
  average_days_to_impact: number | null;
};
