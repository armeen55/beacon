/**
 * novelty-decay (BEACON_500 P4 R10a, v1 item 378, 2026-07-03) - the
 * "first week jump that faded" detector for a shipped change.
 *
 * A change whose daily clicks lift PEAKS in week 1 and has decayed back
 * toward the baseline by week 4 is most likely a novelty effect (freshness
 * boost, recrawl bump, social echo), not a lasting win. This attaches
 * noveltyDecay: true plus the honest sentence, and feeds N10's verdict
 * reliability grade as a demotion input - it NEVER changes the stored
 * verdict, windows, or clock. Computed-only, recomputed on every measure,
 * never persisted (recordToRow omits it).
 *
 * PURE - no I/O. Pinned by novelty-decay.test.ts.
 */

import { addDays } from "./measure";
import type { DailyClickPoint } from "./weekday-baseline";

export type NoveltyDecayRead = {
  /** True when the lift peaked in week 1 and decayed back toward baseline by week 4. */
  noveltyDecay: boolean;
  /** Mean daily clicks lift vs the baseline daily mean, post weeks 1 through 4. */
  weeklyLift: [number, number, number, number];
  /** The honest sentence, non-null only when noveltyDecay fired. */
  sentence: string | null;
};

/** Week 1 must be a real jump: at least this fraction of the baseline daily
 *  mean, floored at 1 extra click a day, before a fade is worth flagging. */
const MIN_PEAK_FRACTION_OF_BASELINE = 0.2;
const MIN_PEAK_DAILY_LIFT = 1;
/** "Decayed back toward baseline" = week 4 keeps at most this fraction of the
 *  week 1 lift. */
const MAX_WEEK4_RETENTION = 0.3;

const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The novelty-decay read. Needs the FULL four post-ship weeks finalized (the
 * shape question is unanswerable earlier) and full baseline coverage - both
 * honest-absence guards mirror weekday-baseline.ts, so a day never reads as
 * a fake zero.
 */
export function computeNoveltyDecay(args: {
  series: ReadonlyArray<DailyClickPoint>;
  shipDate: string;
  /** Earliest date the series read covers (the loader's `since`). */
  knownFrom: string;
  /** Latest finalized GSC date - must cover the full 28 post days. */
  lastFinalizedDate: string | null;
  preWindowDays?: number;
}): NoveltyDecayRead | null {
  const preDays = args.preWindowDays ?? 28;
  const ship = args.shipDate.slice(0, 10);
  const baselineStart = addDays(ship, -preDays);
  if (args.knownFrom.slice(0, 10) > baselineStart) return null;
  const lastPostDay = addDays(ship, 27);
  if (args.lastFinalizedDate == null || args.lastFinalizedDate.slice(0, 10) < lastPostDay) return null;

  const byDate = new Map<string, number>();
  for (const p of args.series) {
    if (p?.date) byDate.set(p.date.slice(0, 10), Number(p.clicks) || 0);
  }
  const clicksOn = (date: string): number => byDate.get(date) ?? 0;

  const baseline: number[] = [];
  for (let i = 0; i < preDays; i++) baseline.push(clicksOn(addDays(baselineStart, i)));
  const mu = mean(baseline);

  const weeklyLift = [0, 1, 2, 3].map((week) => {
    const days: number[] = [];
    for (let i = week * 7; i < week * 7 + 7; i++) days.push(clicksOn(addDays(ship, i)));
    return round1(mean(days) - mu);
  }) as [number, number, number, number];

  const [w1, , , w4] = weeklyLift;
  const minPeak = Math.max(MIN_PEAK_DAILY_LIFT, MIN_PEAK_FRACTION_OF_BASELINE * mu);
  const noveltyDecay =
    w1 >= minPeak &&
    weeklyLift.every((w) => w <= w1) &&
    w4 <= MAX_WEEK4_RETENTION * w1;

  let sentence: string | null = null;
  if (noveltyDecay) {
    const w4Phrase =
      w4 <= 0.05 ? "back to its old level" : `back to about ${round1(w4)} extra clicks a day`;
    sentence = `The first week jump faded. This looks like novelty, not a lasting win. Week 1 ran about ${round1(w1)} extra clicks a day and week 4 is ${w4Phrase}.`;
  }

  return { noveltyDecay, weeklyLift, sentence };
}
