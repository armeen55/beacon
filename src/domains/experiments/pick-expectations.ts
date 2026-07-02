/**
 * pick-expectations (FINAL PREMIUM PLAN items 31, 34, 35; BEACON 500 items 27/28/64) - the honest
 * per-pick expectation lines, deterministic at plan time:
 *   - forecast (34): a range from the CTR-curve opportunity ("roughly 20 to 60 extra clicks a
 *     month"), labeled an estimate, suppressed when too small to mean anything
 *   - changeOurMind (31): one falsifiability line from the proof plan ("If clicks do not move
 *     by the 14-day read, we roll it back and try X instead")
 *   - effort (35): the operator's real cost ("about 2 minutes in your site editor")
 *   - forecastLow / forecastHigh / forecastMetric (28): the SAME range, persisted NUMERICALLY
 *     alongside the prose so a 28-day actual can be scored against it later (the prose string
 *     alone can never be compared to a measured number). Absent exactly when `forecast` is.
 * PURE, no I/O. The bias-correction factor (27) is read by the CALLER (build-daily-plan-record /
 * build-today-preview, which does the store read) and passed in here as a plain number so this
 * file stays pure and testable without a store; defaults to 1.0 (no correction) when omitted.
 *
 * Item 64 - EMPIRICAL CAPTURE. `forecastRange` used to assume every change captures a hardcoded
 * 25 to 75 percent of the CTR-curve gap, forever. It now accepts an optional `captureBand` (built
 * by empirical-capture.ts from the calibration ledger, ALSO read by the caller so this file stays
 * pure) that replaces those two fractions once there is enough per-family history to trust. Omit
 * it (or pass nothing) and the math is byte-identical to before - a fresh tenant with no mature
 * outcomes yet sees exactly the old 25/75 band. This composes with the item 27 correction factor
 * WITHOUT double-counting: the correction factor is a single portfolio-wide bias knob (did
 * forecasts as a whole run hot or cold, applied as a multiplier on the monthly opportunity itself);
 * the capture band is the PER-FAMILY shape of what fraction of the opportunity a title vs. an
 * answer block typically captures. One shifts the whole number up or down; the other decides where
 * inside the range the low and high ends sit. Applying both is "how big is the pie" (correction)
 * times "how big is this family's typical slice" (capture band) - no term appears twice.
 * Pinned by pick-expectations.test.ts.
 */

export type PickExpectations = {
  /** Absent when the opportunity is too small to forecast honestly. */
  forecast?: string;
  /** Numeric twin of `forecast` (item 28), so a 28-day actual can be scored against a real
   *  range instead of parsed out of prose. Additive + optional so plan records persisted
   *  before this field parse unchanged. Present exactly when `forecast` is. */
  forecastLow?: number;
  forecastHigh?: number;
  forecastMetric?: "clicks_per_month";
  changeOurMind: string;
  effort: string;
};

/** What we try NEXT if this lever does not move clicks (the falsifiability exit). */
const NEXT_LEVER_PLAIN: Record<string, string> = {
  meta: "a direct answer at the top of the page",
  title: "a sharper description",
  h1: "a sharper title",
  internal_link: "a different supporting link",
  answer_block: "a sharper description",
  refresh: "a sharper title and description on the same page",
};

/** The expected organic CTR at a Google position (the industry curve the daily candidates use). */
const CTR_CURVE: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025 };
export function expectedCtrAt(position: number): number {
  const p = Math.round(position);
  if (p <= 0) return 0.28;
  if (p <= 10) return CTR_CURVE[p]!;
  if (p <= 15) return 0.018;
  if (p <= 20) return 0.012;
  return 0.006;
}

/** 90d CTR-curve opportunity for a query the page already ranks for (clicks left on the table). */
export function ctrOpportunity90d(input: { position: number; ctr: number; impressions90d: number }): number {
  if (!Number.isFinite(input.impressions90d) || input.impressions90d <= 0) return 0;
  return Math.max(0, expectedCtrAt(input.position) - Math.max(0, input.ctr)) * input.impressions90d;
}

/** Round to a friendly number (5s above 10, 10s above 100) so the range reads like an estimate. */
function friendly(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n / 5) * 5;
  return Math.round(n);
}

/** Clamp the learned bias-correction factor (item 27) to a safe band so a noisy or thin
 *  calibration history can never blow the forecast up or collapse it to near-zero. */
export const CORRECTION_FACTOR_MIN = 0.7;
export const CORRECTION_FACTOR_MAX = 1.3;
export function clampCorrectionFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(CORRECTION_FACTOR_MAX, Math.max(CORRECTION_FACTOR_MIN, factor));
}

/** The capture fractions (item 64): how much of the monthly CTR-curve opportunity the low/high
 *  ends of the range assume a real change captures. Defaults to the original static 25%/75% band;
 *  a caller passes the blended/empirical band from empirical-capture.ts once one exists for this
 *  pick's actionFamily. Omitting it entirely is byte-identical to pre-item-64 behavior. */
export type CaptureFractions = { low: number; high: number };
const DEFAULT_CAPTURE: CaptureFractions = { low: 0.25, high: 0.75 };

/**
 * Monthly extra-clicks range from the 90-day CTR-curve opportunity. The opportunity is "close the
 * whole gap to the curve"; real changes capture part of it, so the range is, by default, 25% to
 * 75% of the monthly opportunity. Returns null when the honest high end is under 3 clicks a month.
 *
 * `correctionFactor` (item 27, default 1.0 = no correction) shifts the range toward what past
 * picks actually delivered, e.g. 0.92 when past forecasts ran about 8% hot. Clamped defensively
 * even if a caller passes an unclamped value.
 *
 * `captureFractions` (item 64, default the static 25%/75% band) replaces those two capture
 * fractions with Beacon's own measured per-family capture history once one is available. This is
 * a SEPARATE knob from correctionFactor - see the module doc comment for why the two never
 * double-count. Omitted entirely, this function's output does not change at all from before.
 */
export function forecastRange(
  ctrOpportunityClicks90d: number,
  correctionFactor: number = 1,
  captureFractions: CaptureFractions = DEFAULT_CAPTURE,
): { low: number; high: number } | null {
  if (!Number.isFinite(ctrOpportunityClicks90d) || ctrOpportunityClicks90d <= 0) return null;
  const factor = clampCorrectionFactor(correctionFactor);
  const monthly = (ctrOpportunityClicks90d / 3) * factor;
  const captureLow = Number.isFinite(captureFractions.low) ? captureFractions.low : DEFAULT_CAPTURE.low;
  const captureHigh = Number.isFinite(captureFractions.high) ? captureFractions.high : DEFAULT_CAPTURE.high;
  const low = friendly(monthly * captureLow);
  const high = friendly(monthly * captureHigh);
  if (high < 3) return null;
  return { low: Math.max(1, low), high: Math.max(high, Math.max(1, low)) };
}

/** Plain, pluralized name for a lever's tests, for the item 64 empirical-capture sentence
 *  ("across our last 9 title tests on this site..."). Falls back to "changes" for an
 *  unrecognized lever so the sentence still reads cleanly. */
const LEVER_TEST_NAME_PLAIN: Record<string, string> = {
  meta: "description tests",
  title: "title tests",
  h1: "title tests",
  internal_link: "internal link tests",
  answer_block: "answer block tests",
  refresh: "page refresh tests",
};

export function buildPickExpectations(input: {
  lever: string;
  ctrOpportunityClicks: number;
  effortMinutes: number;
  /** Item 27: the measured bias-correction factor from past forecasts vs actuals (default 1.0,
   *  meaning no correction). Callers read this fail-soft from forecast-calibration.ts; this
   *  function stays pure and just applies whatever number it is given. */
  correctionFactor?: number;
  /** Item 64: this lever's blended/empirical capture band from empirical-capture.ts (the caller
   *  resolves it by actionFamily and passes the plain fractions + sample size here so this file
   *  stays pure). Omitted entirely (or `isEmpirical: false`) -> byte-identical to pre-item-64
   *  behavior, including the exact prose sentence. */
  captureBand?: { low: number; high: number; n: number; isEmpirical: boolean };
}): PickExpectations {
  const correctionFactor = clampCorrectionFactor(input.correctionFactor ?? 1);
  const captureFractions: CaptureFractions | undefined = input.captureBand
    ? { low: input.captureBand.low, high: input.captureBand.high }
    : undefined;
  const range = forecastRange(input.ctrOpportunityClicks, correctionFactor, captureFractions);
  const next = NEXT_LEVER_PLAIN[input.lever] ?? "a different change";
  const mins = Math.max(1, Math.round(input.effortMinutes));
  // Only name the correction when it actually moved the range - an exact 1.0 (no calibration
  // history yet, or a perfectly calibrated one) should read like the plain original sentence.
  const correctionClause =
    Math.abs(correctionFactor - 1) >= 0.01
      ? ", adjusted for our track record here"
      : "";
  // Item 64: name the empirical history in the same sentence, instead of a silent number change -
  // "across our last 9 title tests on this site, the typical capture was 15 to 40 percent." Only
  // fires once the band is genuinely empirical (n >= MIN_SAMPLES in empirical-capture.ts); a thin
  // or absent history reads exactly like the original sentence, with no mention of a track record.
  const captureClause =
    input.captureBand?.isEmpirical
      ? ` Across our last ${input.captureBand.n} ${LEVER_TEST_NAME_PLAIN[input.lever] ?? "changes"} on this site, the typical capture was ${Math.round(input.captureBand.low * 100)} to ${Math.round(input.captureBand.high * 100)} percent of the gap we are targeting.`
      : "";
  return {
    ...(range
      ? {
          forecast: `If this works: roughly ${range.low.toLocaleString()} to ${range.high.toLocaleString()} extra clicks a month${correctionClause}. An estimate from your current rank and click rate, not a promise.${captureClause}`,
          forecastLow: range.low,
          forecastHigh: range.high,
          forecastMetric: "clicks_per_month" as const,
        }
      : {}),
    changeOurMind: `If clicks do not move by the 14-day read, we roll it back (the old text is saved) and try ${next} instead.`,
    effort: `about ${mins} minute${mins === 1 ? "" : "s"} in your site editor`,
  };
}
