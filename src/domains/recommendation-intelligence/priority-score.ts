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
 * Formula (kept in sync with priorityScore() below — audit check
 * #23, 2026-06-12; fusion item #3, 2026-06-14):
 *   round((SEVERITY + INDEX_BLOCKER + PAGE_IMPORTANCE + UPSIDE_BONUS
 *          + FUSION_CORROBORATION_BONUS)
 *         * VALUE_WEIGHT * CONFIDENCE * PREREQ * SAFETY / EFFORT)
 * where UPSIDE_BONUS = min(15, 4*log10(1+gsc_upside_clicks)),
 * VALUE_WEIGHT = bounded GA4 page-value multiplier (1.0-1.5), and
 * FUSION_CORROBORATION_BONUS is a tiny additive nudge (0/2/3) when the
 * target_url carries ≥2 DISTINCT independent signal classes — clamped
 * for non-blocker rows so a corroborated content play can never reach a
 * comparable index blocker on the same page (see fusionCorroborationBonus).
 * NOTE on "risk": the recommended_edits `risks: string[]` field is
 * POST-promotion operator-facing metadata (it does not exist at
 * scoring time); pre-promotion risk gating is `safety_flags`, which
 * zeroes the score via the SAFETY term — risks are deliberately NOT
 * a scoring input.
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
  // Internal-link brain (2026-06-12): an enhancement, not a fix —
  // one notch under orphan_page's missing-inbound repair.
  internal_link_opportunity: 13,
  // Source-ledger slice (2026-06-12): trust/citability improvement on
  // content pages — below the link-structure plays.
  uncited_content: 11,
  // Clarity fuse (2026-06-13): page-experience friction. Script errors
  // also block JS-free AI crawlers, so this sits with the content
  // signals (above the link/source plays).
  clarity_friction: 16,
  // AEO answer-block readiness (2026-06-12): high-leverage content
  // move on question-shaped pages; evidence is directional (vendor +
  // entity-signal study), not an RCT, so it sits below the
  // deterministic schema signals.
  missing_answer_block: 17,
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
  // Net-new content territory (competitor-proven demand) — valuable
  // but the most effortful play; operator-reviewed.
  semrush_keyword_gap: 12,
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
   *  upside over the 90-day GSC window. Optional — only GSC-backed
   *  candidates carry it. (audit #337: field was misnamed `*28d`
   *  while the impressions base is 90-day; renamed for honesty.) */
  upside_clicks_90d?: number;
  /** Fusion slice (2026-06-12): bounded GA4 page-value multiplier
   *  (1.0–1.5, computed by ga4ValueWeight). Optional — defaults
   *  neutral. Applied to the whole base so blockers and polish on
   *  the SAME page scale equally (the locked blocker-vs-polish
   *  ordering is unaffected). */
  page_value_weight?: number;
  /** Fusion corroboration slice (item #3, 2026-06-14): the COUNT of
   *  DISTINCT independent signal CLASSES the candidate's target_url
   *  carries across the whole tenant batch (GSC-demand / Clarity-
   *  friction / GA4-value). Computed at the promotion seam where all
   *  candidates are visible; threaded in as a pure scalar (the scorer
   *  does NO I/O). A page corroborated by ≥2 independent classes is a
   *  higher-confidence target than any single signal — it earns a
   *  small additive nudge (see `fusionCorroborationBonus`). Optional —
   *  0/1/absent ⇒ zero bonus (exact pre-fusion behavior). */
  signal_class_count?: number;
  /** Learning-loop slice (#10, 2026-06-22): a win-rate-derived ± prior in
   *  [-1,+1] for this candidate's action_type, computed UPSTREAM from the proof
   *  ledger's resolved verdicts (computeOutcomePriors). +1 = this action_type
   *  has always WON in past shipped experiments, -1 = always lost, absent ⇒
   *  neutral. PRIORITY-ONLY: it re-ranks the next-best set toward what has
   *  proven to work; it never changes confidence, QA, or pushability. */
  outcome_prior?: number;
};

/**
 * Pure score. Deterministic. Bounded above by
 * `(30 + 25 + 15 + 15 + 3) * 1.5 / 1.0` (severity + index-blocker +
 * page-importance + upside cap + fusion-corroboration cap, all under
 * the GA4 value weight). For an index-blocker with no upside the
 * familiar `30 + 25 + 15 = 70` base still holds; the +3 corroboration
 * cap only ever LIFTS a blocker further above content. Always returns a
 * non-negative integer.
 */
/**
 * Fusion-EV slice (2026-06-12): bounded additive upside term. The
 * published EV method (CTR-gap × impressions — Botify, SEOmonitor,
 * Greenlane) yields clicks over the 90-day GSC window; log-scaling
 * keeps one mega-page from monopolizing the queue (the PIE/log-damping
 * convention from the fusion-math research) and the cap preserves the
 * locked invariant that index blockers outrank content polish
 * (severity+bonus ceiling stays meaningful).
 */
export const MAX_UPSIDE_BONUS = 15;
export function upsideBonus(upsideClicks90d: number | undefined): number {
  if (upsideClicks90d == null || upsideClicks90d <= 0) return 0;
  return Math.min(MAX_UPSIDE_BONUS, Math.round(4 * Math.log10(1 + upsideClicks90d)));
}

/**
 * Fusion corroboration slice (FUSION_ROADMAP item #3, 2026-06-14): a
 * bounded additive nudge for a target_url corroborated by ≥2 DISTINCT
 * independent signal CLASSES (GSC-demand / Clarity-friction / GA4-
 * value). The product thesis is "fewer, higher-confidence recs, each
 * backed by 2+ independent signals": a page in striking distance that
 * ALSO frustrates valuable visitors is a higher-confidence rewrite than
 * any single signal, so it earns a small re-rank within the already-
 * eligible set. Pure re-rank — NEVER reduces a score, NEVER suppresses
 * a candidate.
 *
 * Bound (deliberately tiny — a nudge, not a term): +2 at 2 classes, +3
 * at 3 classes, capped at MAX_FUSION_CORROBORATION_BONUS = 3. 0/1 class
 * ⇒ 0 (byte-identical to pre-fusion behavior).
 *
 * Why it sits STRICTLY BELOW the index-blocker ceiling: the +25
 * INDEX_BLOCKER bonus must keep a true index blocker outranking any
 * content play on the SAME page. The widest a corroborated content
 * candidate can stretch is the highest GSC-demand severity
 * (gsc_low_ctr = 28) + the full upside cap (15) = base 43 (+page); a
 * minimum-severity index blocker on the same page is severity 20 + 25
 * = 45 (+page) — a 2-point margin. Capping this bonus at 3 would
 * threaten that margin, so the scorer (see `priorityScore`) clamps the
 * applied corroboration bonus to AT MOST `(index-blocker headroom − 1)`
 * for non-blocker rows, guaranteeing a corroborated non-blocker can
 * never reach a comparable index blocker. The headroom is computed from
 * the live SEVERITY ceiling so it stays correct if severities are
 * retuned. Index-blocker rows take the full (uncapped-by-headroom)
 * bonus — corroboration only ever LIFTS a blocker, never demotes it.
 */
export const MAX_FUSION_CORROBORATION_BONUS = 3;
export function fusionCorroborationBonus(
  signalClassCount: number | undefined,
): number {
  if (signalClassCount == null || signalClassCount < 2) return 0;
  // +2 at exactly 2 classes; +3 (the cap) at 3+ classes.
  return Math.min(MAX_FUSION_CORROBORATION_BONUS, signalClassCount);
}

/**
 * The strict ceiling the corroboration bonus must never break: a
 * corroborated NON-index-blocker must stay below a comparable index
 * blocker on the same page. Headroom = (min index-blocker base) −
 * (max content base + max upside) at equal page importance, where the
 * page-importance term and value-weight multiplier cancel because they
 * apply equally to both rows on the SAME page. Computed once from the
 * live SEVERITY table so it tracks any future retune.
 *
 *   min index-blocker base  = MIN_INDEX_BLOCKER_SEVERITY + 25
 *   max content base + lift = MAX_CONTENT_SEVERITY + MAX_UPSIDE_BONUS
 *
 * A non-blocker row's corroboration bonus is clamped to
 * (headroom − 1) so the strict inequality always holds.
 */
const INDEX_BLOCKER_BONUS = 25;
// Lowest severity that can co-occur with the +25 index-blocker bonus
// (sitemap_missing / canonical_mismatch).
const MIN_INDEX_BLOCKER_SEVERITY = 20;
// Highest severity a corroboration-eligible content signal carries
// (gsc_low_ctr = 28 is the max among the GSC-demand / Clarity classes).
const MAX_CORROBORATED_CONTENT_SEVERITY = 28;
export const FUSION_BONUS_NON_BLOCKER_HEADROOM = Math.max(
  0,
  MIN_INDEX_BLOCKER_SEVERITY +
    INDEX_BLOCKER_BONUS -
    (MAX_CORROBORATED_CONTENT_SEVERITY + MAX_UPSIDE_BONUS) -
    1,
);

/** Action types that fix a true INDEXABILITY blocker (page can't be found/ranked
 *  until resolved) and earn the index-blocker priority bonus. An explicit
 *  allowlist, NOT a `fix_` prefix: a content/experience fix like
 *  `fix_page_experience` must never inherit indexability priority. */
const INDEX_BLOCKER_ACTION_TYPES = new Set<string>([
  "fix_sitemap",
  "fix_robots",
  "fix_status_code",
  "fix_canonical",
  "fix_noindex",
  "fix_schema",
]);

/** Max ± points the learning-loop outcome prior may move the base sum (#10).
 *  Comparable to the corroboration / page-importance terms — meaningful enough
 *  to re-order ties toward proven action types, never enough to override a
 *  severity/index-blocker gap or any safety/QA gate. */
export const MAX_OUTCOME_PRIOR_BONUS = 6;

/**
 * Learning-loop term (#10): a bounded ± nudge from how this action_type has
 * performed in past SHIPPED experiments. `prior` ∈ [-1,+1] (win-rate-derived,
 * computed upstream from the proof ledger by computeOutcomePriors); absent/0 ⇒
 * neutral. Symmetric: a historically-losing action type is demoted, a winner
 * promoted. Priority-only — it feeds the score sum, nothing else.
 */
export function outcomePriorBonus(prior: number | undefined): number {
  if (prior == null || !Number.isFinite(prior)) return 0;
  const clamped = Math.max(-1, Math.min(1, prior));
  return Math.round(clamped * MAX_OUTCOME_PRIOR_BONUS);
}

export function priorityScore(c: PriorityScoreInput): number {
  const severity = SEVERITY_BY_TRIGGER_SIGNAL[c.trigger_signal] ?? 0;
  const indexBlocker =
    INDEX_BLOCKER_ACTION_TYPES.has(c.action_type) && c.confidence !== "low" ? 25 : 0;
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
  // Fusion corroboration nudge (item #3). For NON-index-blocker rows
  // the bonus is additionally clamped to the headroom that keeps a
  // corroborated content play strictly below a comparable index
  // blocker on the same page; index-blocker rows take the full bonus
  // (corroboration only ever lifts a blocker further above content).
  const rawCorroboration = fusionCorroborationBonus(c.signal_class_count);
  const corroborationBonus =
    indexBlocker > 0
      ? rawCorroboration
      : Math.min(rawCorroboration, FUSION_BONUS_NON_BLOCKER_HEADROOM);
  const raw =
    ((severity +
      indexBlocker +
      pageImportance +
      upsideBonus(c.upside_clicks_90d) +
      corroborationBonus +
      outcomePriorBonus(c.outcome_prior)) *
      valueWeight *
      conf *
      prereq *
      safety) /
    effort;
  return Math.max(0, Math.round(raw));
}
