/**
 * equivalence (BEACON_500 P4 R10b, v1 item 289, 2026-07-03) - "this change
 * genuinely did nothing, and I can prove that now."
 *
 * An inconclusive verdict says "I do not know". This module proves the
 * stronger, more useful statement when the data supports it: the plausible
 * effect range (the Bayesian read's 90 percent interval on monthly clicks,
 * item 67) sits ENTIRELY inside a "too small to matter" band - under 5
 * percent of the page's baseline monthly clicks AND under 10 clicks a month
 * in absolute terms. That is a PROVEN neutral: the lesson ("this lever does
 * not move pages like this") is reliable even though the change did not win,
 * which is categorically different from a wide-interval "not knowing".
 *
 * Attached as `equivalence` on the record (computed-only, recomputed on every
 * measure, never persisted; recordToRow omits it) and fed to N10's verdict
 * reliability grade as `provenNeutral`: a proven-neutral row with a closed 28
 * day window grades solid-for-learning, distinct from inconclusive. NEVER
 * touches the stored verdict, windows, or clocks.
 *
 * Honest-absence rules: null when the Bayesian read flagged a small sample
 * (tight-looking bounds from thin counts prove nothing), and null when the
 * page had no baseline clicks at all (a percent band on zero is undefined).
 * Position-judged changes have no Bayesian read, so they honestly get no
 * equivalence read either. PURE - no I/O. Pinned by equivalence.test.ts.
 */

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

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The equivalence read for one mature measurement. The caller gates on a
 * closed 28 day window and a non-"won" verdict (a win keeps its win lane;
 * doubtful wins are the FDR module's job, item 291) - this function only
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

  // Range phrasing mirrors bayesian-read.ts's sentence style: never a raw
  // minus sign in operator copy.
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
