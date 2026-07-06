import { describe, it, expect } from "vitest";
import { decideExistingPageHold } from "./existing-page-winnability";
import type { PreparedSerpVerdict } from "./prepare-create-page-verdicts";

function verdict(over: Partial<PreparedSerpVerdict> = {}): PreparedSerpVerdict {
  return {
    verdict: "build",
    confidence: "medium",
    intent: "content",
    contentDomainCount: 8,
    marketplaceUgcCount: 0,
    profoundOverlapCount: 0,
    ownAlreadyRanks: false,
    topDomains: ["a.com", "b.com"],
    reason: "content SERP",
    generatedAt: "2026-07-06T00:00:00Z",
    costUsd: 0.003,
    ...over,
  };
}

describe("decideExistingPageHold (RANK-3)", () => {
  it("no verdict -> never holds, no line (existing behavior untouched)", () => {
    const d = decideExistingPageHold({ verdict: null, moveType: "answer_block" });
    expect(d.hold).toBe(false);
    expect(d.line).toBeNull();
  });

  it("winnable content SERP -> not held, worth-doing line with the beatable count", () => {
    const d = decideExistingPageHold({ verdict: verdict({ contentDomainCount: 8 }), moveType: "answer_block" });
    expect(d.hold).toBe(false);
    expect(d.line).toContain("8 of 10 real content pages you can beat");
    expect(d.line).toContain("worth doing");
  });

  it("marketplace/UGC top results -> HELD with the honest marketplaces line", () => {
    const d = decideExistingPageHold({
      verdict: verdict({ intent: "marketplace_ugc", marketplaceUgcCount: 7, contentDomainCount: 3 }),
      moveType: "answer_block",
    });
    expect(d.hold).toBe(true);
    expect(d.line).toContain("marketplaces and directories I cannot outrank");
    expect(d.line).toContain("holding this");
  });

  it("marketplace count >= 6 (even if intent parsed as content) -> HELD", () => {
    const d = decideExistingPageHold({
      verdict: verdict({ intent: "content", marketplaceUgcCount: 6 }),
      moveType: "edit_page",
    });
    expect(d.hold).toBe(true);
    expect(d.line).toContain("marketplaces and directories");
  });

  it("winnability arithmetic band reject -> HELD, carries the numbered sentence", () => {
    const d = decideExistingPageHold({
      verdict: verdict({
        winnability: { score: 15, band: "reject", sentence: "Google's index scores this keyword 91 of 100 difficulty. This one is not winnable right now, I would skip it." },
      }),
      moveType: "edit_page",
    });
    expect(d.hold).toBe(true);
    expect(d.line).toContain("91 of 100 difficulty");
    expect(d.line).toContain("holding this one");
  });

  it("answer_block + you already rank -> NOT held, honest lower-upside line", () => {
    const d = decideExistingPageHold({ verdict: verdict({ ownAlreadyRanks: true }), moveType: "answer_block" });
    expect(d.hold).toBe(false);
    expect(d.line).toContain("already rank on Google");
    expect(d.line).toContain("AI citation");
  });

  it("edit_page + you already rank -> NOT held (the ranking page IS what we improve)", () => {
    const d = decideExistingPageHold({ verdict: verdict({ ownAlreadyRanks: true }), moveType: "edit_page" });
    expect(d.hold).toBe(false);
    // an edit of a ranking page is the whole point -> worth-doing line, not a hold.
    expect(d.line).toContain("worth doing");
  });

  it("never emits an em or en dash in any line", () => {
    const cases: Array<ReturnType<typeof decideExistingPageHold>> = [
      decideExistingPageHold({ verdict: verdict(), moveType: "answer_block" }),
      decideExistingPageHold({ verdict: verdict({ intent: "marketplace_ugc", marketplaceUgcCount: 8 }), moveType: "answer_block" }),
      decideExistingPageHold({ verdict: verdict({ winnability: { score: 15, band: "reject", sentence: "x" } }), moveType: "edit_page" }),
      decideExistingPageHold({ verdict: verdict({ ownAlreadyRanks: true }), moveType: "answer_block" }),
    ];
    for (const c of cases) {
      expect(c.line ?? "").not.toMatch(/[–—]/);
    }
  });
});
