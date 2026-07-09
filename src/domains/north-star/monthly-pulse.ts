/**
 * north-star/monthly-pulse (2026-07-09, operator spec A-3 + B-6) - the ONE number Beacon
 * is judged on, in the operator's own frame: MONTHLY visits ("weekly won't cut it";
 * peak was ~20k a month, revival = back into the 10s).
 *
 * PURE. The caller feeds monthly GA4 sessions (the ga4_monthly_sessions_v1 RPC), monthly
 * sitewide GSC clicks/impressions (summed from gsc_daily_totals), and the tenant's
 * configured monthly visit goal. This module composes the honest view model + sentences:
 *   - headline: the last FULL month's visits + clicks ("June: 12,862 visits and 3,004
 *     clicks from Google.")
 *   - goal line: progress against the configured goal, on the last full month only (a
 *     part-month compare would always read as failure)
 *   - month-to-date line: the current month so far, clearly labeled
 *   - delta line: last full month vs the month before, percent
 *
 * Beacon voice: first person, concrete numbers, no lab words, no em/en dashes, wins in one
 * sentence, misses owned plainly. Units are honest: GA4 sessions render as "visits" and
 * every sentence says where the number is from. No dollar words anywhere (E-38).
 */

export type MonthlyPulseInput = {
  /** Monthly sitewide GA4 sessions, ascending by month ("YYYY-MM-01"). */
  ga4Months: ReadonlyArray<{ month: string; sessions: number }>;
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
  visits: number | null;
  clicks: number | null;
  impressions: number | null;
};

export type MonthlyPulse = {
  /** Up to the trailing 6 months ascending, current month last (part month). */
  months: MonthlyPulseMonth[];
  headline: string | null;
  goalLine: string | null;
  monthToDateLine: string | null;
  deltaLine: string | null;
};

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
  const currentMonth = monthKey(now);

  const ga4ByMonth = new Map(input.ga4Months.map((m) => [m.month.slice(0, 10), m.sessions]));
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
      visits: ga4ByMonth.has(key) ? ga4ByMonth.get(key)! : null,
      clicks: gsc ? gsc.clicks : null,
      impressions: gsc ? gsc.impressions : null,
    });
  }

  const current = months[months.length - 1]!;
  const lastFull = months[months.length - 2] ?? null;
  const priorFull = months[months.length - 3] ?? null;

  // Headline: last FULL month, visits-first when GA4 exists, clicks-only otherwise.
  let headline: string | null = null;
  if (lastFull) {
    if (lastFull.visits != null && lastFull.visits > 0) {
      const clicksPart =
        lastFull.clicks != null && lastFull.clicks > 0
          ? ` and ${fmt(lastFull.clicks)} clicks from Google search`
          : "";
      headline = `${lastFull.label}: ${fmt(lastFull.visits)} visits${clicksPart}.`;
    } else if (lastFull.clicks != null && lastFull.clicks > 0) {
      headline = `${lastFull.label}: ${fmt(lastFull.clicks)} clicks from Google search.`;
    }
  }

  // Goal line: last full month vs the configured goal. Never a made-up target.
  let goalLine: string | null = null;
  const goal = input.monthlyVisitGoal ?? null;
  if (goal != null && goal > 0 && lastFull && lastFull.visits != null && lastFull.visits > 0) {
    const pct = Math.round((lastFull.visits / goal) * 100);
    goalLine =
      lastFull.visits >= goal
        ? `That clears your ${fmt(goal)}-a-month goal.`
        : `Your goal is ${fmt(goal)} visits a month. ${lastFull.label} reached ${pct}% of it.`;
  }

  // Month-to-date: the current part month, clearly labeled so it never reads as a fall.
  let monthToDateLine: string | null = null;
  if (current.visits != null && current.visits > 0) {
    monthToDateLine = `${current.label} so far: ${fmt(current.visits)} visits.`;
  } else if (current.clicks != null && current.clicks > 0) {
    monthToDateLine = `${current.label} so far: ${fmt(current.clicks)} clicks from Google search.`;
  }

  // Delta: last full month vs the one before, on the same unit as the headline.
  let deltaLine: string | null = null;
  if (lastFull && priorFull) {
    const unit = lastFull.visits != null && priorFull.visits != null ? "visits" : "clicks";
    const a = unit === "visits" ? lastFull.visits : lastFull.clicks;
    const b = unit === "visits" ? priorFull.visits : priorFull.clicks;
    if (a != null && b != null && b > 0) {
      const pct = Math.round(((a - b) / b) * 100);
      if (pct > 0) deltaLine = `${lastFull.label} was up ${pct}% on ${priorFull.label}.`;
      else if (pct < 0) deltaLine = `${lastFull.label} was down ${Math.abs(pct)}% from ${priorFull.label}.`;
      else deltaLine = `${lastFull.label} held even with ${priorFull.label}.`;
    }
  }

  return { months, headline, goalLine, monthToDateLine, deltaLine };
}
