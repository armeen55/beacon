/**
 * 2026-05-20 — Slice 4.5.D.α₀a — pure ranking formula for
 * promotion-eligible candidates.
 *
 * Pure module. No I/O. No mutations.
 *
 * Components (all bounded, all tunable post-deploy):
 *   • SEVERITY        per trigger_signal              (0–30)
 *   • INDEX_BLOCKER   bonus for indexability fixes    (0 or 25)
 *   • PAGE_IMPORTANCE per page type                   (3–15)
 *   • CONFIDENCE      multiplier 0.5 / 0.75 / 1.0
 *   • PREREQ          0 if blocked, 1 if resolved
 *   • SAFETY          0 if any safety flag, 1 otherwise
 *   • EFFORT          divisor per action_type         (1.0–1.5)
 *
 * Formula:
 *   round((SEVERITY + INDEX_BLOCKER + PAGE_IMPORTANCE)
 *         * CONFIDENCE * PREREQ * SAFETY / EFFORT)
 *
 * Hard rule (pinned by `recommendation-intelligence-promotion-
 * eligibility-pin`): indexability blockers with confidence ≥
 * medium MUST outrank content polish at the same page-importance
 * level. The INDEX_BLOCKER +25 bonus achieves this — content
 * SEVERITY caps at 30, so a missing_title on a hub (30 + 0 + 8 =
 * 38 * 1.0 / 1.0 = 38) loses to a sitemap fix on the same hub
 * (20 + 25 + 8 = 53 * 1.0 / 1.0 = 53).
 */

import type { ActionType } from "@/domains/recommendations/action-types";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";
import type {
  CandidateConfidence,
  CandidateSafetyFlag,
} from "@/domains/recommendation-intelligence/emitter/candidate-row";

// ---------------------------------------------------------------------------
// Component tables (readonly; pinned by invariant)
// ---------------------------------------------------------------------------

export const SEVERITY_BY_TRIGGER_SIGNAL: Readonly<Record<string, number>> = {
  // Content / metadata structural blockers
  missing_title: 30,
  bad_http_status: 30,
  missing_h1: 25,
  missing_meta: 25,
  robots_blocks_googlebot: 25,
  // Indexability + retrieval blockers
  sitemap_missing: 20,
  canonical_mismatch: 20,
  // Cross-snapshot + structural quality
  orphan_page: 15,
  duplicate_title: 15,
  duplicate_meta: 15,
  // Legacy 4.5.B baselines (operator-review-only by tier)
  title_h1_mismatch: 18,
  weak_h1: 12,
  // Sensitive / diagnostic-only families
  missing_schema: 10,
  noindex_on_indexable_page: 10,
  robots_blocks_ai_bots: 10,
  // 2026-06-12 day run — the three new engines. Relative order is
  // grounded in the fusion-math research (sources in the slice
  // commits): FIRST-PARTY evidence outranks third-party estimates
  // (Mueller: tool volumes "will always be wrong"; first-party GSC
  // impressions are realized demand), and breakage outranks
  // enhancement (Google: invalid markup can make the whole block
  // ineligible).
  // First-party CTR-gap with exact impressions — just below
  // missing_title (a page with NO title is still the harder blocker).
  gsc_low_ctr: 28,
  // Present-but-broken structured data (scanner's own validator
  // output). Also earns the fix_ index-blocker bonus at >=medium.
  invalid_schema: 22,
  // Third-party rank estimate (striking distance) — real signal,
  // discounted vs first-party per the sourced weighting rule.
  semrush_striking_distance: 20,
  // Article expectation on content pages — AEO enhancement, not a
  // click blocker.
  missing_schema_content: 18,
  // First-party striking distance — same evidence class as
  // gsc_low_ctr, slightly lower urgency (upside play, not bleeding
  // clicks).
  gsc_striking_distance: 24,
  // Losing already-earned presence — recovering existing value is the
  // most urgent content play (declining-pages opportunity class).
  gsc_decay: 26,
  // Breadcrumb on store products — enhancement, one-click pushable.
  missing_schema_store: 16,
  // Two own pages splitting one keyword's equity — meaningful but
  // operator-reviewed (third-party evidence + structural remedy).
  semrush_cannibalization: 14,
} as const;

export const PAGE_IMPORTANCE_BY_PAGE_TYPE: Readonly<Record<PageType, number>> =
  {
    homepage: 15,
    city: 12,
    service: 12,
    project: 10,
    // P0 wall 3 (2026-06-10): on a content-site tenant the entries ARE
    // the product — same importance tier as city/service detail pages.
    content: 12,
    hub: 8,
    utility: 3,
    technical_asset: 3,
    other: 3,
  } as const;

/**
 * Effort divisor. Higher = more work = lower priority for the
 * same severity. Bounded 1.0–1.5 in α₀a.
 */
export const EFFORT_BY_ACTION_TYPE: Readonly<
  Partial<Record<ActionType, number>>
> = {
  add_internal_link: 1.0,
  edit_title: 1.0,
  edit_meta: 1.0,
  fix_sitemap: 1.0,
  fix_robots: 1.0,
  fix_status_code: 1.0,
  fix_canonical: 1.0,
  fix_noindex: 1.0,
  change_h1: 1.2,
  add_h2_section: 1.5,
  add_faq: 1.5,
  add_schema: 1.5,
  // fix_schema is a guided repair of an existing block (directive
  // draft quoting the validator) — less work than authoring new
  // structured data.
  fix_schema: 1.2,
} as const;

const DEFAULT_EFFORT = 1.5;

/**
 * Confidence multiplier. Pinned by
 * `recommendation-intelligence-confidence-low-stays-diagnostic`.
 */
export function confidenceMultiplier(c: CandidateConfidence): number {
  if (c === "high") return 1.0;
  if (c === "medium") return 0.75;
  return 0.5;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export type PriorityScoreInput = {
  trigger_signal: string;
  action_type: ActionType;
  target_page_type: PageType;
  confidence: CandidateConfidence;
  prerequisite_resolved: boolean;
  safety_flags: ReadonlyArray<CandidateSafetyFlag>;
  /** Fusion-EV slice (2026-06-12): first-party expected-clicks
   *  upside (28d). Optional — only GSC-backed candidates carry it. */
  upside_clicks_28d?: number;
  /** Fusion slice (2026-06-12): bounded GA4 page-value multiplier
   *  (1.0–1.5, computed by ga4ValueWeight). Optional — defaults
   *  neutral. Applied to the whole base so blockers and polish on
   *  the SAME page scale equally (the locked blocker-vs-polish
   *  ordering is unaffected). */
  page_value_weight?: number;
};

/**
 * Pure score. Deterministic. Bounded above by
 * `(30 + 25 + 15) * 1.0 * 1 * 1 / 1.0 = 70`. Always returns a
 * non-negative integer.
 */
/**
 * Fusion-EV slice (2026-06-12): bounded additive upside term. The
 * published EV method (CTR-gap × impressions — Botify, SEOmonitor,
 * Greenlane) yields clicks/28d; log-scaling keeps one mega-page from
 * monopolizing the queue (the PIE/log-damping convention from the
 * fusion-math research) and the cap preserves the locked invariant
 * that index blockers outrank content polish (severity+bonus ceiling
 * stays meaningful).
 */
export const MAX_UPSIDE_BONUS = 15;
export function upsideBonus(upsideClicks28d: number | undefined): number {
  if (upsideClicks28d == null || upsideClicks28d <= 0) return 0;
  return Math.min(MAX_UPSIDE_BONUS, Math.round(4 * Math.log10(1 + upsideClicks28d)));
}

export function priorityScore(c: PriorityScoreInput): number {
  const severity = SEVERITY_BY_TRIGGER_SIGNAL[c.trigger_signal] ?? 0;
  const indexBlocker =
    c.action_type.startsWith("fix_") && c.confidence !== "low" ? 25 : 0;
  const pageImportance = PAGE_IMPORTANCE_BY_PAGE_TYPE[c.target_page_type] ?? 3;
  const conf = confidenceMultiplier(c.confidence);
  const prereq = c.prerequisite_resolved ? 1 : 0;
  const safety = c.safety_flags.length === 0 ? 1 : 0;
  const effort = EFFORT_BY_ACTION_TYPE[c.action_type] ?? DEFAULT_EFFORT;

  // Bounded defensive clamp — the weight is computed bounded
  // upstream, but the scorer never trusts inputs blindly.
  const valueWeight = Math.min(
    1.5,
    Math.max(1, c.page_value_weight ?? 1),
  );
  const raw =
    ((severity + indexBlocker + pageImportance + upsideBonus(c.upside_clicks_28d)) *
      valueWeight *
      conf *
      prereq *
      safety) /
    effort;
  return Math.max(0, Math.round(raw));
}
