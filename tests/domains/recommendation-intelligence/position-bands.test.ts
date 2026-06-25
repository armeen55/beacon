import { describe, it, expect } from "vitest";

import { buildPositionBands, totalBandQueries, type BandQuery } from "@/app/(shell)/today-position-bands-rows";

const q = (query: string, position: number, clicks = 0, impressions = 100): BandQuery => ({ query, position, clicks, impressions });

describe("buildPositionBands", () => {
  it("buckets queries into the four position bands", () => {
    const bands = buildPositionBands([q("a", 2), q("b", 6), q("c", 15), q("d", 40)]);
    const byKey = Object.fromEntries(bands.map((b) => [b.key, b.queries]));
    expect(byKey).toEqual({ top3: 1, striking: 1, page2: 1, beyond: 1 });
  });

  it("counts a query once, in its BEST position across pages", () => {
    const bands = buildPositionBands([q("dup", 18), q("dup", 5)]); // best = 5 → striking
    expect(bands.find((b) => b.key === "striking")!.queries).toBe(1);
    expect(bands.find((b) => b.key === "page2")!.queries).toBe(0);
  });

  it("sums clicks/impressions per band and totals queries", () => {
    const bands = buildPositionBands([q("a", 2, 10, 500), q("b", 2, 5, 300)]);
    const top3 = bands.find((b) => b.key === "top3")!;
    expect(top3.queries).toBe(2);
    expect(top3.clicks).toBe(15);
    expect(top3.impressions).toBe(800);
    expect(totalBandQueries(bands)).toBe(2);
  });

  it("ignores empty queries / zero-impression rows", () => {
    expect(totalBandQueries(buildPositionBands([q("", 2), q("x", 3, 0, 0)]))).toBe(0);
  });
});
