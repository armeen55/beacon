/**
 * fresh-tail (BEACON_500 R17b / P2 slice 2, v1 item 264) - the "still
 * settling" tail for the Today scoreboard chart.
 *
 * The nightly sync only persists FINAL Search Analytics days (3-day lag), so
 * the chart's right edge always stops a few days short of today. Google DOES
 * expose early, non-final numbers for those days (dataState "all"); this
 * module is the pure math for rendering them as a clearly-labeled dotted
 * tail - an OPT-IN read at render time, bounded to the lag window.
 *
 * THE INVIOLABLE RULE: fresh numbers are NEVER stored as final. They live in
 * a tiny volatile presentation cache at most (load-fresh-tail.ts), and every
 * point this module produces carries `settling: true`. Nothing here (or in
 * the loader) touches gsc_daily_rows / gsc_daily_totals - fresh-tail.test.ts
 * pins that by scanning the loader source.
 *
 * PURE, no I/O. The read edge is load-fresh-tail.ts.
 */

import { GSC_FINAL_LAG_DAYS } from "./ingestion-gaps";

/** The one label the chart shows for the dotted tail. Pinned by test. */
export const FRESH_TAIL_NOTE =
  "The dotted end is Google's early count; it firms up over 3 days.";

/** The tail may cover at most the final-lag days plus today itself. A wider
 *  gap means the SYNC is behind (an ingestion problem, not settling data),
 *  and rendering a long dotted stretch would dress a sync hole up as normal. */
const FRESH_TAIL_MAX_DAYS = GSC_FINAL_LAG_DAYS + 1;

export type FreshTailPoint = {
  date: string;
  clicks: number;
  /** Always true: this number is Google's EARLY count, never a final one. */
  settling: true;
};

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T12:00:00Z");
  const tb = Date.parse(b + "T12:00:00Z");
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN;
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * The date window the fresh read may cover: the day after the chart's last
 * reported (final) day through today (Pacific). Null when there is nothing
 * to read (no reported history, no gap, or a gap wider than the lag window).
 */
export function freshTailWindow(
  lastReportedDate: string | null,
  todayPacific: string,
): { start: string; end: string } | null {
  if (!lastReportedDate) return null;
  const gap = daysBetween(lastReportedDate, todayPacific);
  if (!Number.isFinite(gap) || gap <= 0) return null;
  if (gap > FRESH_TAIL_MAX_DAYS) return null;
  return { start: addDays(lastReportedDate, 1), end: todayPacific };
}

/**
 * Map date-keyed API rows (dimensions ["date"], dataState "all") into tail
 * points, ascending, window-bounded. Days Google has not reported yet are
 * OMITTED, never invented as zero. Every point is labeled settling: true.
 */
export function buildFreshTailPoints(
  rows: ReadonlyArray<{ keys: string[]; clicks: number }>,
  window: { start: string; end: string },
): FreshTailPoint[] {
  const out: FreshTailPoint[] = [];
  for (const r of rows) {
    const date = Array.isArray(r.keys) ? (r.keys[0] ?? "").slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < window.start || date > window.end) continue;
    out.push({ date, clicks: Math.max(0, Number(r.clicks) || 0), settling: true });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}
