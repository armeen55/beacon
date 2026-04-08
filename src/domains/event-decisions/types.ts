export type CauseType =
  | "change"
  | "competitor"
  | "algorithm"
  | "unknown";

export type OperatorConfidence =
  | "high"
  | "medium"
  | "low";

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
};
