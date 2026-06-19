import { describe, expect, it } from "vitest";
import { deriveHeadline } from "./state-of-union";

describe("deriveHeadline", () => {
  it("flags 'ranking better, losing clicks' when clicks drop AND CTR leaks exist", () => {
    // Real Iranopedia shape: clicks 1,689 → 1,577 (down), many CTR-leak pages.
    const h = deriveHeadline(
      { clicks28d: 1577, clicksPrev28d: 1689, impressions90d: 110082, avgPosition90d: 9.1 },
      6,
    );
    expect(h.verdict).toBe("ranking_better_losing_clicks");
    expect(h.headline.toLowerCase()).toContain("losing clicks");
    expect(h.clicksDeltaPct).toBeLessThan(0);
  });

  it("says 'declining' when clicks drop with few CTR leaks", () => {
    const h = deriveHeadline(
      { clicks28d: 800, clicksPrev28d: 1200, impressions90d: 5000, avgPosition90d: 20 },
      0,
    );
    expect(h.verdict).toBe("declining");
    expect(h.headline).toContain("down");
  });

  it("says 'growing' when clicks rise", () => {
    const h = deriveHeadline(
      { clicks28d: 1300, clicksPrev28d: 1000, impressions90d: 5000, avgPosition90d: 8 },
      0,
    );
    expect(h.verdict).toBe("growing");
    expect(h.clicksDeltaPct).toBe(30);
  });

  it("says 'healthy' when clicks are flat", () => {
    const h = deriveHeadline(
      { clicks28d: 1000, clicksPrev28d: 1000, impressions90d: 5000, avgPosition90d: 8 },
      1,
    );
    expect(h.verdict).toBe("healthy");
  });
});
