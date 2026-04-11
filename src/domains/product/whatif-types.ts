export type SimulationActionType =
  | "refresh_content"
  | "strengthen_structure"
  | "improve_internal_links"
  | "expand_page_coverage"
  | "strengthen_extractability"
  | "add_faq"
  | "add_schema"
  | "add_city_page"
  | "competitive_displacement";

export type SimulationInput = {
  action_type: SimulationActionType;
  target_page_url: string | null;
  target_topic: string | null;
  description: string;
};

export type HistoricalEvidence = {
  action_type: SimulationActionType;
  sample_size: number;
  positive_outcomes: number;
  negative_outcomes: number;
  neutral_outcomes: number;
  avg_citation_delta: number | null;
  data_quality: "strong" | "moderate" | "thin" | "none";
};

export type SimulationResult = {
  input: SimulationInput;
  evidence: HistoricalEvidence;
  can_simulate: boolean;
  direction: "likely_positive" | "uncertain" | "likely_negative" | "insufficient_data";
  explanation: string;
};

export type WhatIfReadiness = {
  computed_at: string;
  action_types_with_evidence: number;
  total_action_types: number;
  total_outcomes: number;
  readiness: "ready" | "partial" | "not_ready";
  assessment: string;
  evidence_by_action: HistoricalEvidence[];
};
