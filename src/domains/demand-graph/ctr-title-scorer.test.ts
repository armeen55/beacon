import { describe, it, expect } from "vitest";
import { titleCandidates, bestTitle, scoreTitle } from "./ctr-title-scorer";

describe("titleCandidates", () => {
  it("never emits the (YYYY Guide) boilerplate", () => {
    const cands = titleCandidates("persian numbers", "Iranopedia", 2026);
    expect(cands.some((c) => /\(20\d\d Guide\)/.test(c))).toBe(false);
  });
  it("emits three distinct page-specific framings", () => {
    const cands = titleCandidates("persian wedding traditions", "Iranopedia");
    expect(cands).toContain("Persian Wedding Traditions | Iranopedia");
    expect(cands).toContain("Persian Wedding Traditions: A Complete Guide | Iranopedia");
    expect(cands).toContain("Persian Wedding Traditions, Explained | Iranopedia");
  });
  it("adds a Top N variant only for list-intent queries", () => {
    expect(titleCandidates("best persian restaurants", "X").some((c) => c.startsWith("Top 10"))).toBe(true);
    expect(titleCandidates("persian new year", "X").some((c) => c.startsWith("Top 10"))).toBe(false);
  });
});

describe("scoreTitle", () => {
  it("does not reward year-stuffing", () => {
    const withYear = scoreTitle("Persian Numbers (2026 Guide)", "persian numbers", "");
    expect(withYear.signals).not.toContain("year");
  });
});

describe("bestTitle", () => {
  it("does not default to a year-guide title", () => {
    expect(/\(20\d\d Guide\)/.test(bestTitle("persian numbers", "Iranopedia"))).toBe(false);
  });
});
