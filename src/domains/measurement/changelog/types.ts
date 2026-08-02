import type { SignalType, AssetType } from "@/lib/constants";

type HypothesisSource = "inferred" | "recommendation" | "operator";

/**
 * Phase 1 — schema-experiment attribution pipeline.
 *
 * `change_family` groups edits by the lever they test. `schema_experiment` is
 * the first family; `content_experiment`, `metadata_experiment`, and
 * `linking_experiment` will follow in later phases. Legacy rows have
 * `change_family === undefined` and fall through to Rule 4 (free-text
 * fallback) of the attribution matching ladder.
 */
type ChangeFamily =
  | "schema_experiment"
  | "content_experiment"
  | "metadata_experiment"
  | "linking_experiment";

/**
 * Phase 1 — exactly three buckets for schema changes. `schema_content_edited`
 * must NEVER be conflated with `schema_added` (tweaking wording inside an
 * existing FAQPage is not the same lever as adding a BreadcrumbList).
 */
type SchemaChangeType =
  | "schema_added"
  | "schema_removed"
  | "schema_content_edited";

export type ChangelogEntry = {
  id: string;
  timestamp: string;
  signal_type: SignalType;
  asset_type: AssetType;
  url: string | null;
  asset_name: string;
  change_description: string;
  topic_targeted: string;
  city_targeted: string | null;
  hypothesis: string | null;
  /** Where the hypothesis came from: auto-inferred from edit type, pulled from a Beacon rec, or typed by operator. */
  hypothesis_source?: HypothesisSource;
  expected_impact_window: string | null;
  brief_id: string | null;
  opportunity_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source_system?: string;
  import_batch_id?: string;
  /**
   * Soft-delete flag. Archived entries are hidden from the /changes list but preserved on disk
   * so dedupe decisions are reversible. Set by the /changes/dedupe review flow.
   */
  archived?: boolean;
  /** Reason the entry was archived (e.g. "dedupe:csv_summary_of_<pdfId>"). */
  archived_reason?: string;
  archived_at?: string;
  /**
   * Operator reviewed this entry in the dedupe flow and decided it is NOT a duplicate
   * of any PDF-granular keeper. Excludes the entry from future dedupe-pair surfacing.
   */
  dedupe_reviewed?: boolean;
  dedupe_reviewed_at?: string;

  // ---------------------------------------------------------------------
  // Phase 1 — schema-experiment attribution fields.
  //
  // All optional. Legacy rows have these fields undefined; only rows
  // produced by `confirmFindingAsChange()` or the scanner's post-deploy
  // auto-classifier populate them. Never backfilled onto legacy rows.
  // ---------------------------------------------------------------------

  /** Which lever family this edit tests. Used by the attribution matcher. */
  change_family?: ChangeFamily;

  /**
   * Fine-grained bucket within the family. For `schema_experiment`:
   * one of `schema_added` | `schema_removed` | `schema_content_edited`.
   * String-typed to leave room for future families without another migration.
   */
  change_type?: SchemaChangeType | string;

  /** Snapshot of `page.schema_types` BEFORE the change (sorted ascending). */
  schema_types_before?: string[];
  /** Snapshot of `page.schema_types` AFTER the change (sorted ascending). */
  schema_types_after?: string[];
  /** Types present in `schema_types_after` but not `schema_types_before`. */
  schema_types_added?: string[];
  /** Types present in `schema_types_before` but not `schema_types_after`. */
  schema_types_removed?: string[];
  /** `page.schema_hash` BEFORE the change (for content_edited detection). */
  schema_hash_before?: string;
  /** `page.schema_hash` AFTER the change. */
  schema_hash_after?: string;
  /**
   * True when `page.content_hash` ALSO changed between snapshots. When true,
   * the attributor down-weights c_scope because the schema effect can't be
   * isolated from a simultaneous copy edit.
   */
  visible_copy_changed?: boolean;
  /** `"single_url"` for page-scoped experiments, `"sitewide"` for rollouts. */
  page_scope?: "single_url" | "sitewide";

  // ---------------------------------------------------------------------
  // Fix 2 (2026-04-21) — rec → finding → changelog linkage
  //
  // Stamped by `confirmFindingAsChange` when the source finding was
  // auto-linked to a previously-accepted recommendation. Attribution
  // engines use these to measure per-rec / per-pattern success rates
  // instead of relying on URL-only retroactive inference.
  //
  // Both optional. Null/absent on:
  //   - legacy rows
  //   - imported CSV rows
  //   - rows confirmed from findings that weren't preceded by an
  //     accepted rec on the same URL within the link window
  // ---------------------------------------------------------------------

  /** RecommendationResponse.recId of the accepted rec that was most likely
   *  the cause of this change. */
  source_rec_id?: string;
  /** BeaconRecommendation.patternId if the source rec was pattern-backed. */
  source_pattern_id?: string | null;

  // ---------------------------------------------------------------------
  // Sprint 6A.1 Phase 1 (2026-04-24) — typed-edit attribution columns.
  //
  // Stamped by `acceptRecommendation` when the source rec carried
  // `recommended_edits` rows (Phase 6A.1.11+). Each accepted rec
  // produces N changelog entries, one per edit; each entry carries the
  // ActionType + element_key it targeted so attribution can learn at
  // element granularity instead of just page granularity.
  //
  // Both optional. Null/absent on:
  //   - legacy rows (pre-Phase-6A.1)
  //   - rows confirmed from findings (no SpecificEdit involved)
  //   - rows from recs that had no recommended_edits (Phase 6A.1.12
  //     fallback path — preserves legacy single-changelog behavior)
  // ---------------------------------------------------------------------

  /** ActionType from `ACTION_TYPE_REGISTRY` (e.g. "edit_title",
   *  "add_h2_section", "add_faq"). */
  action_type?: string;
  /** Stable element key from `page_element_inventory` (e.g.
   *  "title[0]:abc"), or `<type>[new]:<hash>` for additive edits. */
  target_element_key?: string;

  // ---------------------------------------------------------------------
  // Recommendation Lifecycle OS — Phase 1 (2026-04-27).
  //
  // ISO timestamp at which the (future Phase 3) match engine first
  // confirmed the underlying edit is live on the page. Source:
  // `page_snapshots.fetched_at` of the matching snapshot. Stays null
  // until Phase 3 wires the match engine; Phase 4 flips the verdict
  // engine to read `live_at ?? timestamp` for the baseline split.
  //
  // Optional. Legacy rows have this undefined; the verdict engine
  // continues to use `timestamp` for them (backwards compatible).
  // ---------------------------------------------------------------------

  live_at?: string | null;

  /** Owning tenant. */
  tenant_id: string;
};
