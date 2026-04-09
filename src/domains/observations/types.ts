/**
 * First-class observation runs — reproducible passes that produced artifacts
 * (snapshots, guardrails, diffs). Extends legacy scan-run counters for one spine.
 */

/** Legacy scan counters (kept for charts + backward compat). */
export type ObservationArtifactCounts = {
  pages_scanned: number;
  pages_changed: number;
  pages_with_errors: number;
  guardrail_alerts: number;
  critical_count: number;
  regression_count: number;
  improvement_count: number;
};

export type ObservationRunType =
  | "website_crawl"
  /** Live HTML re-fetch from ship verification (single URL). */
  | "website_verify"
  | "citation_sample_import"
  | "composite_placeholder";

export type ObservationRunStatus = "completed" | "failed" | "partial";

/**
 * Single persisted row in `.data/observation-runs.json`.
 * `run_id` matches `observation_run_id` on snapshots/guardrails from that pass.
 */
export type ObservationRun = ObservationArtifactCounts & {
  run_id: string;
  run_type: ObservationRunType;
  /** Pipeline or importer identity (e.g. scan-owned-pages). */
  source: string;
  status: ObservationRunStatus;
  started_at: string;
  completed_at: string;
  /** Human scope line for UI (not a security boundary). */
  scope_label: string;
  /** Extractor / classifier version when applicable. */
  parser_version?: string;
  /** Previous run this pass was diffed against, if known. */
  baseline_run_id?: string | null;
  /** Competitor universe snapshot at run completion (workspace / demo / empty). */
  competitor_universe_version?: number | null;
  competitor_universe_fingerprint?: string | null;
  competitor_universe_scope?: "configured_file" | "demo_defaults" | "empty" | null;
  /** `pinned` when stamped at write time; omit or `legacy_unpinned` for older rows. */
  competitor_universe_pin_status?: "pinned" | "legacy_unpinned";
};

export const OBSERVATION_RUN_PARSER_VERSION = "page-snapshot-v1";
