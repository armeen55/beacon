type DatedClicks = { date: string; clicks: number };

/**
 * GSC omits zero-activity rows. Fill only gaps between the first and last
 * observed day so SVG lines do not visually jump across several calendar days.
 * We intentionally do not invent leading/trailing days outside observed data.
 */
export function densifyDailyClicks(points: ReadonlyArray<DatedClicks>): DatedClicks[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    const date = point.date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(point.clicks)) continue;
    totals.set(date, (totals.get(date) ?? 0) + point.clicks);
  }
  const dates = [...totals.keys()].sort();
  if (dates.length < 2) return dates.map((date) => ({ date, clicks: totals.get(date)! }));

  const start = Date.parse(`${dates[0]}T00:00:00.000Z`);
  const end = Date.parse(`${dates[dates.length - 1]}T00:00:00.000Z`);
  const out: DatedClicks[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    out.push({ date, clicks: totals.get(date) ?? 0 });
  }
  return out;
}
