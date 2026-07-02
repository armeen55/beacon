/**
 * forecast-receipts (2026-07-02, master plan item 42) - PURE line builders that grade a settled
 * forecast against its recorded actual and roll many of them into a running hit-rate line. Reads
 * ONLY the already-written calibration record (forecast-calibration-store.ts); it never
 * recomputes an actual or re-derives an outcome - the record IS the single source of truth,
 * exactly as run-measurement.ts wrote it at the day-28 settle.
 *
 * No I/O. Pinned by forecast-receipts.test.ts.
 */

import type { CalibrationRecord } from "./forecast-calibration-store";
import { MIN_SETTLED_FOR_CALIBRATION } from "./forecast-calibration";

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Trims a whole-number-looking float to an integer string, otherwise keeps one decimal. */
function fmt(n: number): string {
  const r = round1(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Per-row receipt (item 42): "We forecast 8 to 20 extra clicks a month; we got 14. Inside the
 * range." Phrasing branches on the record's own persisted outcome - never re-derived here - so
 * this line can never disagree with the aggregate card or the ledger the record came from.
 */
export function buildForecastReceiptLine(record: CalibrationRecord): string {
  const low = fmt(record.forecastLow);
  const high = fmt(record.forecastHigh);
  const actual = fmt(record.actual);
  const promise = `We forecast ${low} to ${high} extra clicks a month; we got ${actual}.`;
  if (record.outcome === "above") return `${promise} Better than promised.`;
  if (record.outcome === "below") return `${promise} Short of the range, noted and feeding our forecast tuning.`;
  return `${promise} Inside the range.`;
}

/**
 * Running hit-rate line (item 42) for ProofSummarySection: "Our forecasts have landed inside
 * their promised range 9 of 12 times." Null below MIN_SETTLED_FOR_CALIBRATION settled records -
 * the SAME threshold the aggregate card (forecast-calibration.ts) already uses, so the two
 * surfaces self-hide and reappear together and can never contradict each other.
 */
export function buildForecastHitRateLine(records: CalibrationRecord[]): string | null {
  if (records.length < MIN_SETTLED_FOR_CALIBRATION) return null;
  const insideCount = records.filter((r) => r.outcome === "inside").length;
  return `Our forecasts have landed inside their promised range ${insideCount} of ${records.length} times.`;
}

/**
 * Presentation gate shared by the Wins/Learning band rows (proof/page.tsx), mirroring
 * shouldShowChangeDollarLine's pattern: the per-row forecast receipt only ever shows on a MATURE
 * (settled) row that has a matching calibration record. A measuring/in-flight row is never
 * graded, even if a stray record somehow existed for it. Pulled out as a pure predicate so this
 * gate is unit-testable without a full component render.
 */
export function shouldShowForecastReceipt(args: {
  mature: boolean;
  calibration: CalibrationRecord | null | undefined;
}): boolean {
  return args.mature === true && args.calibration != null;
}
