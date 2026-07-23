/**
 * weekly-recap (FINAL PREMIUM PLAN item 8) - pure math for the header streak line, computed from
 * the shipped-change ledger. No I/O. Pinned by weekly-recap.test.ts.
 *
 * The Monday recap band + the D6 daily-counter helpers (buildWeeklyRecap / weeklyRecapSentence /
 * shippedToday / stillDoubleCheckingCount) were removed in the CORE 100K amputation; only the
 * home greeting's shipped-in-last-days streak remains live.
 */

export type RecapRow = {
  shippedAt: string; // ISO
  path: string;
};

const DAY_MS = 86_400_000;

/** Count of changes shipped in the trailing `days` (item 8's streak). */
export function shippedInLastDays(rows: Array<Pick<RecapRow, "shippedAt">>, nowMs: number, days = 14): number {
  const since = nowMs - days * DAY_MS;
  let n = 0;
  for (const r of rows) {
    const t = Date.parse(r.shippedAt);
    if (Number.isFinite(t) && t >= since && t <= nowMs) n += 1;
  }
  return n;
}
