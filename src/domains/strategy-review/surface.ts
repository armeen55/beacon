/**
 * strategy-review/surface (2026-07-02, BEACON 500 item 51) - the PURE presentation slice
 * for the Monday recap band. Decides whether a strategy-mix record is FRESH enough to
 * show (this week's or next week's - a stale record from a month ago must never read as
 * "this week's plan") and renders the signed one-liner. No I/O. Pinned by surface.test.ts.
 */

import type { StrategyMixRecord } from "./strategy-mix-store";

/** A record is fresh when its weekOf is within this many days of `now` in either
 *  direction - covers "the mix for the week we are currently in" (weekOf could be a few
 *  days in the past relative to today) and "the mix for the week that just started"
 *  (weekOf could be a day or two in the future right after a Sunday-night run). */
const FRESH_WINDOW_DAYS = 9;
const DAY_MS = 86_400_000;

export function isStrategyMixFresh(record: StrategyMixRecord, now: Date): boolean {
  const weekOfMs = Date.parse(`${record.weekOf}T00:00:00.000Z`);
  if (!Number.isFinite(weekOfMs)) return false;
  return Math.abs(now.getTime() - weekOfMs) <= FRESH_WINDOW_DAYS * DAY_MS;
}

function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, " - ").trim();
}

/**
 * The Monday recap band's memo line, or null when there is no record, the record is
 * stale, or the memo is empty. Signed per the spec ("- your strategist, Sunday night").
 * Dash-stripped again here as a belt-and-suspenders guard (the memo is already
 * dash-stripped at write time by run-strategy-review.ts) - a surface must never emit an
 * em/en dash even if a future writer regresses that guarantee.
 */
export function strategyMemoLine(record: StrategyMixRecord | null, now: Date): string | null {
  if (!record) return null;
  if (!isStrategyMixFresh(record, now)) return null;
  const memo = stripDashes(record.memo ?? "");
  if (!memo) return null;
  return `${memo} - your strategist, Sunday night`;
}
