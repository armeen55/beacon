/**
 * tenant-ctr-curve (R9 / P3) - pins the fit rules (bucket floors, interpolation,
 * brand exclusion, honest fallback basis) and the byte-identity of the industry
 * default with the constants pick-expectations.ts always carried.
 */
import { describe, expect, it } from "vitest";

import {
  BUCKET_MIN_IMPRESSIONS,
  BUCKET_MIN_QUERIES,
  DEFAULT_CTR_BY_POSITION,
  DEFAULT_CURVE_BASIS,
  MIN_FITTED_BUCKETS,
  SEMRUSH_TOP5_CTR,
  brandTokensFor,
  defaultCtrCurve,
  defaultExpectedCtrAt,
  fitTenantCtrCurve,
  isBrandQuery,
  type QueryCtrAggregate,
} from "./tenant-ctr-curve";

const NOW = new Date("2026-07-03T00:00:00Z");

/** n query observations landing in the bucket for `position`, each with the
 *  same CTR, sized to clear (or miss) the floors. */
function bucketRows(position: number, ctr: number, n = 6, impressionsEach = 100, tag = ""): QueryCtrAggregate[] {
  return Array.from({ length: n }, (_, i) => ({
    query: `q-${position}-${tag}${i}`,
    clicks: Math.round(ctr * impressionsEach),
    impressions: impressionsEach,
    position,
  }));
}

describe("defaultExpectedCtrAt - byte-identical to the legacy pick-expectations table", () => {
  it("matches every legacy constant, including the tail bands and the p<=0 guard", () => {
    const legacy: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025 };
    for (let p = 1; p <= 10; p++) expect(defaultExpectedCtrAt(p)).toBe(legacy[p]);
    expect(defaultExpectedCtrAt(0)).toBe(0.28);
    expect(defaultExpectedCtrAt(-3)).toBe(0.28);
    for (let p = 11; p <= 15; p++) expect(defaultExpectedCtrAt(p)).toBe(0.018);
    for (let p = 16; p <= 20; p++) expect(defaultExpectedCtrAt(p)).toBe(0.012);
    expect(defaultExpectedCtrAt(21)).toBe(0.006);
    expect(defaultExpectedCtrAt(48)).toBe(0.006);
  });

  it("rounds fractional positions exactly like the legacy function (Math.round)", () => {
    expect(defaultExpectedCtrAt(7.4)).toBe(0.04);
    expect(defaultExpectedCtrAt(7.6)).toBe(0.034);
    expect(defaultExpectedCtrAt(10.4)).toBe(0.025);
    expect(defaultExpectedCtrAt(10.6)).toBe(0.018);
  });

  it("DEFAULT_CTR_BY_POSITION carries the same values the function returns for 1-10", () => {
    for (let p = 1; p <= 10; p++) expect(DEFAULT_CTR_BY_POSITION[p]).toBe(defaultExpectedCtrAt(p));
  });
});

describe("SEMRUSH_TOP5_CTR - the sourced trigger benchmark stays byte-identical", () => {
  it("keeps the exact Semrush Dec 2025 values the gsc_low_ctr trigger calibrated on", () => {
    expect(SEMRUSH_TOP5_CTR).toEqual({ 1: 0.398, 2: 0.187, 3: 0.102, 4: 0.072, 5: 0.051 });
  });
});

describe("fitTenantCtrCurve - fits per-bucket medians from the tenant's own rows", () => {
  it("returns the bucket median CTR at each well-sampled position", () => {
    // ctr at position p = (11 - p) / 50, chosen so clicks are exact integers.
    const rows = Array.from({ length: 10 }, (_, i) => bucketRows(i + 1, (10 - i) / 50)).flat();
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.source).toBe("tenant");
    for (let p = 1; p <= 10; p++) {
      expect(curve.expectedCtrAt(p)).toBeCloseTo((11 - p) / 50, 10);
    }
    expect(curve.queries).toBe(60);
    expect(curve.impressions).toBe(6000);
    expect(curve.basis).toBe("your own search data (60 queries, 6,000 impressions)");
    expect(curve.fittedAt).toBe(NOW.toISOString());
  });

  it("a real median: the middle query CTR wins, not the mean", () => {
    const rows = [
      ...bucketRows(3, 0.10, 3, 100, "a"),
      ...bucketRows(3, 0.12, 1, 100, "b"),
      ...bucketRows(3, 0.50, 1, 100, "c"), // outlier cannot drag the value
      // two more fitted buckets so the fit clears MIN_FITTED_BUCKETS
      ...bucketRows(1, 0.3),
      ...bucketRows(2, 0.2),
    ];
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.source).toBe("tenant");
    expect(curve.expectedCtrAt(3)).toBeCloseTo(0.10, 10);
  });
});

describe("fitTenantCtrCurve - bucket floors", () => {
  it(`a bucket under ${BUCKET_MIN_QUERIES} queries is not trusted (interpolated instead)`, () => {
    const rows = [
      ...bucketRows(4, 0.08),
      ...bucketRows(6, 0.04),
      ...bucketRows(8, 0.03),
      // bucket 5: plenty of impressions but only 4 queries, with a wild median
      ...bucketRows(5, 0.9, BUCKET_MIN_QUERIES - 1, 200),
    ];
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.source).toBe("tenant");
    // interpolated midway between fitted position 4 (0.08) and 6 (0.04), never 0.9
    expect(curve.expectedCtrAt(5)).toBeCloseTo(0.06, 10);
  });

  it(`a bucket under ${BUCKET_MIN_IMPRESSIONS} impressions is not trusted (interpolated instead)`, () => {
    const rows = [
      ...bucketRows(4, 0.08),
      ...bucketRows(6, 0.04),
      ...bucketRows(8, 0.03),
      // bucket 5: 6 queries but only 30 impressions each (180 < 200), wild median
      ...bucketRows(5, 0.9, 6, 30),
    ];
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.expectedCtrAt(5)).toBeCloseTo(0.06, 10);
  });

  it("an untrusted EDGE bucket (no fitted neighbor on one side) falls back to the default value", () => {
    const rows = [
      ...bucketRows(2, 0.2),
      ...bucketRows(3, 0.15),
      ...bucketRows(4, 0.1),
    ];
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.source).toBe("tenant");
    expect(curve.expectedCtrAt(1)).toBe(defaultExpectedCtrAt(1)); // no fitted bucket below
    expect(curve.expectedCtrAt(10)).toBe(defaultExpectedCtrAt(10)); // none above either
    expect(curve.expectedCtrAt(13)).toBe(defaultExpectedCtrAt(13)); // tail bands too
    expect(curve.expectedCtrAt(25)).toBe(defaultExpectedCtrAt(25));
  });
});

describe("fitTenantCtrCurve - honest fallback when the tenant lacks data", () => {
  it(`fewer than ${MIN_FITTED_BUCKETS} trusted buckets = the industry default, honestly tagged`, () => {
    const rows = [...bucketRows(3, 0.1), ...bucketRows(7, 0.03)]; // only 2 trustworthy buckets
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.source).toBe("default");
    expect(curve.basis).toBe(DEFAULT_CURVE_BASIS);
    expect(curve.basis).toContain("not enough of your own data yet");
    for (const p of [1, 3, 7, 12, 25]) expect(curve.expectedCtrAt(p)).toBe(defaultExpectedCtrAt(p));
  });

  it("no rows at all = the default curve", () => {
    const curve = fitTenantCtrCurve([], { now: NOW });
    expect(curve.source).toBe("default");
    expect(curve.queries).toBe(0);
    expect(curve.impressions).toBe(0);
  });

  it("defaultCtrCurve() is the same honest object shape", () => {
    const curve = defaultCtrCurve(NOW);
    expect(curve.source).toBe("default");
    expect(curve.basis).toBe(DEFAULT_CURVE_BASIS);
    expect(curve.expectedCtrAt(4)).toBe(defaultExpectedCtrAt(4));
  });
});

describe("fitTenantCtrCurve - brand queries never teach the curve", () => {
  it("brandTokensFor extracts the full name plus a meaningful first word", () => {
    expect(brandTokensFor("Ritz Builders")).toEqual(["ritz builders", "ritz"]);
    expect(brandTokensFor("Iranopedia")).toEqual(["iranopedia"]);
    expect(brandTokensFor("")).toEqual([]);
    expect(brandTokensFor(null)).toEqual([]);
  });

  it("isBrandQuery matches on any token, case-insensitively", () => {
    const tokens = brandTokensFor("Iranopedia");
    expect(isBrandQuery("IRANOPEDIA flags", tokens)).toBe(true);
    expect(isBrandQuery("iranian flags", tokens)).toBe(false);
    expect(isBrandQuery("anything", [])).toBe(false);
  });

  it("a tenant whose data is all brand queries gets the honest default, not a navigational curve", () => {
    const rows = [
      ...bucketRows(1, 0.6).map((r) => ({ ...r, query: `iranopedia ${r.query}` })),
      ...bucketRows(2, 0.5).map((r) => ({ ...r, query: `iranopedia ${r.query}` })),
      ...bucketRows(3, 0.4).map((r) => ({ ...r, query: `iranopedia ${r.query}` })),
    ];
    const curve = fitTenantCtrCurve(rows, { brandName: "Iranopedia", now: NOW });
    expect(curve.source).toBe("default");
  });

  it("non-brand rows still fit when brand rows are mixed in", () => {
    const rows = [
      ...bucketRows(1, 0.9, 6, 100, "brand-").map((r) => ({ ...r, query: `iranopedia ${r.query}` })),
      ...bucketRows(1, 0.25),
      ...bucketRows(2, 0.14),
      ...bucketRows(3, 0.1),
    ];
    const curve = fitTenantCtrCurve(rows, { brandName: "Iranopedia", now: NOW });
    expect(curve.source).toBe("tenant");
    // The brand queries' 0.9 CTR never contaminated position 1's median.
    expect(curve.expectedCtrAt(1)).toBeCloseTo(0.25, 10);
  });
});

describe("fitTenantCtrCurve - hygiene", () => {
  it("ignores junk rows (zero impressions, bad positions, empty queries) instead of crashing", () => {
    const junk: QueryCtrAggregate[] = [
      { query: "x", clicks: 5, impressions: 0, position: 3 },
      { query: "y", clicks: 5, impressions: NaN, position: 3 },
      { query: "z", clicks: 5, impressions: 100, position: 0.2 },
      { query: "", clicks: 5, impressions: 100, position: 3 },
      { query: "w", clicks: -5, impressions: 100, position: 3 },
    ];
    const curve = fitTenantCtrCurve(junk, { now: NOW });
    expect(curve.source).toBe("default");
  });

  it("clamps an absurd bucket median to a sane CTR band", () => {
    const rows = [
      ...bucketRows(1, 2.0), // clicks > impressions in the raw rows
      ...bucketRows(2, 0.14),
      ...bucketRows(3, 0.1),
    ];
    const curve = fitTenantCtrCurve(rows, { now: NOW });
    expect(curve.expectedCtrAt(1)).toBeLessThanOrEqual(0.95);
    expect(curve.expectedCtrAt(1)).toBeGreaterThan(0);
  });

  it("basis strings never carry an em or en dash (dash guard)", () => {
    const fitted = fitTenantCtrCurve(
      [...bucketRows(1, 0.25), ...bucketRows(2, 0.14), ...bucketRows(3, 0.1)],
      { now: NOW },
    );
    expect(fitted.basis).not.toMatch(/[–—]/);
    expect(defaultCtrCurve(NOW).basis).not.toMatch(/[–—]/);
  });
});
