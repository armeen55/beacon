/**
 * Shadow portfolio drift comparison (BEACON_500 item 65, 2026-07-02).
 *
 * Beside the item-41 portfolio counterfactual ("pages we changed vs the diff-in-diff's own
 * comparison pages for those SAME changes"), this module answers a related but DISTINCT
 * question: how did the pages Beacon actually shipped move versus the pages that were just as
 * eligible, scored just as well, but got SKIPPED tonight because a diversification cap filled up
 * first? Those skipped pages never got a treatment - their GSC drift over the following weeks is
 * a second, independent counterfactual, this one about the PICKING process itself rather than
 * about any single change's diff-in-diff.
 *
 * PURE. No I/O. The caller (a loader in this domain) is responsible for:
 *   - resolving each shadow candidate's raw click drift over a window matched in LENGTH to the
 *     selected cohort's own measured basis window (reusing gsc-window.ts);
 *   - the same honest-minimum discipline portfolio-counterfactual.ts already established.
 *
 * Deterministic. No em dash or en dash anywhere in generated copy.
 *
 * Pinned by tests/domains/proof-gsc/shadow-portfolio-drift.test.ts.
 */

/** Minimum members BOTH cohorts must clear before the comparison speaks (item 65's own text:
 *  "when both cohorts have >= 5 members"). Below this, one or two skipped pages would not be a
 *  portfolio claim - it would be cherry-picking. */
export const MIN_COHORT_SIZE = 5;

/** Minimum measured window length (days) for a row to count. A read shorter than 14 days can't
 *  honestly represent "the same weeks" the sentence claims. */
export const MIN_WINDOW_DAYS = 14;

/** One selected (treated + shipped) pick's ALREADY-ADJUSTED lift, expressed as a percent of its
 *  own pre-ship baseline - i.e. the SAME treatedPct-minus-controlPct decomposition
 *  portfolio-counterfactual.ts uses for the item-41 line, at the row level. */
export type SelectedPickDriftRow = {
  id: string;
  /** (treatedDelta - controlDelta) / scaledBaseline, already diff-in-diff adjusted. */
  adjustedPct: number;
  /** The basis window's length in days (7/14/28), so the shadow side can be matched. */
  windowDays: number;
};

/** One shadow (rejected-but-eligible, never shipped) candidate's RAW click drift - no
 *  diff-in-diff adjustment, because nothing was shipped to it; it is its own counterfactual. */
export type ShadowDriftRow = {
  id: string;
  /** Raw click delta over the matched window (post minus pre), unadjusted. */
  rawDelta: number;
  /** The candidate's own click baseline over an equal-length window before capture, pro-rated
   *  the same way portfolio-counterfactual.ts scales a treated page's baseline. Must be > 0 to
   *  contribute a percent. */
  scaledBaseline: number;
  /** The measured window's length in days, so a too-short read is honestly excluded. */
  windowDays: number;
};

export type ShadowPortfolioComparison = {
  selectedN: number;
  shadowN: number;
  /** Mean adjusted percent lift across qualifying selected picks. */
  selectedPct: number;
  /** Mean raw percent drift across qualifying shadow candidates. */
  shadowPct: number;
  /** selectedPct minus shadowPct. */
  spreadPct: number;
  sentence: string;
};

function usableSelected(rows: ReadonlyArray<SelectedPickDriftRow>): SelectedPickDriftRow[] {
  return rows.filter((r) => Number.isFinite(r.adjustedPct) && Number.isFinite(r.windowDays) && r.windowDays >= MIN_WINDOW_DAYS);
}

function usableShadow(rows: ReadonlyArray<ShadowDriftRow>): ShadowDriftRow[] {
  return rows.filter(
    (r) =>
      Number.isFinite(r.rawDelta) &&
      Number.isFinite(r.scaledBaseline) &&
      r.scaledBaseline > 0 &&
      Number.isFinite(r.windowDays) &&
      r.windowDays >= MIN_WINDOW_DAYS,
  );
}

function pctStr(v: number): string {
  return `${Math.round(Math.abs(v) * 100)} percent`;
}

function directionWord(v: number): "up" | "down" | "flat" {
  const rounded = Math.round(v * 100);
  if (rounded > 0) return "up";
  if (rounded < 0) return "down";
  return "flat";
}

function buildSentence(selectedN: number, shadowN: number, selectedPct: number, shadowPct: number): string {
  const selDir = directionWord(selectedPct);
  const shadowDir = directionWord(shadowPct);
  const selClause = selDir === "flat" ? "held about flat" : `moved ${selDir} about ${pctStr(selectedPct)}`;
  const shadowClause = shadowDir === "flat" ? "held about flat" : `moved ${shadowDir} about ${pctStr(shadowPct)}`;
  return `The ${selectedN} pages I changed ${selClause}; the ${shadowN} similar pages I considered but skipped ${shadowClause} over the same weeks.`;
}

/**
 * Compare the selected (shipped) cohort's adjusted lift against the shadow (skipped) cohort's raw
 * drift over matching windows. Returns null (honest silence) below MIN_COHORT_SIZE on EITHER
 * side - a one-sided or thin comparison is not a portfolio claim.
 */
export function compareShadowPortfolio(
  selected: ReadonlyArray<SelectedPickDriftRow>,
  shadow: ReadonlyArray<ShadowDriftRow>,
  minCohortSize: number = MIN_COHORT_SIZE,
): ShadowPortfolioComparison | null {
  const selUsable = usableSelected(selected);
  const shadowUsable = usableShadow(shadow);
  if (selUsable.length < minCohortSize || shadowUsable.length < minCohortSize) return null;

  const selectedPct = selUsable.reduce((s, r) => s + r.adjustedPct, 0) / selUsable.length;
  const shadowPct = shadowUsable.reduce((s, r) => s + r.rawDelta / r.scaledBaseline, 0) / shadowUsable.length;
  const spreadPct = selectedPct - shadowPct;

  return {
    selectedN: selUsable.length,
    shadowN: shadowUsable.length,
    selectedPct,
    shadowPct,
    spreadPct,
    sentence: buildSentence(selUsable.length, shadowUsable.length, selectedPct, shadowPct),
  };
}

// ── Item 65 part 4: calibration feed (drift vs the forecast a shadow pick would have carried) ──

/** One shadow candidate's measured drift alongside the numeric forecast range it WOULD have
 *  carried had it been selected (item 27/28's forecastLow/High, clicks-per-month). Absent
 *  forecast rows are excluded by the caller before this - see buildShadowCalibrationFeed. */
export type ShadowForecastDriftRow = {
  id: string;
  /** Raw click delta over the matched window. */
  rawDelta: number;
  windowDays: number;
  forecastLow: number;
  forecastHigh: number;
};

export type ShadowCalibrationFeed = {
  n: number;
  /** Mean of each row's rawDelta, pro-rated to clicks-per-month, so it is directly comparable to
   *  the forecast midpoint the row would have carried. */
  avgActualPerMonth: number;
  /** Mean of each row's forecast midpoint ((low+high)/2). */
  avgForecastMidpointPerMonth: number;
  /** avgActualPerMonth / avgForecastMidpointPerMonth. 1.0 = a skipped pick would have drifted
   *  exactly as much on its own as a selected pick was forecast to gain from being changed -
   *  i.e. the forecast is really measuring "the page's natural trend," not the treatment. A
   *  correction consumer (future work, NOT wired here) would want this near 0: a skipped page's
   *  organic drift should not resemble the promised lift from a real change. */
  driftToForecastRatio: number;
};

/** Below this many rows, the ratio is too noisy to expose anywhere - matches the portfolio
 *  comparison's own honest-minimum posture, using the SAME cohort-size floor. */
export const MIN_ROWS_FOR_CALIBRATION_FEED = MIN_COHORT_SIZE;

/**
 * PURE aggregation for the drift-vs-forecast calibration feed. Deliberately returns a plain data
 * object, not a correction factor - wiring this into pick-expectations.ts's bias correction is
 * explicitly OUT of scope for this module (see the item-65 build note: pick-expectations.ts may
 * be under concurrent edit from another item this cycle). A future caller can fold
 * driftToForecastRatio into its own correction however it sees fit.
 */
export function buildShadowCalibrationFeed(
  rows: ReadonlyArray<ShadowForecastDriftRow>,
  minRows: number = MIN_ROWS_FOR_CALIBRATION_FEED,
): ShadowCalibrationFeed | null {
  const usable = rows.filter(
    (r) =>
      Number.isFinite(r.rawDelta) &&
      Number.isFinite(r.windowDays) &&
      r.windowDays >= MIN_WINDOW_DAYS &&
      Number.isFinite(r.forecastLow) &&
      Number.isFinite(r.forecastHigh) &&
      r.forecastLow >= 0 &&
      r.forecastHigh >= r.forecastLow,
  );
  if (usable.length < minRows) return null;

  const perMonth = (delta: number, windowDays: number) => (delta / windowDays) * 30;
  const avgActualPerMonth = usable.reduce((s, r) => s + perMonth(r.rawDelta, r.windowDays), 0) / usable.length;
  const avgForecastMidpointPerMonth = usable.reduce((s, r) => s + (r.forecastLow + r.forecastHigh) / 2, 0) / usable.length;
  const driftToForecastRatio = avgForecastMidpointPerMonth > 0 ? avgActualPerMonth / avgForecastMidpointPerMonth : 0;

  return {
    n: usable.length,
    avgActualPerMonth,
    avgForecastMidpointPerMonth,
    driftToForecastRatio,
  };
}
