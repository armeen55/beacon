import { describe, it, expect } from "vitest";

import { buildSparklinePaths, weekBucketIndex } from "@/app/(shell)/sparkline";

describe("buildSparklinePaths", () => {
  it("starts the line with M and includes one L per remaining point", () => {
    const { line } = buildSparklinePaths([{ clicks: 1 }, { clicks: 2 }, { clicks: 3 }], 100, 40);
    expect(line.startsWith("M")).toBe(true);
    expect((line.match(/L/g) ?? []).length).toBe(2);
  });

  it("closes the area path with a baseline back to the start", () => {
    const { area } = buildSparklinePaths([{ clicks: 5 }, { clicks: 9 }], 100, 40);
    expect(area.endsWith("Z")).toBe(true);
  });

  it("scales the max value to the top inset and centers a single point", () => {
    const { x, y } = buildSparklinePaths([{ clicks: 10 }], 100, 40, 3);
    expect(x(0)).toBe(50); // single point centers
    expect(y(10)).toBeCloseTo(3, 5); // max sits at top pad
  });

  it("returns empty paths for no points", () => {
    const { line, area } = buildSparklinePaths([], 100, 40);
    expect(line).toBe("");
    expect(area).toBe("");
  });
});

describe("weekBucketIndex", () => {
  const points = [{ weekStart: "2026-06-01" }, { weekStart: "2026-06-08" }, { weekStart: "2026-06-15" }];

  it("finds the bucket a date falls in and interpolates within it", () => {
    expect(weekBucketIndex(points, "2026-06-01")).toBeCloseTo(0, 5); // bucket start
    const mid = weekBucketIndex(points, "2026-06-11"); // 3 days into bucket 1
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
  });

  it("returns null when the date is outside the window", () => {
    expect(weekBucketIndex(points, "2026-05-01")).toBeNull();
    expect(weekBucketIndex(points, "2026-09-01")).toBeNull();
    expect(weekBucketIndex(points, "not-a-date")).toBeNull();
  });
});
