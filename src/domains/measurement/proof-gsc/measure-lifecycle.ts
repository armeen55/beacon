/**
 * measure-lifecycle (2026-06-25, Sprint 3 / P11) — PURE lifecycle math for applied
 * Moves: the operator-facing outcome STATE, and whether a record is DUE for a
 * fresh measurement. No I/O (lives apart from auto-measure-pass's GSC reads, the
 * way measure.ts lives apart from run-measurement.ts). Pinned by
 * measure-lifecycle.test.ts.
 */

import { addDays } from "./kernel";
import { PROOF_WINDOW_DAYS, type ProofWindowDay } from "./types";
import type { ShippedChangeRecord } from "./shipped-change-store";

/** The check-in dates after the stamp, one per checkpoint. Pure (UTC). */
function proofCheckDates(anchorIso: string): Record<ProofWindowDay, string> {
  return {
    7: addDays(anchorIso, 7), 14: addDays(anchorIso, 14),
    28: addDays(anchorIso, 28), 56: addDays(anchorIso, FOLLOW_UP_WINDOW_DAY),
  };
}

/**
 * THE STAMP every checkpoint counts from: when the operator marked the change done. A
 * record written before there was a stamp counts from its ship date exactly as it always
 * did, so no historical row moves. Pure.
 */
function anchorOf(record: ShippedChangeRecord): string {
  return record.implementedAt ?? record.shippedAt;
}

const MAX_MEASURE_WINDOW_DAYS = Math.max(...PROOF_WINDOW_DAYS);
/** Grace after the last window before a still-"measuring" record is "stale". */
const STALE_GRACE_DAYS = 7;
/** E-39 D4: how long past the 28-day + grace horizon Beacon keeps FAIRLY retrying
 *  a recompute of a still-unsettled measurement whose GSC data has not yet
 *  arrived. Bounded so a page is never re-scanned forever, but long enough that a
 *  genuine GSC finalization delay still gets its verdict once the data lands. */
const MAX_VERDICT_LAG_RETRY_DAYS = 28;

/** THE CONDITIONAL FOURTH CHECKPOINT (Product Truth). A day-56 read runs ONLY when the
 *  day-28 read did not settle, or the change was a dangerous one. A clean 28-day read
 *  CLOSES measurement and no 56-day read is taken. */
export const FOLLOW_UP_WINDOW_DAY = 56;

/** The component kinds that move where a page LIVES or whether it is findable at all.
 *  Spelled out rather than imported: Measurement must not import Decision, and this closed
 *  list is the one in the Decision contract (canonical, redirect, noindex, consolidation). */
const DANGEROUS_COMPONENT_KINDS: ReadonlySet<string> = new Set([
  "canonical", "redirect", "noindex", "consolidation",
]);

/** A DANGEROUS COMPONENT IS EITHER KIND OR GRADE. Decision flags a component dangerous on the
 *  closed kind list OR on its own `risk` grade, so measurement asking only about the kind list
 *  missed every component a proposal graded dangerous under some other name, and those changes
 *  silently lost the fourth checkpoint that exists precisely for them. Same two tests, one
 *  order, on both sides of the boundary. Pure. */
function isDangerousComponent(c: { kind: string; risk?: string | null }): boolean {
  return c.risk === "dangerous" || DANGEROUS_COMPONENT_KINDS.has(c.kind);
}

/** The operator-facing lifecycle state of an applied Move (deliverable 1). */
export type OutcomeState = "measuring" | "win" | "loss" | "inconclusive" | "stale";

function ageDaysOf(record: ShippedChangeRecord, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(anchorOf(record))) / 86_400_000);
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
 *                          NEVER fabricate a verdict.
 *
 * Wall-clock age never manufactures a verdict; missing data never permanently
 * locks the operator out.
 *
 * Review P2 (E-39 D4 wiring): this used to also return `markState: "blocked_data"`
 * and `retryEligible: boolean` on the "release_unresolved" branch, but nothing
 * ever read either field - the ONLY consumer of this function (isDueForMeasure,
 * below) reads `.kind === "recompute"` and nothing else. The honest outcomes
 * those fields described are both already implemented by OTHER mechanisms: the
 * "blocked_data" mark is deriveMeasurementMaturity's own independent derivation
 * (measurement-maturity.ts, computed straight from the record's windows + the
 * GSC watermark, no dependency on this function), and "release" is already
 * outcomeStateOf's "stale" state once a never-measured record ages past the
 * horizon. The one real gap - what an operator reads once the fair retry
 * window itself is exhausted - is now handled directly inside
 * deriveMeasurementMaturity with the SAME MAX_VERDICT_LAG_RETRY_DAYS bound used
 * here (a distinct "unresolved" maturity + honest terminal copy), so it no
 * longer needs a boolean threaded through this type. Narrowed to the shape
 * that is actually consumed; dead fields removed.
 */
type VerdictLagAction =
  | { kind: "in_window" }
  | { kind: "settled" }
  | { kind: "recompute" }
  | { kind: "release_unresolved" };

function resolveVerdictLag(
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
    return { kind: "release_unresolved" };
  }

  // Inside the bounded retry window: can the 28-day window run NOW (its required
  // GSC data has finally arrived)? If so, recompute + persist + settle + release.
  const checks = proofCheckDates(anchorOf(record));
  const required28 = addDays(checks[MAX_MEASURE_WINDOW_DAYS as ProofWindowDay], -1);
  const dataAvailable = lastFinalizedDate != null && lastFinalizedDate >= required28;
  if (dataAvailable) return { kind: "recompute" };

  // Data still unavailable: never invent a verdict from age. Release + preserve,
  // and stay eligible to retry as data arrives (deriveMeasurementMaturity keeps
  // reading this record as "blocked_data" until the same bound above is reached).
  return { kind: "release_unresolved" };
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
  const checks = proofCheckDates(anchorOf(record));
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
    reasonCopy = `Ready: recompute to read the ${nextDay}-day Search verdict.`;
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
 * Maturity-aware label for a record's stored verdict. PURE. One home (Ask's fact
 * assembly and the page dossier both import this) so the same record can never
 * carry two different labels on two surfaces.
 */
export function maturityLabelForRecord(
  record: { verdict: string },
  basisDay: number | null = null,
): string {
  return proofMaturityLabel(record.verdict, basisDay);
}

/**
 * THE CONDITIONAL DAY-56 READ. Product Truth: 7, 14 and 28 always; 56 only when the
 * 28-day read was confounded, insufficient or unclear, or when the change was a dangerous
 * one (it moves the page or hides it, and those take longer to show their real cost).
 * A CLEAN 28-day read closes measurement, and no day-56 read is taken at all. PURE.
 *
 * `runs`   the change earned a fourth checkpoint (and has not had it yet).
 * `due`    it earned it AND Google has finalized the days that read needs.
 * `reason` what earned it, in the vocabulary Product Truth uses, or null.
 */
export function day56Followup(
  record: ShippedChangeRecord,
  lastFinalizedDate: string | null,
  now: Date = new Date(),
): {
  runs: boolean;
  due: boolean;
  reason: "measuring_28" | "insufficient_28" | "unclear_28" | "dangerous_change" | null;
  checkOn: string;
} {
  const checkOn = addDays(anchorOf(record), FOLLOW_UP_WINDOW_DAY);
  const windows = record.windows ?? [];
  const ran28 = windows.some((w) => w.day === 28 && w.ran);
  const ran56 = windows.some((w) => w.day === FOLLOW_UP_WINDOW_DAY && w.ran);
  // A 28-day read that settled on won or lost is the primary directional read, and it is
  // the whole answer. Anything else after a 28-day window that HAS run is unsettled.
  const settled28 = record.verdict === "won" || record.verdict === "lost";
  const dangerous = (record.componentsApplied ?? []).some(isDangerousComponent);
  // A stored "measuring" verdict at a run 28-day window means exactly one thing the record can
  // prove: that read did not settle. WHY it did not (an overlapping change, or Google still
  // catching up) is the live kernel's call, not this record's, so the reason says the true thing
  // rather than naming a cause nobody here checked.
  const reason = !ran28 ? null
    : record.verdict === "insufficient_data" ? "insufficient_28" as const
      : record.verdict === "inconclusive" ? "unclear_28" as const
        : !settled28 ? "measuring_28" as const
          : dangerous ? "dangerous_change" as const : null;
  const runs = ran28 && !ran56 && reason != null;
  const due = runs
    && lastFinalizedDate != null
    && lastFinalizedDate >= addDays(checkOn, -1)
    && now.toISOString().slice(0, 10) >= checkOn;
  return { runs, due, reason, checkOn };
}

/** The answers that let measurement begin: I saw the change on the page, I saw part of it, or the
 *  operator told me on purpose that it is live. Product Truth: "Start measurement only after
 *  implementation is verified or explicitly operator-confirmed." */
const MEASURABLE_VERIFICATION: ReadonlySet<string> = new Set(["verified", "partially_verified", "operator_confirmed"]);

/**
 * Is this record worth re-measuring now? PURE. True when a proof window can
 * transition ran:false → true since the last measure (the GSC finalized
 * watermark has advanced past a window's last day). Settled records still
 * re-check inside the 28d window (a 7d "won" can flip at 28d); once fully aged
 * out they're done.
 *
 * THE GATE COMES FIRST. A Shipment whose change I have not found on the live page is not a
 * measurement waiting to run, it is a claim: measuring it would attribute whatever search does
 * next to work that may never have landed. So a record carrying the stamp must also carry an
 * answer that says the change is there. A pre-Shipment record has no stamp and no answer to wait
 * for, and stays measurable exactly as it always was.
 */
export function isDueForMeasure(
  record: ShippedChangeRecord,
  lastFinalizedDate: string | null,
  now: Date = new Date(),
): boolean {
  if (record.implementedAt != null && !MEASURABLE_VERIFICATION.has(record.verification?.status ?? "")) return false;
  if (lastFinalizedDate == null) return false; // no finalized GSC data → can't measure
  // The conditional day-56 read comes AFTER the ordinary horizon, so it is asked first.
  if (day56Followup(record, lastFinalizedDate, now).due) return true;
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS) {
    // E-39 D4: past the ordinary horizon, still due ONLY when the verdict-lag
    // repair says a recompute can now settle a still-unresolved measurement whose
    // GSC data has finally arrived (bounded fair retry inside resolveVerdictLag).
    return resolveVerdictLag(record, lastFinalizedDate, now).kind === "recompute";
  }

  const checks = proofCheckDates(anchorOf(record));
  const ranByDay = new Map<number, boolean>((record.windows ?? []).map((w) => [w.day, w.ran]));
  return PROOF_WINDOW_DAYS.some((day) => {
    const checkOn = checks[day as ProofWindowDay];
    const canRunNow = lastFinalizedDate >= addDays(checkOn, -1);
    const alreadyRan = ranByDay.get(day) ?? false;
    return canRunNow && !alreadyRan; // a newly-runnable window
  });
}
