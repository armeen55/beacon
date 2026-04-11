/**
 * Conversion Path — placeholder types for future intelligence.
 *
 * Represents the conceptual chain:
 *   prompt → answer presence → citation/source → visit (future) → conversion (future)
 *
 * Beacon currently can observe steps 1-3. Steps 4-5 require
 * external analytics integration not yet available. These types
 * exist to define the architecture cleanly so future phases can
 * extend without rewriting.
 */

export type ConversionPathStage =
  | "prompt_triggered"
  | "answer_present"
  | "citation_earned"
  | "visit_observed"
  | "conversion_recorded";

export type PathStageStatus = "observed" | "inferred" | "not_available";

export type ConversionPathEntry = {
  id: string;
  prompt_id: string | null;
  prompt_text: string | null;
  topic: string | null;
  page_url: string | null;
  stages: Record<ConversionPathStage, PathStageStatus>;
  furthest_stage: ConversionPathStage;
  platform: string | null;
  observed_at: string | null;
};

export type ConversionPathSummary = {
  computed_at: string;
  total_paths: number;
  by_furthest_stage: Record<ConversionPathStage, number>;
  observable_stages: ConversionPathStage[];
  future_stages: ConversionPathStage[];
  readiness: "partial" | "not_ready";
  assessment: string;
};
