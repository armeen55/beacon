import { describe, it, expect } from "vitest";
import {
  classifyOneQuery,
  classifyQueryIntent,
  scoreAnswerForIntent,
  selectIntentAwareAnswer,
  isPlausibleAnswerSentence,
} from "./answer-intent";

describe("isPlausibleAnswerSentence — commerce/CTA firewall (real chaharshanbe proof)", () => {
  it("rejects the t-shirt merch copy that fooled the regex", () => {
    expect(isPlausibleAnswerSentence("Celebrate Chaharshanbe Suri 2025 in style with this unisex Persian shirt, designed to honor the Persian fire festival.")).toBe(false);
    expect(isPlausibleAnswerSentence("🛡 30-Day Guarantee: If your item is defective, wrong, or not as described, we'll replace or refund right away.")).toBe(false);
  });
  it("accepts real informational prose", () => {
    expect(isPlausibleAnswerSentence("Chaharshanbe Suri in 2026 will be celebrated on the evening of Tuesday, March 17, 2026.")).toBe(true);
  });
});

describe("classifyOneQuery", () => {
  it("reads a year as WHEN-intent (the chaharshanbe failure)", () => {
    expect(classifyOneQuery("chaharshanbe suri 2026")).toBe("when");
    expect(classifyOneQuery("when is chaharshanbe suri")).toBe("when");
    expect(classifyOneQuery("chaharshanbe suri 2026 date")).toBe("when");
  });
  it("a bare entity is WHAT (definitional) by default", () => {
    expect(classifyOneQuery("chaharshanbe suri")).toBe("what");
    expect(classifyOneQuery("finglish")).toBe("what");
  });
  it("reads cost / how / where / compare / list", () => {
    expect(classifyOneQuery("custom home builder cost")).toBe("cost");
    expect(classifyOneQuery("how to write finglish")).toBe("how");
    expect(classifyOneQuery("best persian restaurants")).toBe("list");
    expect(classifyOneQuery("farsi vs persian")).toBe("compare");
  });
});

describe("classifyQueryIntent — impression-weighted dominant demand", () => {
  it("chaharshanbe: WHEN wins because the 2026/when queries carry the impressions", () => {
    const cls = classifyQueryIntent([
      { query: "chaharshanbe suri 2026", impressions: 194 },
      { query: "chaharshanbe suri", impressions: 68 },
      { query: "suri 2026", impressions: 37 },
      { query: "chaharshanbe suri 2026 date", impressions: 18 },
      { query: "when is chaharshanbe suri 2026", impressions: 16 },
    ])!;
    expect(cls.dominant).toBe("when");
    expect(cls.dominantShare).toBeGreaterThan(0.5);
  });
  it("returns null for no queries", () => {
    expect(classifyQueryIntent([])).toBeNull();
  });
});

describe("scoreAnswerForIntent", () => {
  it("a date sentence answers WHEN; a definition does not", () => {
    const dateSentence = "Chaharshanbe Suri in 2026 will be celebrated on the evening of Tuesday, March 17, 2026.";
    const definition = "Chaharshanbe Suri, also known as the Festival of Fire, is a traditional Persian celebration rooted in Zoroastrian traditions.";
    expect(scoreAnswerForIntent(dateSentence, "when")).toBeGreaterThan(0.9);
    expect(scoreAnswerForIntent(definition, "when")).toBeLessThan(0.2);
    // and the definition DOES answer "what is"
    expect(scoreAnswerForIntent(definition, "what")).toBeGreaterThan(0.9);
  });
});

describe("selectIntentAwareAnswer — the fix", () => {
  const chaharshanbeQueries = [
    { query: "chaharshanbe suri 2026", impressions: 194 },
    { query: "chaharshanbe suri", impressions: 68 },
    { query: "when is chaharshanbe suri 2026", impressions: 16 },
  ];
  const candidates = [
    { sentence: "Chaharshanbe Suri, also known as the Festival of Fire, is a traditional Persian celebration rooted in Zoroastrian traditions.", documentIndex: 1 },
    { sentence: "Chaharshanbe Suri in 2026 will be celebrated on the evening of Tuesday, March 17, 2026.", documentIndex: 4 },
  ];

  it("picks the DATE sentence over the definition for a WHEN-dominant page", () => {
    const brief = selectIntentAwareAnswer(candidates, chaharshanbeQueries, "Chaharshanbe Suri")!;
    expect(brief.intent).toBe("when");
    expect(brief.chosen).toContain("March 17, 2026");
    expect(brief.chosen).not.toContain("Festival of Fire");
    expect(brief.gap).toBeNull();
    expect(brief.confidence).toBe("high");
    // brief carries cited evidence + the rejected definition as an alternative
    expect(brief.intentEvidence[0]!.query).toBe("chaharshanbe suri 2026");
    expect(brief.rationale).toMatch(/date|when/i);
  });

  it("returns an HONEST GAP (not a definition) when no on-page sentence answers the demand", () => {
    const noDate = [candidates[0]!]; // only the definition exists
    const brief = selectIntentAwareAnswer(noDate, chaharshanbeQueries, "Chaharshanbe Suri")!;
    expect(brief.chosen).toBeNull();
    expect(brief.gap).toMatch(/date|when/i);
    expect(brief.rationale).toMatch(/wrong question|no sentence/i);
  });

  it("still surfaces a definition when the page's demand really is WHAT-IS", () => {
    const brief = selectIntentAwareAnswer(candidates, [{ query: "finglish", impressions: 120 }, { query: "what is finglish", impressions: 40 }], "Finglish")!;
    expect(brief.intent).toBe("what");
    expect(brief.chosen).toContain("Festival of Fire"); // the definitional candidate scores highest for WHAT
  });
});
