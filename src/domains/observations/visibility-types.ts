/**
 * Visibility / citation sample observation — prompt & platform truth that is
 * usually import-backed. Kept separate from website crawl `ObservationRun`.
 */

/** Backs `Result` rows in `lib/seed-data.ts` when no import is active. */
export const VISIBILITY_SEED_WALKTHROUGH_RUN_ID =
  "vis-seed-walkthrough" as const;

export type VisibilityObservationRunStatus = "completed" | "failed" | "partial";

export type VisibilityObservationRun = {
  run_id: string;
  /** What kind of visibility bundle this row describes. */
  run_type: "citation_sample_import" | "prompt_results_import" | "composite";
  /** e.g. Profound export, CSV, citation-evidence-index build. */
  source: string;
  status: VisibilityObservationRunStatus;
  started_at: string;
  completed_at: string;
  scope_label: string;
  /** Prompt set / export version when known (often unknown for raw imports). */
  prompt_set_version?: string | null;
  /** e.g. "chatgpt + google_aio + perplexity rows in sample history". */
  engine_platform_note?: string | null;
  parser_version?: string | null;
  baseline_visibility_run_id?: string | null;
  counts: {
    topic_buckets: number;
    page_topic_rollup_rows: number;
    total_citations_accounted: number;
    distinct_external_domains_sampled: number;
    owned_rollup_rows: number;
  };
  /** True when Beacon synthesized this row from on-disk index (no dedicated run file). */
  is_synthetic_wrapper: boolean;
  /** ISO timestamp from citation-evidence-index `built_at` when present. */
  citation_index_built_at?: string | null;
  /** Sample history / Result rows tied to this run (when known). */
  sample_result_row_count?: number | null;
  /** Optional cross-link to citation rollup run id (same disk era). */
  linked_citation_index_run_id?: string | null;
  /** Competitor universe at import / run creation; synthetic rows use `unpinned`. */
  competitor_universe_version?: number | null;
  competitor_universe_fingerprint?: string | null;
  competitor_universe_scope?: "configured_file" | "demo_defaults" | "empty" | null;
  competitor_universe_pin_status?: "pinned" | "legacy_unpinned" | "synthetic_unpinned";
};
