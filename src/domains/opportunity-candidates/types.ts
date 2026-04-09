export type OpportunityCandidateType =
  | "adjacent"
  | "missing"
  | "expansion"
  | "gap";

export type CandidateConfidence = "high" | "medium" | "low";

export type OpportunityCandidate = {
  id: string;
  label: string;
  queryTemplate: string;

  sourcePatternId: string;
  sourcePatternLabel: string;

  sourceClusterIds: string[];

  opportunityType: OpportunityCandidateType;

  targetTopic: string;
  targetCity: string | null;
  targetPlatform: string | "all";

  similarityScore: number;
  expectedImpact: number;

  reasoning: string;
  supportingEvidence: string[];
  caveats: string[];

  confidence: CandidateConfidence;

  alreadyExists: boolean;
};

export const CANDIDATE_TYPE_LABELS: Record<OpportunityCandidateType, string> = {
  adjacent: "Adjacent City",
  missing: "Missing Coverage",
  expansion: "Topic Expansion",
  gap: "Pattern Gap",
};

export const CANDIDATE_TYPE_COLORS: Record<OpportunityCandidateType, string> = {
  adjacent: "text-muted-foreground",
  missing: "text-status-warning",
  expansion: "text-muted-foreground",
  gap: "text-muted-foreground",
};

export const CANDIDATE_CONFIDENCE_COLORS: Record<CandidateConfidence, string> = {
  high: "text-muted-foreground",
  medium: "text-muted-foreground",
  low: "text-muted-foreground",
};
