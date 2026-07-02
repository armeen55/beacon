/**
 * seasonal/family-demand-profile (BEACON_500 item 69) - PURE. Extends the
 * per-query seasonality detector (seasonality.ts) to the page-FAMILY level, so
 * the seasonality engine can answer "is this whole family of pages seasonal",
 * not just "is this one query seasonal". A page family is the same grouping
 * daily-experiment-planner.ts already uses everywhere else (pageFamilyOf: the
 * first path segment), reused here rather than re-invented.
 *
 * Why family, not query: a page shipped 3 weeks before a demand peak reads as
 * a fake win in diff-in-diff (the whole family - treated AND any comparison
 * pages in the same family - rides the same seasonal wave, so "beat the
 * controls" can just mean "the wave hit this family a little harder"). Rolling
 * demand up to the family level is what measurement-maturity's inflection flag
 * needs: "does this family, as a whole, swing on a calendar rhythm."
 *
 * Two profiles, from two different sources (same split load-monthly-archive.ts
 * / a live daily read already use elsewhere in this domain):
 *
 *   ANNUAL  - built from gsc_monthly_archive rows (permanent, monthly grain).
 *             Reuses the exact share+floor method detectSeasonalQueries uses,
 *             just keyed by family (via topPage) instead of by query.
 *
 *   WEEKLY  - built from recent daily page-level rows (gsc_daily_page_totals;
 *             GSC/Beacon's own retention is much shorter than the permanent
 *             monthly archive), bucketed by ISO week-of-year (1-53) so a
 *             family's within-year rhythm (which weeks run hot) is visible
 *             even before a full annual cycle of monthly-archive history has
 *             accumulated. Honest about its own thinness: weeksOfHistory
 *             reports how many distinct weeks actually fed the profile.
 *
 * Deterministic, $0, no I/O. Fail-closed: a family with too little data, or a
 * flat spread, gets no inflection windows - never a fabricated-looking peak.
 */

/** One page-level daily/period row (matches gsc_daily_page_totals's shape). */
export type FamilyDailyRow = {
  page: string;
  /** YYYY-MM-DD. */
  date: string;
  impressions: number;
  clicks: number;
};

/** Re-export the monthly-archive row shape so callers don't need to import
 *  seasonality.ts just to build a family profile. */
export type FamilyMonthlyRow = {
  query: string;
  month: string; // YYYY-MM (or any ISO date within the month)
  impressions: number;
  clicks: number;
  topPage?: string | null;
};

/** A single detected weekly-recurring high-demand window for a family. */
export type FamilyWeeklyInflection = {
  /** ISO week-of-year, 1-53 (peak first if a 2-week window). */
  weeks: number[];
  /** Share of the observed weekly impressions held by this window (0..1). */
  share: number;
  /** Total impressions across all observed weeks for this family. */
  observedImpressions: number;
};

/** A single detected annual-recurring high-demand window for a family. */
export type FamilyAnnualInflection = {
  /** 1-12 (peak first if a 2-month window). */
  months: number[];
  share: number;
  annualImpressions: number;
  confidence: "one_season" | "repeated";
};

export type FamilyDemandProfile = {
  pageFamily: string;
  /** How many distinct ISO weeks of daily data fed the weekly profile. */
  weeksOfHistory: number;
  /** How many distinct calendar years fed the annual profile. */
  yearsOfHistory: number;
  weekly: FamilyWeeklyInflection[];
  annual: FamilyAnnualInflection[];
  /** Pages observed in this family (bounded, for display/debugging). */
  samplePages: string[];
};

/** A peak window must hold at least this share of the observed period's
 *  impressions before a family counts as seasonal (mirrors SEASONAL_MIN_SHARE
 *  in seasonality.ts - same bar, same honesty posture). */
export const FAMILY_SEASONAL_MIN_SHARE = 0.6;
/** Floor: total impressions across the observed period must clear this before
 *  a family is called seasonal at all (mirrors SEASONAL_MIN_ANNUAL_IMPRESSIONS). */
export const FAMILY_SEASONAL_MIN_IMPRESSIONS = 200;
/** A weekly profile needs at least this many distinct ISO weeks of data before
 *  it is trusted to name a window (four weeks - anything thinner is too noisy
 *  to call a "weekly rhythm" rather than one lucky week). */
export const MIN_WEEKS_FOR_WEEKLY_PROFILE = 4;

function isoWeekOf(dateIso: string): { isoYear: number; isoWeek: number } | null {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // ISO 8601 week: Thursday of the week decides the week's year.
  const target = new Date(d.getTime());
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { isoYear: target.getUTCFullYear(), isoWeek: week };
}

function pageFamilyOfPath(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

function monthBefore(m: number): number {
  return m === 1 ? 12 : m - 1;
}
function monthAfter(m: number): number {
  return m === 12 ? 1 : m + 1;
}
function weekBefore(w: number, maxWeek: number): number {
  return w === 1 ? maxWeek : w - 1;
}
function weekAfter(w: number, maxWeek: number): number {
  return w === maxWeek ? 1 : w + 1;
}

function parseYearMonth(iso: string): { year: number; month: number } | null {
  const s = (iso || "").slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

type MonthBucket = { impressions: number; years: Set<number> };
type WeekBucket = { impressions: number; weekKeys: Set<string> };

/** Build the ANNUAL half of a family's profile from monthly-archive rows,
 *  grouped by pageFamilyOf(topPage). Rows with no topPage can't be attributed
 *  to a family and are skipped (honest: we never guess a family from a bare
 *  query string). PURE. */
function buildAnnualByFamily(rows: readonly FamilyMonthlyRow[]): Map<string, { months: Map<number, MonthBucket>; annualImpressions: number; samplePages: Set<string> }> {
  const byFamily = new Map<string, { months: Map<number, MonthBucket>; annualImpressions: number; samplePages: Set<string> }>();
  for (const r of rows) {
    if (!r.topPage) continue;
    const parsed = parseYearMonth(r.month);
    if (!parsed) continue;
    const impr = Math.max(0, Number(r.impressions) || 0);
    if (impr === 0) continue;
    const family = pageFamilyOfPath(r.topPage);
    let entry = byFamily.get(family);
    if (!entry) {
      entry = { months: new Map(), annualImpressions: 0, samplePages: new Set() };
      byFamily.set(family, entry);
    }
    let bucket = entry.months.get(parsed.month);
    if (!bucket) {
      bucket = { impressions: 0, years: new Set() };
      entry.months.set(parsed.month, bucket);
    }
    bucket.impressions += impr;
    bucket.years.add(parsed.year);
    entry.annualImpressions += impr;
    entry.samplePages.add(r.topPage);
  }
  return byFamily;
}

/** Pick the best 1-2 adjacent month window for a family's month buckets,
 *  mirroring detectSeasonalQueries's share+floor test exactly. PURE. Returns
 *  null when the family doesn't clear the floor or is too flat. */
function bestAnnualWindow(
  months: Map<number, MonthBucket>,
  annualImpressions: number,
): FamilyAnnualInflection | null {
  if (annualImpressions < FAMILY_SEASONAL_MIN_IMPRESSIONS || months.size === 0) return null;

  let peakMonth = -1;
  let peakImpr = -1;
  for (const [m, b] of months) {
    if (b.impressions > peakImpr) {
      peakImpr = b.impressions;
      peakMonth = m;
    }
  }
  if (peakMonth < 0) return null;

  const before = months.get(monthBefore(peakMonth));
  const after = months.get(monthAfter(peakMonth));
  const beforeImpr = before?.impressions ?? 0;
  const afterImpr = after?.impressions ?? 0;
  const extendMonth = beforeImpr >= afterImpr ? monthBefore(peakMonth) : monthAfter(peakMonth);
  const extendImpr = Math.max(beforeImpr, afterImpr);

  const soloShare = peakImpr / annualImpressions;
  const pairShare = (peakImpr + extendImpr) / annualImpressions;

  let peakMonths: number[];
  let share: number;
  if (pairShare >= FAMILY_SEASONAL_MIN_SHARE && extendImpr > 0) {
    const wraps = (peakMonth === 12 && extendMonth === 1) || (peakMonth === 1 && extendMonth === 12);
    peakMonths = wraps || extendMonth > peakMonth ? [peakMonth, extendMonth] : [extendMonth, peakMonth];
    share = pairShare;
  } else if (soloShare >= FAMILY_SEASONAL_MIN_SHARE) {
    peakMonths = [peakMonth];
    share = soloShare;
  } else {
    return null;
  }

  const yearsInWindow = new Set<number>();
  for (const m of peakMonths) {
    const b = months.get(m);
    if (b) for (const y of b.years) yearsInWindow.add(y);
  }
  const confidence: FamilyAnnualInflection["confidence"] = yearsInWindow.size >= 2 ? "repeated" : "one_season";

  return {
    months: peakMonths,
    share: Math.round(share * 1000) / 1000,
    annualImpressions,
    confidence,
  };
}

/** Build the WEEKLY half of a family's profile from daily page-level rows,
 *  grouped by pageFamilyOf(page) and bucketed by ISO week-of-year. PURE. */
function buildWeeklyByFamily(rows: readonly FamilyDailyRow[]): Map<string, { weeks: Map<number, WeekBucket>; observedImpressions: number }> {
  const byFamily = new Map<string, { weeks: Map<number, WeekBucket>; observedImpressions: number }>();
  for (const r of rows) {
    if (!r.page || !r.date) continue;
    const iso = isoWeekOf(r.date);
    if (!iso) continue;
    const impr = Math.max(0, Number(r.impressions) || 0);
    if (impr === 0) continue;
    const family = pageFamilyOfPath(r.page);
    let entry = byFamily.get(family);
    if (!entry) {
      entry = { weeks: new Map(), observedImpressions: 0 };
      byFamily.set(family, entry);
    }
    let bucket = entry.weeks.get(iso.isoWeek);
    if (!bucket) {
      bucket = { impressions: 0, weekKeys: new Set() };
      entry.weeks.set(iso.isoWeek, bucket);
    }
    bucket.impressions += impr;
    bucket.weekKeys.add(`${iso.isoYear}-W${iso.isoWeek}`);
    entry.observedImpressions += impr;
  }
  return byFamily;
}

/** Pick the best 1-2 adjacent ISO-week window for a family's week buckets.
 *  Same share+floor discipline as bestAnnualWindow, wrapped at MAX_ISO_WEEK
 *  instead of 12 months. PURE. Requires MIN_WEEKS_FOR_WEEKLY_PROFILE distinct
 *  weeks of data before it will name a window (thin daily history is honestly
 *  silent rather than calling one busy week "the pattern"). */
const MAX_ISO_WEEK = 53;

function bestWeeklyWindow(
  weeks: Map<number, WeekBucket>,
  observedImpressions: number,
  distinctWeeks: number,
): FamilyWeeklyInflection | null {
  if (distinctWeeks < MIN_WEEKS_FOR_WEEKLY_PROFILE) return null;
  if (observedImpressions < FAMILY_SEASONAL_MIN_IMPRESSIONS || weeks.size === 0) return null;

  let peakWeek = -1;
  let peakImpr = -1;
  for (const [w, b] of weeks) {
    if (b.impressions > peakImpr) {
      peakImpr = b.impressions;
      peakWeek = w;
    }
  }
  if (peakWeek < 0) return null;

  const before = weeks.get(weekBefore(peakWeek, MAX_ISO_WEEK));
  const after = weeks.get(weekAfter(peakWeek, MAX_ISO_WEEK));
  const beforeImpr = before?.impressions ?? 0;
  const afterImpr = after?.impressions ?? 0;
  const extendWeek = beforeImpr >= afterImpr ? weekBefore(peakWeek, MAX_ISO_WEEK) : weekAfter(peakWeek, MAX_ISO_WEEK);
  const extendImpr = Math.max(beforeImpr, afterImpr);

  const soloShare = peakImpr / observedImpressions;
  const pairShare = (peakImpr + extendImpr) / observedImpressions;

  let peakWeeks: number[];
  let share: number;
  if (pairShare >= FAMILY_SEASONAL_MIN_SHARE && extendImpr > 0) {
    const wraps = (peakWeek === MAX_ISO_WEEK && extendWeek === 1) || (peakWeek === 1 && extendWeek === MAX_ISO_WEEK);
    peakWeeks = wraps || extendWeek > peakWeek ? [peakWeek, extendWeek] : [extendWeek, peakWeek];
    share = pairShare;
  } else if (soloShare >= FAMILY_SEASONAL_MIN_SHARE) {
    peakWeeks = [peakWeek];
    share = soloShare;
  } else {
    return null;
  }

  return {
    weeks: peakWeeks,
    share: Math.round(share * 1000) / 1000,
    observedImpressions,
  };
}

/**
 * Build per-pageFamily demand profiles from the tenant's monthly archive
 * (annual) and recent daily page rows (weekly). PURE, deterministic, $0.
 * Families with no signal in either source are simply absent from the output
 * (never a zero-filled placeholder).
 */
export function buildFamilyDemandProfiles(input: {
  monthlyRows: readonly FamilyMonthlyRow[];
  dailyRows: readonly FamilyDailyRow[];
}): FamilyDemandProfile[] {
  const annualByFamily = buildAnnualByFamily(input.monthlyRows);
  const weeklyByFamily = buildWeeklyByFamily(input.dailyRows);

  const families = new Set<string>([...annualByFamily.keys(), ...weeklyByFamily.keys()]);
  const out: FamilyDemandProfile[] = [];

  for (const family of families) {
    const annualEntry = annualByFamily.get(family);
    const weeklyEntry = weeklyByFamily.get(family);

    const annualWindow = annualEntry ? bestAnnualWindow(annualEntry.months, annualEntry.annualImpressions) : null;
    const distinctWeeks = weeklyEntry ? new Set([...weeklyEntry.weeks.values()].flatMap((b) => [...b.weekKeys])).size : 0;
    const weeklyWindow = weeklyEntry ? bestWeeklyWindow(weeklyEntry.weeks, weeklyEntry.observedImpressions, distinctWeeks) : null;

    if (!annualWindow && !weeklyWindow) continue; // no detectable rhythm - stay silent

    const yearsOfHistory = annualEntry
      ? new Set([...annualEntry.months.values()].flatMap((b) => [...b.years])).size
      : 0;

    out.push({
      pageFamily: family,
      weeksOfHistory: distinctWeeks,
      yearsOfHistory,
      weekly: weeklyWindow ? [weeklyWindow] : [],
      annual: annualWindow ? [annualWindow] : [],
      samplePages: annualEntry ? [...annualEntry.samplePages].slice(0, 5) : [],
    });
  }

  // Rank: bigger annual signal first (the families most worth an operator's
  // attention lead), families with only a weekly signal after.
  out.sort((a, b) => {
    const aImpr = a.annual[0]?.annualImpressions ?? 0;
    const bImpr = b.annual[0]?.annualImpressions ?? 0;
    return bImpr - aImpr;
  });

  return out;
}

/** True when `family` has ANY detected annual or weekly inflection window -
 *  the cheap existence check measurement-maturity's read path uses before
 *  doing the more precise date-overlap math. PURE. */
export function familyHasInflection(profile: FamilyDemandProfile | undefined | null): boolean {
  return !!profile && (profile.annual.length > 0 || profile.weekly.length > 0);
}
