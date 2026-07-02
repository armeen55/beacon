/**
 * Lifetime earnings odometer (BEACON_500 item 40, 2026-07-02).
 *
 * A second money line for Today, ABOVE the per-change dollar attribution
 * (change-dollar-value.ts, item 22): instead of "this one change is worth
 * $X/month", this rolls up EVERY mature, won, cleanly-attributed change into
 * one compounding number the operator watches grow: "the changes I shipped
 * are worth about $X a month, and they have earned about 1,240 extra clicks
 * since we started."
 *
 * PURE. No I/O. The caller (a loader in this same domain) supplies one row
 * per mature won change with the numbers already computed elsewhere:
 *   - `extraSessionsPerMonth` / `usdPerMonth`: the SAME control-adjusted
 *     monthly rate change-dollar-value.ts already computed for that row
 *     (never re-derived here - this module only aggregates and prorates).
 *   - `daysLive`: days between ship and now, so a change shipped yesterday
 *     doesn't claim a full month of earnings yet.
 *
 * HONEST PRORATION (documented, not hidden):
 *   Lifetime extra clicks for one row = monthly rate x (daysLive / 30),
 *   CAPPED at daysLive so a long-lived win can't compound past its own
 *   lifetime, and the monthly rate itself is held CONSTANT over the whole
 *   life of the change (we do not have a daily lift series to integrate
 *   over, only the single most-recent measured monthly rate). This is a
 *   deliberate simplification: it assumes the change's lift on day 1 was
 *   already at today's measured rate, which is the most optimistic honest
 *   reading available from a single before/after diff-in-diff. The sentence
 *   says "about" and never claims day-by-day precision.
 *
 *   Dollars lifetime-to-date are NOT summed the same way (a lifetime dollar
 *   odometer would double-count months already reported elsewhere); this
 *   module reports (a) the CURRENT combined monthly run-rate in dollars
 *   across all mature wins, and (b) the LIFETIME extra clicks earned. That
 *   mirrors exactly what the item asks for: "worth about $X a month" (a
 *   rate) plus "earned about N extra clicks since we started" (a total).
 *
 * DEGRADE MATRIX:
 *   - No mature wins at all -> null (silence, not a fabricated zero).
 *   - Mature wins exist but no usable revenue model on ANY of them -> clicks-
 *     only sentence, no dollar figure anywhere.
 *   - A mix of rows with and without a dollar figure -> dollars sum only the
 *     rows that HAVE one; clicks sum every mature win regardless. The
 *     sentence always states clicks; it states dollars only when at least
 *     one row contributed a positive monthly rate.
 *
 * Deterministic. No dates read internally (the caller passes `daysLive`
 * already computed against `now`), no randomness. No em dash or en dash
 * anywhere in generated copy (hyphens only).
 *
 * Pinned by tests/domains/proof-gsc/lifetime-earnings.test.ts.
 */

export type LifetimeEarningsRow = {
  /** Stable id, for dedupe/debugging only - not used in the math. */
  id: string;
  /** Control-adjusted extra sessions/clicks this change is CURRENTLY earning
   *  per month, at its most recent measurement (change-dollar-value.ts's
   *  toMonthlyRate output). Positive = gained. A won row should be positive,
   *  but this module doesn't re-verify direction - callers gate on "won". */
  extraSessionsPerMonth: number;
  /** The same row's dollar figure at that rate, or null when no revenue
   *  model is configured (change-dollar-value.ts's usdPerMonth). */
  usdPerMonth: number | null;
  /** Whole days between ship and now (>= 0). Used only to prorate the
   *  lifetime click total, never the monthly rate. */
  daysLive: number;
};

export type LifetimeEarnings = {
  /** How many mature won changes contributed. */
  changeCount: number;
  /** Sum of each row's current monthly extra-clicks rate. */
  clicksPerMonth: number;
  /** Sum of each row's lifetime-to-date extra clicks (proration below). */
  lifetimeExtraClicks: number;
  /** Sum of usdPerMonth across rows that HAVE a dollar figure, or null when
   *  none do (clicks-only degrade). */
  usdPerMonth: number | null;
  /** How many of the changeCount rows actually contributed a dollar figure -
   *  lets the sentence stay honest when only some rows have a revenue model
   *  applied historically (all rows share one tenant-wide model today, so in
   *  practice this is either 0 or changeCount, but the aggregator doesn't
   *  assume that). */
  changesWithDollarValue: number;
  /** One plain first-person sentence, no em/en dashes. Always names the
   *  clicks; names dollars only when usdPerMonth is a usable positive
   *  number. */
  sentence: string;
};

const DAYS_PER_MONTH = 30;
const roundWhole = (v: number): number => Math.round(v);
const roundCents = (v: number): number => Math.round(v * 100) / 100;

function fmtCount(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const rounded = abs < 10 ? roundCents(abs) : roundWhole(abs);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: rounded < 10 && rounded % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Prorate one row's current monthly rate down to a lifetime-to-date total.
 * Capped so a change can never claim more days of earnings than it has been
 * alive, and floored at 0 (a bad/negative daysLive input contributes nothing
 * rather than subtracting from the total).
 */
export function proratedLifetimeClicks(extraSessionsPerMonth: number, daysLive: number): number {
  if (!Number.isFinite(extraSessionsPerMonth) || !Number.isFinite(daysLive) || daysLive <= 0) return 0;
  const months = daysLive / DAYS_PER_MONTH;
  return extraSessionsPerMonth * months;
}

/**
 * Aggregate every mature-won row into one odometer. Returns null when there
 * are zero rows (silence - never a fabricated "$0 a month" line). Pure;
 * callers gate which rows qualify (mature_result, verdict=won, weather- and
 * weak-comparison-clean) before calling this.
 */
export function computeLifetimeEarnings(rows: ReadonlyArray<LifetimeEarningsRow>): LifetimeEarnings | null {
  if (rows.length === 0) return null;

  let clicksPerMonth = 0;
  let lifetimeExtraClicks = 0;
  let usdTotal = 0;
  let changesWithDollarValue = 0;

  for (const r of rows) {
    const rate = Number.isFinite(r.extraSessionsPerMonth) ? r.extraSessionsPerMonth : 0;
    clicksPerMonth += rate;
    lifetimeExtraClicks += proratedLifetimeClicks(rate, r.daysLive);
    if (r.usdPerMonth != null && Number.isFinite(r.usdPerMonth)) {
      usdTotal += r.usdPerMonth;
      changesWithDollarValue += 1;
    }
  }

  const roundedClicksPerMonth = roundWhole(clicksPerMonth);
  const roundedLifetime = roundWhole(lifetimeExtraClicks);
  const usdPerMonth = changesWithDollarValue > 0 ? roundCents(usdTotal) : null;

  return {
    changeCount: rows.length,
    clicksPerMonth: roundedClicksPerMonth,
    lifetimeExtraClicks: roundedLifetime,
    usdPerMonth,
    changesWithDollarValue,
    sentence: buildSentence({
      changeCount: rows.length,
      lifetimeExtraClicks: roundedLifetime,
      usdPerMonth,
    }),
  };
}

function buildSentence(args: {
  changeCount: number;
  lifetimeExtraClicks: number;
  usdPerMonth: number | null;
}): string {
  const { changeCount, lifetimeExtraClicks, usdPerMonth } = args;
  const changeWord = changeCount === 1 ? "change" : "changes";
  const clicksClause =
    lifetimeExtraClicks > 0
      ? `earned you about ${fmtCount(lifetimeExtraClicks)} extra click${lifetimeExtraClicks === 1 ? "" : "s"} since I started tracking them`
      : "not added up to extra clicks yet, even though they measured as wins";

  if (usdPerMonth != null && usdPerMonth > 0) {
    return `The ${fmtCount(changeCount)} ${changeWord} I shipped that won are worth about $${fmtUsd(usdPerMonth)} a month at your rate, and they have ${clicksClause}.`;
  }
  return `The ${fmtCount(changeCount)} ${changeWord} I shipped that won have ${clicksClause}. Set your rate per visitor or lead in settings to see this in dollars.`;
}
