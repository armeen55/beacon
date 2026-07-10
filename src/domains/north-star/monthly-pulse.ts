/**
 * north-star/monthly-pulse (2026-07-09 origin; 2026-07-10 P0-A truth fix) - the monthly
 * north-star view model.
 *
 * P0-A (2026-07-10) - WHY GA4 VISITS ARE GONE FROM THIS MODULE:
 * The sitewide MONTHLY VISITS number this card used to headline came from the
 * ga4_monthly_sessions_v1 RPC, which SUMS session counts across rows of the
 * per-(url, date) GA4 table. GA4 sessions are NOT additive across page paths - one
 * visit that touches several pages appears in several page rows, so the sum
 * materially inflates the real visit count. We therefore no longer trust or render
 * ANY sitewide-visits number here, and no GA4 session count enters this module. The
 * correct property-grain GA4 rollup is Wave 2's job (do NOT reuse the summing RPC).
 *
 * Until then this card shows an honest reconciliation state plus the number we CAN
 * prove: Search Console clicks, aggregated from property-grain daily totals (one row
 * per property per day, so summing across DISTINCT days is additive-safe - a click is
 * counted once in its day's total and days are disjoint, so no session-style
 * double-count is possible).
 *
 * PURE. The caller feeds monthly sitewide GSC clicks/impressions and the tenant's
 * configured monthly visit goal.
 *
 * Beacon voice: first person, concrete numbers, no lab words, no em/en dashes, wins in
 * one sentence, misses owned plainly. A VISITS goal is NEVER graded from clicks.
 */

export type MonthlyPulseInput = {
  /** Monthly sitewide GSC totals, ascending by month ("YYYY-MM-01"). */
  gscMonths: ReadonlyArray<{ month: string; clicks: number; impressions: number }>;
  /** The tenant's configured monthly-visit goal (operator's revival target). Optional -
   *  no goal configured means no goal line, never a made-up target. */
  monthlyVisitGoal?: number | null;
  /** Clock (testable). */
  nowMs: number;
};

export type MonthlyPulseMonth = {
  month: string; // "2026-06-01"
  label: string; // "June"
  clicks: number | null;
  impressions: number | null;
};

export type MonthlyPulse = {
  /** Up to the trailing 6 months ascending, current month last (part month). */
  months: MonthlyPulseMonth[];
  /** Last full month's clicks headline (the proven number). Null self-hides the card. */
  headline: string | null;
  /** P0-A honest state that stands in for the withdrawn sitewide-visits number. Always
   *  set; only surfaces when the card renders (i.e. when there is a clicks headline). */
  reconciliationLine: string;
  goalLine: string | null;
  monthToDateLine: string | null;
  deltaLine: string | null;
};

/** P0-A honest replacement for the withdrawn sitewide-visits totals. Beacon voice,
 *  owns the miss plainly, points at the number that IS accurate. No dashes. */
export const MONTHLY_VISITS_RECONCILIATION_LINE =
  "Monthly visits need reconciliation, so I am holding that number back until I can rebuild it without double-counting. Your Search Console clicks below are accurate.";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(month: string): string {
  const d = new Date(`${month}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Compose the monthly pulse view model. PURE, deterministic for a fixed nowMs. */
export function buildMonthlyPulse(input: MonthlyPulseInput): MonthlyPulse {
  const now = new Date(input.nowMs);

  const gscByMonth = new Map(
    input.gscMonths.map((m) => [m.month.slice(0, 10), { clicks: m.clicks, impressions: m.impressions }]),
  );

  // Trailing 6 calendar months ascending, ending at the current (part) month.
  const months: MonthlyPulseMonth[] = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const key = monthKey(d);
    const gsc = gscByMonth.get(key) ?? null;
    months.push({
      month: key,
      label: monthLabel(key),
      clicks: gsc ? gsc.clicks : null,
      impressions: gsc ? gsc.impressions : null,
    });
  }

  const current = months[months.length - 1]!;
  const lastFull = months[months.length - 2] ?? null;
  const priorFull = months[months.length - 3] ?? null;

  // Headline: last FULL month clicks (the proven number). Null self-hides the card.
  let headline: string | null = null;
  if (lastFull && lastFull.clicks != null && lastFull.clicks > 0) {
    headline = `${lastFull.label}: ${fmt(lastFull.clicks)} clicks from Google search.`;
  }

  // Goal line: a VISITS goal is never graded from clicks. With no trustworthy visits
  // number, say so plainly - never celebrate a goal we cannot score, never invent a
  // target. When no goal is configured, stay silent.
  let goalLine: string | null = null;
  const goal = input.monthlyVisitGoal ?? null;
  if (goal != null && goal > 0) {
    goalLine = `I can't grade your ${fmt(goal)}-visits-a-month goal yet because monthly visits need reconciliation. I will score it as soon as that number is trustworthy.`;
  }

  // Month-to-date: the current part month clicks, clearly labeled so it never reads as a fall.
  let monthToDateLine: string | null = null;
  if (current.clicks != null && current.clicks > 0) {
    monthToDateLine = `${current.label} so far: ${fmt(current.clicks)} clicks from Google search.`;
  }

  // Delta: last full month vs the one before, on clicks (the proven unit).
  let deltaLine: string | null = null;
  if (
    lastFull &&
    priorFull &&
    lastFull.clicks != null &&
    priorFull.clicks != null &&
    priorFull.clicks > 0
  ) {
    const pct = Math.round(((lastFull.clicks - priorFull.clicks) / priorFull.clicks) * 100);
    if (pct > 0) deltaLine = `${lastFull.label} clicks were up ${pct}% on ${priorFull.label}.`;
    else if (pct < 0) deltaLine = `${lastFull.label} clicks were down ${Math.abs(pct)}% from ${priorFull.label}.`;
    else deltaLine = `${lastFull.label} clicks held even with ${priorFull.label}.`;
  }

  return {
    months,
    headline,
    reconciliationLine: MONTHLY_VISITS_RECONCILIATION_LINE,
    goalLine,
    monthToDateLine,
    deltaLine,
  };
}
