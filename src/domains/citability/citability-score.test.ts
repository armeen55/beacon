/**
 * citability-score tests (2026-07-02, master plan item 26) - matrix of
 * fixture page texts pinning the deterministic 0-100 rubric: high scores for
 * text opening with the quotable patterns, low scores for plain narrative
 * text, honest missing/present pattern lists, and bounded topFixes.
 */
import { describe, it, expect } from "vitest";
import { scorePageCitability } from "./citability-score";

describe("scorePageCitability", () => {
  it("scores an empty page at 0 with all 5 patterns missing", () => {
    const s = scorePageCitability("");
    expect(s.score).toBe(0);
    expect(s.missingPatterns).toHaveLength(5);
    expect(s.presentPatterns).toHaveLength(0);
    expect(s.topFixes).toHaveLength(3);
  });

  it("scores a page whose opening hits all 5 quotable patterns near 100", () => {
    const text = [
      "Over 60 percent of Iranian households set a Haft-Sin table for Nowruz.",
      "Haft-Sin is a symbolic table of seven items representing renewal.",
      "According to UNESCO, the tradition dates back more than 3000 years.",
      "Here are the top 3 items every table includes: sabzeh, senjed, and serkeh.",
      "In 2024, Nowruz fell on March 19 across the Persian calendar.",
      "Families gather to share a festive meal together.",
    ].join(" ");
    const s = scorePageCitability(text);
    expect(s.score).toBe(100);
    expect(s.missingPatterns).toHaveLength(0);
    expect(s.presentPatterns).toHaveLength(5);
    expect(s.topFixes).toHaveLength(0);
  });

  it("scores plain narrative opening text low and names the missing patterns", () => {
    const text = [
      "Nowruz is a wonderful time of year for families.",
      "People enjoy spending time together and eating good food.",
      "The celebrations bring communities closer.",
      "Children especially love the holiday.",
      "It is a special time for everyone involved.",
      "The atmosphere is festive and warm.",
    ].join(" ");
    const s = scorePageCitability(text);
    expect(s.score).toBeLessThan(50);
    expect(s.missingPatterns.length).toBeGreaterThan(0);
    expect(s.topFixes.length).toBeGreaterThan(0);
    expect(s.topFixes.length).toBeLessThanOrEqual(3);
  });

  it("gives half credit for a pattern present later in the text but not in the opening window", () => {
    const openingOnly = [
      "Families gather to celebrate together during this festive season.",
      "People enjoy spending time together and eating good food.",
      "Communities come closer during these joyful weeks.",
      "Children especially love the holiday atmosphere.",
      "Everyone looks forward to the shared traditions.",
      "The atmosphere stays festive and warm throughout.",
      // 7th sentence - outside the 6-sentence opening window.
      "Over 60 percent of families keep the tradition alive today.",
    ].join(" ");
    const s = scorePageCitability(openingOnly);
    expect(s.presentPatterns).toContain("stat_first");
    expect(s.missingPatterns).not.toContain("stat_first");
    // Half credit (10 of 20 points) for stat_first alone, nothing else present.
    expect(s.score).toBe(10);
  });

  it("caps topFixes at 3 even when more than 3 patterns are missing", () => {
    const text = "Families gather to share a festive meal together every year without fail.";
    const s = scorePageCitability(text);
    expect(s.missingPatterns.length).toBeGreaterThan(3);
    expect(s.topFixes).toHaveLength(3);
  });

  it("each topFix is a concrete one-line instruction naming the fix", () => {
    const s = scorePageCitability("Families gather to share a festive meal together every year.");
    for (const fix of s.topFixes) {
      expect(fix.length).toBeGreaterThan(10);
      expect(fix).not.toMatch(/[–—]/);
    }
  });

  it("is deterministic: identical input always produces an identical score", () => {
    const text = "Over 60 percent of families set a Haft-Sin table. It is a spring tradition.";
    const a = scorePageCitability(text);
    const b = scorePageCitability(text);
    expect(a).toEqual(b);
  });

  it("never returns a score outside 0-100", () => {
    const cases = [
      "",
      "a",
      "Over 60 percent. Over 70 percent. Over 80 percent. Over 90 percent. Over 50 percent. Over 40 percent.",
    ];
    for (const c of cases) {
      const s = scorePageCitability(c);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});
