/**
 * pooled-verdict (2026-07-02, master plan item 34) - PURE inverse-variance pooling for a
 * same-lever, same-plan multi-page batch. The live Iranopedia daily batch ships ONE lever
 * (say, a description rewrite) across many sibling pages in one accepted plan (a real batch
 * had 8 selected pages), yet each page's own diff-in-diff read is individually underpowered -
 * a handful of clicks of noise on a modest page reads "inconclusive" even when the lever is
 * genuinely working across the whole page type. This module stacks the per-page adjusted lifts
 * into ONE batch-level verdict, the number the team actually needs: does this lever work on
 * this page type.
 *
 * ESTIMATOR (documented, so the math is auditable):
 *   - Each page in the batch contributes its own adjusted lift (already a diff-in-diff vs that
 *     page's own comparison pages - see measure.ts/computeWindowLift) and a variance estimate
 *     for that lift.
 *   - Variance is derived from the page's OWN daily click scatter over the pre-ship window (the
 *     window's day-to-day noise), NOT from a parametric model: variance = sample variance of the
 *     daily clicks series, scaled to the post-window length (variance of a sum of `day`
 *     i.i.d.-ish daily draws is `day * dailyVariance`; we double it to account for the treated
 *     and comparison sides of the diff-in-diff both carrying pre-window noise). This is a simple,
 *     conservative, deterministic proxy - it does not assume a parametric click distribution, and
 *     a flatter/quieter page (more predictable daily clicks) gets a smaller variance and
 *     therefore MORE weight in the pool, which is the entire point of inverse-variance pooling.
 *   - Pooled lift = weighted mean of the per-page lifts, weights = 1/variance (a page with a
 *     tighter estimate counts for more; a single noisy or high-traffic page cannot swamp seven
 *     quiet ones because its own variance is large in absolute click terms).
 *   - Standard error = sqrt(1 / sum(weights)); z = pooledLift / standardError.
 *   - A permutation-style honesty check: sign-flip permutation across the batch's OWN per-page
 *     lifts (2^n sign patterns, or a bounded deterministic sample above n=20) - reusing the same
 *     "what would a batch of pages with no real, consistently-signed effect look like" logic the
 *     placebo/A-A machinery already applies per-page (aa-calibration.ts), just applied ACROSS
 *     pages instead of across time. The permutation p-value is the fraction of sign patterns
 *     whose pooled |lift| is >= the observed pooled |lift|. No RNG - deterministic exact/near-
 *     exact enumeration, so two runs on the same input are byte-identical (mirrors aa-
 *     calibration's "no Date.now/Math.random" discipline).
 *   - Verdict: "helped" needs BOTH a z-score past a conservative threshold AND permutation
 *     p <= 0.10 (small batches can't demand p<=0.05 and still ever fire - honesty over
 *     confidence theater, but a threshold still exists). "did_not_help" is the mirror case
 *     (confidently negative). Anything else is "no_clear_lift" - the honest default.
 *
 * No I/O. Deterministic. $0. Pinned by pooled-verdict.test.ts.
 */

/** One page's contribution to the pool. `variance` must be > 0 (see estimateDailyLiftVariance
 *  for the documented derivation from a daily-clicks series). `weight` lets a caller override the
 *  inverse-variance weight (e.g. for testing edge cases); when absent the pool computes 1/variance
 *  itself. */
export type PerPageLift = {
  page: string;
  adjustedLiftPct: number;
  variance: number;
  weight?: number;
};

export type PooledVerdict = "helped" | "no_clear_lift" | "did_not_help";

export type PooledResult = {
  /** How many pages actually pooled (n < MIN_PAGES_TO_POOL is refused - see poolBatchLifts). */
  n: number;
  pooledLiftPct: number;
  standardError: number;
  zScore: number;
  /** Fraction (0-1) of sign-flip permutations whose pooled |lift| is >= the observed one. Lower
   *  = the observed pattern is less likely to be a coincidence of unrelated per-page noise. */
  permutationP: number;
  verdict: PooledVerdict;
  /** Plain-English, business-voice summary. Null when n < MIN_PAGES_TO_POOL (honest refusal - the
   *  caller should not render a pool at all in that case; the field is still typed so a caller
   *  that pools anyway gets a safe fallback string instead of undefined behavior). */
  sentence: string | null;
};

/** Below this many measured pages, a pooled verdict is not a "confident answer" - it's still a
 *  guess dressed as one. Honest floor (mission ask: "tiny batch honesty n<3"). */
export const MIN_PAGES_TO_POOL = 3;

/** A pooled z-score at or above this magnitude is treated as a confident directional read. 1.64
 *  is the one-sided 95% z - conservative enough that "helped"/"did_not_help" are not thrown
 *  around lightly, generous enough that a real, consistent multi-page lever pattern actually
 *  clears it (which is the whole point: 8 individually-noisy pages pooling to one confident
 *  answer). */
const Z_CONFIDENT = 1.64;
/** The permutation check must ALSO clear this p-value - a small batch's z-score alone can be
 *  fooled by one dominant page; requiring the sign pattern itself to be improbable is the
 *  second, independent gate. 0.10 (not 0.05) because n=3..8 batches have very few permutations to
 *  work with (n=3 -> 8 sign patterns, finest possible p is 1/8 = 0.125, which would make p<=0.05
 *  mathematically unreachable at the smallest allowed batch size - that would silently make every
 *  minimum-size batch un-confirmable, the opposite of "eight noisy pages become one confident
 *  answer"). */
const PERMUTATION_P_CONFIDENT = 0.1;

/** Above this many pages, exact 2^n sign-flip enumeration gets expensive for no real benefit -
 *  fall back to a bounded, deterministic (non-random) systematic sample of sign patterns. In
 *  practice a daily batch tops out around 8-12 pages, so this rarely engages. */
const MAX_EXACT_PERMUTATION_PAGES = 20;
const MAX_SAMPLED_PERMUTATIONS = 4096;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Estimate the variance of a page's ADJUSTED LIFT (already a percent/pp/click delta) from its own
 * pre-ship daily series. Documented derivation (see the module doc comment for the full
 * reasoning): sample variance of daily deltas, scaled by the post-window length and doubled for
 * the two-sided diff-in-diff, floored so a perfectly flat or too-short series never produces a
 * divide-by-zero weight downstream.
 *
 * `dailyClicks` should be the PRE-ship window's daily series for the treated page (the window
 * whose natural day-to-day scatter is the best available proxy for this page's noise level).
 * `windowDays` is the post-ship measurement window length (7/14/28) the adjusted lift was
 * computed over - the variance scales with it because a longer window sums more daily noise.
 */
export function estimateDailyLiftVariance(dailyClicks: number[], windowDays: number): number {
  const FLOOR = 0.01;
  if (dailyClicks.length < 2 || windowDays <= 0) return FLOOR;
  const mean = dailyClicks.reduce((s, v) => s + v, 0) / dailyClicks.length;
  const sampleVariance =
    dailyClicks.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyClicks.length - 1);
  // Variance of a WINDOW SUM of `windowDays` i.i.d.-ish daily draws scales linearly with the
  // window length; x2 because the diff-in-diff subtracts a comparison side that carries its own
  // (assumed comparable) noise, so the two variances add.
  const scaled = sampleVariance * windowDays * 2;
  return Math.max(scaled, FLOOR);
}

/** Deterministic sign patterns for n pages: [+1,-1,...] per permutation. For n <=
 *  MAX_EXACT_PERMUTATION_PAGES this enumerates every one of the 2^n sign vectors; above that it
 *  takes a bounded, evenly-spaced deterministic subset of the bit-pattern space (no RNG) so the
 *  function stays $0 and instant regardless of batch size. */
function signPatterns(n: number): number[][] {
  const total = 2 ** n;
  const patterns: number[][] = [];
  if (total <= MAX_EXACT_PERMUTATION_PAGES ** 2 || n <= MAX_EXACT_PERMUTATION_PAGES) {
    const count = Math.min(total, MAX_SAMPLED_PERMUTATIONS);
    const stride = total > count ? Math.floor(total / count) : 1;
    for (let i = 0; i < total; i += stride) {
      patterns.push(bitsToSigns(i, n));
      if (patterns.length >= count) break;
    }
  } else {
    for (let i = 0; i < MAX_SAMPLED_PERMUTATIONS; i++) {
      // Deterministic evenly-spaced sample across the bit-pattern space (no Math.random).
      const idx = Math.floor((i * total) / MAX_SAMPLED_PERMUTATIONS);
      patterns.push(bitsToSigns(idx, n));
    }
  }
  return patterns;
}

function bitsToSigns(bits: number, n: number): number[] {
  const signs = new Array<number>(n);
  for (let b = 0; b < n; b++) signs[b] = (bits >> b) & 1 ? -1 : 1;
  return signs;
}

/**
 * Weighted-mean pooled lift for one sign pattern applied to the per-page lifts (used both for the
 * real observed pool - the all-positive-sign pattern - and every permutation).
 */
function weightedPool(lifts: number[], weights: number[], signs: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < lifts.length; i++) {
    num += signs[i]! * lifts[i]! * weights[i]!;
    den += weights[i]!;
  }
  return den > 0 ? num / den : 0;
}

function sentenceFor(args: {
  n: number;
  pooledLiftPct: number;
  verdict: PooledVerdict;
}): string {
  const { n, pooledLiftPct, verdict } = args;
  const mag = Math.abs(round1(pooledLiftPct));
  if (verdict === "helped") {
    return `As a group: this batch of ${n} changes is up about ${mag} percent vs comparison pages. That is a real pattern, even though no single page proves it alone.`;
  }
  if (verdict === "did_not_help") {
    return `As a group: this batch of ${n} changes is down about ${mag} percent vs comparison pages. That is a real pattern, even though no single page proves it alone.`;
  }
  return `As a group: this batch of ${n} changes shows no clear pattern yet (the pages moved in different directions). I need more data or a bigger batch before I can call this lever a win or a loss on this page type.`;
}

/**
 * Pool per-page adjusted lifts (already diff-in-diff numbers, one per page) with inverse-variance
 * weights into ONE batch-level verdict. Refuses (n < MIN_PAGES_TO_POOL) rather than fabricate
 * confidence from too few pages - the tiny-batch honesty rule. Pure, deterministic, $0.
 */
export function poolBatchLifts(perPage: PerPageLift[]): PooledResult {
  const n = perPage.length;
  if (n < MIN_PAGES_TO_POOL) {
    return {
      n,
      pooledLiftPct: 0,
      standardError: 0,
      zScore: 0,
      permutationP: 1,
      verdict: "no_clear_lift",
      sentence: null,
    };
  }

  const lifts = perPage.map((p) => p.adjustedLiftPct);
  const weights = perPage.map((p) => p.weight ?? 1 / Math.max(p.variance, 1e-9));

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const pooledLiftPct = weightedPool(lifts, weights, lifts.map(() => 1));
  const standardError = totalWeight > 0 ? Math.sqrt(1 / totalWeight) : 0;
  const zScore = standardError > 0 ? pooledLiftPct / standardError : 0;

  // Permutation check: flip each page's OWN sign at random (well, deterministically) and see how
  // often the resulting pooled |lift| is >= the observed one. The observed pattern (all signs +1)
  // is included as one of the enumerated patterns.
  const observedAbs = Math.abs(pooledLiftPct);
  const patterns = signPatterns(n);
  let atLeastAsExtreme = 0;
  for (const signs of patterns) {
    const pooled = Math.abs(weightedPool(lifts, weights, signs));
    if (pooled >= observedAbs - 1e-9) atLeastAsExtreme += 1;
  }
  const permutationP = patterns.length > 0 ? atLeastAsExtreme / patterns.length : 1;

  let verdict: PooledVerdict = "no_clear_lift";
  if (zScore >= Z_CONFIDENT && permutationP <= PERMUTATION_P_CONFIDENT) verdict = "helped";
  else if (zScore <= -Z_CONFIDENT && permutationP <= PERMUTATION_P_CONFIDENT) verdict = "did_not_help";

  return {
    n,
    pooledLiftPct: round2(pooledLiftPct),
    standardError: round2(standardError),
    zScore: round2(zScore),
    permutationP: round3(permutationP),
    verdict,
    sentence: sentenceFor({ n, pooledLiftPct, verdict }),
  };
}
