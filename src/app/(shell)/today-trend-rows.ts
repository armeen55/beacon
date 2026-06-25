/**
 * today-trend-rows (2026-06-25) — a MACRO time-trend lens (distinct from the
 * per-page action lenses and the position-distribution funnel): the site's total
 * clicks bucketed into trailing weeks, with a direction verdict. Anchored to the
 * LAST day present in the data (the sync only persists finalized days ~3d behind
 * wall-clock), so a flat site never shows a phantom decline from a short final
 * week. Pure + dependency-free.
 */

export type DailyPoint = { date: string; clicks: number };

export type WeekPoint = {
  /** ISO date of the week's first day (anchored back from the last finalized day). */
  weekStart: string;
  clicks: number;
};

export type TrendDirection = "growing" | "flat" | "declining";

export type WeeklyTrend = {
  points: WeekPoint[];
  direction: TrendDirection;
  /** % change of the most-recent COMPLETE week vs the first complete week in range. */
  deltaPct: number;
  /** Clicks in the most-recent complete week. */
  latestWeekClicks: number;
};

function dayMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/**
 * Build trailing-week buckets from daily totals. Weeks are 7-day windows counted
 * BACK from the last finalized day, so the most-recent bucket is always a full 7
 * days (no short-week artifact). Returns up to `weeks` complete buckets, oldest
 * first. A bucket with no data is dropped (sparse history stays honest).
 */
export function buildWeeklyTrend(daily: DailyPoint[], weeks = 8): WeeklyTrend | null {
  const clean = daily
    .filter((d) => d.date && Number.isFinite(d.clicks))
    .map((d) => ({ date: d.date.slice(0, 10), clicks: Math.max(0, d.clicks) }))
    .sort((a, b) => dayMs(a.date) - dayMs(b.date));
  if (clean.length === 0) return null;

  const endMs = dayMs(clean[clean.length - 1]!.date);
  const startMs = dayMs(clean[0]!.date);

  // Bucket each day into a trailing-week index (0 = most recent 7 days).
  const buckets = new Map<number, { clicks: number; firstMs: number }>();
  for (const d of clean) {
    const idx = Math.floor((endMs - dayMs(d.date)) / (7 * 86_400_000));
    if (idx < 0 || idx >= weeks) continue;
    const startOfWeekMs = endMs - idx * 7 * 86_400_000;
    const cur = buckets.get(idx);
    if (cur) cur.clicks += d.clicks;
    else buckets.set(idx, { clicks: d.clicks, firstMs: startOfWeekMs });
  }
  if (buckets.size === 0) return null;

  // Oldest → newest. Only keep buckets whose 7-day window is fully inside the data
  // range (so the first/last buckets aren't partial and skewing the delta).
  const ordered = [...buckets.entries()]
    .filter(([idx]) => {
      const weekEndMs = endMs - idx * 7 * 86_400_000;
      const weekStartMs = weekEndMs - 6 * 86_400_000;
      return weekStartMs >= startMs;
    })
    .sort((a, b) => b[0] - a[0]); // highest idx (oldest) first

  const points: WeekPoint[] = ordered.map(([idx]) => {
    const weekEndMs = endMs - idx * 7 * 86_400_000;
    const weekStartMs = weekEndMs - 6 * 86_400_000;
    return {
      weekStart: new Date(weekStartMs).toISOString().slice(0, 10),
      clicks: buckets.get(idx)!.clicks,
    };
  });
  if (points.length === 0) return null;

  const first = points[0]!.clicks;
  const latest = points[points.length - 1]!.clicks;
  const deltaPct = first > 0 ? Math.round(((latest - first) / first) * 100) : 0;
  const direction: TrendDirection = deltaPct >= 8 ? "growing" : deltaPct <= -8 ? "declining" : "flat";

  return { points, direction, deltaPct, latestWeekClicks: latest };
}
