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
/** E-39 D4: how long past the 28-day + grace horizon Beacon keeps FAIRLY retrying
 *  a recompute of a still-unsettled measurement whose GSC data has not yet
 *  arrived. Bounded so a page is never re-scanned forever, but long enough that a
 *  genuine GSC finalization delay still gets its verdict once the data lands. */
export const MAX_VERDICT_LAG_RETRY_DAYS = 28;

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
  // window + grace with NOTHING ever read → stale (no usable data). A record with a
  // real window reading is never "stale" here even when old (that reading exists);
  // E-39 D4's honest release of a STUCK measurement is handled by resolveVerdictLag
  // (recompute when data arrives; mark blocked_data + release when it does not) plus
  // the admit-with-caution model, which never manufactures a verdict from age.
  const anyWindowRan = (record.windows ?? []).some((w) => w.ran);
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS && !anyWindowRan) return "stale";
  if (record.verdict === "insufficient_data") return "inconclusive";
  return "measuring";
}

/**
 * E-39 D4 - verdict-lag repair, fail-closed and HONEST. For a record that has
 * reached the 28-day + grace horizon without a settled mature verdict, decide
 * what the measurement engine should do. PURE.
 *
 *   - "in_window"          still inside 28d + grace; ordinary measurement applies.
 *   - "settled"            already has a mature won/lost/inconclusive verdict.
 *   - "recompute"          horizon reached AND the 28-day GSC data is available
 *                          now -> recompute + persist the provisional verdict,
 *                          then settle + release the page/comparison reservations.
 *   - "release_unresolved" horizon reached but the required GSC data is NOT in ->
 *                          RELEASE the page for editing (outcomeStateOf already
 *                          reads "stale"), PRESERVE the unfinished measurement,
 *                          mark it honestly (blocked_data), NEVER fabricate a
 *                          verdict, and retry later while `retryEligible` (a
 *                          bounded, fair window).
 *
 * Wall-clock age never manufactures a verdict; missing data never permanently
 * locks the operator out.
 */
export type VerdictLagAction =
  | { kind: "in_window" }
  | { kind: "settled" }
  | { kind: "recompute" }
  | { kind: "release_unresolved"; markState: "blocked_data"; retryEligible: boolean };

export function resolveVerdictLag(
  record: ShippedChangeRecord,
  lastFinalizedDate: string | null,
  now: Date = new Date(),
): VerdictLagAction {
  if (record.verdict === "won" || record.verdict === "lost" || record.verdict === "inconclusive") {
    return { kind: "settled" };
  }
  const age = ageDaysOf(record, now);
  const horizon = MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS;
  if (age <= horizon) return { kind: "in_window" };

  // Past the horizon without a settled verdict. Bound the fair retry window FIRST:
  // past it, stop retrying entirely - never re-scan forever, never fabricate a
  // verdict; the record stays released for editing and honestly unresolved.
  if (age > horizon + MAX_VERDICT_LAG_RETRY_DAYS) {
    return { kind: "release_unresolved", markState: "blocked_data", retryEligible: false };
  }

  // Inside the bounded retry window: can the 28-day window run NOW (its required
  // GSC data has finally arrived)? If so, recompute + persist + settle + release.
  const checks = proofCheckDates(record.shippedAt);
  const required28 = addDays(checks[MAX_MEASURE_WINDOW_DAYS as ProofWindowDay], -1);
  const dataAvailable = lastFinalizedDate != null && lastFinalizedDate >= required28;
  if (dataAvailable) return { kind: "recompute" };

  // Data still unavailable: never invent a verdict from age. Release + preserve +
  // mark honestly (blocked_data), and stay eligible to retry as data arrives.
  return { kind: "release_unresolved", markState: "blocked_data", retryEligible: true };
}

/** Why a calendar-open proof window still shows no Search verdict: Google Search
 *  Console data lags wall-clock by a few days, so a 7-day window whose calendar date
 *  has passed often cannot be judged yet. PURE — explains the "waiting despite the
 *  date" confusion honestly. */
export type GscLagStatus = {
  /** The next un-measured window's day (7/14/28), or null when all have run. */
  nextWindowDay: ProofWindowDay | null;
  /** Today is on/after that window's calendar check date. */
  calendarWindowClosed: boolean;
  /** GSC has finalized data through the date this window needs. */
  gscWindowAvailable: boolean;
  /** How many more days of GSC data are needed before this window is judgeable. */
  daysBehind: number | null;
  /** The finalized GSC watermark (latest day Google has data for). */
  latestGscDate: string | null;
  /** The GSC date this window needs (checkOn − 1). */
  requiredGscDate: string | null;
  /** One honest line for the UI. */
  reasonCopy: string;
};

const dayStr = (now: Date): string => now.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Explain the GSC-lag state of the next un-measured window for one record. PURE. */
export function gscLagStatus(
  record: ShippedChangeRecord,
  lastFinalizedDate: string | null,
  now: Date = new Date(),
): GscLagStatus {
  const checks = proofCheckDates(record.shippedAt);
  const ranByDay = new Map<number, boolean>((record.windows ?? []).map((w) => [w.day, w.ran]));
  const today = dayStr(now);
  const nextDay = (PROOF_WINDOW_DAYS.find((d) => !(ranByDay.get(d) ?? false)) ?? null) as ProofWindowDay | null;

  if (nextDay == null) {
    return {
      nextWindowDay: null,
      calendarWindowClosed: true,
      gscWindowAvailable: true,
      daysBehind: null,
      latestGscDate: lastFinalizedDate,
      requiredGscDate: null,
      reasonCopy: "All proof windows have been measured.",
    };
  }

  const checkOn = checks[nextDay];
  const requiredGscDate = addDays(checkOn, -1);
  const calendarWindowClosed = today >= checkOn;
  const gscWindowAvailable = lastFinalizedDate != null && lastFinalizedDate >= requiredGscDate;
  const daysBehind = lastFinalizedDate ? Math.max(0, daysBetween(lastFinalizedDate, requiredGscDate)) : null;

  let reasonCopy: string;
  if (gscWindowAvailable) {
    reasonCopy = `Ready — recompute to read the ${nextDay}-day Search verdict.`;
  } else if (!calendarWindowClosed) {
    reasonCopy = `${nextDay}-day check opens ${checkOn}.`;
  } else if (lastFinalizedDate) {
    reasonCopy = `${nextDay}-day Search verdict needs Search Console data through ${requiredGscDate}. Google currently has data through ${lastFinalizedDate}.`;
  } else {
    reasonCopy = `${nextDay}-day Search verdict needs Search Console data through ${requiredGscDate}, but no Search Console data is available yet.`;
  }

  return { nextWindowDay: nextDay, calendarWindowClosed, gscWindowAvailable, daysBehind, latestGscDate: lastFinalizedDate, requiredGscDate, reasonCopy };
}

/**
 * Maturity-aware label for a settled verdict — UI ONLY (does NOT change the verdict
 * value, the learning math, or the proof gate). A 7-day read is an EARLY signal, not a
 * final call; 14-day is "strengthening"; only the 28-day read earns the plain
 * "Helped" / "Did not help". So a fresh 7d win never reads as final. PURE.
 *
 * `basisDay` = the day of the latest window that actually ran (7 | 14 | 28), or null.
 */
export function proofMaturityLabel(verdict: string, basisDay: number | null): string {
  const positive = verdict === "won";
  const negative = verdict === "lost";
  if (!positive && !negative) {
    return (
      ({ inconclusive: "No clear change", measuring: "Still measuring", insufficient_data: "Not enough data yet", stale: "Measurement expired" } as Record<string, string>)[verdict] ??
      verdict.replace(/_/g, " ")
    );
  }
  const d = basisDay ?? 28; // no ran-window info → treat as the final read
  if (d <= 7) return positive ? "Early positive signal" : "Early negative signal";
  if (d <= 14) return positive ? "Positive signal strengthening" : "Negative signal strengthening";
  return positive ? "Helped" : "Did not help"; // 28-day = the main verdict
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
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS) {
    // E-39 D4: past the ordinary horizon, still due ONLY when the verdict-lag
    // repair says a recompute can now settle a still-unresolved measurement whose
    // GSC data has finally arrived (bounded fair retry inside resolveVerdictLag).
    return resolveVerdictLag(record, lastFinalizedDate, now).kind === "recompute";
  }

  const checks = proofCheckDates(record.shippedAt);
  const ranByDay = new Map<number, boolean>((record.windows ?? []).map((w) => [w.day, w.ran]));
  return PROOF_WINDOW_DAYS.some((day) => {
    const checkOn = checks[day as ProofWindowDay];
    const canRunNow = lastFinalizedDate >= addDays(checkOn, -1);
    const alreadyRan = ranByDay.get(day) ?? false;
    return canRunNow && !alreadyRan; // a newly-runnable window
  });
}
