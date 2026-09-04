/** measure-lifecycle (2026-06-25, Sprint 3 / P11): PURE lifecycle math for applied Moves: the operator-facing outcome STATE, and whether a
 *  record is DUE for a fresh measurement. No I/O (lives apart from auto-measure-pass's GSC reads, the way measure.ts lives apart from
 *  run-measurement.ts). Pinned by measure-lifecycle.test.ts. */

import { reportingDay } from "@/lib/reporting-day";
import { addDays } from "./kernel";
import { PROOF_WINDOW_DAYS } from "./types";
import type { ShippedChangeRecord } from "./shipped-change-store";

/** THE DAY ZERO EVERY CHECKPOINT COUNTS FROM, and whether the clock has started at all. The stamp is the day the operator marked the change
 *  done, and a record written before there was a stamp counts from its ship date exactly as it always did, so no historical row moves. BUT
 *  GOOGLE STARTS THE CLOCK, NOT THE PRESS: roughly two in five edited pages are not recrawled inside a week, so a day 3 to 7 reading taken
 *  before the recrawl averages the changed page with the unchanged one Google is still serving and dilutes every early signal. `lastCrawlAt`
 *  is what Search Console reports for this page: at or after the stamp it IS day zero, and before it the change is not indexed yet, so the
 *  row is `awaiting` and no early signal is computed for it. Absent (never asked, or no inspection grant) is the ship clock, unchanged. A
 *  stamp older than the crawl clock itself is not one and never reaches here: the store's own read seam decodes it as absent (CRAWL_STAMP_EPOCH,
 *  shipped-change-store.ts), because the column carried a different meaning on 17 rows before this existed. Pure. */
export function crawlClock(record: ShippedChangeRecord): { anchor: string; awaiting: boolean } {
  const stamp = record.implementedAt ?? record.shippedAt, crawl = record.lastCrawlAt ?? null;
  if (crawl == null) return { anchor: stamp, awaiting: false };
  return crawl.slice(0, 10) >= stamp.slice(0, 10) ? { anchor: crawl, awaiting: false } : { anchor: stamp, awaiting: true }; // compared by DAY, because every window is
}
const anchorOf = (record: ShippedChangeRecord): string => crawlClock(record).anchor;

const MAX_MEASURE_WINDOW_DAYS = Math.max(...PROOF_WINDOW_DAYS);
/** Grace after the last window before a still-"measuring" record is "stale". */
const STALE_GRACE_DAYS = 7;
/** E-39 D4: how long past the 28-day + grace horizon Beacon keeps FAIRLY retrying a recompute of a still-unsettled measurement whose GSC
 *  data has not yet arrived. Bounded so a page is never re-scanned forever, but long enough that a genuine GSC finalization delay still
 *  gets its verdict once the data lands. */
const MAX_VERDICT_LAG_RETRY_DAYS = 28;

/** THE CONDITIONAL FOURTH CHECKPOINT (Product Truth). A day-56 read runs ONLY when the day-28 read did not settle, or the change was a
 *  dangerous one. A clean 28-day read CLOSES measurement and no 56-day read is taken. */
export const FOLLOW_UP_WINDOW_DAY = 56;

/** The component kinds that move where a page LIVES or whether it is findable at all. Spelled out rather than imported: Measurement must
 *  not import Decision (the foundation guard forbids that edge and grants this file no exception), and this closed list is the one in the
 *  Decision contract. EXPORTED so the pin in tests/decision/extended-producers.test.ts holds the two copies equal from the test side, where
 *  importing both kernels is allowed: the day the Decision list gains a kind and this one does not, that test fails loudly instead of a
 *  moved page quietly losing the fourth checkpoint that exists for exactly those changes. */
export const DANGEROUS_COMPONENT_KINDS: ReadonlySet<string> = new Set([
  "canonical", "redirect", "noindex", "consolidation",
]);

/** Claims where being wrong hurts a reader, not a ranking. The same closed expression the Decision contract holds, spelled out for the same
 *  reason the kind list above is: this kernel may not import that one. */
const HIGH_STAKES_CLAIM = /\b(law|legal|lawyer|attorney|court|statute|regulation|licen[cs]|liabilit|medical|medicine|doctor|clinical|diagnos|dosage|drug|symptom|treatment|patient|financial|finance|tax|taxes|loan|mortgage|interest rate|investment|insurance|refund|warrant)/i;

/** THE CANONICAL RULE, whole: a component is dangerous on its KIND, on its own risk GRADE, or because it corrects a fact a reader could act
 *  on. Measurement asked only about the kind list, then only kind or grade, so a correction to a dosage or a refund policy quietly lost the
 *  fourth checkpoint that exists precisely for changes nobody can take back with a sentence. Pure. */
function isDangerousComponent(c: { kind: string; risk?: string | null; after?: string | null }): boolean {
  return c.risk === "dangerous" || DANGEROUS_COMPONENT_KINDS.has(c.kind)
    || (c.kind === "factual_correction" && HIGH_STAKES_CLAIM.test(c.after ?? ""));
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
  // "measuring" / "insufficient_data": in flight unless it aged out past the last window + grace with NOTHING ever read → stale (no usable
  // data). A record with a real window reading is never "stale" here even when old (that reading exists); E-39 D4's honest release of a
  // STUCK measurement is handled by resolveVerdictLag (recompute when data arrives; mark blocked_data + release when it does not) plus the
  // admit-with-caution model, which never manufactures a verdict from age.
  const anyWindowRan = (record.windows ?? []).some((w) => w.ran);
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS && !anyWindowRan) return "stale";
  if (record.verdict === "insufficient_data") return "inconclusive";
  return "measuring";
}

/** E-39 D4 - verdict-lag repair, fail-closed and HONEST. For a record past the 28 day plus grace horizon with no settled mature verdict, what
 *  the engine should do. "in_window" ordinary measurement still applies. "settled" a mature won, lost or inconclusive verdict is on file.
 *  "recompute" the horizon is reached AND the 28 day data has finally arrived, so a provisional verdict can be computed, persisted, settled
 *  and released. "release_unresolved" the horizon is reached and the data is NOT in, so the page is released for editing (outcomeStateOf
 *  already reads "stale"), the unfinished measurement is preserved, and no verdict is fabricated. Wall-clock age never manufactures a verdict
 *  and missing data never locks the operator out. Its one consumer is isDueForMeasure, which reads `.kind === "recompute"` and nothing else. PURE. */
type VerdictLagAction = { kind: "in_window" | "settled" | "recompute" | "release_unresolved" };

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

  // Past the horizon without a settled verdict. Bound the fair retry window FIRST: past it, stop retrying entirely - never re-scan forever,
  // never fabricate a verdict; the record stays released for editing and honestly unresolved.
  if (age > horizon + MAX_VERDICT_LAG_RETRY_DAYS) {
    return { kind: "release_unresolved" };
  }

  // Inside the bounded retry window: can the 28-day window run NOW (its required GSC data has finally arrived)? If so, recompute + persist
  // + settle + release.
  const dataAvailable = lastFinalizedDate != null && lastFinalizedDate >= addDays(anchorOf(record), MAX_MEASURE_WINDOW_DAYS - 1);
  if (dataAvailable) return { kind: "recompute" };

  // Data still unavailable: never invent a verdict from age. Release + preserve, and stay eligible to retry as data arrives
  // (deriveMeasurementMaturity keeps reading this record as "blocked_data" until the same bound above is reached).
  return { kind: "release_unresolved" };
}

/** THE CONDITIONAL DAY-56 READ. Product Truth: 7, 14 and 28 always; 56 only when the 28-day read was confounded, insufficient or unclear,
 *  or when the change was a dangerous one (it moves the page or hides it, and those take longer to show their real cost). A CLEAN 28-day
 *  read closes measurement, and no day-56 read is taken at all. PURE. `runs` the change earned a fourth checkpoint (and has not had it
 *  yet). `due` it earned it AND Google has finalized the days that read needs. `reason` what earned it, in the vocabulary Product Truth
 *  uses, or null. */
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
  // A 28-day read that settled on won or lost is the primary directional read, and it is the whole answer. Anything else after a 28-day
  // window that HAS run is unsettled.
  const settled28 = record.verdict === "won" || record.verdict === "lost";
  const dangerous = (record.componentsApplied ?? []).some(isDangerousComponent);
  // A stored "measuring" verdict at a run 28-day window means exactly one thing the record can prove: that read did not settle. WHY it did
  // not (an overlapping change, or Google still catching up) is the live kernel's call, not this record's, so the reason says the true
  // thing rather than naming a cause nobody here checked.
  const reason = !ran28 ? null
    : record.verdict === "insufficient_data" ? "insufficient_28" as const
      : record.verdict === "inconclusive" ? "unclear_28" as const
        : !settled28 ? "measuring_28" as const
          : dangerous ? "dangerous_change" as const : null;
  const runs = ran28 && !ran56 && reason != null;
  const due = runs
    && lastFinalizedDate != null
    && lastFinalizedDate >= addDays(checkOn, -1)
    && reportingDay(now) >= checkOn;
  return { runs, due, reason, checkOn };
}

/** The only answers that let measurement begin: I SAW the change on the page, or I saw part of it. There is no third way in. A claim, a
 *  note and a legacy override row are all "not read yet", and a reading taken over work I never found would credit whatever search does
 *  next to something that may never have happened. */
const MEASURABLE_VERIFICATION: ReadonlySet<string> = new Set(["verified", "partially_verified"]);
/** The two states a row is parked in when nothing could be found to stand behind it. Neither is a finished answer; both are asked again. */
const DEAD_COMPARISON: ReadonlySet<string> = new Set(["insufficient_comparison", "measurement_unavailable"]);

/** Is this record worth re-measuring now? PURE. True when a proof window can transition ran:false → true since the last measure (the GSC
 *  finalized watermark has advanced past a window's last day). Settled records still re-check inside the 28d window (a 7d "won" can flip at
 *  28d); once fully aged out they're done. THE GATE COMES FIRST. A Shipment whose change I have not found on the live page is not a
 *  measurement waiting to run, it is a claim: measuring it would attribute whatever search does next to work that may never have landed. So
 *  a record carrying the stamp must also carry an answer that says the change is there. A pre-Shipment record has no stamp and no answer to
 *  wait for, and stays measurable exactly as it always was. */
export function isDueForMeasure(
  record: ShippedChangeRecord,
  lastFinalizedDate: string | null,
  now: Date = new Date(),
): boolean {
  if (record.implementedAt != null && !MEASURABLE_VERIFICATION.has(record.verification?.status ?? "")) return false;
  if (lastFinalizedDate == null) return false; // no finalized GSC data → can't measure
  // GOOGLE HAS NOT READ THE CHANGE YET, so there is nothing of it in the numbers: the row waits rather than banking a reading of the page as
  // it still stands. Its crawl stamp is refreshed by the pass itself, so this releases the moment the recrawl lands.
  if (crawlClock(record).awaiting) return false;
  // THE REVIVAL IS REACHED (live pass 23, 2026-09-03). 26 rows sat in a dead comparison state and this gate answered "not due" for every one
  // of them, so the clause in the reading that promotes them the moment a basis exists was never run at all, and the debt that opens a pass
  // is counted with this very function, so the whole cohort kept itself invisible. A measurable row parked in one of those two states is due
  // ONCE A DAY while Search has finalized data behind it: the reading either finds a basis and revives it, or finds none and leaves it
  // exactly where it was. Once a day and not every pass, so a row that can never revive asks again tomorrow instead of forever.
  if (DEAD_COMPARISON.has(record.measurementState ?? "")) return (record.updatedAt ?? "").slice(0, 10) < reportingDay(now);
  // The conditional day-56 read comes AFTER the ordinary horizon, so it is asked first.
  if (day56Followup(record, lastFinalizedDate, now).due) return true;
  if (ageDaysOf(record, now) > MAX_MEASURE_WINDOW_DAYS + STALE_GRACE_DAYS) {
    // E-39 D4: past the ordinary horizon, still due ONLY when the verdict-lag repair says a recompute can now settle a still-unresolved
    // measurement whose GSC data has finally arrived (bounded fair retry inside resolveVerdictLag).
    return resolveVerdictLag(record, lastFinalizedDate, now).kind === "recompute";
  }

  const anchor = anchorOf(record);
  const ranByDay = new Map<number, boolean>((record.windows ?? []).map((w) => [w.day, w.ran]));
  return PROOF_WINDOW_DAYS.some((day) => {
    const canRunNow = lastFinalizedDate >= addDays(anchor, day - 1);
    const alreadyRan = ranByDay.get(day) ?? false;
    return canRunNow && !alreadyRan; // a newly-runnable window
  });
}
