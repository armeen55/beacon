/**
 * verdict-schedule (Wave 3A, 2026-07-10) - THE one place the "when do results land"
 * dates for shipped changes still measuring are computed. Kills the divergent calcs that
 * showed the operator three different "next read" dates for the same ledger:
 *   - scoreboard.ts soonest 7/14/28 future
 *   - today-proof-sections.tsx soonest un-ran checkOn
 *   - daily-experiment-dashboard.ts ship+7+GSC lag
 *   - cumulative-outcome.ts ship+28
 * PURE, no I/O. Measuring membership comes from the SAME canonical splitLedgerLifecycle
 * the count rule uses (src/domains/changes/lifecycle-counts.ts), so the schedule and the
 * "N measuring" count can never describe different sets. Every date is YYYY-MM-DD (UTC);
 * every render site formats it with monthDayLabel (src/components/data/receipt-line.ts).
 */
import { addDays, proofCheckDates, PROOF_WINDOW_DAYS, type ProofWindowDay } from "./measure";
import { GSC_LAG_DAYS } from "@/domains/proof-gsc/change-family";
import { splitLedgerLifecycle, type LedgerLifecycleRow } from "@/domains/changes/lifecycle-counts";

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
  /** Recrawl-gated SEARCH clock (measurement-maturity N11): once Google's index is
   *  confirmed to hold the change, checkpoints count from here instead of shippedAt.
   *  Absent falls back to the ship clock (legacy-identical). */
  recrawlConfirmedAt?: string | null;
  /** True while Google's index has NOT been observed holding the new content - the clock
   *  has not started, so there is no known checkpoint yet (mirrors the deriveMeasurementMaturity
   *  recrawlPending gate). */
  recrawlPending?: boolean;
};

export type VerdictSchedule = {
  /** Earliest FUTURE next-unclosed 7/14/28 checkpoint across measuring rows (recrawl clock). */
  firstReadOn: string | null;
  /** Earliest FUTURE ship + 28 - the soonest final verdict any measuring row can reach. */
  finalVerdictOn: string | null;
  /** finalVerdictOn + GSC_LAG_DAYS - when Google's data for that final window is reliably in. */
  reliableDataOn: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}/;
const ymd = (now: Date): string => now.toISOString().slice(0, 10);

/** The day the SEARCH clock starts for a row: the confirmed recrawl date when it is known
 *  and not before ship, otherwise the ship date. Mirrors measurement-maturity's rule. */
function searchClockStart(row: VerdictScheduleRow): string {
  const ship = row.shippedAt.slice(0, 10);
  const confirmed = row.recrawlConfirmedAt;
  if (confirmed && YMD.test(confirmed) && confirmed.slice(0, 10) >= ship) return confirmed.slice(0, 10);
  return ship;
}

/** The earliest future unclosed checkpoint for ONE row, recrawl-aware; null when none. */
function rowFirstRead(row: VerdictScheduleRow, nowYmd: string): string | null {
  if (row.recrawlPending === true) return null; // clock not started -> no known checkpoint
  const checks = proofCheckDates(searchClockStart(row));
  for (const d of PROOF_WINDOW_DAYS) {
    const ran = row.windows.some((w) => w.day === d && w.ran);
    const on = checks[d as ProofWindowDay];
    if (!ran && on > nowYmd) return on;
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
    const first = rowFirstRead(row, nowYmd);
    if (first != null && (firstReadOn == null || first < firstReadOn)) firstReadOn = first;
    const final = addDays(row.shippedAt, FINAL_WINDOW_DAY);
    if (final > nowYmd && (finalVerdictOn == null || final < finalVerdictOn)) finalVerdictOn = final;
  }
  const reliableDataOn = finalVerdictOn != null ? addDays(finalVerdictOn, GSC_LAG_DAYS) : null;
  return { firstReadOn, finalVerdictOn, reliableDataOn };
}
