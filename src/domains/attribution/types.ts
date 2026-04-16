import type { SignalType } from "@/lib/constants";
import type { EvidenceTier } from "@/domains/pages/types";

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
  /** Owning tenant. */
  tenant_id: string;
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

export type CauseType = "change" | "competitor" | "algorithm" | "unknown";
export type OperatorConfidence = "high" | "medium" | "low";

export type EventDecision = {
  id: string;
  event_id: string;
  result_id: string;
  cause_type: CauseType;
  primary_change_id: string | null;
  operator_confidence: OperatorConfidence;
  operator_note: string | null;
  rejected_change_ids: string[];
  decided_at: string;
  /** Owning tenant. */
  tenant_id: string;
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
    sourceCategory: MatchStrength;
  };
  factor_scores: Record<string, number>;
  evidence_tier: EvidenceTier | null;
  temporal_distance_days: number;
  within_impact_window: boolean;
  explanation: string;
};

export type ChangeVerdict =
  | "validated"
  | "partial"
  | "inconclusive"
  | "no_impact"
  | "negative"
  | "too_early"
  | "pending";

export type ImpactConfidence = "high" | "medium" | "low";

export type ImpactDirection = "positive" | "negative" | "mixed" | "none";

export type ChangeImpact = {
  confidence: ImpactConfidence;
  direction: ImpactDirection;
  whyExplanation: string;
  nextAction: string;
};

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
