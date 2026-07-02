/**
 * seasonal/seasonal-hints (2026-07-02, master plan item 21) - PURE mapper from
 * detected seasonal windows to the daily plan builder's hint shape, following
 * the trend-radar/spike-hints precedent exactly: a seasonal window only
 * becomes a "prep now" hint when its prep deadline falls within the next 21
 * days (otherwise it is not urgent yet - the archive keeps it for later), and
 * the feed is bounded so seasonal prep seasons the plan instead of flooding it.
 */

import { normalizePath } from "@/domains/experiments/daily-plan-types";
import type { SeasonalQuery } from "./seasonality";

/** A prep deadline further out than this is not urgent yet; stay silent. */
export const PREP_WINDOW_DAYS = 21;
/** At most this many prep-now hints reach the plan builder per night. */
export const MAX_SEASONAL_HINTS_PER_NIGHT = 2;

/** The note attached to a daily candidate whose page has a seasonal window
 *  approaching. */
export type SeasonalHintNote = {
  query: string;
  peakMonths: number[];
  annualImpressions: number;
  prepByDate: string;
  /** Ready-to-append operator sentence (Beacon voice, no dashes). */
  sentence: string;
};

function daysUntil(iso: string, now: Date): number {
  const target = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(target)) return Infinity;
  return Math.round((target - now.getTime()) / 86_400_000);
}

/**
 * Seasonal windows -> Map<normalized page path, SeasonalHintNote>, bounded to
 * items whose prep deadline is within the next PREP_WINDOW_DAYS (inclusive of
 * "already due" - a slightly late prep is still worth flagging, never
 * negative-far-past which would mean the wave already happened). Windows
 * arrive ranked (soonest deadline first), so the bound keeps the most urgent.
 * One hint per page (first wins). A window with no known top page is skipped
 * (nothing exact to strengthen).
 */
export function buildSeasonalHintNotes(
  seasonal: SeasonalQuery[],
  now: Date = new Date(),
  limit: number = MAX_SEASONAL_HINTS_PER_NIGHT,
): Map<string, SeasonalHintNote> {
  const out = new Map<string, SeasonalHintNote>();
  for (const s of seasonal) {
    if (out.size >= limit) break;
    if (!s.topPage) continue; // no page named -> nothing exact to strengthen
    const days = daysUntil(s.prepByDate, now);
    if (!Number.isFinite(days) || days > PREP_WINDOW_DAYS) continue; // not urgent yet
    const key = normalizePath(s.topPage);
    if (out.has(key)) continue;
    out.set(key, {
      query: s.query,
      peakMonths: s.peakMonths,
      annualImpressions: s.annualImpressions,
      prepByDate: s.prepByDate,
      sentence: s.sentence,
    });
  }
  return out;
}
