import "server-only";

/**
 * reliability-extras (Core 100K lane P, 2026-07-21) - the six small
 * uplift-quantification modules merged into ONE, each preserved exactly:
 *
 *   - bayesian-read (item 67): Bayesian verdicts with credible intervals.
 *   - permutation-null (item 37): the untouched-page null distribution.
 *   - fdr-adjust (v1 item 291): the many-measurements champagne hold.
 *   - equivalence (v1 item 289): the proven "this genuinely did nothing".
 *   - novelty-decay (v1 item 378): the first-week-jump-that-faded detector.
 *   - early-signal (v1 item 288): adaptive window reads, clock untouched.
 *
 * Each feeds ONE flag into gradeFromPresentation (verdict-reliability.ts) or
 * one sentence into the Results row. All are computed-only quantification
 * layers beside the hard-floor verdict in measure.ts: they NEVER decide or
 * mutate won/lost, windows, baselines, or clocks. Everything except the
 * permutation-null builder is PURE (no I/O).
 */

import {
  loadPageSurgeonContext,
  type PageSurgeonContext,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { loadShippedChanges } from "./shipped-change-store";
import { readWindowForPages } from "./gsc-window";
import { ledgerExclusionPaths, pickPlaceboPages, type PlaceboCandidate } from "./aa-calibration";
import { addDays, type GscWindowMetrics, type ProofWindowDay } from "./measure";
import type { DailyClickPoint } from "./weekday-baseline";

// Shared helpers (byte-equivalent across the merged modules).
const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Round to 2 decimal places for stable, readable output. */
const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// ---------------------------------------------------------------------------
// Bayesian verdicts with credible intervals (2026-07-02, master plan item 67)
// ---------------------------------------------------------------------------
// PURE, deterministic. Additive quantification beside the hard-floor verdict:
// it does NOT decide won/lost. Two conjugate models: CTR = beta-binomial
// (pre window as an informative add-one prior, post window as the update);
// clicks = gamma-Poisson on the daily rate. THE APPROXIMATION: the CI on a
// difference of two Betas/Gammas has no closed form, so each posterior is
// moment-matched to a normal (exact for the difference of two normals). It
// degrades on very small counts (under ~10 clicks / ~30 impressions in a
// window); the MIN_SAMPLE floors gate a "small sample" flag onto the output
// rather than silently trusting it. NOT diff-in-diff: reads the TREATED PAGE
// ALONE; the headline upgrade only fires when the Bayesian read AGREES in
// direction with the floor verdict (bayesianAgreesWithVerdict below).

export type BayesianCtrInput = {
  preClicks: number;
  preImpressions: number;
  postClicks: number;
  postImpressions: number;
  /** Length of the post window in days, so the impressions-per-day rate can
   *  be scaled to a 30-day month. Defaults to 28 (the standard proof-window
   *  length) when omitted. */
  postWindowDays?: number;
};

export type BayesianClicksInput = {
  preClicks: number;
  /** Length of the pre window in days. */
  preDays: number;
  postClicks: number;
  /** Length of the post window in days. */
  postDays: number;
};

export type BayesianRead = {
  /** P(the real post-change rate is higher than the real pre-change rate), 0-1. */
  pWin: number;
  /** 90% credible interval, LOW end, on EXTRA clicks per month (can be negative). */
  ci90Low: number;
  /** 90% credible interval, HIGH end, on EXTRA clicks per month. */
  ci90High: number;
  /** Point estimate: expected extra clicks per month (posterior mean diff, scaled). */
  expectedMonthlyLift: number;
  /** True when either window's counts are thin enough that the normal
   *  approximation (see section doc) may not hold, render cautiously. */
  smallSample: boolean;
  /** "We are 87 percent sure this helped, likely 5 to 40 extra clicks a month." */
  sentence: string;
};

/** Below this many clicks OR impressions in either window, the moment-matched
 *  normal approximation of a Beta/Gamma posterior can meaningfully misstate
 *  pWin/CI (skew near the boundary). Documented in the section header. */
const MIN_CLICKS_FOR_NORMAL_APPROX = 10;
const MIN_IMPRESSIONS_FOR_NORMAL_APPROX = 30;

const Z_90 = 1.6448536269514722; // Phi^-1(0.95), two-sided 90% CI half-width multiplier
const SQRT2 = Math.SQRT2;

/**
 * Standard normal CDF via the Abramowitz-Stegun erf approximation
 * (max error ~1.5e-7), pure, no dependency. Phi(z) = (1 + erf(z/sqrt2)) / 2.
 */
export function standardNormalCdf(z: number): number {
  return (1 + erf(z / SQRT2)) / 2;
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Beta(a, b) mean + variance, moment-matched to a normal (see section doc). */
function betaMoments(a: number, b: number): { mean: number; sd: number } {
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

/** Gamma(shape, rate) mean + variance, moment-matched to a normal (see section doc). */
function gammaMoments(shape: number, rate: number): { mean: number; sd: number } {
  const mean = rate > 0 ? shape / rate : 0;
  const variance = rate > 0 ? shape / (rate * rate) : 0;
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

/** Standard "a month" length for scaling any window-length figure to a
 *  monthly rate, matching the plain-English sentence's "extra clicks a
 *  month" framing used across the proof ledger (rank-recheck, dollar-value). */
const MONTH_DAYS = 30;

/**
 * CTR read: Beta-binomial, pre window as an informative prior, post window as
 * the update. Returns the posterior CTR lift (post rate - pre rate) expressed
 * as an EXTRA-MONTHLY-CLICKS figure: the lift is applied to the post window's
 * own impressions-PER-DAY rate (postImpressions / postWindowDays), then
 * scaled to a 30-day month, the plain-English "how many more clicks a
 * month" reading a CTR change earns. Pure.
 */
export function bayesianCtrRead(input: BayesianCtrInput): BayesianRead {
  const { preClicks, preImpressions, postClicks, postImpressions } = input;
  const postWindowDays = Math.max(1, input.postWindowDays ?? 28);

  // Add-one (Beta(1,1) uniform prior) smoothing so a zero-click window never
  // yields a degenerate alpha/beta of 0.
  const alpha0 = Math.max(0, preClicks) + 1;
  const beta0 = Math.max(0, preImpressions - preClicks) + 1;
  const alpha1 = alpha0 + Math.max(0, postClicks);
  const beta1 = beta0 + Math.max(0, postImpressions - postClicks);

  const pre = betaMoments(alpha0, beta0);
  const post = betaMoments(alpha1, beta1);

  const meanDiff = post.mean - pre.mean;
  const sdDiff = Math.sqrt(pre.sd * pre.sd + post.sd * post.sd);
  const pWin = sdDiff > 0 ? standardNormalCdf(meanDiff / sdDiff) : meanDiff > 0 ? 1 : meanDiff < 0 ? 0 : 0.5;

  // Extra clicks/month = CTR lift x (impressions per day, from the post
  // window's own observed rate) x 30 days. Using the post window's rate (not
  // the pre window's) reflects the impression volume the page is CURRENTLY
  // earning, the honest basis for a forward-looking monthly estimate.
  const impressionsPerDay = postImpressions / postWindowDays;
  const monthlyImpressions = impressionsPerDay * MONTH_DAYS;
  const expectedMonthlyLift = round2(meanDiff * monthlyImpressions);
  const ciLow = round2((meanDiff - Z_90 * sdDiff) * monthlyImpressions);
  const ciHigh = round2((meanDiff + Z_90 * sdDiff) * monthlyImpressions);

  const smallSample =
    preClicks < MIN_CLICKS_FOR_NORMAL_APPROX ||
    postClicks < MIN_CLICKS_FOR_NORMAL_APPROX ||
    preImpressions < MIN_IMPRESSIONS_FOR_NORMAL_APPROX ||
    postImpressions < MIN_IMPRESSIONS_FOR_NORMAL_APPROX;

  return {
    pWin: round2(pWin * 100) / 100,
    ci90Low: Math.min(ciLow, ciHigh),
    ci90High: Math.max(ciLow, ciHigh),
    expectedMonthlyLift,
    smallSample,
    sentence: bayesianSentence(pWin, Math.min(ciLow, ciHigh), Math.max(ciLow, ciHigh), smallSample),
  };
}

/**
 * Clicks read: Gamma-Poisson, pre window (as a daily rate) as the prior, post
 * window as the update. Returns the posterior lift already scaled to a
 * 30-day month (the Gamma posterior IS a daily-rate distribution, so scaling
 * to monthly is exact multiplication, unlike the CTR path above). Pure.
 */
export function bayesianClicksRead(input: BayesianClicksInput): BayesianRead {
  const { preClicks, preDays, postClicks, postDays } = input;
  const safePreDays = Math.max(1, preDays);
  const safePostDays = Math.max(1, postDays);

  const shape0 = Math.max(0, preClicks) + 1;
  const rate0 = safePreDays;
  const shape1 = shape0 + Math.max(0, postClicks);
  const rate1 = rate0 + safePostDays;

  const pre = gammaMoments(shape0, rate0); // daily rate, pre
  const post = gammaMoments(shape1, rate1); // daily rate, post

  const meanDiffDaily = post.mean - pre.mean;
  const sdDiffDaily = Math.sqrt(pre.sd * pre.sd + post.sd * post.sd);
  const pWin =
    sdDiffDaily > 0
      ? standardNormalCdf(meanDiffDaily / sdDiffDaily)
      : meanDiffDaily > 0
        ? 1
        : meanDiffDaily < 0
          ? 0
          : 0.5;

  const expectedMonthlyLift = round2(meanDiffDaily * MONTH_DAYS);
  const ciLow = round2((meanDiffDaily - Z_90 * sdDiffDaily) * MONTH_DAYS);
  const ciHigh = round2((meanDiffDaily + Z_90 * sdDiffDaily) * MONTH_DAYS);

  const smallSample =
    preClicks < MIN_CLICKS_FOR_NORMAL_APPROX || postClicks < MIN_CLICKS_FOR_NORMAL_APPROX;

  return {
    pWin: round2(pWin * 100) / 100,
    ci90Low: Math.min(ciLow, ciHigh),
    ci90High: Math.max(ciLow, ciHigh),
    expectedMonthlyLift,
    smallSample,
    sentence: bayesianSentence(pWin, Math.min(ciLow, ciHigh), Math.max(ciLow, ciHigh), smallSample),
  };
}

/**
 * Orchestrator: pick the metric-appropriate model (CTR for a snippet/CTR
 * lever, clicks for everything else, mirroring pickProofMetric) so the
 * Bayesian read always asks the SAME question the floor verdict is judged
 * on. Position is not a count/rate a Beta/Poisson can model honestly, so a
 * position-judged change gets no Bayesian read (honest skip). Pure.
 */
export function buildBayesianRead(args: {
  metric: "clicks" | "ctr" | "position";
  treatedPre: { clicks: number; impressions: number };
  treatedPost: { clicks: number; impressions: number };
  preWindowDays: number;
  postWindowDays: number;
}): BayesianRead | null {
  if (args.metric === "position") return null;
  if (args.metric === "ctr") {
    return bayesianCtrRead({
      preClicks: args.treatedPre.clicks,
      preImpressions: args.treatedPre.impressions,
      postClicks: args.treatedPost.clicks,
      postImpressions: args.treatedPost.impressions,
      postWindowDays: args.postWindowDays,
    });
  }
  return bayesianClicksRead({
    preClicks: args.treatedPre.clicks,
    preDays: args.preWindowDays,
    postClicks: args.treatedPost.clicks,
    postDays: args.postWindowDays,
  });
}

/**
 * "We are 87 percent sure this helped, likely 5 to 40 extra clicks a month."
 * First-person, no dashes, no jargon (no "beta-binomial", "posterior",
 * "credible interval", those live only in code comments). Honest at every
 * confidence level: a coin-flip pWin reads as genuinely unsure, not spun
 * positive. Small-sample runs get an explicit early-read caveat appended.
 */
export function bayesianSentence(
  pWin: number,
  ci90Low: number,
  ci90High: number,
  smallSample: boolean,
): string {
  const pct = Math.round(pWin * 100);
  const lowR = Math.round(ci90Low);
  const highR = Math.round(ci90High);
  const range =
    lowR === highR
      ? `about ${lowR} extra clicks a month`
      : lowR < 0 && highR < 0
        ? `likely ${Math.abs(highR)} to ${Math.abs(lowR)} fewer clicks a month`
        : lowR < 0 && highR >= 0
          ? `likely ${Math.abs(lowR)} fewer to ${highR} extra clicks a month`
          : `likely ${lowR} to ${highR} extra clicks a month`;

  let base: string;
  if (pct >= 95) base = `I am ${pct} percent sure this helped, ${range}.`;
  else if (pct >= 70) base = `We are ${pct} percent sure this helped, ${range}.`;
  else if (pct <= 5) base = `I am ${100 - pct} percent sure this hurt, ${range}.`;
  else if (pct <= 30) base = `We are ${100 - pct} percent sure this hurt, ${range}.`;
  else base = `Too close to call yet, ${range} either way.`;

  return smallSample ? `${base} Early read, small sample so far.` : base;
}

/**
 * Direction agreement gate (spec: the headline upgrade only fires when the
 * Bayesian read agrees in direction with the floor verdict). Pure. A "won"
 * verdict agrees when pWin clears 0.7 (the "We are X percent sure this
 * helped" band above); a "lost" verdict agrees when pWin is at or below 0.3
 * (the mirrored "sure this hurt" band). Any other verdict (measuring,
 * inconclusive, insufficient_data) never agrees, there is no directional
 * claim to confirm.
 */
export function bayesianAgreesWithVerdict(
  verdict: string,
  read: Pick<BayesianRead, "pWin">,
): boolean {
  if (verdict === "won") return read.pWin >= 0.7;
  if (verdict === "lost") return read.pWin <= 0.3;
  return false;
}

/**
 * Results-row headline selection (extracted so the upgrade rule is unit-
 * testable, not just re-derived inline on the page). The stored verdict
 * (floors + permutation) is UNCHANGED either way, this only decides which
 * SENTENCE renders: the Bayesian quantified read when one exists and agrees
 * in direction with the floor verdict, else the existing floor-derived
 * sentence untouched. Pure.
 */
export function selectHeadlineSentence(
  verdict: string,
  bayesianRead: Pick<BayesianRead, "pWin" | "sentence"> | null | undefined,
  floorSentence: string,
): string {
  if (bayesianRead && bayesianAgreesWithVerdict(verdict, bayesianRead)) {
    return bayesianRead.sentence;
  }
  return floorSentence;
}

// ---------------------------------------------------------------------------
// Permutation null (2026-07-02, master plan item 37)
// ---------------------------------------------------------------------------
// Expands the treated change's diff-in-diff comparison to EVERY untreated
// page with enough traffic, reusing aa-calibration.ts's placebo picker and
// the SAME window the treated verdict was judged on (the null must share the
// treated window's market weather or it is not a fair comparison). Each
// untreated page gets a leave-one-out pseudo-lift; the treated lift's spot in
// that distribution (percentileOf) is the plain "out of N untouched pages,
// only M moved this much" read. Deterministic, $0, bounded to MAX_NULL_PAGES.

/** Bounded nightly/on-demand cost: at most this many untreated pages anchor
 *  one treated change's null distribution. Mirrors aa-calibration's own cap;
 *  a single readWindowForPages call reads all of them at once (two RPC calls
 *  total, not one per page), so this bound is about honesty of the
 *  distribution size, not about read cost. */
export const MAX_NULL_PAGES = 60;

/** Below this many untreated pages, a percentile read is too thin to call
 *  "strong evidence" either way - the caller should skip the permutation
 *  read entirely and say so honestly rather than report a percentile off a
 *  handful of comparison points. */
export const MIN_NULL_PAGES = 20;

const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

export type NullPageLift = {
  page: string;
  /** This page's own clicks delta (post - pro-rated pre) over the shared window. */
  delta: number;
  /** Leave-one-out pseudo-lift: this page's delta minus the mean of every
   *  OTHER untreated candidate's delta over the same window. */
  pseudoLift: number;
};

export type PermutationNull = {
  /** Every untreated page's pseudo-lift, in the SAME clicks unit the treated
   *  adjusted lift is judged in. */
  pages: NullPageLift[];
  /** shipDate the null shares with the treated window (for display/debugging). */
  shipDate: string;
  windowDays: ProofWindowDay | number;
};

/**
 * Build the permutation null: every untreated, adequate-traffic page's
 * pseudo-lift over the SAME pre/post windows the treated change was judged
 * on. Fail-soft: any read failure or empty candidate pool returns an empty
 * `pages` array (never throws), so the caller's < MIN_NULL_PAGES gate
 * naturally covers it. Injectable I/O for tests.
 */
export async function buildPermutationNull(
  args: {
    tenantId: string;
    shipDate: string; // YYYY-MM-DD, the treated change's ship date
    windowDays: ProofWindowDay | number; // the post-window length the treated verdict used
    preWindowDays?: number; // default 28, mirrors PROOF_BASELINE_WINDOW_DAYS
    /** Paths to exclude beyond the ledger set (typically the treated page
     *  itself and its own control pages, so the null never includes the
     *  experiment it is qualifying). */
    excludePaths?: ReadonlySet<string>;
    maxPages?: number;
  },
  deps: {
    loadContext?: (tenantId: string) => Promise<PageSurgeonContext>;
    loadLedger?: () => Promise<Array<{ path: string; controlPages: string[] }>>;
    readWindow?: typeof readWindowForPages;
  } = {},
): Promise<PermutationNull> {
  const preWindowDays = args.preWindowDays ?? 28;
  const empty: PermutationNull = { pages: [], shipDate: args.shipDate, windowDays: args.windowDays };
  if (!args.tenantId || !args.shipDate) return empty;

  const loadContext = deps.loadContext ?? loadPageSurgeonContext;
  const loadLedger = deps.loadLedger ?? loadShippedChanges;
  const readWindow = deps.readWindow ?? readWindowForPages;

  let ctx: PageSurgeonContext;
  let ledger: Array<{ path: string; controlPages: string[] }>;
  try {
    [ctx, ledger] = await Promise.all([loadContext(args.tenantId), loadLedger().catch(() => [])]);
  } catch {
    return empty;
  }

  const candidates: PlaceboCandidate[] = [];
  for (const [url, sig] of ctx.gscByUrl) {
    if (!ctx.snapshotByCanon.has(url)) continue;
    candidates.push({ page: url, baselineImpressions: sig.impressions90d });
  }
  if (candidates.length === 0) return empty;

  const exclude = new Set<string>(ledgerExclusionPaths(ledger));
  if (args.excludePaths) for (const p of args.excludePaths) exclude.add(normPath(p));

  const nullPages = pickPlaceboPages(candidates, exclude, args.maxPages ?? MAX_NULL_PAGES);
  if (nullPages.length === 0) return empty;

  const preStart = addDays(args.shipDate, -preWindowDays);
  const postEnd = addDays(args.shipDate, args.windowDays);
  const pageUrls = nullPages.map((c) => c.page);

  let pre: Map<string, GscWindowMetrics>;
  let post: Map<string, GscWindowMetrics>;
  try {
    [pre, post] = await Promise.all([
      readWindow({ tenantId: args.tenantId, pages: pageUrls, start: preStart, end: args.shipDate }),
      readWindow({ tenantId: args.tenantId, pages: pageUrls, start: args.shipDate, end: postEnd }),
    ]);
  } catch {
    return empty;
  }

  const clicksScale = preWindowDays > 0 ? Number(args.windowDays) / preWindowDays : 1;
  const usable = pageUrls
    .map((page) => {
      const preM = pre.get(page) ?? NULL_METRICS;
      const postM = post.get(page) ?? NULL_METRICS;
      if (preM.impressions <= 0) return null; // no real pre-window presence, can't form a fair delta
      const delta = postM.clicks - preM.clicks * clicksScale;
      return { page, delta };
    })
    .filter((x): x is { page: string; delta: number } => x != null);

  if (usable.length === 0) return empty;

  const total = usable.reduce((sum, u) => sum + u.delta, 0);
  const n = usable.length;
  const pages: NullPageLift[] = usable.map((u) => {
    const meanOthers = n > 1 ? (total - u.delta) / (n - 1) : 0;
    return { page: u.page, delta: u.delta, pseudoLift: u.delta - meanOthers };
  });

  return { pages, shipDate: args.shipDate, windowDays: args.windowDays };
}

function normPath(u: string): string {
  try {
    return (new URL(u).pathname || "/").replace(/\/+$/, "") || "/";
  } catch {
    return (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  }
}

export type PermutationPercentile = {
  /** Share (0-1) of the null distribution whose |pseudoLift| is >= the treated
   *  lift's magnitude (an empirical, two-sided permutation p-value). */
  percentile: number;
  /** How many untreated pages moved AS MUCH OR MORE than the treated page. */
  nGreater: number;
  /** Total untreated pages in the null distribution. */
  nTotal: number;
};

/** The computed-only permutation read attached to a measured ShippedChangeRecord
 *  (run-measurement.ts). Same shape as PermutationPercentile - named separately
 *  so the ledger-facing field has its own stable contract independent of this
 *  module's internal percentileOf signature. Never persisted (recordToRow omits
 *  it), recomputed on every measure like trafficOutcome/citationOutcome. */
export type PermutationRead = PermutationPercentile;

/**
 * Where the treated lift sits in the null distribution: what fraction of
 * untreated pages moved at least as much (in either direction) as the
 * treated page did. Pure. A LOW percentile (few untreated pages moved this
 * much) is the strong-evidence case; a HIGH one means plenty of untouched
 * pages swing this hard on their own, so the lift is unremarkable. Returns
 * percentile 1 (no evidence either way) on an empty null.
 */
export function percentileOf(lift: number, nullDist: PermutationNull): PermutationPercentile {
  const nTotal = nullDist.pages.length;
  if (nTotal === 0) return { percentile: 1, nGreater: 0, nTotal: 0 };
  const target = Math.abs(lift);
  const nGreater = nullDist.pages.filter((p) => Math.abs(p.pseudoLift) >= target).length;
  return { percentile: nGreater / nTotal, nGreater, nTotal };
}

/** Gate the caller uses instead of hand-rolling the MIN_NULL_PAGES check
 *  everywhere: is this null distribution big enough to report a percentile
 *  read at all? */
export function hasEnoughNullPages(nullDist: PermutationNull): boolean {
  return nullDist.pages.length >= MIN_NULL_PAGES;
}

/** Plain-English, first-person, no-jargon sentence from an already-computed
 *  percentile read ({nGreater, nTotal} - the shape attached to a measured
 *  ShippedChangeRecord as `permutationRead`). Never says "placebo" /
 *  "permutation" / "p-value" - "untouched pages" only. Returns null when
 *  nTotal is 0 (no honest comparison pool - caller should render nothing,
 *  never a thin-sample claim). This is the function presentation surfaces
 *  should call: it takes the SAME counts already attached at measure time,
 *  so the Results row can never disagree with what was computed. */
export function permutationSentenceFromCounts(nGreater: number, nTotal: number): string | null {
  if (nTotal <= 0) return null;
  // operator spec 2026-07-09 E-34: never claims causal certainty ("that is strong evidence the
  // change caused it") - names the untouched-page comparison as what makes this a strong ESTIMATE
  // of the change's effect, not proof.
  if (nGreater === 0) {
    return `Out of ${nTotal} untouched pages, none moved as much as this one did. That is a strong estimate the change did it, not proof.`;
  }
  if (nGreater === 1) {
    return `Out of ${nTotal} untouched pages, only 1 moved as much as this one did. That is a strong estimate the change did it, not proof.`;
  }
  const strong = nGreater / nTotal <= 0.05;
  if (strong) {
    return `Out of ${nTotal} untouched pages, only ${nGreater} moved as much as this one did. That is a strong estimate the change did it, not proof.`;
  }
  return `Out of ${nTotal} untouched pages, ${nGreater} moved as much as this one did. Untouched pages swing this much on their own, so I would not call this strong evidence yet.`;
}

/** Plain-English, first-person, no-jargon sentence for the Results row,
 *  computed directly from a lift + null distribution. Returns null when
 *  there isn't enough of a comparison pool to say anything honest (caller
 *  should render nothing, not a thin-sample claim). Convenience wrapper
 *  around percentileOf + permutationSentenceFromCounts for callers that
 *  hold the full distribution rather than just the summary counts. */
export function permutationSentence(lift: number, nullDist: PermutationNull): string | null {
  if (!hasEnoughNullPages(nullDist)) return null;
  const { nGreater, nTotal } = percentileOf(lift, nullDist);
  return permutationSentenceFromCounts(nGreater, nTotal);
}

// ---------------------------------------------------------------------------
// FDR adjust (BEACON_500 P4 R10b, v1 item 291)
// ---------------------------------------------------------------------------
// With many simultaneous measurements, some wins are luck. The standard
// step-up adjustment (Benjamini-Hochberg at a 10 percent rate - the name
// lives ONLY in this comment, never on a surface) re-ranks the pool of mature
// win rows by how surprising each lift is (permutation-null read preferred,
// Poisson-scale fallback) and keeps only the wins that survive the pool-wide
// bar; the rest get `fdrCaution: true` and N10 demotes them solid -> decent.
// Stored verdicts, windows, and clocks are NEVER touched. Applied at LEDGER
// LOAD (load-ledger.ts), the only place the whole pool is in hand. PURE.

export type FdrRead = {
  /** True when this win cleared the individual bar but lost it after the
   *  pool-wide adjustment - hold the champagne. */
  fdrCaution: boolean;
  /** How many mature win rows were adjusted together. */
  poolSize: number;
  /** The row's own "how surprising" figure, 0-1 (smaller = more surprising).
   *  Kept for tests/debug; never rendered raw on a surface. */
  pValue: number;
  /** The honest sentence, non-null only when fdrCaution. */
  sentence: string | null;
};

/** The pool-wide rate: at most this fraction of surviving wins should be
 *  luck. 10 percent per the item spec. */
export const FDR_Q = 0.1;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * One row's "how surprising is this lift" figure. Prefers the empirical
 * permutation-null read (item 37); falls back to the Poisson-scale
 * approximation off the basis window's click lift. PURE.
 */
export function winPValue(args: {
  permutationRead?: { nGreater: number; nTotal: number } | null;
  /** The basis window's control-adjusted clicks lift. */
  adjustedLift: number;
  /** The pre-window clicks pro-rated to the basis window's length - the
   *  expected clicks had the change done nothing. */
  expectedWindowClicks: number;
}): number {
  const perm = args.permutationRead;
  if (perm && perm.nTotal > 0) return clamp01(perm.nGreater / perm.nTotal);
  const z = args.adjustedLift / Math.sqrt(Math.max(args.expectedWindowClicks, 1));
  return clamp01(1 - standardNormalCdf(z));
}

/**
 * The step-up adjustment: sort ascending, find the largest rank k whose
 * figure clears (k / poolSize) x q, keep everything at or above that rank.
 * Returns the ids that SURVIVE the pool-wide bar. PURE.
 */
export function benjaminiHochbergSignificant(
  rows: ReadonlyArray<{ id: string; p: number }>,
  q: number = FDR_Q,
): Set<string> {
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let k = -1;
  for (let i = 0; i < m; i++) {
    if (sorted[i].p <= ((i + 1) / m) * q) k = i;
  }
  const out = new Set<string>();
  for (let i = 0; i <= k; i++) out.add(sorted[i].id);
  return out;
}

/** The honest champagne sentence, with the real pool count. No lab words. */
export function fdrCautionSentence(poolSize: number): string {
  return `With ${poolSize} changes measured at once, one or two will look like winners by chance; this one is close enough to that line that I am holding the champagne.`;
}

/**
 * The full pool read: every row gets an FdrRead; only rows that cleared the
 * individual bar (p <= q) but lost the pool-wide one carry fdrCaution. Rows
 * that never cleared the individual bar are NOT cautioned here - their
 * weakness is already surfaced by the permutation "normal noise" line and
 * N10's own noise demotion. PURE.
 */
export function computeFdrCautions(
  rows: ReadonlyArray<{ id: string; p: number }>,
  q: number = FDR_Q,
): Map<string, FdrRead> {
  const survivors = benjaminiHochbergSignificant(rows, q);
  const out = new Map<string, FdrRead>();
  for (const r of rows) {
    const fdrCaution = r.p <= q && !survivors.has(r.id);
    out.set(r.id, {
      fdrCaution,
      poolSize: rows.length,
      pValue: r.p,
      sentence: fdrCaution ? fdrCautionSentence(rows.length) : null,
    });
  }
  return out;
}

/** The minimal record shape the ledger pass needs - structural so this pure
 *  section never imports the store's own types. */
type FdrLedgerRow = {
  id: string;
  verdict: string;
  windows: ReadonlyArray<{ day: number; ran: boolean; adjustedLift: number }>;
  baseline: { clicks: number; windowDays: number };
  permutationRead?: { nGreater: number; nTotal: number } | null;
  fdrRead?: FdrRead | null;
};

/**
 * The ledger pass: pick the pool (mature win rows - stored verdict "won"
 * with a closed 28 day window), score each, run the adjustment, and return
 * NEW records with `fdrRead` attached to pool rows. Everything else is
 * returned untouched (never cautioned, never restated). A pool of fewer than
 * two rows returns the input unchanged - one measurement has no multiplicity
 * to adjust for. PURE.
 */
export function attachFdrToLedger<T extends FdrLedgerRow>(records: ReadonlyArray<T>): T[] {
  const pool = records.filter(
    (r) => r.verdict === "won" && (r.windows ?? []).some((w) => w.day === 28 && w.ran),
  );
  if (pool.length < 2) return [...records];

  const scored = pool.map((r) => {
    const w28 = (r.windows ?? []).find((w) => w.day === 28 && w.ran)!;
    const baselineDays =
      r.baseline?.windowDays && r.baseline.windowDays > 0 ? r.baseline.windowDays : 28;
    const expectedWindowClicks = Math.max(0, r.baseline?.clicks ?? 0) * (28 / baselineDays);
    return {
      id: r.id,
      p: winPValue({
        permutationRead:
          r.permutationRead && r.permutationRead.nTotal > 0 ? r.permutationRead : null,
        adjustedLift: w28.adjustedLift ?? 0,
        expectedWindowClicks,
      }),
    };
  });
  const cautions = computeFdrCautions(scored);
  return records.map((r) => {
    const read = cautions.get(r.id);
    return read ? { ...r, fdrRead: read } : r;
  });
}

// ---------------------------------------------------------------------------
// Equivalence (BEACON_500 P4 R10b, v1 item 289)
// ---------------------------------------------------------------------------
// "This change genuinely did nothing, and I can prove that now." Proven when
// the Bayesian 90 percent range on monthly clicks sits ENTIRELY inside the
// too-small-to-matter band (under 5 percent of baseline monthly clicks AND
// under 10 clicks a month). Fed to N10 as `provenNeutral`: solid-for-learning
// with a closed 28 day window, distinct from inconclusive. Never touches the
// stored verdict/windows/clocks. Null when the Bayesian read flagged a small
// sample or the page had no baseline clicks. PURE.

export type EquivalenceRead = {
  /** True when the whole plausible effect range sits inside the band. */
  provenNeutral: boolean;
  /** The "too small to matter" band's half-width in clicks per month: the
   *  SMALLER of 5 percent of baseline monthly clicks and 10 clicks a month
   *  (both conditions must hold, per the item spec). */
  bandClicksPerMonth: number;
  /** The 90 percent plausible range on extra clicks per month (item 67). */
  ci90Low: number;
  ci90High: number;
  /** The honest close, non-null only when provenNeutral. */
  sentence: string | null;
};

/** "Too small to matter": the effect must be under BOTH caps. */
export const EQUIVALENCE_MAX_LIFT_FRACTION = 0.05;
export const EQUIVALENCE_MAX_CLICKS_PER_MONTH = 10;

/**
 * The equivalence read for one mature measurement. The caller gates on a
 * closed 28 day window and a non-"won" verdict (a win keeps its win lane;
 * doubtful wins are the FDR section's job, item 291) - this function only
 * judges the bounds themselves.
 */
export function computeEquivalence(args: {
  ci90Low: number;
  ci90High: number;
  /** The Bayesian read's own thin-counts flag - a small sample can not PROVE
   *  anything, however narrow its approximated interval looks. */
  smallSample: boolean;
  /** The treated page's own pre-ship clicks scaled to a 30 day month. */
  baselineMonthlyClicks: number;
}): EquivalenceRead | null {
  if (args.smallSample) return null;
  if (!(args.baselineMonthlyClicks > 0)) return null;
  if (!Number.isFinite(args.ci90Low) || !Number.isFinite(args.ci90High)) return null;

  const band = Math.min(
    EQUIVALENCE_MAX_LIFT_FRACTION * args.baselineMonthlyClicks,
    EQUIVALENCE_MAX_CLICKS_PER_MONTH,
  );
  const lo = Math.min(args.ci90Low, args.ci90High);
  const hi = Math.max(args.ci90Low, args.ci90High);
  const worstEnd = Math.max(Math.abs(lo), Math.abs(hi));
  const provenNeutral = worstEnd < band;

  // Range phrasing mirrors the Bayesian sentence style: never a raw minus
  // sign in operator copy.
  const loR = Math.round(lo);
  const hiR = Math.round(hi);
  const range =
    loR >= 0
      ? `between ${loR} and ${hiR} extra clicks a month`
      : hiR <= 0
        ? `between ${Math.abs(hiR)} and ${Math.abs(loR)} fewer clicks a month`
        : `between ${Math.abs(loR)} fewer and ${hiR} extra clicks a month`;
  const sentence = provenNeutral
    ? `This change genuinely did nothing, and I can prove that now; that is different from not knowing. The plausible effect sits ${range}, too small to matter either way.`
    : null;

  return {
    provenNeutral,
    bandClicksPerMonth: round1(band),
    ci90Low: lo,
    ci90High: hi,
    sentence,
  };
}

// ---------------------------------------------------------------------------
// Novelty decay (BEACON_500 P4 R10a, v1 item 378)
// ---------------------------------------------------------------------------
// The "first week jump that faded" detector: a lift that PEAKS in week 1 and
// decays back toward baseline by week 4 is most likely novelty (freshness
// boost, recrawl bump, social echo), not a lasting win. Feeds N10 as a
// demotion input; NEVER changes the stored verdict, windows, or clock. PURE.

export type NoveltyDecayRead = {
  /** True when the lift peaked in week 1 and decayed back toward baseline by week 4. */
  noveltyDecay: boolean;
  /** Mean daily clicks lift vs the baseline daily mean, post weeks 1 through 4. */
  weeklyLift: [number, number, number, number];
  /** The honest sentence, non-null only when noveltyDecay fired. */
  sentence: string | null;
};

/** Week 1 must be a real jump: at least this fraction of the baseline daily
 *  mean, floored at 1 extra click a day, before a fade is worth flagging. */
const MIN_PEAK_FRACTION_OF_BASELINE = 0.2;
const MIN_PEAK_DAILY_LIFT = 1;
/** "Decayed back toward baseline" = week 4 keeps at most this fraction of the
 *  week 1 lift. */
const MAX_WEEK4_RETENTION = 0.3;

/**
 * The novelty-decay read. Needs the FULL four post-ship weeks finalized (the
 * shape question is unanswerable earlier) and full baseline coverage - both
 * honest-absence guards mirror weekday-baseline.ts, so a day never reads as
 * a fake zero.
 */
export function computeNoveltyDecay(args: {
  series: ReadonlyArray<DailyClickPoint>;
  shipDate: string;
  /** Earliest date the series read covers (the loader's `since`). */
  knownFrom: string;
  /** Latest finalized GSC date - must cover the full 28 post days. */
  lastFinalizedDate: string | null;
  preWindowDays?: number;
}): NoveltyDecayRead | null {
  const preDays = args.preWindowDays ?? 28;
  const ship = args.shipDate.slice(0, 10);
  const baselineStart = addDays(ship, -preDays);
  if (args.knownFrom.slice(0, 10) > baselineStart) return null;
  const lastPostDay = addDays(ship, 27);
  if (args.lastFinalizedDate == null || args.lastFinalizedDate.slice(0, 10) < lastPostDay) return null;

  const byDate = new Map<string, number>();
  for (const p of args.series) {
    if (p?.date) byDate.set(p.date.slice(0, 10), Number(p.clicks) || 0);
  }
  const clicksOn = (date: string): number => byDate.get(date) ?? 0;

  const baseline: number[] = [];
  for (let i = 0; i < preDays; i++) baseline.push(clicksOn(addDays(baselineStart, i)));
  const mu = mean(baseline);

  const weeklyLift = [0, 1, 2, 3].map((week) => {
    const days: number[] = [];
    for (let i = week * 7; i < week * 7 + 7; i++) days.push(clicksOn(addDays(ship, i)));
    return round1(mean(days) - mu);
  }) as [number, number, number, number];

  const [w1, , , w4] = weeklyLift;
  const minPeak = Math.max(MIN_PEAK_DAILY_LIFT, MIN_PEAK_FRACTION_OF_BASELINE * mu);
  const noveltyDecay =
    w1 >= minPeak &&
    weeklyLift.every((w) => w <= w1) &&
    w4 <= MAX_WEEK4_RETENTION * w1;

  let sentence: string | null = null;
  if (noveltyDecay) {
    const w4Phrase =
      w4 <= 0.05 ? "back to its old level" : `back to about ${round1(w4)} extra clicks a day`;
    sentence = `The first week jump faded. This looks like novelty, not a lasting win. Week 1 ran about ${round1(w1)} extra clicks a day and week 4 is ${w4Phrase}.`;
  }

  return { noveltyDecay, weeklyLift, sentence };
}

// ---------------------------------------------------------------------------
// Early signal (BEACON_500 P4 R10a, v1 item 288)
// ---------------------------------------------------------------------------
// Adaptive window READS without ever touching the clock: 7+ consecutive
// recent post-ship days far outside the baseline's normal range in one
// direction attaches earlyDecisive; bounds that already exclude any
// meaningful effect after two weeks attach earlyFutile. HARD RULE: neither
// flag closes, shortens, or reopens any measurement window - the 7/14/28
// clock rules from N11 are inviolable. Presentation language plus an N10
// confidence input, nothing else. PURE.

export type EarlySignalRead = {
  /** True when the last 7+ finalized post-ship days are ALL far outside the
   *  baseline's normal daily range in the same direction. */
  earlyDecisive: boolean;
  /** Which way the decisive run points; null unless earlyDecisive. */
  direction: "up" | "down" | null;
  /** True when, after 14+ finalized post days, the daily movement's plausible
   *  range already excludes any meaningful effect in either direction. */
  earlyFutile: boolean;
  /** Length of the qualifying current run of far-outside days (0 when the
   *  most recent finalized day is back inside the normal range). */
  qualifyingRunDays: number;
  /** How many finalized post-ship days this read actually saw. */
  postDaysRead: number;
  /** The plain presentation sentence, non-null only when a flag fired. */
  sentence: string | null;
};

/** "Far outside its normal range" = beyond this many baseline daily spreads. */
const DECISIVE_SPREAD_MULTIPLE = 3;
/** The decisive run must cover at least this many consecutive recent days. */
const DECISIVE_MIN_CONSECUTIVE_DAYS = 7;
/** The futility read needs at least this many finalized post days. */
const FUTILE_MIN_POST_DAYS = 14;
/** A meaningful daily effect: 10 percent of the baseline daily mean, floored
 *  at the verdict's own 3-clicks-per-28-days minimum (measure.ts's
 *  DEFAULT_MIN_LIFT_CLICKS spread over the full window). */
const MEANINGFUL_DAILY_FRACTION = 0.1;
const MEANINGFUL_DAILY_FLOOR = 3 / 28;

const stdDev = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

/**
 * The early-signal read for a change whose 28-day window has NOT closed yet.
 * Honest-absence rules match weekday-baseline.ts: null when the series read
 * does not cover the whole baseline window, or when GSC has not finalized a
 * single post-ship day. Days past the finalized watermark are never read as
 * zeros.
 */
export function computeEarlySignal(args: {
  series: ReadonlyArray<DailyClickPoint>;
  shipDate: string;
  /** Earliest date the series read covers (the loader's `since`). */
  knownFrom: string;
  /** Latest finalized GSC date - the post read stops here. */
  lastFinalizedDate: string | null;
  preWindowDays?: number;
  /** Post days are capped at the full proof window. */
  maxPostDays?: number;
}): EarlySignalRead | null {
  const preDays = args.preWindowDays ?? 28;
  const maxPost = args.maxPostDays ?? 28;
  const ship = args.shipDate.slice(0, 10);
  const baselineStart = addDays(ship, -preDays);
  if (args.knownFrom.slice(0, 10) > baselineStart) return null;
  const lastFinal = args.lastFinalizedDate ? args.lastFinalizedDate.slice(0, 10) : null;
  if (lastFinal == null || lastFinal < ship) return null;

  const byDate = new Map<string, number>();
  for (const p of args.series) {
    if (p?.date) byDate.set(p.date.slice(0, 10), Number(p.clicks) || 0);
  }
  const clicksOn = (date: string): number => byDate.get(date) ?? 0;

  const baseline: number[] = [];
  for (let i = 0; i < preDays; i++) baseline.push(clicksOn(addDays(baselineStart, i)));
  const mu = mean(baseline);
  // A page's daily clicks are counts: a perfectly flat baseline still has
  // count-level noise, so the spread is floored at the square root of the
  // daily mean (and never below 1) - a dead-flat tiny page can not flag
  // "decisive" off ordinary single-click wobble.
  const spread = Math.max(stdDev(baseline), Math.sqrt(Math.max(mu, 1)));

  const post: number[] = [];
  for (let i = 0; i < maxPost; i++) {
    const date = addDays(ship, i);
    if (date > lastFinal) break;
    post.push(clicksOn(date));
  }
  const n = post.length;
  if (n === 0) return null;

  // Decisive: the CURRENT run of same-direction far-outside days, ending at
  // the most recent finalized day - "is working so clearly" is a present
  // tense claim, so a spike that already normalized never qualifies.
  let run = 0;
  let runDir: "up" | "down" | null = null;
  for (let i = n - 1; i >= 0; i--) {
    const z = (post[i] - mu) / spread;
    const dir: "up" | "down" | null =
      z > DECISIVE_SPREAD_MULTIPLE ? "up" : z < -DECISIVE_SPREAD_MULTIPLE ? "down" : null;
    if (dir == null || (runDir != null && dir !== runDir)) break;
    runDir = dir;
    run++;
  }
  const earlyDecisive = run >= DECISIVE_MIN_CONSECUTIVE_DAYS && runDir != null;
  const direction = earlyDecisive ? runDir : null;

  // Futile: after two weeks, does the plausible range of the mean daily
  // movement already exclude a meaningful effect BOTH ways? Uses the wider of
  // the baseline and post-period spreads (floored) so a noisy page never
  // reads futile off a lucky-flat stretch.
  let earlyFutile = false;
  if (!earlyDecisive && n >= FUTILE_MIN_POST_DAYS) {
    const meanLift = mean(post) - mu;
    const ciSpread = Math.max(stdDev(baseline), stdDev(post), 0.5);
    const halfWidth = (2 * ciSpread) / Math.sqrt(n);
    const meaningfulDaily = Math.max(MEANINGFUL_DAILY_FRACTION * mu, MEANINGFUL_DAILY_FLOOR);
    earlyFutile = meanLift + halfWidth < meaningfulDaily && meanLift - halfWidth > -meaningfulDaily;
  }

  let sentence: string | null = null;
  if (earlyDecisive && direction === "up") {
    sentence = `This is working so clearly I do not need the full 28 days to tell you. Every one of the last ${run} days is far above this page's normal range. The full 28-day read still waits for the window to close.`;
  } else if (earlyDecisive && direction === "down") {
    sentence = `This is hurting so clearly I do not need the full 28 days to tell you. Every one of the last ${run} days is far below this page's normal range. The full 28-day read still waits for the window to close.`;
  } else if (earlyFutile) {
    sentence = `After ${n} days this change is very unlikely to move this page in any meaningful way. I will still let the full window finish before calling it.`;
  }

  return {
    earlyDecisive,
    direction,
    earlyFutile,
    qualifyingRunDays: run,
    postDaysRead: n,
    sentence,
  };
}
