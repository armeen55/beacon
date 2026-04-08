export type OutcomeEventType =
  | "first_appearance"
  | "visibility_regained"
  | "mention_surge"
  | "citation_gained"
  | "position_improvement"
  | "visibility_lost";

export type EventDirection =
  | "positive"
  | "negative"
  | "neutral";

export type OutcomeEvent = {
  id: string;
  date_detected: string;
  scope_type: "prompt" | "topic" | "entity";
  scope_id: string;
  platform: string;
  event_type: OutcomeEventType;
  direction: EventDirection;
  magnitude: number | null;
  summary: string;
  evidence_refs: string[];
  context: Record<string, unknown>;
};
