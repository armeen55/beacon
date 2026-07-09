/**
 * opportunity-math (2026-07-02, DREAM SITE V1 item D7) - the ONE honest opportunity-forecast
 * entry point used everywhere a number claims upside. PURE, no I/O.
 *
 * THE PROBLEM (operator, verbatim): "opportunities shouldnt just be a guess of yea this is 500k
 * ppl at risk since u got 1k clicks of 501k impressions.. it should be a real smart formula that
 * guesses based on x % you can presume x improvement in x days ... so maybe that can fund our
 * learnings hypothesis." Several surfaces summed raw GSC impressions or a raw demand-graph score
 * and called it an "opportunity" or "at stake" number - a number nobody could act on, because it
 * was never run through the tenant's own click-through behavior.
 *
 * THIS MODULE composes machinery that ALREADY EXISTS and is already correct, into one canonical
 * call a caller can reach for instead of reinventing a naive sum:
 *   - ctrOpportunity90d / expectedCtrAt (pick-expectations.ts) - the tenant CTR curve: what a
 *     query SHOULD click at a given Google position, versus what it actually clicks today.
 *   - forecastRange (pick-expectations.ts) - turns the 90-day gap into a monthly LOW/HIGH range,
 *     already shaped by the bias-correction factor (item 27) and the empirical capture band
 *     (item 64) when a caller has them.
 *   - blendCaptureBand / captureBandForFamily (empirical-capture.ts) - the per-actionFamily
 *     capture history, when a caller has loaded the calibration ledger; omitted, this module
 *     falls back to the same static 25/75 band forecastRange has always used.
 *
 * This file does NOT duplicate any of that math - it takes the same inputs those functions take
 * and calls them, then adds the two things no existing module supplies:
 *   (a) a plain-English `basis` sentence naming the concrete evidence ("your own click rates ...
 *       and N settled results"), and
 *   (b) a deterministic `hypothesisId` so a caller can log this exact rendered forecast (see
 *       hypothesis-log.ts) and grade it later against forecast-calibration-store.ts's settled
 *       outcome for the same page+lever.
 *
 * HONESTY RULE: when there is not enough history to size a claim (no impressions, no position, no
 * settled comparisons), this module returns a NULL range with a `basis` that says so in plain
 * words - never a fabricated number. A caller that used to display raw impressions as "opportunity"
 * should now display nothing (or this honest sentence) rather than keep the old number.
 */

import {
  ctrOpportunity90d,
  forecastRange,
  clampCorrectionFactor,
  type CaptureFractions,
} from "@/domains/experiments/pick-expectations";
import type { TenantCtrCurve } from "./tenant-ctr-curve";

/** FP2 (2026-07-02) - noun phrases for the honest no-history fallback ("coverage", "internal
 *  linking"), distinct from LEVER_PLAIN's "a TITLE change" clause shape so the two fallback
 *  sentences below never read as copies of each other stamped with a different noun. Falls back
 *  to LEVER_PLAIN's own noun, then to the generic "this" when a lever has neither. */
const LEVER_NOUN: Record<string, string> = {
  meta: "the meta description",
  edit_meta: "the meta description",
  title: "the title",
  edit_title: "the title",
  h1: "the headline",
  internal_link: "internal linking",
  internal_links: "internal linking",
  add_internal_link: "internal linking",
  add_internal_links: "internal linking",
  answer_block: "the answer block",
  add_answer_block: "the answer block",
  refresh: "the refresh",
  edit_page: "the edit",
  edit_existing_page: "the edit",
  create_page: "the new page",
  create_new_page: "the new page",
  create_hub: "the new hub page",
  fix_experience: "the experience fix",
  fix_page_experience: "the experience fix",
  fix_conversion_friction: "the experience fix",
  fix_title_meta_ctr: "the title and meta",
  consolidate_pages: "consolidating these pages",
  add_schema: "the schema",
};

/** FP2 - the honest "no history at all" fallback (no GSC impressions/position for this page
 *  yet), varied by lever so it never reads as the same templated line stamped across every
 *  row on the list. Still never invents a number - it names what evidence WOULD size this and
 *  what to watch instead. */
function noHistoryBasis(lever: string): string {
  const noun = LEVER_NOUN[lever];
  if (lever === "create_page" || lever === "create_new_page" || lever === "create_hub") {
    return "This page does not exist yet, so there is no click history to size a range from. Once it is live and Search Console shows impressions, I will give you a real range.";
  }
  if (noun) {
    return `I do not have Search Console impressions or a rank for this page yet, so I cannot size ${noun} honestly. Once that data shows up, I will give you a real range.`;
  }
  return "I do not have enough history to size this yet. Once Search Console shows real impressions and a rank for this page, I will give you a real range.";
}

/** FP2 - the honest "gap too small" fallback (real position/impressions exist, but the CTR-curve
 *  gap rounds under the floor). Varied by lever + whatever context IS known about the row
 *  (settled history, a real position) so the same sentence does not stamp 90+ rows verbatim -
 *  still never invents a number. */
function tooSmallBasis(lever: string, hasPosition: boolean, targetClause: string, settled: number): string {
  const noun = LEVER_NOUN[lever] ?? "this";
  if (hasPosition) {
    return `This page${targetClause} already earns close to what its position typically gets, so I can't put an honest number on ${noun} right now. Worth doing for coverage - I'll watch the next Search Console read for a real gap.`;
  }
  if (settled > 0) {
    return `Your own click rates don't show a clear gap here yet, even against ${settled} settled result${settled === 1 ? "" : "s"}. Worth doing for coverage - I cannot put a number on it yet.`;
  }
  return `Your own click rates don't show a clear gap here yet. Worth doing for coverage - I cannot put a number on it yet.`;
}

/** Plain lever-family names used in the basis sentence ("a title change", "an answer block
 *  change"). Covers both pick-expectations.ts's ExperimentLever vocabulary (meta/title/h1/
 *  internal_link/answer_block/refresh) AND the action-pack/canonical-change ActionType vocabulary
 *  (edit_title/add_answer_block/create_new_page/...) so every caller in the codebase gets a real
 *  plain name, never the generic fallback duplicating the word "change" (see leverChangeClause
 *  below). */
const LEVER_PLAIN: Record<string, string> = {
  meta: "meta description",
  edit_meta: "meta description",
  title: "title",
  edit_title: "title",
  h1: "title",
  internal_link: "internal link",
  internal_links: "internal link",
  add_internal_link: "internal link",
  add_internal_links: "internal link",
  answer_block: "answer block",
  add_answer_block: "answer block",
  refresh: "page refresh",
  edit_page: "page edit",
  edit_existing_page: "page edit",
  create_page: "new page",
  create_new_page: "new page",
  create_hub: "new hub page",
  fix_experience: "experience fix",
  fix_page_experience: "experience fix",
  fix_conversion_friction: "experience fix",
  fix_title_meta_ctr: "title and meta",
  consolidate_pages: "page consolidation",
  add_schema: "schema",
};

/** Plain name for the basis sentence's "a LEVER_NAME change" clause. A lever already mapped to a
 *  noun phrase (e.g. "title") reads as "a title change"; an unmapped lever falls back to a fully
 *  generic clause ("a change") instead of duplicating the word "change" ("a change change"). */
function leverChangeClause(lever: string): string {
  const plain = LEVER_PLAIN[lever];
  return plain ? `a ${plain} change` : "a change";
}

/** Time-to-impact defaults (days) when no measured time-to-signal history exists for this lever.
 *  Mirrors the proof ledger's own read cadence (proof-gsc/measure.ts PROOF_WINDOW_DAYS = [7,14,28]):
 *  a text-level change (title/meta/h1/answer/link) gets its first real read at day 14 (the same
 *  checkpoint pick-expectations.ts's `changeOurMind` line already promises); a new page or a
 *  structural change (hub/experience fix) needs the full 28 days to accumulate enough traffic to
 *  read cleanly. */
const DAYS_TO_IMPACT_DEFAULT: Record<string, number> = {
  meta: 14,
  title: 14,
  h1: 14,
  internal_link: 14,
  internal_links: 14,
  answer_block: 14,
  refresh: 14,
  edit_page: 14,
  fix_experience: 28,
  create_page: 28,
  add_schema: 28,
};

function daysToImpactFor(lever: string, measuredDays?: number | null): number {
  if (typeof measuredDays === "number" && Number.isFinite(measuredDays) && measuredDays > 0) {
    return Math.round(measuredDays);
  }
  return DAYS_TO_IMPACT_DEFAULT[lever] ?? 28;
}

/** Tiny stable string hash (djb2) -> hex; deterministic id without node:crypto. Mirrors the same
 *  helper already used in action-pack/adapters.ts (kept local so this module has zero imports
 *  outside pick-expectations.ts and stays trivially pure/portable). */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export type OpportunityInput = {
  /** Stable identity for the hypothesisId (tenant + page + lever is enough to dedupe re-renders
   *  of the SAME opportunity on the SAME day; a caller wanting a fresh id per render can add a
   *  timestamp to `page`, but the default is deliberately re-render-stable). */
  tenantId: string;
  page: string;
  lever: string;
  /** Google's average position for the query/queries this opportunity targets. Null/undefined =
   *  no rank data yet (honest-gap path). */
  currentPosition?: number | null;
  /** An explicit target position (a striking-distance goal). When omitted, the CTR-curve math
   *  compares current CTR against the curve's OWN expectation at currentPosition (the same "clicks
   *  left on the table at your own rank" framing pick-expectations.ts already uses) - a caller does
   *  not need to guess a target rank for the math to be honest. */
  targetPosition?: number | null;
  impressions90d?: number | null;
  clicks90d?: number | null;
  /** Item 27 (optional): the tenant's own measured bias-correction factor from
   *  forecast-calibration.ts. Omitted = 1.0 (no correction), exactly forecastRange's default. */
  correctionFactor?: number | null;
  /** Item 64 (optional): this lever's empirical capture band + sample size from
   *  empirical-capture.ts's blendCaptureBand/captureBandForFamily. Omitted = the static 25/75
   *  band, exactly forecastRange's default - byte-identical output to a caller with no history. */
  captureBand?: { low: number; high: number; n: number; isEmpirical: boolean } | null;
  /** How many settled (day-28) results this tenant has, across any lever, for the "N settled
   *  results" clause in the basis sentence. Omitted/0 -> the sentence names only the CTR curve. */
  settledResultsCount?: number | null;
  /** Measured time-to-signal for this lever/page from the proof ledger, in days, when available.
   *  Omitted -> the lever-family default (see DAYS_TO_IMPACT_DEFAULT). */
  measuredDaysToImpact?: number | null;
  /** R9 (optional): the tenant's OWN fitted position-to-CTR curve from
   *  load-tenant-ctr-curve.ts. Omitted = the industry-default curve, byte-identical
   *  output to before R9 existed. When a TENANT-fitted curve is passed, the gap is
   *  computed from how their own pages convert position to clicks AND the basis
   *  sentence says so. Only pass this on the computeOpportunity path (where the gap
   *  is computed here); a caller handing computeOpportunityFromGap a pre-computed
   *  gap should pass it only if that gap was computed with the same curve. */
  curve?: TenantCtrCurve | null;
};

export type OpportunityForecast = {
  /** Null exactly when there is not enough history to size this honestly (no positive gap, or the
   *  honest high end rounds under the same floor forecastRange already enforces). */
  lowPerMonth: number | null;
  highPerMonth: number | null;
  /** Always present - the number of days until the first real read, even when the range is null
   *  (a caller still knows WHEN to check back). */
  days: number;
  /** Plain sentence. Always present, always honest - names the real evidence when a range exists,
   *  or says plainly there isn't enough history yet when it does not. Never a made-up number. */
  basis: string;
  /** True exactly when `lowPerMonth`/`highPerMonth` are null - i.e. `basis` is one of the honest
   *  fallback sentences rather than a sized range. FP2 (2026-07-02): callers that rank or curate a
   *  list of these forecasts (e.g. changes-data.ts) use this to demote a row below every row with
   *  a real sized forecast, instead of comparing on a number that does not exist. Optional so an
   *  existing literal built elsewhere in the codebase (a test fixture, a hand-built forecast)
   *  keeps compiling; every value this module itself returns always sets it - a caller can also
   *  derive the same fact from `lowPerMonth == null` when this is absent. */
  unsized?: boolean;
  /** Deterministic id for hypothesis-log.ts to record this exact rendered claim, so a later
   *  settled outcome (forecast-calibration-store.ts) can grade it. Stable across re-renders of the
   *  SAME (tenant, page, lever) opportunity on the SAME UTC day - repeated page loads log one
   *  hypothesis, not one per click. */
  hypothesisId: string;
};

/** Round to a friendly unit the same way pick-expectations.ts does, so a caller never sees a range
 *  shaped differently depending on which entry point produced it. */
function friendly(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n / 5) * 5;
  return Math.round(n);
}

/**
 * The canonical opportunity-forecast entry point. Composes ctrOpportunity90d + forecastRange
 * (pick-expectations.ts) into one call, adds a plain-English basis sentence and a stable
 * hypothesisId. PURE - a caller resolves correctionFactor/captureBand/settledResultsCount from
 * whatever store it has (or omits them for the honest fail-soft defaults) and passes plain values
 * in; this function does no I/O of its own.
 */
export function computeOpportunity(input: OpportunityInput): OpportunityForecast {
  const impressions = input.impressions90d ?? 0;
  const clicks = input.clicks90d ?? 0;
  const position = input.currentPosition;

  // Honest-gap path: no rank/impression history to size a claim from at all.
  if (position == null || !Number.isFinite(position) || !Number.isFinite(impressions) || impressions <= 0) {
    return {
      lowPerMonth: null,
      highPerMonth: null,
      days: daysToImpactFor(input.lever, input.measuredDaysToImpact),
      basis: noHistoryBasis(input.lever),
      unsized: true,
      hypothesisId: hypothesisIdFor(input),
    };
  }

  const ctr = impressions > 0 ? Math.max(0, clicks) / impressions : 0;
  // R9: the gap comes from the ONE canonical curve - the tenant's own fitted
  // curve when the caller loaded one, else the industry default (byte-identical
  // to pre-R9 behavior).
  const gapClicks90d = ctrOpportunity90d({ position, ctr, impressions90d: impressions }, input.curve ?? undefined);
  return computeOpportunityFromGap(input, gapClicks90d, position);
}

/** Deterministic hypothesisId shared by both entry points, so the SAME (tenant, page, lever, day)
 *  opportunity always logs the same id regardless of which entry point computed it. */
function hypothesisIdFor(input: Pick<OpportunityInput, "tenantId" | "page" | "lever">): string {
  const day = new Date().toISOString().slice(0, 10);
  return hashId(`${input.tenantId}|${input.page}|${input.lever}|${day}`);
}

/**
 * Lower-level entry point for a caller that already has a 90-day CTR-curve gap in clicks (e.g. a
 * legacy call site pre-dating opportunity-math.ts that computed `ctrOpportunity90d` itself). Runs
 * the SAME forecastRange + basis-sentence + hypothesisId logic as `computeOpportunity` - no second,
 * divergent formula - so a caller migrating from a raw `ctrOpportunity90d()` call to this module
 * gets byte-identical range math immediately, and can add the raw position/impressions signal
 * later to also gain the plain-English position clause in the basis sentence. `position` is
 * optional and only used for that clause; omitted, the basis reads generically.
 */
export function computeOpportunityFromGap(
  input: OpportunityInput,
  gapClicks90d: number,
  position?: number | null,
): OpportunityForecast {
  const hypothesisId = hypothesisIdFor(input);
  const days = daysToImpactFor(input.lever, input.measuredDaysToImpact);

  const correctionFactor = clampCorrectionFactor(input.correctionFactor ?? 1);
  const captureFractions: CaptureFractions | undefined = input.captureBand
    ? { low: input.captureBand.low, high: input.captureBand.high }
    : undefined;
  const range = forecastRange(gapClicks90d, correctionFactor, captureFractions);

  const settled = input.settledResultsCount ?? 0;
  const changeClause = leverChangeClause(input.lever);
  const hasPosition = position != null && Number.isFinite(position);
  const targetClause = hasPosition
    ? input.targetPosition != null && Number.isFinite(input.targetPosition) && input.targetPosition < position!
      ? ` from position ${Math.round(position!)} to ${Math.round(input.targetPosition)}`
      : ` at position ${Math.round(position!)}`
    : "";

  if (!range) {
    return {
      lowPerMonth: null,
      highPerMonth: null,
      days,
      basis: tooSmallBasis(input.lever, hasPosition, targetClause, settled),
      unsized: true,
      hypothesisId,
    };
  }

  // audit #4 (2026-07-09): cap the forecast at the query's PHYSICAL ceiling. A query can
  // deliver at most its monthly impressions in clicks (100% CTR). A large CTR gap times the
  // correction factor can otherwise push the range above that, producing impossible copy
  // like "14 impressions -> 7 to 20 clicks a month". Cap both ends at monthly impressions so
  // the number can never exceed its own basis. Only when we actually know impressions.
  const monthlyImpressions =
    input.impressions90d != null && Number.isFinite(input.impressions90d) && input.impressions90d > 0
      ? input.impressions90d / 3
      : null;
  const low = monthlyImpressions != null ? Math.min(range.low, monthlyImpressions) : range.low;
  const high = monthlyImpressions != null ? Math.min(range.high, monthlyImpressions) : range.high;

  const settledClause = settled > 0 ? ` and ${settled} settled result${settled === 1 ? "" : "s"}` : "";
  // R9: when the tenant's OWN fitted curve sized this range, the sentence says so
  // (plain words, never a lab term). The default curve keeps the exact pre-R9
  // sentence, byte-identical (pinned).
  const lead =
    input.curve?.source === "tenant"
      ? `Based on how your own pages convert position to clicks, from ${input.curve.basis}`
      : "Based on your own click rates at each Google position";
  const basis = `${lead}${settledClause}, ${changeClause}${targetClause} usually adds ${friendly(low).toLocaleString()} to ${friendly(high).toLocaleString()} clicks a month within ${days} days.`;

  return {
    lowPerMonth: low,
    highPerMonth: high,
    days,
    basis,
    unsized: false,
    hypothesisId,
  };
}
