export type MatchStrength = "strong" | "partial" | "none" | "unknown";

export type CandidateCauseStatus =
  | "suggested"
  | "confirmed"
  | "rejected";

export type CandidateCause = {
  id: string;
  event_id: string;
  change_id: string;
  platform_match: MatchStrength;
  topic_match: MatchStrength;
  geo_match: MatchStrength;
  entity_match: MatchStrength;
  temporal_match: MatchStrength;
  score: number;
  rationale: string;
  status: CandidateCauseStatus;
  created_at: string;
  reviewed_at: string | null;
};
