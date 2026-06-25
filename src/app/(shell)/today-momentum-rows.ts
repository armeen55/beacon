import { buildWeeklyTrend, type DailyPoint, type TrendDirection, type WeekPoint } from "./today-trend-rows";

/**
 * today-momentum-rows (2026-06-25) — per-page momentum: which pages are rising or
 * falling over the trailing weeks. The drill-down the macro traffic-trend CTA
 * promises ("see the pages dragging it down"). Reuses buildWeeklyTrend per page,
 * so the same last-finalized-day anchoring + partial-week guard apply. Pure.
 */

export type PageMomentum = {
  page: string;
  direction: TrendDirection;
  deltaPct: number;
  /** Clicks in the most-recent complete week (sized to rank the movers). */
  latestWeekClicks: number;
  /** Net clicks change from the first complete week to the latest. */
  netChange: number;
  points: WeekPoint[];
};

export type MomentumSplit = { risers: PageMomentum[]; fallers: PageMomentum[] };

/**
 * Build per-page momentum from each page's daily series, then split into the
 * biggest risers and fallers. A page needs `minWeeks` complete weeks and at least
 * `minLatestClicks` in its latest week (ignore noise from near-zero pages).
 * Risers sorted by largest gain, fallers by largest loss; each capped at `cap`.
 */
export function buildPageMomentum(
  entries: Array<{ page: string; daily: DailyPoint[] }>,
  opts: { weeks?: number; minWeeks?: number; minLatestClicks?: number; minNetChange?: number; cap?: number } = {},
): MomentumSplit {
  const weeks = opts.weeks ?? 8;
  const minWeeks = opts.minWeeks ?? 3;
  const minLatestClicks = opts.minLatestClicks ?? 3;
  // Ignore trivial movers (e.g. a page that lost 2 clicks/wk) — momentum should
  // name the pages that actually move the macro number, not noise.
  const minNetChange = opts.minNetChange ?? 5;
  const cap = opts.cap ?? 5;

  const all: PageMomentum[] = [];
  for (const { page, daily } of entries) {
    const trend = buildWeeklyTrend(daily, weeks);
    if (!trend || trend.points.length < minWeeks) continue;
    const first = trend.points[0]!.clicks;
    const latest = trend.latestWeekClicks;
    if (latest < minLatestClicks && first < minLatestClicks) continue;
    if (Math.abs(latest - first) < minNetChange) continue;
    all.push({
      page,
      direction: trend.direction,
      deltaPct: trend.deltaPct,
      latestWeekClicks: latest,
      netChange: latest - first,
      points: trend.points,
    });
  }

  const risers = all
    .filter((m) => m.direction === "growing")
    .sort((a, b) => b.netChange - a.netChange)
    .slice(0, cap);
  const fallers = all
    .filter((m) => m.direction === "declining")
    .sort((a, b) => a.netChange - b.netChange)
    .slice(0, cap);

  return { risers, fallers };
}
