/**
 * verdict-schedule (Wave 3A, 2026-07-10) - THE one place the "when do results land"
 * dates for shipped changes still measuring are computed. Kills the divergent calcs that
 * showed the operator three different "next read" dates for the same ledger:
 *   - scoreboard.ts soonest 7/14/28 future
 *   - today-proof-sections.tsx soonest un-ran checkOn
 *   - daily-experiment-dashboard.ts ship+7+GSC lag
 *   - cumulative-outcome.ts ship+28
 * PURE, no I/O. Measuring membership comes from the SAME canonical splitLedgerLifecycle
 * the count rule uses (src/domains/decision/changes/lifecycle-counts.ts), so the schedule and the
 * "N measuring" count can never describe different sets. Every date is YYYY-MM-DD (UTC);
 * every render site formats it with monthDayLabel (src/components/data/receipt-line.ts).
 */
import { reportingDay } from "@/lib/reporting-day";
import { addDays } from "./kernel";
import { PROOF_WINDOW_DAYS } from "./types";
import { GSC_LAG_DAYS } from "@/domains/measurement/proof-gsc/kernel";

import { splitLedgerLifecycle, type LedgerLifecycleRow } from "@/domains/decision/changes/lifecycle-counts";

/** The final proof window; a change reaches its earliest final verdict at ship + this. */
const FINAL_WINDOW_DAY = 28;

/**
 * A ledger row the schedule reads: the canonical lifecycle row shape plus the per-window
 * close dates and the optional recrawl clock. Structurally satisfied by ShippedChangeRecord
 * (proof-gsc/shipped-change-store.ts), so callers pass the ledger straight through.
 */
export type VerdictScheduleRow = LedgerLifecycleRow & {
  windows: ReadonlyArray<{
    day: number;
    ran: boolean;
    /** YYYY-MM-DD the window closes. */
    checkOn?: string | null;
    controlsUsed?: number | null;
  }>;
  /** WHEN GOOGLE LAST CRAWLED THIS PAGE, the very field measure-lifecycle counts its windows from, so the date promised here and the day the
   *  read actually lands can never be two different days. At or after the stamp it IS day zero; before it the change is not indexed yet, so
   *  the clock has not started and this row has no checkpoint to promise. Absent is the ship clock, unchanged. */
  lastCrawlAt?: string | null;
};

type VerdictSchedule = { // PRIVATE: no caller outside this file ever spelled this name, and public surface is capped, so a type nobody names is not surface
  /** Earliest FUTURE next-unclosed 7/14/28 checkpoint across measuring rows (recrawl clock). */
  firstReadOn: string | null;
  /** Earliest FUTURE stamp + 28 - the soonest final verdict any measuring row can reach. */
  finalVerdictOn: string | null;
  /** finalVerdictOn + GSC_LAG_DAYS - when Google's data for that final window is reliably in. */
  reliableDataOn: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}/;
const ymd = (now: Date): string => reportingDay(now);

/**
 * THE STAMP every promised date counts from: when the operator marked the change done, falling
 * back to the ship date on a row written before there was a stamp. The same anchor the kernel,
 * measure-lifecycle and measure-pass all count from, so the date Today promises the operator and
 * the date the read actually lands can never be two different days. A re-press moves the ship
 * date and never the stamp, so it never moves a promised date either. Pure.
 */
function anchorOf(row: VerdictScheduleRow): string {
  return (row.implementedAt ?? row.shippedAt).slice(0, 10);
}

/** The day the SEARCH clock starts for a row, and whether it has started at all: Google's last crawl where that is known and not before the
 *  stamp, the stamp otherwise, and a crawl BEFORE the stamp means Google has not read the change yet, so this row has nothing to promise. */
function searchClock(row: VerdictScheduleRow): { start: string; waiting: boolean } {
  const anchor = anchorOf(row), crawl = row.lastCrawlAt ?? null;
  if (crawl == null || !YMD.test(crawl)) return { start: anchor, waiting: false };
  return crawl.slice(0, 10) >= anchor ? { start: crawl.slice(0, 10), waiting: false } : { start: anchor, waiting: true };
}

/** The earliest future unclosed checkpoint for ONE row on its own clock; null when none. */
function rowFirstRead(row: VerdictScheduleRow, start: string, nowYmd: string): string | null {
  for (const d of PROOF_WINDOW_DAYS) {
    const on = addDays(start, d);
    if (!row.windows.some((w) => w.day === d && w.ran) && on > nowYmd) return on;
  }
  return null;
}

/**
 * The proof schedule for a ledger. Measuring rows are the canonical set
 * (splitLedgerLifecycle), so the schedule never describes a change the count rule
 * considers decided. All three dates are FUTURE-only (a checkpoint already in the past is
 * not a "when results land"); each is the earliest such date across the measuring set.
 */
export function verdictSchedule(
  rows: ReadonlyArray<VerdictScheduleRow>,
  now: Date = new Date(),
): VerdictSchedule {
  const measuring = splitLedgerLifecycle(rows, now).measuring;
  const nowYmd = ymd(now);

  let firstReadOn: string | null = null;
  let finalVerdictOn: string | null = null;
  for (const row of measuring) {
    const clock = searchClock(row);
    if (clock.waiting) continue; // Google has not read the change yet, so neither date of this row's is known
    const first = rowFirstRead(row, clock.start, nowYmd);
    if (first != null && (firstReadOn == null || first < firstReadOn)) firstReadOn = first;
    const final = addDays(clock.start, FINAL_WINDOW_DAY);
    if (final > nowYmd && (finalVerdictOn == null || final < finalVerdictOn)) finalVerdictOn = final;
  }
  const reliableDataOn = finalVerdictOn != null ? addDays(finalVerdictOn, GSC_LAG_DAYS) : null;
  return { firstReadOn, finalVerdictOn, reliableDataOn };
}
