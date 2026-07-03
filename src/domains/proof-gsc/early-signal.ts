/**
 * early-signal (BEACON_500 P4 R10a, v1 item 288, 2026-07-03) - adaptive
 * window READS for a shipped change, without ever touching the clock.
 *
 * When a result is decisive early (every recent post-ship day far outside the
 * baseline's normal daily range, in the same direction, for 7+ consecutive
 * days) this attaches earlyDecisive so the presentation can say "This is
 * working so clearly I do not need the full 28 days to tell you." The same
 * shape in reverse (bounds that already exclude any meaningful effect after
 * two weeks) attaches earlyFutile. HARD RULE: neither flag closes, shortens,
 * or reopens any measurement window - the 7/14/28 clock rules from N11 are
 * inviolable. This is presentation language plus an N10 confidence input,
 * nothing else. Computed-only, recomputed on every measure, never persisted.
 *
 * PURE - no I/O. Pinned by early-signal.test.ts.
 */

import { addDays } from "./measure";
import type { DailyClickPoint } from "./weekday-baseline";

export type EarlySignalRead = {
  /** True when the last 7+ finalized post-ship days are ALL far outside the
   *  baseline's normal daily range in the same direction. */
  earlyDecisive: boolean;
  /** Which way the decisive run points; null unless earlyDecisive. */
  direction: "up" | "down" | null;
  /** True when, after 14+ finalized post days, the daily movement's plausible
   *  range already excludes any meaningful effect in either direction. */
  earlyFutile: boolean;
  /** Length of the qualifying current run of far-outside days (0 when the
   *  most recent finalized day is back inside the normal range). */
  qualifyingRunDays: number;
  /** How many finalized post-ship days this read actually saw. */
  postDaysRead: number;
  /** The plain presentation sentence, non-null only when a flag fired. */
  sentence: string | null;
};

/** "Far outside its normal range" = beyond this many baseline daily spreads. */
const DECISIVE_SPREAD_MULTIPLE = 3;
/** The decisive run must cover at least this many consecutive recent days. */
const DECISIVE_MIN_CONSECUTIVE_DAYS = 7;
/** The futility read needs at least this many finalized post days. */
const FUTILE_MIN_POST_DAYS = 14;
/** A meaningful daily effect: 10 percent of the baseline daily mean, floored
 *  at the verdict's own 3-clicks-per-28-days minimum (measure.ts's
 *  DEFAULT_MIN_LIFT_CLICKS spread over the full window). */
const MEANINGFUL_DAILY_FRACTION = 0.1;
const MEANINGFUL_DAILY_FLOOR = 3 / 28;

const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const stdDev = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

/**
 * The early-signal read for a change whose 28-day window has NOT closed yet.
 * Honest-absence rules match weekday-baseline.ts: null when the series read
 * does not cover the whole baseline window, or when GSC has not finalized a
 * single post-ship day. Days past the finalized watermark are never read as
 * zeros.
 */
export function computeEarlySignal(args: {
  series: ReadonlyArray<DailyClickPoint>;
  shipDate: string;
  /** Earliest date the series read covers (the loader's `since`). */
  knownFrom: string;
  /** Latest finalized GSC date - the post read stops here. */
  lastFinalizedDate: string | null;
  preWindowDays?: number;
  /** Post days are capped at the full proof window. */
  maxPostDays?: number;
}): EarlySignalRead | null {
  const preDays = args.preWindowDays ?? 28;
  const maxPost = args.maxPostDays ?? 28;
  const ship = args.shipDate.slice(0, 10);
  const baselineStart = addDays(ship, -preDays);
  if (args.knownFrom.slice(0, 10) > baselineStart) return null;
  const lastFinal = args.lastFinalizedDate ? args.lastFinalizedDate.slice(0, 10) : null;
  if (lastFinal == null || lastFinal < ship) return null;

  const byDate = new Map<string, number>();
  for (const p of args.series) {
    if (p?.date) byDate.set(p.date.slice(0, 10), Number(p.clicks) || 0);
  }
  const clicksOn = (date: string): number => byDate.get(date) ?? 0;

  const baseline: number[] = [];
  for (let i = 0; i < preDays; i++) baseline.push(clicksOn(addDays(baselineStart, i)));
  const mu = mean(baseline);
  // A page's daily clicks are counts: a perfectly flat baseline still has
  // count-level noise, so the spread is floored at the square root of the
  // daily mean (and never below 1) - a dead-flat tiny page can not flag
  // "decisive" off ordinary single-click wobble.
  const spread = Math.max(stdDev(baseline), Math.sqrt(Math.max(mu, 1)));

  const post: number[] = [];
  for (let i = 0; i < maxPost; i++) {
    const date = addDays(ship, i);
    if (date > lastFinal) break;
    post.push(clicksOn(date));
  }
  const n = post.length;
  if (n === 0) return null;

  // Decisive: the CURRENT run of same-direction far-outside days, ending at
  // the most recent finalized day - "is working so clearly" is a present
  // tense claim, so a spike that already normalized never qualifies.
  let run = 0;
  let runDir: "up" | "down" | null = null;
  for (let i = n - 1; i >= 0; i--) {
    const z = (post[i] - mu) / spread;
    const dir: "up" | "down" | null =
      z > DECISIVE_SPREAD_MULTIPLE ? "up" : z < -DECISIVE_SPREAD_MULTIPLE ? "down" : null;
    if (dir == null || (runDir != null && dir !== runDir)) break;
    runDir = dir;
    run++;
  }
  const earlyDecisive = run >= DECISIVE_MIN_CONSECUTIVE_DAYS && runDir != null;
  const direction = earlyDecisive ? runDir : null;

  // Futile: after two weeks, does the plausible range of the mean daily
  // movement already exclude a meaningful effect BOTH ways? Uses the wider of
  // the baseline and post-period spreads (floored) so a noisy page never
  // reads futile off a lucky-flat stretch.
  let earlyFutile = false;
  if (!earlyDecisive && n >= FUTILE_MIN_POST_DAYS) {
    const meanLift = mean(post) - mu;
    const ciSpread = Math.max(stdDev(baseline), stdDev(post), 0.5);
    const halfWidth = (2 * ciSpread) / Math.sqrt(n);
    const meaningfulDaily = Math.max(MEANINGFUL_DAILY_FRACTION * mu, MEANINGFUL_DAILY_FLOOR);
    earlyFutile = meanLift + halfWidth < meaningfulDaily && meanLift - halfWidth > -meaningfulDaily;
  }

  let sentence: string | null = null;
  if (earlyDecisive && direction === "up") {
    sentence = `This is working so clearly I do not need the full 28 days to tell you. Every one of the last ${run} days is far above this page's normal range. The final call still waits for the full window.`;
  } else if (earlyDecisive && direction === "down") {
    sentence = `This is hurting so clearly I do not need the full 28 days to tell you. Every one of the last ${run} days is far below this page's normal range. The final call still waits for the full window.`;
  } else if (earlyFutile) {
    sentence = `After ${n} days this change is very unlikely to move this page in any meaningful way. I will still let the full window finish before calling it.`;
  }

  return {
    earlyDecisive,
    direction,
    earlyFutile,
    qualifyingRunDays: run,
    postDaysRead: n,
    sentence,
  };
}
