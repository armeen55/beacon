import { describe, it, expect } from "vitest";

import { buildPageMomentum } from "@/app/(shell)/today-momentum-rows";
import { type DailyPoint } from "@/app/(shell)/today-trend-rows";

function series(endDate: string, days: number, clicksFor: (dayIndex: number) => number): DailyPoint[] {
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push({ date: new Date(endMs - i * 86_400_000).toISOString().slice(0, 10), clicks: clicksFor(days - 1 - i) });
  }
  return out;
}

describe("buildPageMomentum", () => {
  it("splits pages into risers and fallers by net change", () => {
    const { risers, fallers } = buildPageMomentum([
      { page: "/up", daily: series("2026-06-25", 28, (d) => 5 + d) }, // ramps up
      { page: "/down", daily: series("2026-06-25", 28, (d) => 40 - d) }, // ramps down
      { page: "/flat", daily: series("2026-06-25", 28, () => 10) }, // flat
    ]);
    expect(risers.map((r) => r.page)).toContain("/up");
    expect(fallers.map((f) => f.page)).toContain("/down");
    expect([...risers, ...fallers].map((m) => m.page)).not.toContain("/flat");
  });

  it("ranks fallers by largest loss first", () => {
    const { fallers } = buildPageMomentum([
      { page: "/small", daily: series("2026-06-25", 28, (d) => 20 - d * 0.3) },
      { page: "/big", daily: series("2026-06-25", 28, (d) => 60 - d * 1.5) },
    ]);
    expect(fallers[0]!.page).toBe("/big");
    expect(fallers[0]!.netChange).toBeLessThan(0);
  });

  it("ignores near-zero noise pages and too-short histories", () => {
    const { risers, fallers } = buildPageMomentum([
      { page: "/noise", daily: series("2026-06-25", 28, () => 0) }, // all zero
      { page: "/short", daily: series("2026-06-25", 10, (d) => 5 + d) }, // <3 weeks
    ]);
    expect(risers).toHaveLength(0);
    expect(fallers).toHaveLength(0);
  });

  it("caps each side", () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      page: `/p${i}`,
      daily: series("2026-06-25", 28, (d) => 5 + d + i),
    }));
    const { risers } = buildPageMomentum(entries, { cap: 3 });
    expect(risers.length).toBeLessThanOrEqual(3);
  });
});
