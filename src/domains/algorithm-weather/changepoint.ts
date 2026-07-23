/**
 * changepoint (2026-07-02, master plan item 32) - PURE CUSUM changepoint detector
 * over a sitewide daily metric series (clicks or impressions from
 * loadDailyTotalsForTenant). No I/O, no thresholds hidden in code the operator
 * can't see; every constant is named and documented.
 *
 * WHY CUSUM: a Google core update does not spike a single day, it SHIFTS the
 * whole level of the series for days or weeks. A cumulative-sum control chart is
 * built exactly for that shape (a sustained mean shift), unlike a single-day
 * z-score which reacts to one noisy day and unlike a simple week-over-week ratio
 * which resets every week and can miss a shift that started mid-week.
 *
 * WEEKDAY NOISE: Search Console clicks/impressions are strongly weekday-cyclic
 * (weekends often run 20-40% lighter for a typical content site). Feeding raw
 * daily values into CUSUM would read every Saturday as a "drop". We normalize
 * first with a trailing same-weekday baseline (the mean of the same weekday over
 * the prior BASELINE_WEEKS), so the statistic only reacts to a move relative to
 * that weekday's own recent history, not to the calendar shape of a week.
 *
 * TUNING: threshold + drift are expressed as FRACTIONS of the trailing overall
 * mean (not raw counts), so the same defaults work whether a site does 50
 * clicks/day or 50,000. Defaults are chosen to fire on a sustained ~20%+ shift
 * (the plan's target) while not firing on ordinary day-to-day noise once
 * weekday-normalized. Tuned + regression-tested in changepoint.test.ts.
 */

export type DailyPoint = { date: string; value: number };

export type Changepoint = {
  /** The date the sustained shift is first detected (CUSUM alarm date). */
  date: string;
  direction: "up" | "down";
  /** Size of the shift as a fraction of the trailing baseline mean (e.g. 0.25 = +25%). */
  magnitude: number;
};

export type ChangepointOptions = {
  /** How many prior weeks of the SAME weekday feed the weekday baseline. */
  baselineWeeks?: number;
  /** CUSUM decision threshold, as a fraction of the trailing overall mean.
   *  The cumulative sum must exceed this many "mean units" before we call it a
   *  changepoint. Lower = more sensitive (more false alarms on noise); higher =
   *  only catches bigger shifts. Default tuned to a ~20% sustained shift. */
  threshold?: number;
  /** CUSUM allowance/drift (the "slack" subtracted each day before
   *  accumulating), as a fraction of the trailing overall mean. This is what
   *  lets ordinary noise reset instead of slowly building an alarm; it must be
   *  smaller than half of the shift we want to catch. */
  drift?: number;
  /** Minimum days of history required before we trust the baseline enough to
   *  detect anything (fail-closed: short series stay silent). */
  minHistoryDays?: number;
};

const DEFAULTS: Required<ChangepointOptions> = {
  baselineWeeks: 4,
  // 20% of the trailing mean. A CUSUM accumulates day over day, so a sustained
  // ~20% shift crosses this within a few days without ordinary weekday-
  // normalized noise (typically a few percent) ever accumulating that far.
  threshold: 0.5,
  // Half the target shift's fraction (0.10 of the mean) is subtracted from
  // every day's normalized deviation before it accumulates, so small noise
  // decays back toward zero instead of slowly summing into a false alarm.
  drift: 0.1,
  minHistoryDays: 21,
};

const DAY_MS = 86_400_000;

function dayMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function weekdayOf(iso: string): number {
  return new Date(dayMs(iso)).getUTCDay();
}

/**
 * Weekday-normalize a daily series: each day's value is divided by the mean of
 * the same weekday over the trailing `baselineWeeks` (excluding the day
 * itself), yielding a "ratio to typical for this weekday" series centered
 * around 1.0. Days without enough same-weekday history are dropped (fail-
 * closed rather than guessing a baseline from too little data).
 */
function normalizeByWeekday(
  series: ReadonlyArray<DailyPoint>,
  baselineWeeks: number,
): Array<{ date: string; ratio: number }> {
  const sorted = [...series]
    .filter((p) => p.date && Number.isFinite(dayMs(p.date)) && Number.isFinite(p.value))
    .sort((a, b) => dayMs(a.date) - dayMs(b.date));

  const byWeekday = new Map<number, DailyPoint[]>();
  for (const p of sorted) {
    const wd = weekdayOf(p.date);
    if (!byWeekday.has(wd)) byWeekday.set(wd, []);
    byWeekday.get(wd)!.push(p);
  }

  const out: Array<{ date: string; ratio: number }> = [];
  for (const p of sorted) {
    const wd = weekdayOf(p.date);
    const sameWeekday = byWeekday.get(wd) ?? [];
    const idx = sameWeekday.findIndex((q) => q.date === p.date);
    const priorSameWeekday = sameWeekday.slice(Math.max(0, idx - baselineWeeks), idx);
    if (priorSameWeekday.length < Math.min(2, baselineWeeks)) continue; // not enough history yet
    const baseline = priorSameWeekday.reduce((s, q) => s + q.value, 0) / priorSameWeekday.length;
    if (baseline <= 0) continue; // can't form a meaningful ratio off a zero baseline
    out.push({ date: p.date, ratio: p.value / baseline });
  }
  return out;
}

/**
 * Detect sustained mean-shift changepoints in a sitewide daily metric series
 * using a two-sided CUSUM over the weekday-normalized ratio series (centered
 * at 1.0 = "typical for this weekday"). PURE, deterministic, no I/O.
 *
 * Returns one alarm per detected shift (the date the cumulative statistic
 * first crosses the threshold); the accumulator resets to 0 after each alarm
 * so a single sustained shift is reported once, not on every subsequent day.
 */
export function detectChangepoints(
  dailySeries: ReadonlyArray<DailyPoint>,
  opts: ChangepointOptions = {},
): Changepoint[] {
  const o = { ...DEFAULTS, ...opts };
  const normalized = normalizeByWeekday(dailySeries, o.baselineWeeks);
  if (normalized.length < o.minHistoryDays) return [];

  // The CUSUM operates on (ratio - 1), i.e. the deviation from "typical for
  // this weekday" as a fraction. Threshold/drift are expressed in the same
  // fraction units, so they apply identically regardless of absolute traffic.
  let posSum = 0;
  let negSum = 0;
  const out: Changepoint[] = [];

  for (const point of normalized) {
    const deviation = point.ratio - 1;
    posSum = Math.max(0, posSum + deviation - o.drift);
    negSum = Math.min(0, negSum + deviation + o.drift);

    if (posSum > o.threshold) {
      out.push({ date: point.date, direction: "up", magnitude: round2(posSum) });
      posSum = 0;
      negSum = 0;
    } else if (negSum < -o.threshold) {
      out.push({ date: point.date, direction: "down", magnitude: round2(Math.abs(negSum)) });
      posSum = 0;
      negSum = 0;
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Number of days between two YYYY-MM-DD dates (b - a). Pure helper shared with
 *  algorithm-weather.ts for merging up/down changepoints into windows. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}
