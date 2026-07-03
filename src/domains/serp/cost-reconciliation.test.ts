import { describe, it, expect } from "vitest";
import { reconcileCost, SERP_PER_CALL_USD, type PlatformSpendRow } from "./cost-reconciliation";
import { SERP_COST_USD } from "./dataforseo-serp";

describe("reconcileCost (v1 417) - estimated vs actual research spend, $0 read", () => {
  it("SERP_PER_CALL_USD stays byte-identical to dataforseo-serp SERP_COST_USD (drift pin)", () => {
    expect(SERP_PER_CALL_USD).toBe(SERP_COST_USD);
  });

  it("empty-safe: no spend rows -> zero totals + honest nothing-to-reconcile line", () => {
    const r = reconcileCost([]);
    expect(r.perPlatform).toEqual([]);
    expect(r.totalEstimatedUsd).toBe(0);
    expect(r.totalActualUsd).toBe(0);
    expect(r.totalDeltaUsd).toBe(0);
    expect(r.sentence).toMatch(/have not spent anything on live research yet/i);
    expect(r.sentence).not.toMatch(/[‒–—―]/);
  });

  it("estimate for dataforseo-serp = calls x per-call price; delta is real drift", () => {
    // 16 calls x $0.003 = $0.048 estimated; ledger says $0.050 actually charged.
    const rows: PlatformSpendRow[] = [
      { platform: "dataforseo-serp", spentUsd: 0.05, calls: 16 },
    ];
    const r = reconcileCost(rows);
    expect(SERP_COST_USD).toBe(0.003);
    expect(r.perPlatform[0]!.estimatedUsd).toBeCloseTo(0.048, 6);
    expect(r.perPlatform[0]!.actualUsd).toBe(0.05);
    expect(r.perPlatform[0]!.deltaUsd).toBeCloseTo(0.002, 6);
    expect(r.perPlatform[0]!.hasEstimate).toBe(true);
    expect(r.totalEstimatedUsd).toBeCloseTo(0.048, 6);
    expect(r.totalActualUsd).toBe(0.05);
    // honest receipt in Beacon voice
    expect(r.sentence).toMatch(/I estimated \$0.048 and actually spent \$0.05/);
    expect(r.sentence).not.toMatch(/[‒–—―]/);
  });

  it("spent LESS than estimated reads 'only'", () => {
    const rows: PlatformSpendRow[] = [
      { platform: "dataforseo-serp", spentUsd: 0.04, calls: 16 }, // est 0.048, actual 0.04
    ];
    const r = reconcileCost(rows);
    expect(r.totalDeltaUsd).toBeLessThan(0);
    expect(r.sentence).toMatch(/actually spent only \$0.04/);
  });

  it("exact match reads 'spent exactly that'", () => {
    const rows: PlatformSpendRow[] = [
      { platform: "dataforseo-serp", spentUsd: 0.048, calls: 16 }, // est == actual
    ];
    const r = reconcileCost(rows);
    expect(r.sentence).toMatch(/estimated \$0.048 and spent exactly that/);
  });

  it("platform with no known per-call price mirrors actual (no fabricated drift)", () => {
    const rows: PlatformSpendRow[] = [
      { platform: "openai", spentUsd: 1.23, calls: 40 },
    ];
    const r = reconcileCost(rows);
    expect(r.perPlatform[0]!.hasEstimate).toBe(false);
    expect(r.perPlatform[0]!.estimatedUsd).toBe(1.23); // mirrors actual
    expect(r.perPlatform[0]!.deltaUsd).toBe(0);
    // sentence names only what was actually spent (no fake estimate claim)
    expect(r.sentence).toMatch(/I actually spent \$1.23/);
  });

  it("mixes platforms and sorts by actual spend descending", () => {
    const rows: PlatformSpendRow[] = [
      { platform: "dataforseo-serp", spentUsd: 0.05, calls: 16 },
      { platform: "openai", spentUsd: 2.0, calls: 40 },
    ];
    const r = reconcileCost(rows);
    expect(r.perPlatform[0]!.platform).toBe("openai"); // biggest actual first
    expect(r.perPlatform[1]!.platform).toBe("dataforseo-serp");
    expect(r.totalActualUsd).toBeCloseTo(2.05, 6);
    // has at least one real estimate -> estimated/actual sentence form
    expect(r.sentence).toMatch(/I estimated/);
  });

  it("drops malformed rows (negative, non-finite, blank platform) safely", () => {
    const rows: PlatformSpendRow[] = [
      { platform: "", spentUsd: 1, calls: 1 },
      { platform: "dataforseo-serp", spentUsd: -1, calls: 1 },
      { platform: "dataforseo-serp", spentUsd: Number.NaN, calls: 1 },
      { platform: "dataforseo-serp", spentUsd: 0.006, calls: 2 },
    ];
    const r = reconcileCost(rows);
    expect(r.perPlatform).toHaveLength(1);
    expect(r.perPlatform[0]!.calls).toBe(2);
  });
});
