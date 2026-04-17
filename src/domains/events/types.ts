/**
 * Phase 0 — Hierarchical Event Attribution contract.
 *
 * This file locks the data shapes for the event model BEFORE any logic is
 * written. Everything downstream (assembler, attributor, validation script)
 * depends on these types.
 *
 * Design rules:
 * - Every active changelog row belongs to exactly ONE event. No orphan, no
 *   double-assign.
 * - Events hold the verdict. Child edits are components, never independent
 *   wins.
 * - `confidence_source` MUST be populated on every attribution record so seed
 *   priors never masquerade as learned truth.
 */

/**
 * The abstraction level at which an event lives.
 *
 * - `compound_launch`  — a new URL came online, often with many related edits
 *                        clustered around its publish date. Grouped by the
 *                        URL's first citation-data appearance + publish-
 *                        semantics keyword in the changelog, NOT by sheer
 *                        count of same-day edits.
 * - `sitewide_rollout` — work that changes infrastructure or publishes a
 *                        document affecting many pages at once (llms.txt,
 *                        canonical unify, performance batch, schema rollout,
 *                        site-wide content templates).
 * - `page_level`       — an isolated edit to a single existing URL that does
 *                        not fit the two scopes above.
 */
export type EventScope =
  | "compound_launch"
  | "sitewide_rollout"
  | "page_level";

/**
 * Semantic classification of the work represented by an event. Used both for
 * rendering labels and for looking up the static `event_priors_v1` heuristic
 * when scoring sitewide rollouts.
 */
export type EventType =
  | "page_created"
  | "metadata_publication" // llms.txt, GBP, Bing Places
  | "crawlability_fix" // canonical / sitemap / robots
  | "schema_rollout"
  | "performance_batch"
  | "content_rollout" // comparison tables, global components, multi-page content
  | "content_edit"; // page_level fallback

/**
 * One event. Parent record for N child changelog rows.
 */
export type ChangeEvent = {
  /** `evt-{scope}-{slug}-{YYYYMMDD}`. Deterministic from its inputs. */
  id: string;
  scope: EventScope;
  event_type: EventType;
  /** Short human label for reports. */
  label: string;
  /** First timestamp (YYYY-MM-DD) in the event's child edits. */
  started_at: string;
  /** Last timestamp (YYYY-MM-DD) in the event's child edits. */
  ended_at: string;
  /**
   * URLs the event targets.
   *   - `compound_launch`  → [created_url]
   *   - `sitewide_rollout` → list of touched URLs (may be large; null if truly sitewide)
   *   - `page_level`       → [url]
   */
  target_urls: string[] | null;
  /** IDs of imported-changes rows bound to this event. */
  child_change_ids: string[];
  /**
   * For `compound_launch`: the created URL (path-only normalized form).
   * For `sitewide_rollout`: null.
   * For `page_level`: the single affected URL (path-only normalized form).
   */
  created_url: string | null;
  tenant_id: string;
};

/**
 * Where the confidence number in an attribution came from. Critical for
 * honesty: a seed prior is not a measurement, and the UI/report must not
 * display it as one.
 */
export type ConfidenceSource =
  /** Direct post-change citation observation (lift, first-citation day). */
  | "measured"
  /** v1 static edit-type heuristic from `business-config.json`. */
  | "seed_prior"
  /** Alignment/scope rules applied without direct measurement. */
  | "inference";

/**
 * Phase 1 — how the attributor matched a changelog entry to a citation
 * movement. The 5-rung ladder from most- to least-specific. Only set on
 * EventAttribution.evidence when the underlying entry is a
 * `schema_experiment` (`change_family === "schema_experiment"`). Legacy
 * entries without structured fields never get this field populated.
 *
 * Mapping to attribution confidence:
 *   exact    → c_scope multiplier 1.00, confidence_source "measured"
 *   strong   → c_scope multiplier 0.85, confidence_source "measured"
 *   partial  → c_scope multiplier 0.65, confidence_source "inference"
 *   fallback → c_scope multiplier 0.40, confidence_source "inference"
 */
export type SchemaMatchSpecificity =
  | "exact"
  | "strong"
  | "partial"
  | "fallback"
  | "none";

/**
 * One attribution per event. The verdict string is scope-dependent — see the
 * event-attributor for the enumeration per scope.
 *
 * Scope verdict enums (for reference; kept as `string` here to allow all three
 * scope verdict vocabularies to live in one store):
 *   compound_launch  → "landed_fast" | "landed_normal" | "landed_slow" | "never_landed"
 *   sitewide_rollout → "attributed_high" | "attributed_medium" | "attributed_low" | "inconclusive"
 *   page_level       → "helping" | "promising" | "nothing_yet" | "hurting"
 *                      | "degrading" | "inconclusive" | "not_enough_data"
 */
export type EventAttribution = {
  event_id: string;
  /** When the event lines up with a detected site-movement window, that window's id. Null otherwise. */
  site_movement_event_id: string | null;
  verdict: string;
  /** 0..1 geomean(c_timing, c_scope, c_magnitude). */
  confidence: number;
  evidence: {
    c_timing: number;
    c_scope: number;
    c_magnitude: number;
    confidence_source: ConfidenceSource;
    /** Short plain-English explanation of the math for the report. */
    narrative: string;
    /**
     * Only populated when `confidence_source === "measured"` AND we can
     * compute a real post-change citation lift. Null otherwise.
     */
    observed_lift_pct: number | null;
    /**
     * For compound_launch: days from `ended_at` to the URL's first citation.
     * Null for other scopes, or if the URL never cited.
     */
    days_to_first_citation: number | null;
    /**
     * Phase 1 — for schema_experiment entries, which rung of the matching
     * ladder produced this attribution. Undefined for non-schema events so
     * legacy attribution behavior stays untouched.
     */
    matching_specificity?: SchemaMatchSpecificity;
  };
  /** ISO 8601 timestamp of when this attribution was computed. */
  recorded_at: string;
};

/**
 * A day that the data-quality gate has marked as unreliable for deriving
 * verdicts. Persisted to `.data/data-quality-flags.json`.
 */
export type DataQualityFlag = {
  /** YYYY-MM-DD. */
  date: string;
  /** Stable identifier for the defect class. */
  reason_code: "is_owned_false_but_category_owned" | string;
  /** Human-readable justification included in the Phase 0 report. */
  narrative: string;
  /** Which domain triggered the flag (e.g., "ritzbuilders.com"). */
  domain: string;
};

/**
 * A day-over-day citation movement large enough to be worth explaining.
 * Persisted to `.data/site-movement-events.json`.
 */
export type SiteMovementEvent = {
  /** `mov-{YYYYMMDD}`. */
  id: string;
  /** YYYY-MM-DD — the day AFTER the delta (the day the lift was observed). */
  date: string;
  prev_count: number;
  count: number;
  /** count - prev_count. */
  delta_abs: number;
  /** (count - prev_count) / max(prev_count, 1). */
  delta_pct: number;
  /** Reason the detector admitted this day. */
  trigger: "delta_pct_over_threshold" | "delta_abs_over_threshold" | "both";
  tenant_id: string;
};
