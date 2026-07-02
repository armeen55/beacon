/**
 * empirical-capture (2026-07-02, master plan item 64) - replaces the hardcoded 25 to 75 percent
 * "capture" assumption in pick-expectations.ts with Beacon's own measured lever priors, per
 * actionFamily, shrunk against winner's curse. PURE, no I/O.
 *
 * THE PROBLEM: forecastRange (pick-expectations.ts) always assumes a real change captures 25 to 75
 * percent of the CTR-curve gap it targets, forever, no matter what the ledger has actually learned.
 * Titles might really capture 15 to 40 percent; answer blocks might capture 30 to 80. This module
 * computes that shape FROM the calibration ledger (forecast-calibration-store.ts), one family at a
 * time, and blends it in only once there is enough evidence to trust it.
 *
 * THE MATH, in three pure steps:
 *
 * (1) REALIZED CAPTURE FRACTION. For one settled, cleanly-attributed pick:
 *       capture = realized monthly lift / the CTR-curve gap it targeted
 *     Both numbers already exist on (or are derivable from) the calibration record - see
 *     `realizedCaptureFraction`. A capture > 1 (the change beat the whole curve gap, e.g. it also
 *     picked up incremental impressions) or < 0 (it lost clicks) is kept as-is; the distribution
 *     summarizes whatever the ledger actually shows, it does not clip winners or losers.
 *
 * (2) WINNER'S-CURSE SHRINKAGE (apply BEFORE a sample enters the distribution). A pick only reaches
 *     the calibration ledger because it was SELECTED - typically because its forecast opportunity
 *     looked good. Selecting on a noisy estimate biases the selected sample's mean upward (the
 *     "winner's curse"): some of what looks like a great capture rate is just noise that happened to
 *     land high. Left uncorrected, feeding raw realized captures back into next month's forecast
 *     would make Beacon chronically overpromise.
 *
 *     The fix is a simple, standard shrinkage estimator (the same idea behind James-Stein / empirical
 *     Bayes shrinkage, simplified to one knob so it stays auditable):
 *
 *       shrunk = mean + (obs - mean) * weight
 *       weight = n / (n + PRECISION_SCALE)          (n = the window's impression volume)
 *
 *     `weight` runs 0..1 and grows with impression volume: a pick measured on a high-impression page
 *     (n large relative to PRECISION_SCALE) is trusted almost fully (weight near 1, shrunk near obs);
 *     a pick measured on a low-impression page (n small) is pulled hard toward the family mean
 *     (weight near 0, shrunk near mean). This is precision weighting - more Search impressions in the
 *     measurement window means less sampling noise in the realized capture, so it deserves more
 *     trust relative to the family average.
 *
 * (3) BLEND WITH THE STATIC BAND. Below MIN_SAMPLES shrunk observations for a family, there is not
 *     enough evidence to trust an empirical p25/p75 at all - use the static 25/75 band exactly as
 *     before (byte-identical to pre-item-64 behavior). From MIN_SAMPLES to FULL_EMPIRICAL_SAMPLES,
 *     blend linearly from the static band toward the empirical one; at FULL_EMPIRICAL_SAMPLES and
 *     above, use the empirical band outright.
 *
 * Pinned by empirical-capture.test.ts.
 */

/** One settled, cleanly-attributed pick's realized capture, ready to fold into a family
 *  distribution. `impressions` is the precision-weight input (the measurement window's post-window
 *  Search impressions on the treated page) - more impressions means less sampling noise, so the
 *  observation is trusted more relative to the family mean during shrinkage. */
export type CaptureObservation = {
  actionFamily: string;
  /** realized monthly lift / CTR-curve gap targeted. Can be negative (lost clicks) or > 1 (beat the
   *  whole gap); never clipped here - the distribution reflects the ledger honestly. */
  capture: number;
  /** Post-window Search impressions for the treated page - the precision-weight input. */
  impressions: number;
};

/** A shrunk observation, ready to enter its family's p25/p75 distribution. */
export type ShrunkObservation = {
  actionFamily: string;
  capture: number;
};

/** The empirical capture band learned for one actionFamily, plus the sample size that earned it
 *  (named directly in the upgraded forecast prose - "across our last N title tests..."). */
export type FamilyCaptureBand = {
  actionFamily: string;
  p25: number;
  p75: number;
  n: number;
};

/** Below this many shrunk observations in a family, the static 25/75 band is used untouched - too
 *  thin to trust an empirical percentile. */
export const MIN_SAMPLES = 5;
/** At and above this many shrunk observations, the family band is used outright (fully empirical,
 *  no blend with the static band). */
export const FULL_EMPIRICAL_SAMPLES = 15;

/** The static band this whole module exists to eventually replace, kept as the honest fallback
 *  below MIN_SAMPLES and the blend anchor between MIN_SAMPLES and FULL_EMPIRICAL_SAMPLES. Mirrors
 *  the literal 0.25/0.75 forecastRange has always used. */
export const STATIC_LOW = 0.25;
export const STATIC_HIGH = 0.75;

/** Precision scale for the shrinkage weight (impressions at which a family-mean pull and an
 *  observation get equal say: weight = n / (n + PRECISION_SCALE) = 0.5 when n = PRECISION_SCALE).
 *  400 impressions is roughly a modest month of Search presence for a page worth experimenting on -
 *  a pick measured on far less traffic than that leans on the family average; far more, it stands
 *  mostly on its own. */
export const PRECISION_SCALE = 400;

/**
 * Realized capture fraction for one settled pick: how much of the CTR-curve gap it targeted the
 * change actually captured. PURE arithmetic; `gapClicksPerMonth` must already be derived the SAME
 * way pick-expectations.ts derives the opportunity (see build-daily-candidates.ts /
 * forecastRange's caller), scaled to the same monthly units as `actualMonthlyLift`. Returns null
 * when the gap is not positive (nothing to capture a fraction OF - an honest skip, never a
 * division fabrication).
 */
export function realizedCaptureFraction(actualMonthlyLift: number, gapClicksPerMonth: number): number | null {
  if (!Number.isFinite(gapClicksPerMonth) || gapClicksPerMonth <= 0) return null;
  if (!Number.isFinite(actualMonthlyLift)) return null;
  return actualMonthlyLift / gapClicksPerMonth;
}

/**
 * Winner's-curse shrinkage (step 2). Pulls one raw observation toward its family mean, weighted by
 * how much Search impression volume backed the measurement (more volume -> less noise -> more of
 * the observation's own value is kept). `familyMean` is the mean of the OTHER shrinkage inputs
 * before shrinkage is applied to this one (see `shrinkObservations`, which handles the
 * leave-one-out bookkeeping) - a caller scoring a single observation against an already-known prior
 * mean may pass any trusted mean directly.
 */
export function shrinkTowardMean(
  observedCapture: number,
  familyMean: number,
  impressions: number,
  precisionScale: number = PRECISION_SCALE,
): number {
  const n = Number.isFinite(impressions) && impressions > 0 ? impressions : 0;
  const scale = Number.isFinite(precisionScale) && precisionScale > 0 ? precisionScale : PRECISION_SCALE;
  const weight = n / (n + scale);
  return familyMean + (observedCapture - familyMean) * weight;
}

/**
 * Shrink every observation in one actionFamily toward the family's own (unshrunk) mean, weighted by
 * each observation's impression volume. Uses the family's raw mean (not leave-one-out) as the
 * shrinkage target - simple and stable, and with MIN_SAMPLES+ observations one point's influence on
 * the mean is already small. PURE; empty input -> [].
 */
export function shrinkFamilyObservations(observations: ReadonlyArray<CaptureObservation>): ShrunkObservation[] {
  if (observations.length === 0) return [];
  const mean = observations.reduce((s, o) => s + o.capture, 0) / observations.length;
  return observations.map((o) => ({
    actionFamily: o.actionFamily,
    capture: shrinkTowardMean(o.capture, mean, o.impressions),
  }));
}

/** p25/p75 by linear interpolation between the two nearest ranks (same convention as the ledger's
 *  own percentile95 in aa-calibration.ts). Empty -> 0. Single value -> that value for both. */
function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/**
 * Step 1+2 combined entry point: given every mature, cleanly-attributed CaptureObservation across
 * every family (already gated by the caller through the same load-experiment-outcomes maturity/
 * weather/parallel-trends checks pick-expectations relies on elsewhere), shrink each family's
 * observations toward its own mean and fold them into a per-family p25/p75/n distribution. PURE;
 * empty input -> empty map. A family with zero observations never appears (absence means "use the
 * static band", handled by `blendCaptureBand`).
 */
export function computeCaptureDistribution(
  observations: ReadonlyArray<CaptureObservation>,
): Map<string, FamilyCaptureBand> {
  const byFamily = new Map<string, CaptureObservation[]>();
  for (const o of observations) {
    const list = byFamily.get(o.actionFamily);
    if (list) list.push(o);
    else byFamily.set(o.actionFamily, [o]);
  }
  const out = new Map<string, FamilyCaptureBand>();
  for (const [family, obsList] of byFamily) {
    const shrunk = shrinkFamilyObservations(obsList).map((s) => s.capture).sort((a, b) => a - b);
    out.set(family, {
      actionFamily: family,
      p25: percentile(shrunk, 0.25),
      p75: percentile(shrunk, 0.75),
      n: shrunk.length,
    });
  }
  return out;
}

export type CaptureBlendResult = {
  low: number;
  high: number;
  n: number;
  /** true once the band is anything other than the pure static 25/75 fallback (n >= MIN_SAMPLES) -
   *  the caller uses this to decide whether the prose should name the empirical history. */
  isEmpirical: boolean;
  /** true only once the band is FULLY empirical (n >= FULL_EMPIRICAL_SAMPLES) - no static blend
   *  left in the number at all. Informational; prose can read fine off `isEmpirical` alone. */
  isFullyEmpirical: boolean;
};

/**
 * Step 3: blend the static 25/75 band toward a family's empirical band as its sample size grows.
 * Below MIN_SAMPLES -> the plain static band (byte-identical to pre-item-64 behavior). From
 * MIN_SAMPLES to FULL_EMPIRICAL_SAMPLES -> linear interpolation on the LOW and HIGH fractions
 * separately. At FULL_EMPIRICAL_SAMPLES+ -> the empirical band outright. `band` is undefined for a
 * family with no mature history yet (same as n = 0). PURE.
 */
export function blendCaptureBand(band: FamilyCaptureBand | undefined): CaptureBlendResult {
  const n = band?.n ?? 0;
  if (n < MIN_SAMPLES || !band) {
    return { low: STATIC_LOW, high: STATIC_HIGH, n, isEmpirical: false, isFullyEmpirical: false };
  }
  if (n >= FULL_EMPIRICAL_SAMPLES) {
    return { low: band.p25, high: band.p75, n, isEmpirical: true, isFullyEmpirical: true };
  }
  // Linear ramp from 0 (at MIN_SAMPLES) to 1 (at FULL_EMPIRICAL_SAMPLES).
  const t = (n - MIN_SAMPLES) / (FULL_EMPIRICAL_SAMPLES - MIN_SAMPLES);
  const low = STATIC_LOW + (band.p25 - STATIC_LOW) * t;
  const high = STATIC_HIGH + (band.p75 - STATIC_HIGH) * t;
  return { low, high, n, isEmpirical: true, isFullyEmpirical: false };
}

/** Convenience: distribution + blend in one call for a single family. PURE. */
export function captureBandForFamily(
  distribution: ReadonlyMap<string, FamilyCaptureBand>,
  actionFamily: string,
): CaptureBlendResult {
  return blendCaptureBand(distribution.get(actionFamily));
}
