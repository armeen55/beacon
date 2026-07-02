/**
 * seasonal/seasonal-hints tests (2026-07-02, master plan item 21): the prep-now
 * feed only fires within the 21-day urgency window, stays bounded at 2, keeps
 * one hint per page, and never fabricates urgency for a page with no known
 * top page.
 */
import { describe, expect, it } from "vitest";

import { buildSeasonalHintNotes, MAX_SEASONAL_HINTS_PER_NIGHT, PREP_WINDOW_DAYS } from "./seasonal-hints";
import type { SeasonalQuery } from "./seasonality";

const NOW = new Date("2026-07-02T00:00:00Z");

function seasonal(over: Partial<SeasonalQuery> = {}): SeasonalQuery {
  return {
    query: "nowruz table setting",
    peakMonths: [3],
    share: 0.8,
    annualImpressions: 41000,
    topPage: "https://iranopedia.com/nowruz",
    peakStartDate: "2027-03-01",
    prepByDate: "2026-07-10", // 8 days from NOW
    sentence: 'Searches for "nowruz table setting" climb every March (last year: 41,000 impressions in that window). I would prep this page by February 15, six weeks ahead, so Google has it indexed before the wave.',
    confidence: "repeated",
    ...over,
  };
}

describe("buildSeasonalHintNotes", () => {
  it("emits a hint keyed by the normalized page path when prep is due within the window", () => {
    const out = buildSeasonalHintNotes([seasonal()], NOW);
    expect(out.size).toBe(1);
    const note = out.get("/nowruz");
    expect(note?.query).toBe("nowruz table setting");
    expect(note?.sentence).toContain("41,000");
  });

  it("skips windows whose prep deadline is further out than the urgency window", () => {
    const farOut = seasonal({ prepByDate: "2026-09-01" }); // ~2 months out
    expect(buildSeasonalHintNotes([farOut], NOW).size).toBe(0);
  });

  it("still fires when the prep deadline is already due (not strictly in the future)", () => {
    const overdue = seasonal({ prepByDate: "2026-06-20" }); // in the past relative to NOW
    expect(buildSeasonalHintNotes([overdue], NOW).size).toBe(1);
  });

  it("skips seasonal windows with no known top page (nothing exact to strengthen)", () => {
    expect(buildSeasonalHintNotes([seasonal({ topPage: null })], NOW).size).toBe(0);
  });

  it("is bounded and keeps the soonest-deadline windows (input arrives ranked)", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      seasonal({ query: `q${i}`, topPage: `https://x.com/p${i}`, prepByDate: `2026-07-0${i + 1}` }),
    );
    const out = buildSeasonalHintNotes(many, NOW);
    expect(out.size).toBe(MAX_SEASONAL_HINTS_PER_NIGHT);
    expect([...out.keys()]).toEqual(["/p0", "/p1"]);
  });

  it("keeps one hint per page (first wins)", () => {
    const out = buildSeasonalHintNotes(
      [seasonal({ query: "first" }), seasonal({ query: "second" })],
      NOW,
    );
    expect(out.size).toBe(1);
    expect(out.get("/nowruz")?.query).toBe("first");
  });

  it("respects the configured urgency window boundary", () => {
    expect(PREP_WINDOW_DAYS).toBe(21);
    const justInside = seasonal({ prepByDate: "2026-07-22" }); // 20 days out
    const justOutside = seasonal({ prepByDate: "2026-07-24" }); // 22 days out
    expect(buildSeasonalHintNotes([justInside], NOW).size).toBe(1);
    expect(buildSeasonalHintNotes([justOutside], NOW).size).toBe(0);
  });
});
