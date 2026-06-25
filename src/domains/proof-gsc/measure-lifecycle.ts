/**
 * measure-lifecycle (2026-06-25, Sprint 3 / P11) — PURE lifecycle math for applied
 * Moves: the operator-facing outcome STATE, and whether a record is DUE for a
 * fresh measurement. No I/O (lives apart from auto-measure-pass's GSC reads, the
 * way measure.ts lives apart from run-measurement.ts). Pinned by
 * measure-lifecycle.test.ts.
 */

import { addDays, proofCheckDates, PROOF_WINDOW_DAYS, type ProofWindowDay } from "./measure";
import type { ShippedChangeRecord } from "./shipped-change-store";

const MAX_MEASURE_WINDOW_DAYS = Math.max(...PROOF_WINDOW_DAYS);
/** Grace after the last window before a still-"measuring" record is "stale". */
export const STALE_GRACE_DAYS = 7;

/** The operator-facing lifecycle state of an applied Move (deliverable 1). */
export type OutcomeState = "measuring" | "win" | "loss" | "inconclusive" | "stale";

function ageDaysOf(record: ShippedChangeRecord, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(record.shippedAt)) / 86_400_000);
}

/** Map the GSC verdict + age onto the spec's lifecycle states. PURE. */
export function outcomeStateOf(record: ShippedChangeRecord, now: Date = new Date()): OutcomeState {
  if (record.verdict === "won") return "win";
  if (record.verdict === "lost") return "loss";
  if (record.verdict === "inconclusive") return "inconclusive";
  // "measuring" / "insufficient_data": in flight unless it aged out past the last
  // window + grace with nothing settled → stale (no usable data).
  const anyWindowRan = (record.windows ?? []).some((w) => w.ran);
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS && !anyWindowRan) return "stale";
  if (record.verdict === "insufficient_data") return "inconclusive";
  return "measuring";
}

/**
 * Is this record worth re-measuring now? PURE. True when a proof window can
 * transition ran:false → true since the last measure (the GSC finalized
 * watermark has advanced past a window's last day). Settled records still
 * re-check inside the 28d window (a 7d "won" can flip at 28d); once fully aged
 * out they're done.
 */
export function isDueForMeasure(
  record: ShippedChangeRecord,
  lastFinalizedDate: string | null,
  now: Date = new Date(),
): boolean {
  if (lastFinalizedDate == null) return false; // no finalized GSC data → can't measure
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS) return false; // aged out

  const checks = proofCheckDates(record.shippedAt);
  const ranByDay = new Map<number, boolean>((record.windows ?? []).map((w) => [w.day, w.ran]));
  return PROOF_WINDOW_DAYS.some((day) => {
    const checkOn = checks[day as ProofWindowDay];
    const canRunNow = lastFinalizedDate >= addDays(checkOn, -1);
    const alreadyRan = ranByDay.get(day) ?? false;
    return canRunNow && !alreadyRan; // a newly-runnable window
  });
}
