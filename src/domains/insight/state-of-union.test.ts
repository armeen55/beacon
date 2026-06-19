import { describe, expect, it } from "vitest";
import { deriveHeadline } from "./state-of-union";

describe("deriveHeadline", () => {
  it("leads with the CTR-leak story when many leaks exist and clicks drop", () => {
    const h = deriveHeadline(
      { clicks28d: 1577, clicksPrev28d: 1689, impressions90d: 110082, avgPosition90d: 9.1 },
      6,
    );
    expect(h.verdict).toBe("ranking_better_losing_clicks");
    expect(h.headline.toLowerCase()).toContain("leaking clicks");
    expect(h.clicksDeltaPct).toBeLessThan(0);
  });

  it("STILL leads with CTR leaks even when clicks are UP (real Iranopedia case: +7%, 37 leaks)", () => {
    const h = deriveHeadline(
      { clicks28d: 2896, clicksPrev28d: 2707, impressions90d: 361976, avgPosition90d: 9.6 },
      37,
    );
    expect(h.verdict).toBe("ranking_better_losing_clicks");
    expect(h.headline).toContain("37 page-1 pages");
    expect(h.subline.toLowerCase()).toContain("up"); // trend still reported in the subline
  });

  it("low CTR-leak count + clicks down → plain declining", () => {
    const h = deriveHeadline(
      { clicks28d: 800, clicksPrev28d: 1200, impressions90d: 5000, avgPosition90d: 20 },
      0,
    );
    expect(h.verdict).toBe("declining");
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
