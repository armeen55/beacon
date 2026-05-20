/**
 * 2026-05-20 — Slice 4.5.D.α₀a — locked promotion-eligibility table.
 *
 * Pure module. No I/O. No mutations. No side effects.
 *
 * Maps every `(trigger_signal, action_type)` pair that the
 * α-family trigger engine can emit to one of four eligibility
 * tiers. The tiers gate whether a row may eventually graduate from
 * the operator-only `/diagnostics/recommendation-triggers` surface
 * to the customer-facing recommendation queue.
 *
 *   customer-queue-ready  — already operator-validated; safe to
 *                           promote without per-row spot-checking.
 *   operator-review-only  — needs operator approve-to-promote
 *                           affordance per row (4.5.D.α₂ slice).
 *   diagnostic-only       — never auto-promote. Two flavors:
 *                             • missing_schema → industry calibration
 *                               pending; promote only after schema
 *                               expectations are tuned per industry.
 *                             • noindex_on_indexable_page +
 *                               robots_blocks_ai_bots → many
 *                               operators intentionally set these;
 *                               auto-promotion would overwrite
 *                               policy. Permanent diagnostic-only
 *                               unless an explicit per-tenant
 *                               operator override is wired in a
 *                               later slice.
 *   blocked               — unknown pairs, off-site action types,
 *                           or any explicitly-rejected combination.
 *
 * The table is the SINGLE source of truth. A new predicate cannot
 * become customer-queue-promotable simply by emitting at
 * `confidence: "high"`; it must also have an entry in this table
 * with `tier: "customer-queue-ready"`. The architecture invariant
 * `recommendation-intelligence-promotion-eligibility-pin` enforces
 * that the table contents match the operator-locked shape exactly.
 */

import type { ActionType } from "@/domains/recommendations/action-types";

export type EligibilityTier =
  | "customer-queue-ready"
  | "operator-review-only"
  | "diagnostic-only"
  | "blocked";

/**
 * Off-site action types are PERMANENTLY blocked from
 * recommendation-intelligence promotion (Section 7 I-block lock).
 * Section 7 generates off-site rows through its own pipeline.
 */
const OFF_SITE_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
]);

/**
 * Operator-locked eligibility table (2026-05-20, Section 4.5.D.α₀a).
 *
 * Key format: `${trigger_signal}::${action_type}` — same shape the
 * pin invariant uses. Any pair NOT in this map is `blocked` by
 * default.
 */
export const PROMOTION_ELIGIBILITY_TABLE: ReadonlyMap<
  string,
  EligibilityTier
> = new Map<string, EligibilityTier>([
  // ── customer-queue-ready ──────────────────────────────────────
  ["missing_title::edit_title", "customer-queue-ready"],
  ["missing_meta::edit_meta", "customer-queue-ready"],
  ["missing_h1::change_h1", "customer-queue-ready"],
  ["sitemap_missing::fix_sitemap", "customer-queue-ready"],
  ["robots_blocks_googlebot::fix_robots", "customer-queue-ready"],
  ["bad_http_status::fix_status_code", "customer-queue-ready"],

  // ── operator-review-only ──────────────────────────────────────
  ["duplicate_title::edit_title", "operator-review-only"],
  ["duplicate_meta::edit_meta", "operator-review-only"],
  ["canonical_mismatch::fix_canonical", "operator-review-only"],
  ["orphan_page::add_internal_link", "operator-review-only"],
  // Legacy 4.5.B baseline predicates — stay operator-review-only
  // until separately validated for customer queue.
  ["title_h1_mismatch::edit_title", "operator-review-only"],
  ["title_h1_mismatch::change_h1", "operator-review-only"],
  ["weak_h1::change_h1", "operator-review-only"],

  // ── diagnostic-only ───────────────────────────────────────────
  // Pending industry calibration. Schema expectations are
  // local-service-tuned today; cross-industry calibration is a
  // separate slice. Will graduate once calibration ships.
  ["missing_schema::add_schema", "diagnostic-only"],
  // Permanently diagnostic-only unless per-tenant operator
  // override is wired in a future slice. Auto-promotion would
  // override intentional operator policy on these signals.
  ["noindex_on_indexable_page::fix_noindex", "diagnostic-only"],
  // Operator correction (2026-05-20): robots_blocks_ai_bots maps
  // to fix_robots (NOT fix_noindex). The remediation is a
  // robots.txt edit, not a meta-robots edit.
  ["robots_blocks_ai_bots::fix_robots", "diagnostic-only"],
]);

/**
 * Pure lookup. Returns the locked tier for the (trigger_signal,
 * action_type) pair. Unknown pairs and off-site action types are
 * `blocked` — the safety-gate layer should never accept blocked
 * rows.
 *
 * Note: the eligibility tier is a STATIC property of the
 * (signal, action) pair. Confidence band and other dynamic
 * factors are enforced by the safety-gate layer
 * (`safety-gates.ts`), not here.
 */
export function eligibilityForTrigger(
  triggerSignal: string,
  actionType: ActionType,
): EligibilityTier {
  if (OFF_SITE_ACTION_TYPES.has(actionType)) return "blocked";
  const key = `${triggerSignal}::${actionType}`;
  return PROMOTION_ELIGIBILITY_TABLE.get(key) ?? "blocked";
}

/**
 * For tests + invariants. Returns the pinned set of pairs that
 * are customer-queue-ready. Order is stable and matches the
 * table declaration above.
 */
export function listCustomerQueueReadyPairs(): ReadonlyArray<string> {
  return Array.from(PROMOTION_ELIGIBILITY_TABLE.entries())
    .filter(([, tier]) => tier === "customer-queue-ready")
    .map(([key]) => key);
}
