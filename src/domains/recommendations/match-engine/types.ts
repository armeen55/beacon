/**
 * Recommendation Lifecycle OS — Phase 2 (2026-04-27).
 *
 * Pure-function match engine. Compares an accepted `recommended_edit`
 * against a fresh `page_element_inventory` snapshot and emits a
 * `MatchResult`. NO I/O. NO DB. NO scan triggers. NO Supabase.
 * NO repository imports. NO server actions.
 *
 * Phase 3 will wire `matchAcceptedEdit` into the scan dual-write block;
 * until then the engine is consumed only by tests.
 *
 * Locked by `docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md` §2 (state machine)
 * + §3 (confidence rubric) + §4 (no attribution change yet — that's
 * Phase 4).
 */

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { RecommendedEditRow } from "../recommended-edits-persistence";

/**
 * The runtime "what happened" verdict the runner should record on the
 * `recommended_edits` row's `implementation_status` column.
 *
 * `not_found_after_7d` is intentionally NOT in this union. The pure
 * engine cannot know the operator's accept-time → it returns `not_found`
 * and the (Phase 3) scan-side runner promotes to `not_found_after_7d`
 * by joining `accepted_at` against the current scan time.
 */
export type MatchOutcome =
  | "verified_live"
  | "verified_live_modified"
  | "needs_review"
  | "wrong_page"
  | "partially_implemented"
  | "not_found";

export type MatchConfidence = "high" | "medium" | "low";

/**
 * Why the engine arrived at the outcome. Carried for operator UI +
 * debugging — never gates downstream decisions.
 *
 * - `exact`        — element_text matches proposed_text after normalization.
 * - `modified`     — high-confidence text similarity above the per-action
 *                    "modified" threshold but below exact.
 * - `key_only`     — element_key matches but text differs significantly.
 * - `text_only`    — text matches but element_key differs (rare; positional drift).
 * - `wrong_page`   — text matches on a non-target URL.
 * - `structural_partial` — compound edit (FAQ Q+A) where one leg matched
 *                          and the other did not.
 * - `unsupported`  — engine has no matcher for this action_type in v1.
 * - `none`         — no match anywhere.
 */
export type MatchKind =
  | "exact"
  | "modified"
  | "key_only"
  | "text_only"
  | "wrong_page"
  | "structural_partial"
  | "unsupported"
  | "none";

export type MatchResult = {
  outcome: MatchOutcome;
  confidence: MatchConfidence;
  kind: MatchKind;
  /** [0,1] — undefined when no candidate was scored (e.g., not_found). */
  similarity?: number;
  /** `page_element_inventory.element_key` of the matched element. */
  matchedElementKey?: string;
  /** Text of the matched element at the time of the snapshot. */
  matchedElementText?: string;
  /** When `kind === "wrong_page"`, the URL where the text was found. */
  matchedUrl?: string;
  /** Free-text reason. Operator-readable; never parsed downstream. */
  reason?: string;
};

/**
 * A single non-target URL's inventory, supplied so the engine can detect
 * "operator put the edit on the wrong page". Only consulted after the
 * target URL fails to produce an exact or modified match.
 */
export type OtherUrlInventory = {
  url: string;
  rows: ReadonlyArray<PageElementInventoryRow>;
};

export type MatchInputs = {
  /** The accepted edit to match. */
  edit: RecommendedEditRow;
  /** Element inventory of the edit's `target_url` from the latest scan. */
  currentInventory: ReadonlyArray<PageElementInventoryRow>;
  /**
   * Inventory of the same URL from the previous scan. Optional — used
   * by future "regression detection" logic; v1 ignores it. Reserved
   * here so the runner contract doesn't shift in Phase 3.
   */
  previousInventory?: ReadonlyArray<PageElementInventoryRow> | null;
  /** Inventories from non-target URLs for wrong-page detection. */
  otherUrlInventories?: ReadonlyArray<OtherUrlInventory>;
};

// ── Per-action-type confidence thresholds ─────────────────────────────────
//
// Locked by `docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md` §3.2. The two
// numbers per row are: HIGH-modified (sim ≥ x → verified_live_modified)
// and MEDIUM (sim ≥ y → needs_review). Below MEDIUM = not_found.
// HIGH-exact is always strict equality after normalization (sim === 1
// after exact case-preserving compare).
//
// Singletons (title/meta/h1) collapse to one element so the matcher
// only needs (modified, medium). Positional/new (h2/faq/internal_link)
// score every candidate and pick the max.

export type ActionThresholds = {
  modified: number;
  medium: number;
};

export const ACTION_THRESHOLDS: Record<string, ActionThresholds> = {
  edit_title: { modified: 0.85, medium: 0.5 },
  edit_meta: { modified: 0.85, medium: 0.5 },
  change_h1: { modified: 0.85, medium: 0.5 },
  add_h2_section: { modified: 0.7, medium: 0.5 },
  rewrite_h2: { modified: 0.7, medium: 0.5 },
  add_faq: { modified: 0.85, medium: 0.7 },
  rewrite_faq: { modified: 0.85, medium: 0.7 },
  add_internal_link: { modified: 0.85, medium: 0.5 },
};

/**
 * Action types the v1 match engine handles directly. Anything outside
 * this set returns `not_found` + `kind: "unsupported"` with a reason
 * naming the action — caller logs but does not fail the scan.
 */
export const SUPPORTED_ACTION_TYPES = [
  "edit_title",
  "edit_meta",
  "change_h1",
  "add_h2_section",
  "rewrite_h2",
  "add_faq",
  "rewrite_faq",
  "add_internal_link",
  "add_schema",
  "fix_schema",
] as const;

export type SupportedActionType = (typeof SUPPORTED_ACTION_TYPES)[number];

export function isSupportedActionType(s: string): s is SupportedActionType {
  return (SUPPORTED_ACTION_TYPES as readonly string[]).includes(s);
}
