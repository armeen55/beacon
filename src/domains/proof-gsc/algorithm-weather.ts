/**
 * algorithm-weather (2026-07-02, master plan item 32) - PURE assembly + overlap
 * logic for the algorithm-weather guard. Merges the operator-seeded confirmed
 * Google update ranges (google-updates.ts) with sitewide shocks the CUSUM
 * detector (changepoint.ts) found in the tenant's own daily Search Console
 * totals, into one list of "shock windows". Any proof measurement window that
 * overlaps a shock window gets a visible caveat and is excluded from learning,
 * computed at READ time (never mutating a stored verdict) - the same posture
 * as detectMeasurementOverlaps / attribution quality in measurement-maturity.ts.
 *
 * No I/O here. The nightly step (cron-sync.ts) calls detectChangepoints and
 * persists the result via algorithm-weather-store.ts; every reader (Results
 * page, load-experiment-outcomes.ts) calls buildShockWindows with whatever it
 * has loaded, then overlapsShockWindow per measurement window.
 */

import { detectChangepoints, type DailyPoint, type Changepoint } from "./changepoint";
import { CONFIRMED_GOOGLE_UPDATES, DEFAULT_ROLLOUT_DAYS, type ConfirmedGoogleUpdate } from "./google-updates";

export type ShockWindow = {
  id: string;
  start: string;
  end: string;
  kind: "confirmed" | "suspected";
  /** Plain first-person label for the caveat sentence, e.g.
   *  "the March 2026 Google core update" or "a sitewide shift I detected". */
  label: string;
  direction?: "up" | "down";
};

const DAY_MS = 86_400_000;

function toMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function addDaysIso(iso: string, days: number): string {
  return new Date(toMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A detected changepoint becomes a shock WINDOW spanning a conservative reach
 *  around the alarm date: `SUSPECTED_SPREAD_DAYS` before (the shift likely
 *  started before CUSUM accumulated enough to alarm) and after (the new level
 *  needs a few days of data before we would trust a page's own recovery). Pure. */
const SUSPECTED_SPREAD_BEFORE_DAYS = 3;
const SUSPECTED_SPREAD_AFTER_DAYS = 10;

/** Turn confirmed update entries into shock windows (defaulting an open end to
 *  start + DEFAULT_ROLLOUT_DAYS). PURE. */
export function confirmedShockWindows(
  updates: ReadonlyArray<ConfirmedGoogleUpdate> = CONFIRMED_GOOGLE_UPDATES,
): ShockWindow[] {
  return updates
    .filter((u) => u.id && u.start)
    .map((u) => ({
      id: `confirmed:${u.id}`,
      start: u.start,
      end: u.end && u.end >= u.start ? u.end : addDaysIso(u.start, DEFAULT_ROLLOUT_DAYS),
      kind: "confirmed" as const,
      label: u.label || u.id,
    }));
}

/** Turn CUSUM changepoints into "suspected" shock windows. PURE. */
export function suspectedShockWindows(changepoints: ReadonlyArray<Changepoint>): ShockWindow[] {
  return changepoints.map((c) => ({
    id: `suspected:${c.date}:${c.direction}`,
    start: addDaysIso(c.date, -SUSPECTED_SPREAD_BEFORE_DAYS),
    end: addDaysIso(c.date, SUSPECTED_SPREAD_AFTER_DAYS),
    kind: "suspected" as const,
    label: "a sitewide shift I detected",
    direction: c.direction,
  }));
}

/**
 * Run the CUSUM detector over a tenant's daily totals series (clicks OR
 * impressions - callers typically run both and merge) and merge with the
 * confirmed update list into one ranked shock-window list. PURE (no I/O; the
 * caller reads the series and any persisted detections beforehand).
 */
export function buildShockWindows(args: {
  dailySeries: ReadonlyArray<DailyPoint>;
  confirmedUpdates?: ReadonlyArray<ConfirmedGoogleUpdate>;
  /** Previously-detected changepoints (e.g. from the persisted store), merged
   *  with a fresh detection pass so a reader without daily data still sees
   *  last night's shocks. Deduped by date+direction. */
  priorChangepoints?: ReadonlyArray<Changepoint>;
}): ShockWindow[] {
  const fresh = detectChangepoints(args.dailySeries);
  const seen = new Set(fresh.map((c) => `${c.date}:${c.direction}`));
  const merged = [...fresh, ...(args.priorChangepoints ?? []).filter((c) => !seen.has(`${c.date}:${c.direction}`))];
  return [...confirmedShockWindows(args.confirmedUpdates), ...suspectedShockWindows(merged)];
}

/** Does [aStart, aEnd] overlap [bStart, bEnd] (inclusive, YYYY-MM-DD)? PURE. */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMs(aStart) <= toMs(bEnd) && toMs(bStart) <= toMs(aEnd);
}

/**
 * Does a measurement window [start, end] overlap ANY shock window? Returns the
 * first (confirmed takes priority over suspected) overlapping window, or null.
 * PURE - the caller supplies the window's own start/end (ship date to basis
 * checkpoint date); nothing here reads a clock or a store.
 */
export function overlappingShock(
  windowStart: string,
  windowEnd: string,
  shocks: ReadonlyArray<ShockWindow>,
): ShockWindow | null {
  if (!windowStart || !windowEnd) return null;
  const hits = shocks.filter((s) => rangesOverlap(windowStart, windowEnd, s.start, s.end));
  if (hits.length === 0) return null;
  const confirmed = hits.find((h) => h.kind === "confirmed");
  return confirmed ?? hits[0]!;
}

/** Plain first-person caveat sentence for a Results row / MoveCard whose
 *  measurement window overlapped a shock. No dashes. PURE. */
export function weatherCaveatSentence(shock: ShockWindow): string {
  const when = new Date(`${shock.start}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Google shifted the whole playing field around ${when} while this was measuring, so I am reading this result cautiously.`;
}
