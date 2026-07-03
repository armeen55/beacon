/**
 * weekday-baseline (BEACON_500 P4 R10a, v1 item 285, 2026-07-03) - the
 * weekday-aligned comparison mode for a shipped change's daily clicks.
 *
 * The window comparison in run-measurement.ts uses raw day SUMS: the post
 * window's clicks minus the pre window's clicks pro-rated by length. That
 * expectation is a plain daily MEAN of the baseline, so one viral spike day
 * in the baseline inflates it (a flat page then reads "fell"), and a site
 * whose weekends run hot or cold is compared against a blended average
 * instead of like days. This module compares each post-ship day against the
 * MEDIAN of the SAME weekday in the baseline period and reports the total as
 * `weekdayAdjustedLift` ALONGSIDE the raw number - it never replaces the
 * stored diff-in-diff, never touches a verdict, and is recomputed on every
 * measure (computed-only, same posture as trafficOutcome/permutationRead).
 *
 * Both numbers here are the treated page's OWN movement (not control
 * adjusted) - the honest apples-to-apples pair for "raw day sums vs weekday
 * aligned day sums". The presentation prefers the weekday-adjusted number
 * only when the two differ by more than 20 percent, with one plain sentence
 * naming why.
 *
 * PURE - no I/O. Pinned by weekday-baseline.test.ts.
 */

import { addDays } from "./measure";

export type DailyClickPoint = { date: string; clicks: number };

export type WeekdayAdjustedRead = {
  /** The closed basis window this read covers (7/14/28). */
  windowDays: number;
  /** Raw lift: post-window clicks minus the baseline daily mean times the
   *  window length. Treated page only (NOT control adjusted). */
  rawLift: number;
  /** Weekday-aligned lift: sum over post days of (that day's clicks minus the
   *  baseline median for the SAME weekday). Treated page only. */
  weekdayAdjustedLift: number;
  /** True when the two numbers differ by more than 20 percent - the
   *  presentation should lead with the weekday-adjusted number. */
  preferAdjusted: boolean;
  /** One plain sentence naming why, non-null ONLY when preferAdjusted. */
  sentence: string | null;
};

/** The presentation prefers the adjusted number when the two figures differ
 *  by more than this fraction of the raw figure. */
const PREFER_ADJUSTED_DIFF_FRACTION = 0.2;
/** Weekend medians must differ from weekday medians by more than this
 *  fraction before the sentence names weekends specifically. */
const WEEKEND_PATTERN_MIN_DIFF_FRACTION = 0.3;

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const fmtClicks = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n)}`;

/**
 * The weekday-aligned lift for one closed basis window. Honest-absence rules:
 *   - null when the series read does not cover the whole baseline window
 *     (`knownFrom` after the baseline start would make missing days read as
 *     fake zeros for days we simply never read);
 *   - null when the post window is not fully finalized (days past the GSC
 *     watermark are unknown, not zero).
 * Within covered, finalized ranges a missing date IS an honest zero (the GSC
 * daily table has no row for a day with no impressions).
 */
export function computeWeekdayAdjustedLift(args: {
  series: ReadonlyArray<DailyClickPoint>;
  /** YYYY-MM-DD ship date. Pre window is [ship - preWindowDays, ship). */
  shipDate: string;
  /** The closed basis window length (7/14/28). */
  windowDays: number;
  preWindowDays?: number;
  /** Earliest date the series read covers (the loader's `since`). */
  knownFrom: string;
  /** Latest finalized GSC date - days after this are unknown, never zero. */
  lastFinalizedDate: string | null;
}): WeekdayAdjustedRead | null {
  const preDays = args.preWindowDays ?? 28;
  if (args.windowDays <= 0 || preDays <= 0) return null;
  const ship = args.shipDate.slice(0, 10);
  const baselineStart = addDays(ship, -preDays);
  // Coverage guards: never fabricate zeros for days the read did not cover or
  // GSC has not finalized.
  if (args.knownFrom.slice(0, 10) > baselineStart) return null;
  const lastPostDay = addDays(ship, args.windowDays - 1);
  if (args.lastFinalizedDate == null || args.lastFinalizedDate.slice(0, 10) < lastPostDay) return null;

  const byDate = new Map<string, number>();
  for (const p of args.series) {
    if (p?.date) byDate.set(p.date.slice(0, 10), Number(p.clicks) || 0);
  }
  const clicksOn = (date: string): number => byDate.get(date) ?? 0;

  // Baseline: per-weekday medians + the overall daily mean the raw number uses.
  const byWeekday = new Map<number, number[]>();
  let baselineSum = 0;
  for (let i = 0; i < preDays; i++) {
    const date = addDays(baselineStart, i);
    const clicks = clicksOn(date);
    baselineSum += clicks;
    const wd = weekdayOf(date);
    const list = byWeekday.get(wd) ?? [];
    list.push(clicks);
    byWeekday.set(wd, list);
  }
  const allBaselineMedian = median([...byWeekday.values()].flat());
  const medianForWeekday = (wd: number): number => {
    const list = byWeekday.get(wd);
    return list && list.length > 0 ? median(list) : allBaselineMedian;
  };

  let postSum = 0;
  let adjusted = 0;
  for (let i = 0; i < args.windowDays; i++) {
    const date = addDays(ship, i);
    const clicks = clicksOn(date);
    postSum += clicks;
    adjusted += clicks - medianForWeekday(weekdayOf(date));
  }

  const rawLift = round1(postSum - (baselineSum / preDays) * args.windowDays);
  const weekdayAdjustedLift = round1(adjusted);

  const denom = Math.max(Math.abs(rawLift), 1);
  const preferAdjusted =
    Math.abs(weekdayAdjustedLift - rawLift) / denom > PREFER_ADJUSTED_DIFF_FRACTION;

  let sentence: string | null = null;
  if (preferAdjusted) {
    // Name the honest reason: a real weekend pattern gets the weekend
    // sentence; otherwise the medians are simply steadier than a mean that a
    // spike day can drag around.
    const weekendMedian = median(
      [...(byWeekday.get(0) ?? []), ...(byWeekday.get(6) ?? [])],
    );
    const weekdayMedian = median(
      [1, 2, 3, 4, 5].flatMap((wd) => byWeekday.get(wd) ?? []),
    );
    const weekendPattern =
      Math.abs(weekendMedian - weekdayMedian) >
      WEEKEND_PATTERN_MIN_DIFF_FRACTION * Math.max(weekdayMedian, 1);
    const why = weekendPattern
      ? "Weekends behave differently on this site, so I compare like with like."
      : "A few unusual days skew the plain average on this page, so I compare each day with a typical same weekday instead.";
    sentence = `${why} Read this as about ${fmtClicks(weekdayAdjustedLift)} clicks over ${args.windowDays} days, not ${fmtClicks(rawLift)}.`;
  }

  return { windowDays: args.windowDays, rawLift, weekdayAdjustedLift, preferAdjusted, sentence };
}
