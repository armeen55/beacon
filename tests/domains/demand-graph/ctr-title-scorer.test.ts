import { describe, it, expect } from "vitest";
import { bestTitle, scoreTitle, titleCandidates } from "@/domains/demand-graph/ctr-title-scorer";

describe("ctr-title-scorer (deterministic, no LLM)", () => {
  it("bestTitle keeps the query, adds the brand, stays ≤60 chars", () => {
    const t = bestTitle("persian wedding traditions", "Iranopedia", 2026);
    expect(t.toLowerCase()).toContain("persian wedding traditions");
    expect(t).toContain("Iranopedia");
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it("a list-intent query gets a number/list variant scored higher than the bare title", () => {
    const cands = titleCandidates("best persian boy names", "Iranopedia", 2026);
    expect(cands.some((c) => /top 10/i.test(c) || /list/i.test(c))).toBe(true);
    const bare = scoreTitle("Best Persian Boy Names | Iranopedia", "best persian boy names", "Iranopedia");
    const listy = scoreTitle("Top 10 Best Persian Boy Names | Iranopedia", "best persian boy names", "Iranopedia");
    expect(listy.score).toBeGreaterThan(bare.score);
  });

  it("rewards full query coverage + penalizes over-length titles", () => {
    const covered = scoreTitle("Cities in Iran | Iranopedia", "cities in iran", "Iranopedia");
    const missing = scoreTitle("Beautiful Places | Iranopedia", "cities in iran", "Iranopedia");
    expect(covered.score).toBeGreaterThan(missing.score);
    expect(covered.signals).toContain("full-query");

    const tooLong = scoreTitle(
      "The Absolutely Complete and Definitive Ultimate Guide to Cities in Iran for Travelers | Iranopedia",
      "cities in iran",
      "Iranopedia",
    );
    expect(tooLong.signals).toContain("too-long");
  });

  it("is deterministic — same inputs, same output (year is an explicit arg)", () => {
    expect(bestTitle("farsi vs persian", "Iranopedia", 2026)).toBe(bestTitle("farsi vs persian", "Iranopedia", 2026));
  });
});
