import { describe, it, expect } from "vitest";
import {
  poolBatchLifts,
  estimateDailyLiftVariance,
  MIN_PAGES_TO_POOL,
  type PerPageLift,
} from "./pooled-verdict";

function page(name: string, adjustedLiftPct: number, variance = 1): PerPageLift {
  return { page: name, adjustedLiftPct, variance };
}

describe("poolBatchLifts", () => {
  it("refuses to pool below MIN_PAGES_TO_POOL (tiny batch honesty)", () => {
    expect(MIN_PAGES_TO_POOL).toBe(3);
    const result = poolBatchLifts([page("/a", 20), page("/b", 25)]);
    expect(result.n).toBe(2);
    expect(result.verdict).toBe("no_clear_lift");
    expect(result.sentence).toBeNull();
    expect(result.pooledLiftPct).toBe(0);
  });

  it("pools consistent positive lifts across many pages to a confident 'helped'", () => {
    const perPage = [
      page("/a", 12, 4),
      page("/b", 9, 4),
      page("/c", 14, 4),
      page("/d", 10, 4),
      page("/e", 11, 4),
      page("/f", 13, 4),
      page("/g", 8, 4),
      page("/h", 15, 4),
    ];
    const result = poolBatchLifts(perPage);
    expect(result.n).toBe(8);
    expect(result.verdict).toBe("helped");
    expect(result.pooledLiftPct).toBeGreaterThan(0);
    expect(result.zScore).toBeGreaterThan(0);
    expect(result.permutationP).toBeLessThanOrEqual(0.1);
    expect(result.sentence).toContain("up about");
    expect(result.sentence).toContain("8 changes");
  });

  it("pools consistent negative lifts to a confident 'did_not_help'", () => {
    const perPage = [
      page("/a", -12, 4),
      page("/b", -9, 4),
      page("/c", -14, 4),
      page("/d", -10, 4),
      page("/e", -11, 4),
      page("/f", -13, 4),
    ];
    const result = poolBatchLifts(perPage);
    expect(result.verdict).toBe("did_not_help");
    expect(result.pooledLiftPct).toBeLessThan(0);
    expect(result.sentence).toContain("down about");
  });

  it("mixed-sign lifts pool to no_clear_lift, not a false confident verdict", () => {
    const perPage = [
      page("/a", 40, 4),
      page("/b", -35, 4),
      page("/c", 30, 4),
      page("/d", -28, 4),
      page("/e", 20, 4),
      page("/f", -18, 4),
    ];
    const result = poolBatchLifts(perPage);
    expect(result.verdict).toBe("no_clear_lift");
    expect(result.sentence).toContain("no clear pattern");
  });

  it("one dominant/high-variance page does not swamp the pool (inverse-variance weighting)", () => {
    // One page has a huge lift but is also very noisy (large variance -> tiny weight); seven
    // quiet, consistent pages should dominate the pooled result instead.
    const perPage: PerPageLift[] = [
      page("/dominant", 500, 10000), // huge lift, huge variance -> tiny weight
      page("/a", 10, 1),
      page("/b", 9, 1),
      page("/c", 11, 1),
      page("/d", 8, 1),
      page("/e", 12, 1),
      page("/f", 10, 1),
      page("/g", 9, 1),
    ];
    const result = poolBatchLifts(perPage);
    // The pooled lift should sit close to the quiet-page consensus (~10), nowhere near 500.
    expect(result.pooledLiftPct).toBeLessThan(20);
    expect(result.pooledLiftPct).toBeGreaterThan(0);
  });

  it("an explicit weight override is honored over 1/variance", () => {
    const perPage: PerPageLift[] = [
      { page: "/a", adjustedLiftPct: 100, variance: 1, weight: 0.0001 },
      { page: "/b", adjustedLiftPct: 10, variance: 1, weight: 1 },
      { page: "/c", adjustedLiftPct: 10, variance: 1, weight: 1 },
      { page: "/d", adjustedLiftPct: 10, variance: 1, weight: 1 },
    ];
    const result = poolBatchLifts(perPage);
    // /a's huge lift is nearly zeroed out by its tiny explicit weight.
    expect(result.pooledLiftPct).toBeLessThan(15);
  });

  it("standardError shrinks (confidence grows) as more consistent pages are added", () => {
    const three = poolBatchLifts([page("/a", 10, 4), page("/b", 11, 4), page("/c", 9, 4)]);
    const eight = poolBatchLifts([
      page("/a", 10, 4), page("/b", 11, 4), page("/c", 9, 4), page("/d", 10, 4),
      page("/e", 11, 4), page("/f", 9, 4), page("/g", 10, 4), page("/h", 11, 4),
    ]);
    expect(eight.standardError).toBeLessThan(three.standardError);
  });

  it("weak/inconsistent lifts with only the minimum 3 pages stay honest (no false 'helped')", () => {
    const result = poolBatchLifts([page("/a", 3, 4), page("/b", -2, 4), page("/c", 1, 4)]);
    expect(result.verdict).toBe("no_clear_lift");
  });

  it("never emits an em or en dash anywhere in the sentence (dash guard)", () => {
    const cases = [
      poolBatchLifts([page("/a", 12, 4), page("/b", 9, 4), page("/c", 14, 4)]),
      poolBatchLifts([page("/a", -12, 4), page("/b", -9, 4), page("/c", -14, 4)]),
      poolBatchLifts([page("/a", 3, 4), page("/b", -2, 4), page("/c", 1, 4)]),
    ];
    for (const r of cases) {
      expect(r.sentence ?? "").not.toMatch(/[–—]/);
    }
  });
});

describe("estimateDailyLiftVariance", () => {
  it("returns a positive floor for too-short or flat series", () => {
    expect(estimateDailyLiftVariance([], 7)).toBeGreaterThan(0);
    expect(estimateDailyLiftVariance([5], 7)).toBeGreaterThan(0);
    expect(estimateDailyLiftVariance([5, 5, 5, 5], 7)).toBeGreaterThan(0);
  });

  it("scales with window length (longer post window -> larger variance)", () => {
    const series = [3, 8, 2, 10, 4, 6, 1, 9, 5, 7];
    const v7 = estimateDailyLiftVariance(series, 7);
    const v28 = estimateDailyLiftVariance(series, 28);
    expect(v28).toBeGreaterThan(v7);
  });

  it("a noisier daily series yields a larger variance than a quieter one", () => {
    const quiet = [10, 11, 9, 10, 10, 9, 11, 10];
    const noisy = [2, 30, 1, 28, 3, 25, 0, 32];
    expect(estimateDailyLiftVariance(noisy, 14)).toBeGreaterThan(estimateDailyLiftVariance(quiet, 14));
  });
});
