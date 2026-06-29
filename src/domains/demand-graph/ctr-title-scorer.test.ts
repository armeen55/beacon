import { describe, it, expect } from "vitest";
import { titleCandidates, buildTitleVariants, bestTitle, scoreTitle } from "./ctr-title-scorer";

describe("titleCandidates", () => {
  it("never emits the (YYYY Guide) boilerplate", () => {
    const cands = titleCandidates("persian numbers", "Iranopedia");
    expect(cands.some((c) => /\(20\d\d Guide\)/.test(c))).toBe(false);
  });
  it("tolerates a legacy numeric third arg (ignored)", () => {
    const cands = titleCandidates("persian numbers", "Iranopedia", 2026);
    expect(cands).toContain("Persian Numbers | Iranopedia");
  });
  it("always offers the exact-query framing", () => {
    expect(titleCandidates("persian wedding traditions", "Iranopedia")).toContain(
      "Persian Wedding Traditions | Iranopedia",
    );
  });
  it("adds a Top N variant only for list-intent queries", () => {
    expect(titleCandidates("best persian restaurants", "X").some((c) => c.startsWith("Top 10"))).toBe(true);
    expect(titleCandidates("persian new year", "X").some((c) => c.startsWith("Top 10"))).toBe(false);
  });
});

describe('"Complete Guide" is not the universal fallback', () => {
  it("does NOT generate Complete Guide for a list-intent query", () => {
    const cands = titleCandidates("best persian foods", "Iranopedia");
    expect(cands.some((c) => /Complete Guide/.test(c))).toBe(false);
  });
  it("does NOT generate Complete Guide for a bare entity query", () => {
    const cands = titleCandidates("onager", "Iranopedia");
    expect(cands.some((c) => /Complete Guide/.test(c))).toBe(false);
  });
  it("DOES allow Complete Guide for an explainer/definitional query", () => {
    const cands = titleCandidates("what is nowruz", "Iranopedia");
    expect(cands.some((c) => /Complete Guide/.test(c))).toBe(true);
  });
  it("best title for a list query is a list framing, not a guide", () => {
    const best = bestTitle("persian boy names", "Iranopedia");
    expect(/Complete Guide/.test(best)).toBe(false);
    expect(/^Top \d/.test(best)).toBe(true);
  });
  it("best titles vary by intent across pages (not all identical templates)", () => {
    const bests = ["persian boy names", "onager", "what is nowruz", "best persian foods", "iran flag"].map((q) =>
      bestTitle(q, "Iranopedia"),
    );
    const guideCount = bests.filter((t) => /Complete Guide/.test(t)).length;
    expect(guideCount).toBeLessThanOrEqual(1); // never the default across the board
    expect(new Set(bests).size).toBeGreaterThanOrEqual(4); // real variety
  });
});

describe("buildTitleVariants — evidence + reasons", () => {
  it("attaches a one-line reason + strategy to every variant", () => {
    const vs = buildTitleVariants("persian boy names", "Iranopedia");
    expect(vs.length).toBeGreaterThanOrEqual(2);
    expect(vs.every((v) => typeof v.reason === "string" && v.reason!.length > 0)).toBe(true);
    expect(vs.every((v) => typeof v.strategy === "string")).toBe(true);
  });
  it("offers a 'trim under 60 chars' variant when the current title is over the limit", () => {
    const longTitle = "Top 20 Famous Persian Actresses and Actors in Cinema History | Iranopedia";
    expect(longTitle.length).toBeGreaterThan(60);
    const vs = buildTitleVariants("persian actors", "Iranopedia", { currentTitle: longTitle });
    const trim = vs.find((v) => v.strategy === "trim-current");
    expect(trim).toBeTruthy();
    expect(trim!.title.length).toBeLessThanOrEqual(60);
  });
  it("does not invent a trim variant when the current title already fits", () => {
    const vs = buildTitleVariants("onager", "Iranopedia", { currentTitle: "Onager | Iranopedia" });
    expect(vs.some((v) => v.strategy === "trim-current")).toBe(false);
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
