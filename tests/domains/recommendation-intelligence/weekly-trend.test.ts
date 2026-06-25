import { describe, it, expect } from "vitest";

import { buildWeeklyTrend, type DailyPoint } from "@/app/(shell)/today-trend-rows";

/** Generate `days` of daily points ending at `endDate`, clicks from a per-day fn. */
function series(endDate: string, days: number, clicksFor: (dayIndex: number) => number): DailyPoint[] {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push({ date: new Date(endMs - i * 86_400_000).toISOString().slice(0, 10), clicks: clicksFor(days - 1 - i) });
  }
  return out;
}

describe("buildWeeklyTrend", () => {
  it("returns null on empty input", () => {
    expect(buildWeeklyTrend([])).toBeNull();
  });

  it("buckets daily clicks into trailing 7-day weeks, oldest first", () => {
    // 28 days, 10 clicks/day → 4 weeks of 70 each.
    const t = buildWeeklyTrend(series("2026-06-25", 28, () => 10), 8);
    expect(t).not.toBeNull();
    expect(t!.points.length).toBe(4);
    expect(t!.points.every((p) => p.clicks === 70)).toBe(true);
    expect(t!.direction).toBe("flat");
    expect(t!.deltaPct).toBe(0);
  });

  it("flags growth when the latest week beats the first by ≥8%", () => {
    // ramp up: day d → 5 + d clicks
    const t = buildWeeklyTrend(series("2026-06-25", 28, (d) => 5 + d), 8);
    expect(t!.direction).toBe("growing");
    expect(t!.deltaPct).toBeGreaterThan(8);
    expect(t!.latestWeekClicks).toBeGreaterThan(t!.points[0]!.clicks);
  });

  it("flags decline when the latest week drops ≥8%", () => {
    const t = buildWeeklyTrend(series("2026-06-25", 28, (d) => 40 - d), 8);
    expect(t!.direction).toBe("declining");
    expect(t!.deltaPct).toBeLessThan(-8);
  });

  it("anchors weeks to the last finalized day (no phantom short-week)", () => {
    // flat 21 days but data ends 3 days 'early' relative to today — still flat.
    const t = buildWeeklyTrend(series("2026-06-22", 21, () => 12), 8);
    expect(t!.direction).toBe("flat");
    expect(t!.points.every((p) => p.clicks === 84)).toBe(true);
  });
});
