import { describe, it, expect } from "vitest";
import { computeRankDistribution, type RankedQuery } from "./rank-distribution";

describe("computeRankDistribution (v1 489) - $0 rank spread over persisted GSC", () => {
  it("empty-safe: no queries -> all-zero buckets + honest no-data line", () => {
    const d = computeRankDistribution([]);
    expect(d.top3).toBe(0);
    expect(d.striking).toBe(0);
    expect(d.deep).toBe(0);
    expect(d.total).toBe(0);
    expect(d.sentence).toMatch(/do not have ranked searches for you yet/i);
    expect(d.sentence).not.toMatch(/[‒–—―]/);
  });

  it("buckets into top 3 / striking (4-10) / page two+ (11+) on band boundaries", () => {
    const rows: RankedQuery[] = [
      { position: 1 }, // top3
      { position: 3 }, // top3
      { position: 3.4 }, // rounds within band? no rounding: 3.4 > 3 -> striking
      { position: 4 }, // striking
      { position: 10 }, // striking
      { position: 10.9 }, // deep (>10)
      { position: 11 }, // deep
      { position: 45 }, // deep
    ];
    const d = computeRankDistribution(rows);
    expect(d.top3).toBe(2);
    expect(d.striking).toBe(3); // 3.4, 4, 10
    expect(d.deep).toBe(3); // 10.9, 11, 45
    expect(d.total).toBe(8);
  });

  it("ignores queries with no real position (0, null, non-finite)", () => {
    const rows: RankedQuery[] = [
      { position: 2 },
      { position: 0 },
      { position: null },
      { position: undefined },
      { position: Number.NaN },
      { position: 7 },
    ];
    const d = computeRankDistribution(rows);
    expect(d.top3).toBe(1);
    expect(d.striking).toBe(1);
    expect(d.deep).toBe(0);
    expect(d.total).toBe(2);
  });

  it("builds a concrete first-person summary sentence with all three counts", () => {
    const rows: RankedQuery[] = [
      ...Array.from({ length: 38 }, () => ({ position: 2 })),
      ...Array.from({ length: 71 }, () => ({ position: 6 })),
      ...Array.from({ length: 105 }, () => ({ position: 20 })),
    ];
    const d = computeRankDistribution(rows);
    expect(d.total).toBe(214);
    expect(d.sentence).toBe(
      "Of 214 searches you show up for, 38 are in the top 3, 71 are in striking distance, and 105 are on page two or beyond.",
    );
    expect(d.sentence).not.toMatch(/[‒–—―]/);
  });
});
