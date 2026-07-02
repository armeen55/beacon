/**
 * Bayesian verdicts with credible intervals (2026-07-02, master plan item 67).
 * PURE, deterministic, no dependencies. Additive quantification layer beside
 * the existing hard-floor verdict in measure.ts, it does NOT decide won/lost.
 *
 * summarizeVerdict's floors are a single threshold: a 3-click lift on 200
 * impressions and the same lift on 20,000 impressions read identically
 * (both either clear the floor or don't). That ignores sample size entirely.
 * This module answers a different, honest question for the SAME pre/post
 * windows already read by run-measurement.ts: "how sure am I this helped, and
 * what is a plausible range for the real effect?"
 *
 * TWO models, one per metric family:
 *
 *   1. CTR, beta-binomial. A click is a Bernoulli trial over impressions.
 *      The PRE window supplies an INFORMATIVE prior (this page's own recent
 *      behavior, not a generic one): alpha0 = preClicks + 1, beta0 =
 *      preImpressions - preClicks + 1 (Beta(1,1) uniform prior updated by the
 *      pre-window's own clicks/impressions, a standard "add-one" Bayes-
 *      Laplace smoothing so a zero-click pre window never yields alpha0=0).
 *      The POSTERIOR then updates that SAME prior with the post window's
 *      clicks/impressions: alpha1 = alpha0 + postClicks, beta1 = beta0 +
 *      (postImpressions - postClicks). This treats the pre window as "what I
 *      believed the rate was before the change" and the post window as new
 *      evidence, which is the honest Bayesian reading of a before/after test
 *      (NOT a diff-in-diff, see the module-level caveat below).
 *
 *   2. Clicks, gamma-Poisson. Daily clicks are a Poisson process; the
 *      conjugate prior for its rate is a Gamma. The PRE window supplies the
 *      prior: shape0 = preClicks + 1, rate0 = preDays (a Gamma(1, 0) improper
 *      -> Gamma(preClicks+1, preDays) posterior-as-prior, same add-one
 *      smoothing as the CTR side). The POSTERIOR updates with the post
 *      window's own clicks/days: shape1 = shape0 + postClicks, rate1 = rate0
 *      + postDays. The resulting Gamma(shape1, rate1) describes the belief
 *      about the DAILY click rate after the change; scaling by 30 gives a
 *      monthly-clicks distribution.
 *
 * THE APPROXIMATION (documented per the spec, read this before trusting a
 * number from here): computing P(post rate > pre rate) and a credible
 * interval on the DIFFERENCE of two Beta or two Gamma random variables has no
 * simple closed form. Rather than pull in a numerics dependency (forbidden,
 * this must stay pure TypeScript, zero dependencies), each distribution is
 * approximated by a NORMAL distribution matched to its own mean and variance
 * (a standard moment-matching approximation):
 *
 *   Beta(a, b)   ~= Normal(a/(a+b), sqrt(ab / ((a+b)^2 (a+b+1))))
 *   Gamma(k, th) ~= Normal(k/th,   sqrt(k) / th)
 *
 * The difference of two (independent) normals is itself exactly normal, so
 * P(post > pre) = Phi((mean_diff) / sd_diff) and the 90% credible interval is
 * mean_diff +/- 1.645 * sd_diff. This is EXACT for the normal approximation,
 * but the approximation itself degrades when either distribution is far from
 * bell-shaped, concretely:
 *   - very small counts (under ~10 clicks or ~30 impressions in a window),
 *     where a Beta/Gamma is skewed and a normal can imply a negative CTR or
 *     negative clicks;
 *   - alpha or shape parameters near the boundary (a handful of impressions).
 * MIN_SAMPLE_FOR_NORMAL_APPROX below gates a "small sample" flag onto the
 * output rather than silently trusting the approximation. This is the
 * "keep it honest for small samples" clause in the item spec: the sentence
 * still renders (informationally), but pWin and the interval are the
 * moment-matched normal read, not a claim of exactness, and the small-sample
 * flag lets a caller soften the language or withhold the headline upgrade.
 *
 * NOT diff-in-diff: this reads the TREATED PAGE ALONE (its own pre vs post),
 * unlike the floor verdict which subtracts the mean control-page delta. A
 * closed-form Bayesian treatment of a three-way (treated pre, treated post,
 * control drift) diff-in-diff has no simple conjugate form either, and
 * bolting a control adjustment onto a page-level Beta/Gamma posterior would
 * silently break the conjugacy this module leans on. This is the documented
 * trade: the Bayesian read answers "how sure am I THIS PAGE moved", the
 * floor verdict (which still decides won/lost) answers "how sure am I this
 * page moved MORE than similar pages". They are complementary, not
 * duplicative, and the headline upgrade (measure.ts callers) only fires when
 * they AGREE in direction, see agreesWithVerdict below.
 */

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
   *  approximation (see module doc) may not hold, render cautiously. */
  smallSample: boolean;
  /** "We are 87 percent sure this helped, likely 5 to 40 extra clicks a month." */
  sentence: string;
};

/** Below this many clicks OR impressions in either window, the moment-matched
 *  normal approximation of a Beta/Gamma posterior can meaningfully misstate
 *  pWin/CI (skew near the boundary). Documented in the module header. */
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

/** Beta(a, b) mean + variance, moment-matched to a normal (see module doc). */
function betaMoments(a: number, b: number): { mean: number; sd: number } {
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) * (a + b) * (a + b + 1));
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

/** Gamma(shape, rate) mean + variance, moment-matched to a normal (see module doc). */
function gammaMoments(shape: number, rate: number): { mean: number; sd: number } {
  const mean = rate > 0 ? shape / rate : 0;
  const variance = rate > 0 ? shape / (rate * rate) : 0;
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

/** Round to 2 decimal places for stable, readable output. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

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
 * lever, clicks for everything else, mirrors pickProofMetric's own metric
 * choice so the Bayesian read is always asking the SAME question the floor
 * verdict is judged on) and build one BayesianRead from the raw pre/post
 * window readings measureRecord already has in hand. Position is not a
 * count/rate Beta-Poisson can model honestly (it's an average rank, not a
 * trial count), so a position-judged change gets no Bayesian read (honest
 * skip, not a fabricated model) - the floor verdict alone still governs it.
 * Pure - no I/O, callers supply the already-read window metrics.
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
