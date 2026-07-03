import { describe, it, expect } from "vitest";

import {
  buildStrikingPortfolio,
  isStrikingDistance,
  type StrikingQueryInput,
} from "./striking-portfolio";
import { isStrikingDistance as reExported } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { defaultCtrCurve, type TenantCtrCurve } from "@/domains/forecast/tenant-ctr-curve";
import { brandTokensFor } from "./brand-split";

const BANNED_DASH = /[‒–—―]/;

describe("isStrikingDistance (moved from gsc-page-queries, byte-identical)", () => {
  it("holds at the position and impression boundaries", () => {
    expect(isStrikingDistance(4, 100)).toBe(true);
    expect(isStrikingDistance(15, 100)).toBe(true);
    expect(isStrikingDistance(3.9, 100)).toBe(false);
    expect(isStrikingDistance(15.1, 100)).toBe(false);
    expect(isStrikingDistance(8, 99)).toBe(false);
    expect(isStrikingDistance(8, 100)).toBe(true);
  });

  it("gsc-page-queries re-exports the SAME function (one implementation)", () => {
    expect(reExported).toBe(isStrikingDistance);
  });
});

const q = (over: Partial<StrikingQueryInput>): StrikingQueryInput => ({
  query: "persian recipes",
  clicks: 10,
  impressions: 500,
  position: 8,
  ...over,
});

describe("buildStrikingPortfolio", () => {
  it("counts distinct striking searches and sums their impressions", () => {
    const portfolio = buildStrikingPortfolio([
      q({ query: "persian recipes", impressions: 3000, position: 8 }),
      q({ query: "tehran travel", impressions: 500, position: 12 }),
      q({ query: "top of page one", impressions: 900, position: 2 }), // not striking
      q({ query: "thin demand", impressions: 50, position: 9 }), // under the floor
    ])!;
    expect(portfolio.queryCount).toBe(2);
    expect(portfolio.totalImpressions).toBe(3500);
    expect(portfolio.headline).toContain("2 searches rank just below the top results");
    expect(portfolio.headline).toContain("shown 3,500 times in the last 90 days");
  });

  it("collapses the same query across pages (summed impressions, weighted position)", () => {
    const portfolio = buildStrikingPortfolio([
      q({ query: "Persian Recipes", impressions: 300, position: 6 }),
      q({ query: "persian recipes", impressions: 300, position: 10 }),
    ])!;
    // One query, 600 impressions, weighted position 8 (still striking).
    expect(portfolio.queryCount).toBe(1);
    expect(portfolio.totalImpressions).toBe(600);
  });

  it("excludes brand searches through the one brand classifier", () => {
    const portfolio = buildStrikingPortfolio(
      [
        q({ query: "iranopedia persian names", impressions: 2000, position: 8 }),
        q({ query: "persian names", impressions: 800, position: 8 }),
      ],
      { brandTokens: brandTokensFor("Iranopedia") },
    )!;
    expect(portfolio.queryCount).toBe(1);
    expect(portfolio.totalImpressions).toBe(800);
  });

  it("returns null when nothing qualifies (surfaces self-hide, never a bare zero)", () => {
    expect(buildStrikingPortfolio([])).toBeNull();
    expect(buildStrikingPortfolio([q({ position: 2 })])).toBeNull();
  });

  it("sizes the push through the CTR curve and forecastRange's capture band", () => {
    // Default curve: expected CTR at position 3 is 0.11. One query, 3,000
    // impressions, 30 clicks: top-3 clicks 330, gap 300 over 90 days ->
    // 100/month -> 25 to 75 through the 25/75 capture band.
    const portfolio = buildStrikingPortfolio(
      [q({ query: "persian recipes", impressions: 3000, clicks: 30, position: 8 })],
      { curve: defaultCtrCurve(new Date("2026-07-01T00:00:00Z")) },
    )!;
    expect(portfolio.extraClicksLowPerMonth).toBe(25);
    expect(portfolio.extraClicksHighPerMonth).toBe(75);
    expect(portfolio.sizingLine).toContain("Reaching the top 3 is usually worth 25 to 75 extra clicks a month");
    expect(portfolio.sizingLine).toContain("typical click rates at each Google position");
  });

  it("names the tenant's own data when a tenant-fitted curve sized it", () => {
    const tenantCurve: TenantCtrCurve = {
      expectedCtrAt: () => 0.2,
      source: "tenant",
      basis: "your own search data (100 queries, 50,000 impressions)",
      fittedAt: "2026-07-01T00:00:00.000Z",
      queries: 100,
      impressions: 50_000,
    };
    const portfolio = buildStrikingPortfolio(
      [q({ query: "persian recipes", impressions: 3000, clicks: 30, position: 8 })],
      { curve: tenantCurve },
    )!;
    expect(portfolio.sizingLine).toContain("how your own pages convert position to clicks");
  });

  it("no curve means no sizing line, never an invented number", () => {
    const portfolio = buildStrikingPortfolio([q({ impressions: 3000, position: 8 })])!;
    expect(portfolio.sizingLine).toBeNull();
    expect(portfolio.extraClicksLowPerMonth).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const portfolio = buildStrikingPortfolio(
      [q({ impressions: 3000, clicks: 30, position: 8 })],
      { curve: defaultCtrCurve(new Date("2026-07-01T00:00:00Z")) },
    )!;
    expect(BANNED_DASH.test(portfolio.headline)).toBe(false);
    expect(BANNED_DASH.test(portfolio.sizingLine ?? "")).toBe(false);
  });
});
