import { describe, it, expect } from "vitest";
import {
  normalizePageRevenue,
  revenueScoreMultiplier,
  revenueStateLabel,
  type RawPageRevenueAggregate,
} from "@/domains/recommendation-intelligence/ga4-revenue";

const base: RawPageRevenueAggregate = {
  page: "https://x.com/p",
  sessions: 0,
  engagedSessions: 0,
  conversions: 0,
  totalRevenue: null,
  purchaseRevenue: null,
  transactions: null,
  revenueCurrency: null,
  revenueObserved: false,
};

describe("normalizePageRevenue — unknown vs zero", () => {
  it("no GA4 data at all → unknown, revenue null (NOT 0)", () => {
    const v = normalizePageRevenue({ ...base });
    expect(v.confidence).toBe("unknown");
    expect(v.revenue).toBeNull();
    expect(v.revenuePerVisit).toBeNull();
  });

  it("traffic but revenue never observed → revenue stays null (unknown), low confidence", () => {
    const v = normalizePageRevenue({ ...base, sessions: 500 });
    expect(v.revenue).toBeNull(); // NOT 0 — never fetched
    expect(v.confidence).toBe("low");
  });

  it("conversions present, revenue not observed → medium, revenue null", () => {
    const v = normalizePageRevenue({ ...base, sessions: 500, conversions: 12 });
    expect(v.revenue).toBeNull();
    expect(v.confidence).toBe("medium");
  });

  it("revenue OBSERVED as zero → revenue 0 (not null), high confidence", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: 500,
      purchaseRevenue: 0,
      revenueObserved: true,
    });
    expect(v.revenue).toBe(0);
    expect(v.confidence).toBe("high");
  });

  it("real revenue present → revenue value, currency preserved, high confidence", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: 1000,
      conversions: 20,
      purchaseRevenue: 5000,
      transactions: 50,
      revenueCurrency: "USD",
      revenueObserved: true,
    });
    expect(v.revenue).toBe(5000);
    expect(v.revenueCurrency).toBe("USD");
    expect(v.revenueSource).toBe("ga4_purchase_revenue");
    expect(v.confidence).toBe("high");
  });

  it("prefers purchase_revenue over total_revenue", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: 10,
      purchaseRevenue: 100,
      totalRevenue: 999,
      revenueObserved: true,
    });
    expect(v.revenue).toBe(100);
    expect(v.revenueSource).toBe("ga4_purchase_revenue");
  });

  it("falls back to total_revenue when purchase is null", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: 10,
      totalRevenue: 250,
      revenueObserved: true,
    });
    expect(v.revenue).toBe(250);
    expect(v.revenueSource).toBe("ga4_total_revenue");
  });
});

describe("normalizePageRevenue — derived ratios are divide-by-zero safe", () => {
  it("revenuePerVisit null when sessions is 0", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: 0,
      purchaseRevenue: 100,
      revenueObserved: true,
    });
    expect(v.revenuePerVisit).toBeNull(); // no /0
  });

  it("revenuePerVisit computed when sessions > 0 and revenue known", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: 200,
      purchaseRevenue: 1000,
      revenueObserved: true,
    });
    expect(v.revenuePerVisit).toBeCloseTo(5, 5);
  });

  it("averageOrderValue null when transactions 0/null, computed otherwise", () => {
    expect(
      normalizePageRevenue({ ...base, sessions: 10, purchaseRevenue: 100, transactions: 0, revenueObserved: true }).averageOrderValue,
    ).toBeNull();
    const v = normalizePageRevenue({ ...base, sessions: 10, purchaseRevenue: 100, transactions: 4, revenueObserved: true });
    expect(v.averageOrderValue).toBeCloseTo(25, 5);
  });

  it("never emits NaN/Infinity from malformed input", () => {
    const v = normalizePageRevenue({
      ...base,
      sessions: Number.NaN as unknown as number,
      purchaseRevenue: Number.POSITIVE_INFINITY as unknown as number,
      revenueObserved: true,
    });
    expect(Number.isFinite(v.revenue ?? 0)).toBe(true);
    expect(v.revenuePerVisit === null || Number.isFinite(v.revenuePerVisit)).toBe(true);
  });
});

describe("revenueScoreMultiplier — bounded influence, never punishes", () => {
  const norm = (o: Partial<RawPageRevenueAggregate>) => normalizePageRevenue({ ...base, ...o });

  it("real revenue boosts (>1) and is bounded at the ceiling", () => {
    const small = revenueScoreMultiplier(norm({ sessions: 10, purchaseRevenue: 100, revenueObserved: true }));
    const big = revenueScoreMultiplier(norm({ sessions: 10, purchaseRevenue: 10_000_000, revenueObserved: true }));
    expect(small.multiplier).toBeGreaterThan(1);
    expect(small.basis).toBe("revenue");
    expect(big.multiplier).toBeLessThanOrEqual(4.0);
    expect(big.multiplier).toBeGreaterThan(small.multiplier);
  });

  it("observed-zero revenue → neutral 1.0 (no boost, no punish)", () => {
    const r = revenueScoreMultiplier(norm({ sessions: 500, purchaseRevenue: 0, revenueObserved: true }));
    expect(r.multiplier).toBe(1.0);
    expect(r.explain).toMatch(/no revenue observed/i);
  });

  it("conversion fallback is weaker than real revenue and capped at 2.0", () => {
    const conv = revenueScoreMultiplier(norm({ sessions: 500, conversions: 10_000 }));
    expect(conv.basis).toBe("conversions");
    expect(conv.multiplier).toBeGreaterThan(1);
    expect(conv.multiplier).toBeLessThanOrEqual(2.0);
    // a modest real-revenue page should be able to exceed the conversion cap
    const rev = revenueScoreMultiplier(norm({ sessions: 10, purchaseRevenue: 5000, revenueObserved: true }));
    expect(rev.multiplier).toBeGreaterThan(2.0);
  });

  it("no revenue + no conversions (informational page) → 1.0 neutral, not penalized", () => {
    const r = revenueScoreMultiplier(norm({ sessions: 2000 }));
    expect(r.multiplier).toBe(1.0);
    expect(r.basis).toBe("none");
  });

  it("unknown (no data) → 1.0 + 'unavailable' explain", () => {
    const r = revenueScoreMultiplier(norm({}));
    expect(r.multiplier).toBe(1.0);
    expect(r.explain).toMatch(/unavailable/i);
  });
});

describe("revenueStateLabel — never says $0 for unknown", () => {
  const norm = (o: Partial<RawPageRevenueAggregate>) => normalizePageRevenue({ ...base, ...o });
  it("unknown → 'No GA4 data'", () => {
    expect(revenueStateLabel(norm({}))).toBe("No GA4 data");
  });
  it("traffic, revenue unknown → 'Revenue unknown' (not $0)", () => {
    expect(revenueStateLabel(norm({ sessions: 100 }))).toMatch(/unknown/i);
  });
  it("observed zero with traffic → 'Traffic but no revenue observed'", () => {
    expect(revenueStateLabel(norm({ sessions: 100, purchaseRevenue: 0, revenueObserved: true }))).toMatch(/no revenue observed/i);
  });
  it("real revenue → 'Revenue observed'", () => {
    expect(revenueStateLabel(norm({ sessions: 100, purchaseRevenue: 500, revenueObserved: true }))).toBe("Revenue observed");
  });
});
