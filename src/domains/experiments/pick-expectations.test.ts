import { describe, expect, it } from "vitest";
import { buildPickExpectations, forecastRange } from "./pick-expectations";

describe("pick-expectations (items 31/34/35)", () => {
  it("forecasts a friendly monthly range from the 90d opportunity", () => {
    // 240 clicks/90d -> 80/mo -> 25%..75% = 20..60
    expect(forecastRange(240)).toEqual({ low: 20, high: 60 });
  });

  it("suppresses a forecast too small to mean anything", () => {
    expect(forecastRange(6)).toBeNull();
    expect(forecastRange(0)).toBeNull();
    expect(forecastRange(NaN)).toBeNull();
  });

  it("writes the three lines for a meta pick", () => {
    const x = buildPickExpectations({ lever: "meta", ctrOpportunityClicks: 240, effortMinutes: 1 });
    expect(x.forecast).toContain("roughly 20 to 60 extra clicks a month");
    expect(x.forecast).toContain("not a promise");
    expect(x.changeOurMind).toContain("If clicks do not move by the 14-day read");
    expect(x.changeOurMind).toContain("a direct answer at the top of the page");
    expect(x.effort).toBe("about 1 minute in your site editor");
  });

  it("omits the forecast but keeps the exit plan on tiny opportunities", () => {
    const x = buildPickExpectations({ lever: "title", ctrOpportunityClicks: 2, effortMinutes: 3 });
    expect(x.forecast).toBeUndefined();
    expect(x.changeOurMind).toContain("a sharper description");
    expect(x.effort).toBe("about 3 minutes in your site editor");
  });
});
