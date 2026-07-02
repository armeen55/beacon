/**
 * power-analysis (2026-07-02, BEACON 500 item 35) - the honest "can we even see this?" gate.
 * The planner scores candidates by opportunity but never asked whether the page has enough
 * traffic to tell a real change from ordinary day-to-day noise inside a 28-day read. This module
 * answers that with plain statistics: the minimum detectable effect (MDE) a page's own baseline
 * clicks/impressions and noise level can resolve in `windowDays`, then compares it honestly to
 * the numeric forecast persisted by pick-expectations.ts (item 28's forecastLow/forecastHigh).
 *
 * PURE, no I/O, no LLM, $0. The caller (build-today-preview.ts) supplies the page's own daily
 * click series (a bounded read it already has a loader for); this file never fetches anything.
 *
 * THE MATH (documented, not hidden):
 *   - A 28-day (or `windowDays`) before/after comparison on daily clicks is, to first order, a
 *     comparison of two window TOTALS. The natural month-to-month variability of that total is
 *     approximately `mean * noiseCv` (a coefficient-of-variation model - the standard deviation
 *     scaled to the mean, which is the right shape for click counts that are neither pure Poisson
 *     noise on a tiny page nor negligible noise on a huge one).
 *   - We treat the smallest change worth trusting as one that would need to clear roughly TWO
 *     noise units to read as a real signal against that natural swing (a conservative, plain-
 *     English stand-in for a two-sample detection threshold - not a formal power calculation with
 *     an assumed alpha/beta, but the same shape: bigger noise or a shorter window needs a bigger
 *     true effect before we would ever notice it). That is `MDE_NOISE_MULTIPLIER = 2`.
 *   - Noise also shrinks with more days of data in the window (more days average out day-to-day
 *     swings), so the multiplier is scaled by `1 / sqrt(windowDays / 28)` relative to the
 *     reference 28-day window - a 14-day read needs a bigger true effect to detect than a 28-day
 *     one on the same page; a 56-day read can detect a smaller one.
 *   - The result is expressed as CLICKS PER MONTH (30 days) so it lines up unit-for-unit with
 *     forecastLow/forecastHigh from pick-expectations.ts.
 *
 * NOISE ESTIMATOR (`noiseCv`, the coefficient of variation of the page's own daily clicks):
 *   - Simple estimator: sample standard deviation of the daily series divided by its mean
 *     (population CV). This is the textbook "how spiky is this series relative to its own
 *     average" measure and needs no distributional assumption.
 *   - FALLBACK when the series is short (< MIN_SERIES_DAYS days) or degenerate (mean is ~0, or
 *     fewer than 2 usable points): a fixed conservative default (`FALLBACK_NOISE_CV`) high enough
 *     to assume a thin page is noisy until proven otherwise (never assume a page is quiet just
 *     because we have not measured it). `confidence` reports which path was used, so a caller can
 *     say "rough estimate" honestly instead of pretending precision it doesn't have.
 */

export type ComputeMdeInput = {
  /** The page's average daily clicks over its baseline window (impressions90d-style clicks/90,
   *  or any equivalent daily average the caller already has). */
  baselineDailyClicks: number;
  /** The page's average daily impressions over the same baseline window. Currently informational
   *  (kept in the signature so a future refinement can fold in impression-driven precision
   *  without a breaking change) - the click-noise model already captures the traffic scale that
   *  matters for a clicks-per-month forecast. */
  baselineDailyImpressions: number;
  /** How many days the read window covers (28 for the standard daily-experiment cadence). */
  windowDays: number;
  /** Coefficient of variation (std dev / mean) of the page's own daily click scatter. Compute with
   *  {@link estimateNoiseCv} from the raw daily series; pass the result straight through. */
  noiseCv: number;
};

export type MdeResult = {
  /** The smallest month-over-month clicks-per-month change this page could reliably show inside
   *  `windowDays`, given its own traffic and noise. */
  mdeClicksPerMonth: number;
  /** "estimated" when noiseCv came from a real daily series long enough to trust; "rough" when it
   *  fell back to the conservative default (short/degenerate series). Never hide the difference. */
  confidence: "estimated" | "rough";
};

/** How many noise units of separation we require before calling an effect detectable. A plain,
 *  documented stand-in for a two-sample detection threshold (not a formal alpha/beta power
 *  calculation) - conservative enough that a "just barely bigger than noise" forecast still reads
 *  as marginal rather than well powered. */
export const MDE_NOISE_MULTIPLIER = 2;

/** Reference window (days) the noise multiplier is calibrated against; shorter reads need a
 *  bigger true effect (less averaging), longer reads need a smaller one. */
const REFERENCE_WINDOW_DAYS = 28;

/** Days of daily-series history required before we trust a computed noiseCv over the fallback. */
export const MIN_SERIES_DAYS = 14;

/** Conservative default CV used when the series is too short or degenerate to measure. Chosen
 *  high (most content-site pages show 30-60% month-to-month click CV) so a thin/unknown page is
 *  assumed noisy rather than falsely confident. */
export const FALLBACK_NOISE_CV = 0.6;

/** Floor under a computed CV so a suspiciously flat short series (e.g. all-zero padding) never
 *  claims implausible precision - real click series are never perfectly smooth. */
const MIN_PLAUSIBLE_CV = 0.15;

export type DailyClickPoint = { date: string; clicks: number };

/**
 * Estimate the coefficient of variation (std dev / mean) of a page's own daily click series.
 * Simple estimator: population standard deviation over the mean. Falls back to
 * {@link FALLBACK_NOISE_CV} (confidence "rough") when there is not enough usable history, or when
 * the series is too flat/zero to trust. PURE.
 */
export function estimateNoiseCv(series: ReadonlyArray<DailyClickPoint>): { noiseCv: number; confidence: "estimated" | "rough" } {
  const values = series.map((p) => (Number.isFinite(p.clicks) ? Math.max(0, p.clicks) : 0));
  if (values.length < MIN_SERIES_DAYS) return { noiseCv: FALLBACK_NOISE_CV, confidence: "rough" };

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean <= 0) return { noiseCv: FALLBACK_NOISE_CV, confidence: "rough" };

  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const cv = std / mean;

  // A near-zero measured CV on real data is implausible for organic clicks (weekday cycles alone
  // produce real scatter) - treat it as too good to be true rather than reporting false precision.
  if (!Number.isFinite(cv) || cv < MIN_PLAUSIBLE_CV) return { noiseCv: MIN_PLAUSIBLE_CV, confidence: "estimated" };
  return { noiseCv: cv, confidence: "estimated" };
}

/**
 * Minimum detectable effect, in clicks per month, for a page with the given baseline traffic,
 * noise, and read window. Deterministic, PURE, $0. See file header for the documented math.
 */
export function computeMde(input: ComputeMdeInput): MdeResult {
  const dailyClicks = Number.isFinite(input.baselineDailyClicks) ? Math.max(0, input.baselineDailyClicks) : 0;
  const windowDays = Number.isFinite(input.windowDays) && input.windowDays > 0 ? input.windowDays : REFERENCE_WINDOW_DAYS;
  const cv = Number.isFinite(input.noiseCv) && input.noiseCv > 0 ? input.noiseCv : FALLBACK_NOISE_CV;

  // Monthly baseline clicks - the scale the noise (and the MDE) is expressed against.
  const monthlyClicks = dailyClicks * 30;

  // Shorter windows average out less day-to-day noise, so they need a bigger true effect before
  // it clears the noise floor; longer windows need less. Scaled relative to the 28-day reference.
  const windowScale = Math.sqrt(REFERENCE_WINDOW_DAYS / windowDays);

  // The natural month-to-month swing in this page's own clicks, in clicks/month.
  const noiseClicksPerMonth = monthlyClicks * cv;

  const mdeClicksPerMonth = noiseClicksPerMonth * MDE_NOISE_MULTIPLIER * windowScale;

  // A page with truly zero baseline traffic can't detect ANY effect - the MDE is effectively
  // infinite, but we report a small positive floor (1 click) so downstream ratio math never
  // divides by zero or produces a misleadingly clean 0.
  const floor = dailyClicks <= 0 ? Math.max(3, monthlyClicks) : 0;

  return {
    mdeClicksPerMonth: Math.max(1, Math.round(Math.max(mdeClicksPerMonth, floor))),
    confidence: input.noiseCv === FALLBACK_NOISE_CV ? "rough" : "estimated",
  };
}

export type PowerBand = "well_powered" | "marginal" | "underpowered";

export type AssessPowerInput = {
  /** The pick's numeric forecast range (item 28's forecastLow/forecastHigh, clicks per month). */
  forecastLow: number;
  forecastHigh: number;
  mde: MdeResult;
};

export type PowerAssessment = {
  band: PowerBand;
  /** forecast midpoint / mde, rounded to 2 decimals. >= 1.5 well powered, >= 0.7 marginal, else
   *  underpowered (see WELL_POWERED_RATIO / MARGINAL_RATIO). */
  ratio: number;
  /** One honest, first-person, operator-facing sentence. Never a raw number dump; always plain
   *  business language. No em or en dashes. */
  sentence: string;
  mdeClicksPerMonth: number;
};

/** Ratio (forecast midpoint / MDE) at or above which a pick reads as comfortably measurable. */
export const WELL_POWERED_RATIO = 1.5;
/** Ratio at or above which a pick is still worth doing, just slower/noisier to confirm. Below
 *  this the pick is underpowered - genuinely unlikely to resolve within the window. */
export const MARGINAL_RATIO = 0.7;
/** Ratio below which the shortfall is EXTREME - the forecast is less than half the noise floor,
 *  so the test is doomed even with generous patience. This is the only threshold the gate uses to
 *  hard-exclude; everything else warns and downranks. Documented per the hard rule: the operator's
 *  plan should never silently shrink to zero, so this stays a high bar. */
export const EXTREME_SHORTFALL_RATIO = 0.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compare a pick's numeric forecast range to its page's MDE and return an honest band + a plain
 * first-person sentence. PURE, deterministic. Never mentions "power", "MDE", "noise floor", or any
 * other lab word to the operator - only clicks, months, and what to do about it.
 */
export function assessPower(input: AssessPowerInput): PowerAssessment {
  const mde = Math.max(1, input.mde.mdeClicksPerMonth);
  const low = Number.isFinite(input.forecastLow) ? Math.max(0, input.forecastLow) : 0;
  const high = Number.isFinite(input.forecastHigh) ? Math.max(low, input.forecastHigh) : low;
  const midpoint = (low + high) / 2;
  const ratio = round2(midpoint / mde);

  let band: PowerBand;
  if (ratio >= WELL_POWERED_RATIO) band = "well_powered";
  else if (ratio >= MARGINAL_RATIO) band = "marginal";
  else band = "underpowered";

  const sentence = powerSentence(band, midpoint, mde);

  return { band, ratio, sentence, mdeClicksPerMonth: mde };
}

/** The plain, first-person sentence for each band. Business language only, numbers when we have
 *  them, always honest about what it means for the operator's next move. No dashes. */
function powerSentence(band: PowerBand, forecastMidpoint: number, mde: number): string {
  const roundedForecast = Math.round(forecastMidpoint);
  const roundedMde = Math.round(mde);
  if (band === "well_powered") {
    return `This page gets enough traffic that a change of this size should show up clearly within 28 days.`;
  }
  if (band === "marginal") {
    return `The result may take longer than 28 days to prove on this page, traffic is thin. Worth doing, slower to verify. I would need to see about ${roundedMde} extra clicks a month to be sure, and I am forecasting roughly ${roundedForecast}.`;
  }
  return `This page gets about ${roundedForecast} clicks a month of headroom here, and I would need to see about ${roundedMde} to tell a real change from normal noise. Even a good change would be invisible for months, so I am spending tonight's slot on a page where we can actually see the result.`;
}
