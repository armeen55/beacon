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
  // Internal-link brain (2026-06-12): contextual topic-cluster link
  // suggestions — same human-judgment posture as the other link advice.
  ["internal_link_opportunity::add_internal_link", "operator-review-only"],
  // Source-ledger slice (2026-06-12): picking which sources to cite is
  // editorial judgment — the directive draft names WHAT to add, never
  // the sources themselves.
  ["uncited_content::add_proof_section", "operator-review-only"],
  // AEO answer-block readiness (2026-06-12): the directive names what
  // to add; the OWNER writes the factual answer (no auto-authoring of
  // cultural/historical claims) — operator review.
  ["missing_answer_block::add_answer_block", "operator-review-only"],
  // Legacy 4.5.B baseline predicates — stay operator-review-only
  // until separately validated for customer queue.
  ["title_h1_mismatch::edit_title", "operator-review-only"],
  ["title_h1_mismatch::change_h1", "operator-review-only"],
  ["weak_h1::change_h1", "operator-review-only"],
  // Cannibalization slice (2026-06-12): link-structure advice wants
  // human eyes (same posture as orphan_page::add_internal_link).
  ["semrush_cannibalization::add_internal_link", "operator-review-only"],
  // Keyword-gap slice (2026-06-12): new-content briefs commit real
  // authoring effort — human judgment gates them.
  ["semrush_keyword_gap::create_page", "operator-review-only"],
  // Originality guard (audit #13, 2026-06-12): when the gap keyword's
  // topic is already covered by an existing page, the play flips to
  // expanding that page — same human-judgment tier as the family.
  ["semrush_keyword_gap::add_h2_section", "operator-review-only"],

  // Content Schema Engine (2026-06-12). Unlike the builder-tuned
  // `missing_schema` signal below (diagnostic-only pending industry
  // calibration), the content branch involves NO industry-tuned
  // types: Article on an article-shaped content page is universally
  // correct (Google: Article has no required properties), the page
  // class comes from the tenant's own contentSiteMode config, store
  // pages are guarded out (Product schema present → no emission),
  // and the deterministic draft is pinned against the scanner's own
  // validateSchema() in tests. Customer-queue-ready is the dream
  // contract: schema fixes must be accept-ready, not diagnostics.
  ["missing_schema_content::add_schema", "customer-queue-ready"],
  // fix_schema slice (2026-06-12): repair candidates driven by the
  // scanner's OWN validator output for the exact page (failing
  // type + property quoted verbatim) — no industry-tuned
  // expectations involved, any vertical/language. Same directive-
  // draft family as fix_canonical/fix_robots (already queue-ready).
  ["invalid_schema::fix_schema", "customer-queue-ready"],
  // Insight Graph slice 1 (2026-06-12): the first FUSED signal — the
  // tenant's OWN Search Console numbers (impressions/CTR/position per
  // query) drive a title rewrite. Evidence is first-party ground
  // truth; thresholds are research-derived (Semrush positional CTR
  // benchmarks, positions 1–5 only). Any vertical/geo/language.
  ["gsc_low_ctr::edit_title", "customer-queue-ready"],
  // Insight Graph slice 2 (2026-06-12): striking-distance keywords
  // (third-party rank data, sourced 4-20 band) -> title push when the
  // keyword is absent from the title.
  ["semrush_striking_distance::edit_title", "customer-queue-ready"],
  // Wix SEO push slice (2026-06-12): Breadcrumb-only block on store
  // product pages — duplication-safe + one-click pushable via the
  // Stores seoData write behind the Accept click.
  ["missing_schema_store::add_schema", "customer-queue-ready"],
  // Rule B (2026-06-12): FIRST-PARTY striking distance (4-15 band,
  // GSC impressions floor, query-not-in-title play).
  ["gsc_striking_distance::edit_title", "customer-queue-ready"],
  // Decay slice (2026-06-12): both first-party decay signals crossed
  // (clicks -20%+ AND weighted position worse) -> refresh.
  ["gsc_decay::update_intro", "customer-queue-ready"],

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
  // Slice 4.5.E.α₁a (2026-05-21) — first LLM-assisted pair.
  // `weak_h2::rewrite_h2` stays diagnostic-only by operator lock —
  // the α₀ gateway will draft proposed text via the α₁b server
  // action; no customer-queue path until operator validates.
  ["weak_h2::rewrite_h2", "diagnostic-only"],
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
