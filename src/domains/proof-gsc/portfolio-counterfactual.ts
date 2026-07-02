/**
 * Portfolio counterfactual sentence (BEACON_500 item 41, 2026-07-02).
 *
 * Aggregates across the WHOLE proof ledger, not one change: on average, how
 * did the pages Beacon touched move versus the comparison pages the
 * diff-in-diff already picked for each of them, over the same measured
 * windows? "Pages I changed are up about 12 percent; similar pages I left
 * alone are down about 3 percent over the same weeks."
 *
 * PURE. No I/O. Reuses the SAME percent-lift decomposition
 * pooled-verdict-runner.ts's percentLiftOf already established as this
 * product's one honest way to turn a ProofWindowResult into a percent:
 *   treatedPct = treatedDelta / scaledBaseline
 *   controlPct = controlDelta / scaledBaseline
 * (both against the SAME denominator - the treated page's own pre-ship
 * baseline, pro-rated to the basis window length - because adjustedLift is
 * defined as treatedDelta minus controlDelta, so this decomposition is exact
 * and the two percentages are always mutually consistent with the per-page
 * adjustedLift already shown elsewhere).
 *
 * ELIGIBILITY (mirrors src/domains/learning/load-experiment-outcomes.ts
 * EXACTLY, per the item's instruction to respect the same gates):
 *   - Maturity must resolve to "mature_result" (deriveMeasurementMaturity) -
 *     a 7/14-day early read never contributes to a portfolio-level claim.
 *   - Excluded when the record's measurement window overlapped a confirmed
 *     Google update or a detected sitewide shock (algorithm-weather).
 *   - Excluded when the record's comparison pages were a fallback match
 *     (controlMatchWeak) - the parallel-trends veto.
 *   - Excluded when the basis window used zero usable controls (no
 *     comparison-page percent to average) or the row's own pre-ship
 *     baseline was zero (no percent to compute, avoids divide-by-zero).
 *
 * HONEST MINIMUM: fewer than MIN_MATURE_ROWS qualifying rows -> null
 * (silence). A portfolio claim built from 1-2 pages is not a portfolio
 * claim; it is cherry-picking, so this module refuses to speak until there
 * is a real sample.
 *
 * Deterministic. No em dash or en dash anywhere in generated copy.
 *
 * Pinned by tests/domains/proof-gsc/portfolio-counterfactual.test.ts.
 */

export const MIN_MATURE_ROWS_FOR_COUNTERFACTUAL = 3;

/** One eligible row's already-computed basis-window numbers. The caller
 *  (a loader in this domain) is responsible for the maturity/weather/weak-
 *  comparison gate BEFORE building this - see the module doc above for the
 *  exact gate to mirror (load-experiment-outcomes.ts). */
export type CounterfactualRow = {
  id: string;
  /** Treated page: basis-window click delta (ProofWindowResult.treatedDelta). */
  treatedDelta: number;
  /** Mean control-page click delta over the same basis window
   *  (ProofWindowResult.controlDelta). */
  controlDelta: number;
  /** The record's own pre-ship baseline clicks, pro-rated to the basis
   *  window length (the SAME scaledBaseline pooled-verdict-runner.ts and
   *  summarizeVerdict's clicksFloorBaseline both use). Must be > 0 for the
   *  row to contribute a percent - the caller filters non-positive values
   *  out before calling, or this module drops them itself (see below). */
  scaledBaseline: number;
  /** How many control pages had usable data in the basis window. A row with
   *  zero is EXCLUDED - "similar pages" requires at least one to exist. */
  controlsUsed: number;
};

export type PortfolioCounterfactual = {
  /** How many rows actually qualified and contributed a percent. */
  n: number;
  /** Mean treated-page percent change across qualifying rows (e.g. 0.12 = +12%). */
  treatedPct: number;
  /** Mean comparison-page percent change across the same rows. */
  controlPct: number;
  /** treatedPct minus controlPct - the portfolio-level adjusted lift. */
  spreadPct: number;
  /** One plain first-person sentence, no em/en dashes. Null-returning caller
   *  (computePortfolioCounterfactual) never returns this type below the
   *  honest minimum - see that function's doc. */
  sentence: string;
};

function pctStr(v: number): string {
  return `${Math.round(Math.abs(v) * 100)} percent`;
}

function directionWord(v: number): "up" | "down" | "flat" {
  const rounded = Math.round(v * 100);
  if (rounded > 0) return "up";
  if (rounded < 0) return "down";
  return "flat";
}

/**
 * Filter to rows that can honestly contribute a percent (positive baseline,
 * at least one control), then average. PURE - no eligibility/maturity
 * filtering happens here; that is the caller's job (see module doc), so this
 * function stays a straightforward numeric aggregator that is easy to pin
 * with synthetic rows in tests.
 */
export function computePortfolioCounterfactual(
  rows: ReadonlyArray<CounterfactualRow>,
  minRows: number = MIN_MATURE_ROWS_FOR_COUNTERFACTUAL,
): PortfolioCounterfactual | null {
  const usable = rows.filter(
    (r) =>
      Number.isFinite(r.scaledBaseline) &&
      r.scaledBaseline > 0 &&
      r.controlsUsed > 0 &&
      Number.isFinite(r.treatedDelta) &&
      Number.isFinite(r.controlDelta),
  );
  if (usable.length < minRows) return null;

  const treatedPcts = usable.map((r) => r.treatedDelta / r.scaledBaseline);
  const controlPcts = usable.map((r) => r.controlDelta / r.scaledBaseline);
  const treatedPct = treatedPcts.reduce((a, b) => a + b, 0) / treatedPcts.length;
  const controlPct = controlPcts.reduce((a, b) => a + b, 0) / controlPcts.length;
  const spreadPct = treatedPct - controlPct;

  return {
    n: usable.length,
    treatedPct,
    controlPct,
    spreadPct,
    sentence: buildSentence(usable.length, treatedPct, controlPct),
  };
}

function buildSentence(n: number, treatedPct: number, controlPct: number): string {
  const treatedDir = directionWord(treatedPct);
  const controlDir = directionWord(controlPct);

  const treatedClause =
    treatedDir === "flat"
      ? "held about flat"
      : `are ${treatedDir} about ${pctStr(treatedPct)}`;
  const controlClause =
    controlDir === "flat"
      ? "held about flat"
      : `are ${controlDir} about ${pctStr(controlPct)}`;

  return `The ${n} pages I changed and fully measured ${treatedClause}; similar pages I left alone ${controlClause} over the same weeks.`;
}
