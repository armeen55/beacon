/**
 * seasonal/seasonality (2026-07-02, master plan item 21) - PURE.
 *
 * Finds queries whose demand concentrates in one or two adjacent calendar
 * months, over Beacon's own permanent monthly archive (gsc_monthly_archive).
 * Nothing here names a holiday or a month by convention - every peak window,
 * every date, every sentence is DERIVED from the rows passed in. A "Nowruz
 * wave" is never hardcoded; it falls out of March/April impressions being
 * disproportionate for a query, whatever that query happens to be.
 *
 * Method: for each query, sum impressions per calendar month (Jan..Dec,
 * folding every year of history into the same 12 buckets - a real seasonal
 * query repeats the same month(s) every year it has data for). A query is
 * "seasonal" when its single biggest month, or that month plus an adjacent
 * one, holds >= SEASONAL_MIN_SHARE of its annual impressions, AND the annual
 * total clears SEASONAL_MIN_ANNUAL_IMPRESSIONS (a floor so a 40-impression
 * query never gets a confident-looking headline).
 *
 * Confidence is 'repeated' only when at least 2 distinct calendar years
 * contributed impressions to the peak month(s) (the wave showed up more than
 * once); a single year of history that still clears the share+floor test is
 * 'one_season' - real enough to act on, honestly labeled as one data point.
 *
 * Deterministic, $0, no I/O. Fail-closed: a query with no rows, a flat
 * spread, or below the floor emits nothing.
 */

/** One monthly archive row for one query (matches gsc_monthly_archive). */
export type MonthlyArchiveRow = {
  query: string;
  /** YYYY-MM-01 (or any ISO date within the month; only year+month are read). */
  month: string;
  impressions: number;
  clicks: number;
  topPage?: string | null;
};

export type SeasonalQuery = {
  query: string;
  /** 1-2 adjacent calendar months (1 = January .. 12 = December), peak first. */
  peakMonths: number[];
  /** Share of annual impressions held by the peak window (0..1). */
  share: number;
  /** Total impressions across all months of history, folded to the 12-month year. */
  annualImpressions: number;
  /** The page that took the most impressions in the peak month(s), if known. */
  topPage: string | null;
  /** First day of the next occurrence of the peak window (this year or next). */
  peakStartDate: string;
  /** Six weeks before peakStartDate - when "prep now" should fire. */
  prepByDate: string;
  /** Ready-to-show operator sentence (plain first person, no dashes). */
  sentence: string;
  /** 'repeated' when >= 2 distinct years fed the peak month(s); else 'one_season'. */
  confidence: "one_season" | "repeated";
};

/** A peak window must hold at least this share of annual impressions. */
export const SEASONAL_MIN_SHARE = 0.6;
/** Floor: total annual impressions must clear this before a query is called seasonal. */
export const SEASONAL_MIN_ANNUAL_IMPRESSIONS = 200;
/** How many weeks before the peak window starts a prep move fires. */
export const PREP_LEAD_WEEKS = 6;
/** Bound the ranked output. */
export const MAX_SEASONAL_QUERIES = 20;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseYearMonth(iso: string): { year: number; month: number } | null {
  const s = (iso || "").slice(0, 7); // "YYYY-MM"
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** 1-indexed month arithmetic, wrapping Dec -> Jan. */
function monthBefore(m: number): number {
  return m === 1 ? 12 : m - 1;
}
function monthAfter(m: number): number {
  return m === 12 ? 1 : m + 1;
}

/** The next calendar occurrence of `month` (1-12) on/after `now`, as YYYY-MM-01. */
function nextOccurrence(month: number, now: Date): string {
  const y = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const year = month >= nowMonth ? y : y + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Subtract N weeks from an ISO date, returning YYYY-MM-DD. */
function subtractWeeks(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

function formatShare(share: number): string {
  return `${Math.round(share * 100)}`;
}

function monthWindowLabel(months: number[]): string {
  if (months.length === 1) return MONTH_NAMES[months[0] - 1];
  return `${MONTH_NAMES[months[0] - 1]} and ${MONTH_NAMES[months[1] - 1]}`;
}

/** Plain first-person sentence, hyphens only. */
export function seasonalSentence(row: {
  query: string;
  peakMonths: number[];
  annualImpressions: number;
  prepByDate: string;
}): string {
  const windowLabel = monthWindowLabel(row.peakMonths);
  const impr = row.annualImpressions.toLocaleString();
  const prep = new Date(`${row.prepByDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  return `Searches for "${row.query}" climb every ${windowLabel} (last year: ${impr} impressions in that window). I would prep this page by ${prep}, six weeks ahead, so Google has it indexed before the wave.`;
}

type MonthBucket = {
  impressions: number;
  clicks: number;
  years: Set<number>;
  pages: Map<string, number>;
};

/**
 * Ranked seasonal queries over the permanent monthly archive. PURE.
 * Works with even one year of data (confidence reflects that honestly).
 */
export function detectSeasonalQueries(rows: MonthlyArchiveRow[], now: Date = new Date()): SeasonalQuery[] {
  const byQuery = new Map<string, Map<number, MonthBucket>>();

  for (const r of rows) {
    if (!r.query || !r.query.trim()) continue;
    const parsed = parseYearMonth(r.month);
    if (!parsed) continue;
    const impr = Math.max(0, Number(r.impressions) || 0);
    if (impr === 0 && (Number(r.clicks) || 0) === 0) continue;
    const query = r.query.trim();
    let months = byQuery.get(query);
    if (!months) {
      months = new Map();
      byQuery.set(query, months);
    }
    let bucket = months.get(parsed.month);
    if (!bucket) {
      bucket = { impressions: 0, clicks: 0, years: new Set(), pages: new Map() };
      months.set(parsed.month, bucket);
    }
    bucket.impressions += impr;
    bucket.clicks += Math.max(0, Number(r.clicks) || 0);
    bucket.years.add(parsed.year);
    if (r.topPage) bucket.pages.set(r.topPage, (bucket.pages.get(r.topPage) ?? 0) + impr);
  }

  const out: SeasonalQuery[] = [];

  for (const [query, months] of byQuery) {
    const annualImpressions = [...months.values()].reduce((sum, b) => sum + b.impressions, 0);
    if (annualImpressions < SEASONAL_MIN_ANNUAL_IMPRESSIONS) continue;
    if (months.size === 0) continue;

    // Find the single biggest month.
    let peakMonth = -1;
    let peakImpr = -1;
    for (const [m, b] of months) {
      if (b.impressions > peakImpr) {
        peakImpr = b.impressions;
        peakMonth = m;
      }
    }
    if (peakMonth < 0) continue;

    // Try extending to the better of the two adjacent months (before/after);
    // only keep the extension if it actually improves the concentration.
    const before = months.get(monthBefore(peakMonth));
    const after = months.get(monthAfter(peakMonth));
    const beforeImpr = before?.impressions ?? 0;
    const afterImpr = after?.impressions ?? 0;
    const extendMonth = beforeImpr >= afterImpr ? monthBefore(peakMonth) : monthAfter(peakMonth);
    const extendImpr = Math.max(beforeImpr, afterImpr);

    const soloShare = peakImpr / annualImpressions;
    const pairShare = (peakImpr + extendImpr) / annualImpressions;

    let peakMonths: number[];
    let windowImpr: number;
    let share: number;
    if (pairShare >= SEASONAL_MIN_SHARE && extendImpr > 0) {
      // Order the pair chronologically for a natural "Month A and Month B" label,
      // except when it wraps Dec/Jan - keep peak first there so the sentence reads naturally.
      const wraps = (peakMonth === 12 && extendMonth === 1) || (peakMonth === 1 && extendMonth === 12);
      peakMonths = wraps || extendMonth > peakMonth ? [peakMonth, extendMonth] : [extendMonth, peakMonth];
      windowImpr = peakImpr + extendImpr;
      share = pairShare;
    } else if (soloShare >= SEASONAL_MIN_SHARE) {
      peakMonths = [peakMonth];
      windowImpr = peakImpr;
      share = soloShare;
    } else {
      continue; // demand is spread too flat across the year - not seasonal
    }

    // Confidence: did the peak window's contributing months see >= 2 distinct years?
    const yearsInWindow = new Set<number>();
    for (const m of peakMonths) {
      const b = months.get(m);
      if (b) for (const y of b.years) yearsInWindow.add(y);
    }
    const confidence: SeasonalQuery["confidence"] = yearsInWindow.size >= 2 ? "repeated" : "one_season";

    // Top page across the peak window's months.
    const pageTotals = new Map<string, number>();
    for (const m of peakMonths) {
      const b = months.get(m);
      if (!b) continue;
      for (const [page, impr] of b.pages) pageTotals.set(page, (pageTotals.get(page) ?? 0) + impr);
    }
    let topPage: string | null = null;
    let topPageImpr = -1;
    for (const [page, impr] of pageTotals) {
      if (impr > topPageImpr) {
        topPage = page;
        topPageImpr = impr;
      }
    }

    const earliestPeakMonth = peakMonths[0];
    const peakStartDate = nextOccurrence(earliestPeakMonth, now);
    const prepByDate = subtractWeeks(peakStartDate, PREP_LEAD_WEEKS);

    out.push({
      query,
      peakMonths,
      share: Math.round(share * 1000) / 1000,
      annualImpressions: windowImpr,
      topPage,
      peakStartDate,
      prepByDate,
      sentence: "",
      confidence,
    });
  }

  out.forEach((row) => {
    (row as { sentence: string }).sentence = seasonalSentence(row);
  });

  // Rank: soonest prep deadline first (the most time-sensitive items lead),
  // then by annual impressions (bigger waves first) as a tiebreak.
  out.sort((a, b) => {
    const byDate = a.prepByDate.localeCompare(b.prepByDate);
    if (byDate !== 0) return byDate;
    return b.annualImpressions - a.annualImpressions;
  });

  return out.slice(0, MAX_SEASONAL_QUERIES);
}

/** True when a formatted percent share string is >= the min share (display helper). */
export function sharePercentLabel(share: number): string {
  return `${formatShare(share)} percent`;
}
