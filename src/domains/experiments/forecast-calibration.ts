/**
 * forecast-calibration (2026-07-02, master plan items 27/64) - PURE aggregation of the calibration
 * ledger (forecast-calibration-store.ts) into the portfolio-level "promise ledger" numbers: how
 * many forecasts landed inside their own range, whether Beacon runs hot or cold on average, one
 * plain sentence for the operator, and the bias-correction factor fed back into
 * pick-expectations.ts so future ranges shift toward reality.
 *
 * Item 64 additionally turns the same ledger into the PER-FAMILY empirical capture distribution
 * (empirical-capture.ts) - see `captureDistributionFromCalibrationRecords` below.
 *
 * No I/O. Pinned by forecast-calibration.test.ts.
 */

import {
  clampCorrectionFactor,
  CORRECTION_FACTOR_MIN,
  CORRECTION_FACTOR_MAX,
} from "./pick-expectations";
import {
  computeCaptureDistribution,
  type CaptureObservation,
  type FamilyCaptureBand,
} from "./empirical-capture";
import { canonicalMoveType } from "@/domains/learning/experiment-prior";
import type { CalibrationRecord } from "./forecast-calibration-store";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord } from "./daily-plan-types";

/** A settled pick worth calibrating: it carries a numeric forecast and it activated into a
 *  specific proof row (execution.items[pickId].proofId). */
export type ForecastedPick = {
  pickId: string;
  proofId: string;
  page: string;
  lever: string;
  forecastLow: number;
  forecastHigh: number;
};

/**
 * PURE: given the tenant's plans and a settled proof row's id, find the ONE plan pick that
 * activated into it and still carries a numeric forecast (item 28). Old picks planned before this
 * field existed, or picks whose forecast was too small to render (see forecastRange), have no
 * `expectations.forecastLow/forecastHigh` and are honestly excluded here - they stay
 * uncalibratable, which is correct (there was never a number to score them against).
 */
export function findForecastedPickForProofId(
  plans: DailyExperimentPlanRecord[],
  proofId: string,
): ForecastedPick | null {
  for (const plan of plans) {
    const items = plan.execution?.items ?? {};
    for (const [pickId, item] of Object.entries(items)) {
      if (item.proofId !== proofId) continue;
      const pick: PlannedExperimentRecord | undefined = plan.selected.find((p) => p.id === pickId);
      if (!pick) return null;
      const exp = pick.expectations;
      if (exp?.forecastLow == null || exp?.forecastHigh == null) return null;
      return {
        pickId,
        proofId,
        page: pick.url,
        lever: pick.lever,
        forecastLow: exp.forecastLow,
        forecastHigh: exp.forecastHigh,
      };
    }
  }
  return null;
}

/** Below this many settled records, the sample is too thin to trust an aggregate - the /proof
 *  card self-hides and the correction factor stays 1.0 (no correction). */
export const MIN_SETTLED_FOR_CALIBRATION = 3;

export type ForecastCalibrationSummary = {
  settledCount: number;
  insideCount: number;
  aboveCount: number;
  belowCount: number;
  /** Fraction (0-1) of settled forecasts that landed inside their own range. */
  insideRate: number;
  /** Sum of realized actuals across settled records. */
  totalActual: number;
  /** Sum of the forecast midpoints ((low+high)/2) across settled records - the "promised" total. */
  totalPromisedMidpoint: number;
  /** delivered / promised, from the midpoints. 1.0 = spot on; >1 = we undersold; <1 = we ran hot. */
  bias: number;
  /** Percent the forecasts ran hot (positive) or cold (negative), rounded to the nearest whole
   *  percent. hotColdPct > 0 means actuals came in BELOW the promised midpoint (forecasts too
   *  optimistic); < 0 means actuals beat the promise (forecasts too conservative). */
  hotColdPct: number;
  /** Plain-English one-liner for the /proof card and the weekly recap. Null when too thin
   *  (fewer than MIN_SETTLED_FOR_CALIBRATION settled records) - the surface self-hides. */
  sentence: string | null;
  /** The bias-correction factor to feed back into pick-expectations.ts, clamped to
   *  [CORRECTION_FACTOR_MIN, CORRECTION_FACTOR_MAX]. Defaults to 1.0 (no correction) when the
   *  sample is too thin to trust. */
  correctionFactor: number;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/**
 * Aggregate the calibration ledger into the promise-ledger summary. Pure function over the
 * records array - callers pass whatever slice they want summarized (e.g. all settled records, or
 * just last month's for a monthly reconciliation sentence).
 */
export function summarizeForecastCalibration(records: CalibrationRecord[]): ForecastCalibrationSummary {
  const settledCount = records.length;
  const insideCount = records.filter((r) => r.outcome === "inside").length;
  const aboveCount = records.filter((r) => r.outcome === "above").length;
  const belowCount = records.filter((r) => r.outcome === "below").length;
  const insideRate = settledCount > 0 ? insideCount / settledCount : 0;

  const totalActual = records.reduce((s, r) => s + r.actual, 0);
  const totalPromisedMidpoint = records.reduce((s, r) => s + (r.forecastLow + r.forecastHigh) / 2, 0);
  const bias = totalPromisedMidpoint > 0 ? totalActual / totalPromisedMidpoint : 1;
  const hotColdPct = totalPromisedMidpoint > 0 ? Math.round((1 - bias) * 100) : 0;

  const thin = settledCount < MIN_SETTLED_FOR_CALIBRATION;
  // The correction factor shifts future forecasts toward what the portfolio actually delivered:
  // if actuals ran 8% below the promise (bias 0.92), future forecasts should shrink by the same
  // ratio, so the correction factor IS the bias ratio, clamped for safety. A thin or zero-promise
  // sample never corrects (defaults to 1.0 fail-soft).
  const correctionFactor = thin || totalPromisedMidpoint <= 0 ? 1 : clampCorrectionFactor(bias);

  let sentence: string | null = null;
  if (!thin) {
    const month = monthLabel(records[records.length - 1]?.at ?? new Date().toISOString());
    const lowSum = Math.round(records.reduce((s, r) => s + r.forecastLow, 0));
    const highSum = Math.round(records.reduce((s, r) => s + r.forecastHigh, 0));
    const actualRounded = Math.round(totalActual);
    const runDirection =
      hotColdPct > 2 ? `Our forecasts ran about ${hotColdPct} percent hot, and we have tightened them.`
      : hotColdPct < -2 ? `Our forecasts ran about ${Math.abs(hotColdPct)} percent cold, and we have loosened them.`
      : "Our forecasts landed about where we said they would.";
    sentence = `In ${month} we told you to expect ${lowSum.toLocaleString()} to ${highSum.toLocaleString()} extra clicks a month from the changes you approved. The measured total came to ${actualRounded.toLocaleString()}. ${runDirection}`;
  }

  return {
    settledCount,
    insideCount,
    aboveCount,
    belowCount,
    insideRate,
    totalActual: round1(totalActual),
    totalPromisedMidpoint: round1(totalPromisedMidpoint),
    bias: round1(bias * 100) / 100,
    hotColdPct,
    sentence,
    correctionFactor,
  };
}

/**
 * Item 64: turn the same calibration ledger into per-actionFamily CaptureObservations, ready for
 * empirical-capture.ts's shrinkage + distribution. `actionFamily` is derived fresh from `lever` via
 * canonicalMoveType (NOT stored on the record - see forecast-calibration-store.ts's doc comment on
 * why). A record missing `gapClicksPerMonth` (predates the field, or the baseline had no positive
 * gap to target) is honestly excluded - there is no gap to divide by, so no capture fraction can be
 * computed for it; this is the SAME "honest gap in the history" posture the rest of the calibration
 * ledger already uses for pre-item-28 records. `windowImpressions` missing reads as 0 impressions
 * (empirical-capture.ts's shrinkage then pulls that observation fully toward its family mean - the
 * safe default when precision is unknown, never a fabricated high-confidence weight).
 */
export function captureObservationsFromCalibrationRecords(
  records: ReadonlyArray<CalibrationRecord>,
): CaptureObservation[] {
  const out: CaptureObservation[] = [];
  for (const r of records) {
    if (r.gapClicksPerMonth == null || r.gapClicksPerMonth <= 0) continue;
    out.push({
      actionFamily: canonicalMoveType(r.lever),
      capture: r.actual / r.gapClicksPerMonth,
      impressions: r.windowImpressions ?? 0,
    });
  }
  return out;
}

/** Item 64: the full ledger -> per-family empirical capture distribution, in one call. PURE. */
export function captureDistributionFromCalibrationRecords(
  records: ReadonlyArray<CalibrationRecord>,
): Map<string, FamilyCaptureBand> {
  return computeCaptureDistribution(captureObservationsFromCalibrationRecords(records));
}

export { CORRECTION_FACTOR_MIN, CORRECTION_FACTOR_MAX };
