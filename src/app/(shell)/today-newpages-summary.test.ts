/**
 * TodayNewPagesSummaryLine copy (FP5b, 2026-07-02) - pins the one sentence Today shows
 * about new pages now that the board itself renders ONLY on /changes. First person,
 * concrete number, one next step, no dashes.
 *
 * Extended 2026-07-11 (blind-benchmark defect 1): also pins BOTH variants of the
 * board's section subhead. The blanket "you have no page yet" claim may only render
 * when no card carries owned coverage; the soft variant defers to the per-card
 * Watching/acknowledgment sentences so one screen never contradicts itself.
 */
import { describe, expect, it } from "vitest";
import { newPagesSummarySentence, newPagesSectionSub } from "./today-newpages-section";

describe("newPagesSummarySentence", () => {
  it("says the count and where the board lives", () => {
    expect(newPagesSummarySentence(9)).toBe(
      "I found 9 new pages worth building. The full board, with drafts and competitor teardowns, lives in Changes.",
    );
  });

  it("handles the singular", () => {
    expect(newPagesSummarySentence(1)).toContain("1 new page worth building");
  });

  it("never emits an em or en dash", () => {
    expect(newPagesSummarySentence(4)).not.toMatch(/[–—]/);
  });
});

describe("newPagesSectionSub (owned-coverage honest header)", () => {
  it("keeps the no-page claim only when no rendered card carries owned coverage", () => {
    expect(newPagesSectionSub(false)).toBe(
      "Competitor pages get cited for these topics, and you have no page yet. The fastest way to capture demand AI and Google are already sending elsewhere.",
    );
  });

  it("drops the blanket no-page claim when any rendered card is owned-covered", () => {
    expect(newPagesSectionSub(true)).toBe(
      "Competitor pages get cited for these topics. Where I already have a page, I say so on the card.",
    );
    expect(newPagesSectionSub(true)).not.toContain("you have no page yet");
  });

  it("never emits an em or en dash in either variant", () => {
    expect(newPagesSectionSub(true)).not.toMatch(/[‒–—―]/);
    expect(newPagesSectionSub(false)).not.toMatch(/[‒–—―]/);
  });
});
