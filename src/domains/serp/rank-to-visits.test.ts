import { describe, it, expect } from "vitest";
import { rankToVisits, expectedVisitsAt } from "./rank-to-visits";
import { DEFAULT_CTR_BY_POSITION, type TenantCtrCurve } from "@/domains/forecast/tenant-ctr-curve";

describe("expectedVisitsAt (v1 367) - default curve math against known CTR points", () => {
  it("multiplies the industry-default CTR at a position by monthly impressions", () => {
    // position 3 default CTR = 0.11; 1000 impressions -> 110 visits
    expect(DEFAULT_CTR_BY_POSITION[3]).toBe(0.11);
    expect(expectedVisitsAt(3, 1000)).toBeCloseTo(110, 6);
    // position 8 default CTR = 0.034; 1000 impressions -> 34 visits
    expect(DEFAULT_CTR_BY_POSITION[8]).toBe(0.034);
    expect(expectedVisitsAt(8, 1000)).toBeCloseTo(34, 6);
  });

  it("empty-safe: null position or no impressions -> null (never fabricates)", () => {
    expect(expectedVisitsAt(null, 1000)).toBeNull();
    expect(expectedVisitsAt(0, 1000)).toBeNull();
    expect(expectedVisitsAt(3, null)).toBeNull();
    expect(expectedVisitsAt(3, 0)).toBeNull();
    expect(expectedVisitsAt(3, Number.NaN)).toBeNull();
  });

  it("uses a tenant fitted curve when passed", () => {
    const curve: TenantCtrCurve = {
      expectedCtrAt: (p) => (p <= 3 ? 0.2 : 0.05),
      source: "tenant",
      basis: "your own search data (12 queries, 5,000 impressions)",
      fittedAt: "2026-07-03T00:00:00.000Z",
      queries: 12,
      impressions: 5000,
    };
    expect(expectedVisitsAt(3, 1000, curve)).toBeCloseTo(200, 6);
    expect(expectedVisitsAt(8, 1000, curve)).toBeCloseTo(50, 6);
  });
});

describe("rankToVisits (v1 367) - rank move -> expected monthly visits", () => {
  it("#8 to #3 on 1000 impressions is worth about 76 more visits a month", () => {
    // #3 = 110 visits, #8 = 34 visits -> raw gain 76 -> friendly 75 (5s over 10)
    const r = rankToVisits({ currentPosition: 8, targetPosition: 3, monthlyImpressions: 1000 });
    expect(r.currentVisits).toBeCloseTo(34, 6);
    expect(r.targetVisits).toBeCloseTo(110, 6);
    expect(r.monthlyGain).toBe(75);
    expect(r.sentence).toMatch(/Moving from #8 to #3 is worth about 75 more visits a month/);
    expect(r.sentence).not.toMatch(/[‒–—―]/);
  });

  it("larger scale rounds to the 10s unit and reads plainly", () => {
    // #8 = 340, #3 = 1100 on 10k impressions -> gain 760 -> friendly 760
    const r = rankToVisits({ currentPosition: 8, targetPosition: 3, monthlyImpressions: 10000 });
    expect(r.monthlyGain).toBe(760);
    expect(r.sentence).toMatch(/about 760 more visits a month/);
  });

  it("empty-safe: no rank + no impressions -> null gain + honest line", () => {
    const r = rankToVisits({ currentPosition: null, targetPosition: null, monthlyImpressions: null });
    expect(r.currentVisits).toBeNull();
    expect(r.targetVisits).toBeNull();
    expect(r.monthlyGain).toBeNull();
    expect(r.sentence).toMatch(/do not have a rank and monthly impressions/i);
  });

  it("target not actually higher than current -> null gain, honest 'not a real move up'", () => {
    const r = rankToVisits({ currentPosition: 3, targetPosition: 8, monthlyImpressions: 1000 });
    expect(r.monthlyGain).toBeNull();
    expect(r.sentence).toMatch(/not a real move up/i);
  });

  it("equal current and target -> null gain (no move)", () => {
    const r = rankToVisits({ currentPosition: 5, targetPosition: 5, monthlyImpressions: 1000 });
    expect(r.monthlyGain).toBeNull();
  });

  it("tenant-curve basis phrase surfaces in the sentence", () => {
    const curve: TenantCtrCurve = {
      expectedCtrAt: (p) => (p <= 3 ? 0.2 : 0.05),
      source: "tenant",
      basis: "your own search data",
      fittedAt: "2026-07-03T00:00:00.000Z",
      queries: 12,
      impressions: 5000,
    };
    const r = rankToVisits({ currentPosition: 8, targetPosition: 3, monthlyImpressions: 1000, curve });
    expect(r.basis).toMatch(/how your own pages convert position to clicks/);
    expect(r.sentence).toMatch(/how your own pages convert position to clicks/);
  });
});
