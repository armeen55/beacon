import { describe, it, expect } from "vitest";

import { buildAnswerOpportunities, isQuestion, answerImpressionsAtStake } from "@/app/(shell)/today-questions-rows";

describe("isQuestion", () => {
  it("matches leading interrogatives and the literal ?", () => {
    expect(isQuestion("how to make tahdig")).toBe(true);
    expect(isQuestion("where is karaj")).toBe(true);
    expect(isQuestion('what is the meaning of "karaj"?')).toBe(true);
    expect(isQuestion("persian boy names")).toBe(false);
  });
});

describe("buildAnswerOpportunities", () => {
  const q = (query: string, clicks: number, impressions: number) => ({ query, clicks, impressions });

  it("surfaces question queries with real impressions and weak CTR", () => {
    const rows = buildAnswerOpportunities([
      q("where is karaj", 0, 97), // 0% CTR, 97 impr → opportunity
      q("persian boy names", 486, 5000), // not a question → excluded
      q("how big is iran", 1, 400), // 0.25% CTR → opportunity
    ]);
    // Both questions kept (the non-question is dropped), sorted by impressions desc.
    expect(rows.map((r) => r.query)).toEqual(["how big is iran", "where is karaj"]);
  });

  it("drops questions below the impression floor or already answered (high CTR)", () => {
    const rows = buildAnswerOpportunities([
      q("how tiny", 0, 5), // below floor
      q("what is answered", 50, 100), // 50% CTR → already captured
    ]);
    expect(rows).toHaveLength(0);
  });

  it("sums impressions at stake", () => {
    const rows = buildAnswerOpportunities([q("how a", 0, 100), q("what b", 0, 50)]);
    expect(answerImpressionsAtStake(rows)).toBe(150);
  });
});
