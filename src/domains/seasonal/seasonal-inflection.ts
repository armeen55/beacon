/**
 * seasonal/seasonal-inflection (BEACON_500 item 69) - PURE. Computes, at
 * measurement READ TIME, whether a shipped change's measurement window spans
 * a detected demand inflection for its page family - the exact class of bug
 * this item exists to catch: a page shipped 3 weeks before a demand peak
 * reads as a fake win (the lift is the wave arriving, not the change), and
 * diff-in-diff fails outright when the page family IS the seasonal topic (the
 * comparison pages ride the same wave, so "beat the controls" just means "the
 * wave hit this page a little harder").
 *
 * HARD RULE: computed-only. This module has NO I/O and never mutates a stored
 * record. It is attached to a ShippedChangeRecord the exact same way
 * trafficOutcome/bayesianRead are attached in run-measurement.ts's
 * measureRecord - a fresh compute on every read, never persisted (recordToRow
 * in shipped-change-store.ts has no field for it, so there is nothing to
 * accidentally write).
 *
 * "Spans an inflection" means: the measurement window [start, end) overlaps
 * the family's peak window in EITHER the year the window fell in (an annual
 * inflection, from FamilyAnnualInflection's months) OR the ISO week range (a
 * weekly inflection, from FamilyWeeklyInflection's weeks). A window that ships
 * comfortably inside a flat season never gets flagged - only one that
 * actually crosses the boundary into/out of (or sits entirely inside) the
 * family's own detected high-demand window.
 */

import type { FamilyAnnualInflection, FamilyDemandProfile, FamilyWeeklyInflection } from "./family-demand-profile";

export type SeasonalInflectionFlag = {
  /** True when the window overlaps ANY detected inflection (annual or weekly). */
  measuredAcrossSeasonalInflection: boolean;
  /** Which kind of inflection matched (both can be true at once). */
  matchedAnnual: boolean;
  matchedWeekly: boolean;
  /** The page family the check ran against. */
  pageFamily: string;
  /** Plain first-person caveat sentence, ready to render next to the verdict.
   *  Null when measuredAcrossSeasonalInflection is false. */
  caveat: string | null;
};

const NO_FLAG = (pageFamily: string): SeasonalInflectionFlag => ({
  measuredAcrossSeasonalInflection: false,
  matchedAnnual: false,
  matchedWeekly: false,
  pageFamily,
  caveat: null,
});

function toUtcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** 1-12 for every calendar month the [start, end) window touches, across
 *  however many years it spans (a window is always <= 28 days in this
 *  product, so this is at most 2 distinct months in practice, but the loop
 *  is written generally). PURE. */
function monthsTouched(start: string, end: string): Set<number> {
  const out = new Set<number>();
  const startD = toUtcDate(start);
  const endD = toUtcDate(end);
  if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime())) return out;
  const cur = new Date(startD.getTime());
  let guard = 0;
  while (cur.getTime() <= endD.getTime() && guard < 400) {
    out.add(cur.getUTCMonth() + 1);
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

function isoWeekOf(d: Date): number {
  const target = new Date(d.getTime());
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** ISO weeks-of-year touched by [start, end). PURE. */
function weeksTouched(start: string, end: string): Set<number> {
  const out = new Set<number>();
  const startD = toUtcDate(start);
  const endD = toUtcDate(end);
  if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime())) return out;
  const cur = new Date(startD.getTime());
  let guard = 0;
  while (cur.getTime() <= endD.getTime() && guard < 400) {
    out.add(isoWeekOf(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

function overlapsAnnual(windowMonths: Set<number>, inflection: FamilyAnnualInflection): boolean {
  return inflection.months.some((m) => windowMonths.has(m));
}

function overlapsWeekly(windowWeeks: Set<number>, inflection: FamilyWeeklyInflection): boolean {
  return inflection.weeks.some((w) => windowWeeks.has(w));
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthWindowLabel(months: number[]): string {
  if (months.length === 1) return MONTH_NAMES[months[0]! - 1]!;
  return `${MONTH_NAMES[months[0]! - 1]} and ${MONTH_NAMES[months[1]! - 1]}`;
}

/**
 * Compute the seasonal-inflection flag for one measurement window against one
 * family's demand profile. PURE, $0, no I/O. Returns the no-flag shape when
 * the profile has no detected inflection at all (never a fabricated caveat
 * off missing data).
 */
export function computeSeasonalInflection(args: {
  pageFamily: string;
  windowStart: string; // YYYY-MM-DD, inclusive
  windowEnd: string; // YYYY-MM-DD, exclusive per measurementWindowOf's convention
  profile: FamilyDemandProfile | null | undefined;
}): SeasonalInflectionFlag {
  const { pageFamily, windowStart, windowEnd, profile } = args;
  if (!profile || (!profile.annual.length && !profile.weekly.length)) return NO_FLAG(pageFamily);
  if (!windowStart || !windowEnd) return NO_FLAG(pageFamily);

  const windowMonths = monthsTouched(windowStart, windowEnd);
  const windowWeeks = weeksTouched(windowStart, windowEnd);

  const matchedAnnualEntry = profile.annual.find((a) => overlapsAnnual(windowMonths, a)) ?? null;
  const matchedWeeklyEntry = profile.weekly.find((w) => overlapsWeekly(windowWeeks, w)) ?? null;

  const matchedAnnual = matchedAnnualEntry != null;
  const matchedWeekly = matchedWeeklyEntry != null;
  if (!matchedAnnual && !matchedWeekly) return NO_FLAG(pageFamily);

  let caveat: string;
  if (matchedAnnualEntry) {
    const windowLabel = monthWindowLabel(matchedAnnualEntry.months);
    const confidenceWord = matchedAnnualEntry.confidence === "repeated" ? "repeats every year" : "showed up once so far";
    caveat = `This page's family usually sees a demand swing in ${windowLabel} that ${confidenceWord}, and this measurement window overlaps it. I am reading the result cautiously - the swing itself can look like a win or a loss that has nothing to do with the change.`;
  } else {
    caveat = "This page's family has a recurring weekly demand swing that overlaps this measurement window. I am reading the result cautiously - the swing itself can look like a win or a loss that has nothing to do with the change.";
  }

  return {
    measuredAcrossSeasonalInflection: true,
    matchedAnnual,
    matchedWeekly,
    pageFamily,
    caveat,
  };
}
