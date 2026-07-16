/**
 * clean-window-salvage (BEACON_500 P4 R10b, v1 item 152, 2026-07-03) - when a
 * Google update muddies part of a measurement window, salvage the clean days
 * instead of writing off the whole read.
 *
 * The algorithm-weather guard (item 32) flags any measurement window that
 * overlapped a confirmed Google update or a detected sitewide shock, and the
 * whole read gets graded down wholesale. Often only PART of the window was
 * actually inside the shock: this module partitions the basis window's days
 * into muddied (inside any shock window) and clean (outside all of them),
 * and when at least 10 clean days exist it computes the treated page's own
 * lift on the clean days alone, against a baseline that ALSO excludes shock
 * days ("A Google update muddied 9 of these 28 days; on the 19 clean days
 * this change is still up 14 percent."). The presentation renders it right
 * under the weather caveat - the caveat stays named, the salvage read gives
 * the honest remainder. The stored verdict, windows, learning gates, and
 * clocks are NEVER touched; attached as `cleanWindowLift`, computed-only,
 * recomputed on every measure, never persisted (recordToRow omits it).
 *
 * Honest-absence rules mirror weekday-baseline.ts: null when the series read
 * does not cover the whole baseline window, null when the post window is not
 * fully finalized (a day GSC has not finalized is unknown, never zero), null
 * when no shock actually muddied a day of this window (nothing to salvage),
 * and null when fewer than 10 clean days remain on either side (a sliver is
 * not a read). Like weekday-baseline, both numbers are the treated page's
 * OWN movement, not control adjusted. PURE - no I/O. Pinned by
 * clean-window-salvage.test.ts.
 */

import { addDays } from "./measure";
import type { DailyClickPoint } from "./weekday-baseline";
import type { ShockWindow } from "./algorithm-weather";

export type CleanWindowLift = {
  /** The closed basis window this read covers (7/14/28). */
  windowDays: number;
  /** Post-window days OUTSIDE every shock window. */
  cleanDays: number;
  /** Post-window days inside at least one shock window. */
  muddiedDays: number;
  /** Clean-days lift as a fraction of the clean baseline daily pace (0.14 =
   *  up 14 percent). Null when the clean baseline is too thin for an honest
   *  rate - the clicks figure below still reads. */
  cleanLiftPct: number | null;
  /** Total extra clicks across the clean days vs the clean baseline pace. */
  cleanLiftClicks: number;
  /** Whether the muddying shock was a confirmed Google update or a detected
   *  sitewide shift (confirmed wins when both touched the window). */
  shockKind: "confirmed" | "suspected";
  /** The plain salvage sentence, always present on a returned read. */
  sentence: string;
};

/** At least this many clean days must exist INSIDE the window (and inside
 *  the baseline) before a salvage read is honest. */
export const MIN_CLEAN_DAYS_FOR_SALVAGE = 10;
/** Below this many expected clicks across the clean days, a percent change
 *  is not an honest rate (matches query-panel.ts's scale). */
const MIN_EXPECTED_CLEAN_CLICKS_FOR_PCT = 3;
/** Within this fraction either way, the clean-days read is "about flat". */
const FLAT_PCT_BAND = 0.005;

const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

function inAnyShock(date: string, shocks: ReadonlyArray<ShockWindow>): ShockWindow | null {
  for (const s of shocks) {
    if (s.start <= date && date <= s.end) return s;
  }
  return null;
}

/**
 * The clean-days salvage read for one closed basis window. See the module
 * doc for the honest-absence rules.
 */
export function computeCleanWindowSalvage(args: {
  series: ReadonlyArray<DailyClickPoint>;
  /** YYYY-MM-DD ship date. Post window is [ship, ship + windowDays). */
  shipDate: string;
  /** The closed basis window length (7/14/28). */
  windowDays: number;
  preWindowDays?: number;
  /** Earliest date the series read covers (the loader's `since`). */
  knownFrom: string;
  /** Latest finalized GSC date - days after this are unknown, never zero. */
  lastFinalizedDate: string | null;
  /** The tenant's known shock windows (algorithm-weather.ts). */
  shocks: ReadonlyArray<ShockWindow>;
}): CleanWindowLift | null {
  const preDays = args.preWindowDays ?? 28;
  if (args.windowDays <= 0 || preDays <= 0) return null;
  if (!args.shocks || args.shocks.length === 0) return null;
  const ship = args.shipDate.slice(0, 10);
  const baselineStart = addDays(ship, -preDays);
  // Coverage guards: never fabricate zeros for days the read did not cover or
  // GSC has not finalized (mirrors weekday-baseline.ts exactly).
  if (args.knownFrom.slice(0, 10) > baselineStart) return null;
  const lastPostDay = addDays(ship, args.windowDays - 1);
  if (args.lastFinalizedDate == null || args.lastFinalizedDate.slice(0, 10) < lastPostDay) return null;

  const byDate = new Map<string, number>();
  for (const p of args.series) {
    if (p?.date) byDate.set(p.date.slice(0, 10), Number(p.clicks) || 0);
  }
  const clicksOn = (date: string): number => byDate.get(date) ?? 0;

  // Partition the post window's days.
  const cleanPost: number[] = [];
  let muddiedDays = 0;
  let sawConfirmed = false;
  for (let i = 0; i < args.windowDays; i++) {
    const date = addDays(ship, i);
    const shock = inAnyShock(date, args.shocks);
    if (shock) {
      muddiedDays++;
      if (shock.kind === "confirmed") sawConfirmed = true;
    } else {
      cleanPost.push(clicksOn(date));
    }
  }
  // Nothing muddied = nothing to salvage (the weather guard did not really
  // touch these days); too few clean days = a sliver, not a read.
  if (muddiedDays === 0) return null;
  if (cleanPost.length < MIN_CLEAN_DAYS_FOR_SALVAGE) return null;

  // Baseline pace from the baseline's OWN clean days - a shock that also
  // touched the baseline must not contaminate the "usual pace" either.
  const cleanBaseline: number[] = [];
  for (let i = 0; i < preDays; i++) {
    const date = addDays(baselineStart, i);
    if (!inAnyShock(date, args.shocks)) cleanBaseline.push(clicksOn(date));
  }
  if (cleanBaseline.length < MIN_CLEAN_DAYS_FOR_SALVAGE) return null;

  const mu = mean(cleanBaseline);
  const cleanMean = mean(cleanPost);
  const cleanDays = cleanPost.length;
  const cleanLiftClicks = round1((cleanMean - mu) * cleanDays);
  const expectedCleanClicks = mu * cleanDays;
  const cleanLiftPct =
    expectedCleanClicks >= MIN_EXPECTED_CLEAN_CLICKS_FOR_PCT ? (cleanMean - mu) / mu : null;

  const shockKind: CleanWindowLift["shockKind"] = sawConfirmed ? "confirmed" : "suspected";
  const label = sawConfirmed ? "A Google update" : "A sitewide shift";

  let movement: string;
  if (cleanLiftPct != null) {
    if (Math.abs(cleanLiftPct) < FLAT_PCT_BAND) movement = "is about flat";
    else if (cleanLiftPct > 0) movement = `is still up ${Math.round(cleanLiftPct * 100)} percent`;
    else movement = `is down ${Math.round(Math.abs(cleanLiftPct) * 100)} percent`;
  } else if (cleanLiftClicks >= 1) {
    movement = `is still ahead by about ${Math.round(cleanLiftClicks)} clicks`;
  } else if (cleanLiftClicks <= -1) {
    movement = `is behind by about ${Math.round(Math.abs(cleanLiftClicks))} clicks`;
  } else {
    movement = "is about flat";
  }
  const sentence = `${label} muddied ${muddiedDays} of these ${args.windowDays} days; on the ${cleanDays} clean days this change ${movement}.`;

  return {
    windowDays: args.windowDays,
    cleanDays,
    muddiedDays,
    cleanLiftPct: cleanLiftPct != null ? Math.round(cleanLiftPct * 1000) / 1000 : null,
    cleanLiftClicks,
    shockKind,
    sentence,
  };
}
