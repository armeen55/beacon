/**
 * weekly-recap (FINAL PREMIUM PLAN items 7 + 8) - pure math for the Monday recap band and the
 * header streak line, computed from the shipped-change ledger. No I/O. Pinned by
 * weekly-recap.test.ts.
 *
 * D6 (daily ritual loop) addition: `shippedToday` / `stillDoubleCheckingCount` give the Today
 * page's daily counter strip its two real numbers, both read from the SAME ledger rows this
 * file already summarizes - server truth, never localStorage. "Today" is the Pacific calendar
 * date (matches `defaultPacificShipDate` in run-measurement.ts, the same clock every ship is
 * dated against), not a rolling 24h window.
 */

import { displayProofOutcome } from "./verdict-calibration";

export type RecapRow = {
  shippedAt: string; // ISO
  verdict: string; // won | lost | inconclusive | measuring | insufficient_data
  /** 2026-07-11 quarantine: classifier version behind this verdict, or null
   *  (uncalibrated). Only a calibrated won counts as a win in the recap; an
   *  uncalibrated decided row reads as still measuring, per the one-count rule. */
  calibrationVersion?: string | null;
  path: string;
};

export type WeeklyRecap = {
  shipped: number;
  won: number;
  wonPaths: string[];
  noLift: number;
  stillMeasuring: number;
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

/** Recap of LAST calendar week (the 7 days ending yesterday, simple + honest). */
export function buildWeeklyRecap(rows: RecapRow[], nowMs: number): WeeklyRecap {
  const end = nowMs;
  const start = end - 7 * DAY_MS;
  const week = rows.filter((r) => {
    const t = Date.parse(r.shippedAt);
    return Number.isFinite(t) && t >= start && t < end;
  });
  // Fail-closed calibration quarantine (2026-07-11): count wins/no-lift through the
  // shared selector so an uncalibrated won/lost is never a recap "win" or a "no
  // clear lift" claim - it reads as still measuring, matching the one-count rule
  // everywhere else. A calibrated read is unchanged.
  const kindOf = (r: RecapRow) => displayProofOutcome(r).kind;
  const won = week.filter((r) => kindOf(r) === "won");
  const noLift = week.filter((r) => {
    const k = kindOf(r);
    return k === "lost" || k === "inconclusive" || k === "insufficient_data";
  });
  const measuring = week.filter((r) => {
    const k = kindOf(r);
    return k === "measuring" || k === "no_clear_effect_uncalibrated";
  });
  return {
    shipped: week.length,
    won: won.length,
    wonPaths: won.map((r) => r.path).slice(0, 3),
    noLift: noLift.length,
    stillMeasuring: measuring.length,
  };
}

/** Pacific calendar-date key ("2026-07-02"), the same clock `defaultPacificShipDate` dates ships
 *  against, so "today" here always means the same day a ship recorded itself under. */
function pacificDateKey(iso: string | number): string | null {
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Count of changes shipped on today's Pacific calendar date - the D6 daily counter's first
 *  number ("You shipped N changes today"). Server truth: reads the same ledger rows the streak
 *  and weekly recap read, never a client-side count. */
export function shippedToday(rows: Array<Pick<RecapRow, "shippedAt">>, nowMs: number): number {
  const today = pacificDateKey(nowMs);
  let n = 0;
  for (const r of rows) {
    if (pacificDateKey(r.shippedAt) === today) n += 1;
  }
  return n;
}

/** Of today's ships, how many are still mid-verification/measurement (not yet a settled result) -
 *  the D6 daily counter's second number ("Beacon is double-checking M of them"). Matches
 *  `buildWeeklyRecap`'s own "measuring" filter (the only non-settled verdict). */
export function stillDoubleCheckingCount(rows: Array<Pick<RecapRow, "shippedAt" | "verdict">>, nowMs: number): number {
  const today = pacificDateKey(nowMs);
  let n = 0;
  for (const r of rows) {
    if (pacificDateKey(r.shippedAt) === today && r.verdict === "measuring") n += 1;
  }
  return n;
}

/** One plain sentence for the band. Null when nothing shipped (band self-hides). */
export function weeklyRecapSentence(r: WeeklyRecap): string | null {
  if (r.shipped === 0) return null;
  const parts: string[] = [`${r.shipped} change${r.shipped === 1 ? "" : "s"} shipped`];
  if (r.won > 0) parts.push(`${r.won} win${r.won === 1 ? "" : "s"}${r.wonPaths.length ? ` (${r.wonPaths.join(", ")})` : ""}`);
  if (r.noLift > 0) parts.push(`${r.noLift} with no clear lift`);
  if (r.stillMeasuring > 0) parts.push(`${r.stillMeasuring} still measuring`);
  return `Last 7 days: ${parts.join(", ")}.`;
}
