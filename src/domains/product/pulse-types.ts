export type PulseEventType =
  | "citation_decline"
  | "discrepancy_detected"
  | "competitor_pressure"
  | "local_gap"
  | "extractability_gap"
  | "journey_gap"
  | "sampling_stale";

export type PulseSeverity = "high" | "medium" | "info";

export type PulseEvent = {
  id: string;
  type: PulseEventType;
  severity: PulseSeverity;
  title: string;
  detail: string;
  href: string;
  created_at: string;
};

export type PulseSummary = {
  computed_at: string;
  events: PulseEvent[];
  high_count: number;
  medium_count: number;
  info_count: number;
  total: number;
};
