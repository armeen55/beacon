/**
 * TodayNewPagesSummaryLine copy (FP5b, 2026-07-02) - pins the one sentence Today shows
 * about new pages now that the board itself renders ONLY on /changes. First person,
 * concrete number, one next step, no dashes.
 */
import { describe, expect, it } from "vitest";
import { newPagesSummarySentence } from "./today-newpages-section";

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
