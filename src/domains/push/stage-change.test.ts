import { describe, it, expect } from "vitest";
import { entailmentGateForEdit } from "./stage-change";

/**
 * stage-change.test.ts (N8, 2026-07-02) - covers the PURE publish-gate
 * decision `entailmentGateForEdit` in isolation. The full
 * `stageChangeForRecord`/`resolveMove` flow reaches Supabase, the tenant
 * store, and executePush, so it is deliberately NOT re-mocked here; this
 * pins the one new decision point the gate adds, exactly the way
 * stage-route.ts's pure helpers are tested next to the push pipeline they
 * feed rather than through the whole pipeline.
 *
 * OPERATOR CORRECTION (2026-07-02): the page itself can be stale; a claim
 * that CONTRADICTS the page but is backed by a dated authoritative fact is
 * an allowed CORRECTION (never blocks), distinct from an unsupported
 * INVENTION (found nowhere - blocks). Both paths are pinned below.
 */

describe("entailmentGateForEdit", () => {
  it("returns null (no gate) for an action type with no free-text claim (schema)", () => {
    const g = entailmentGateForEdit(
      { action_type: "add_schema", proposed_text: "3000 years of history" },
      "This page has none of those facts on it.",
    );
    expect(g).toBeNull();
  });

  it("returns null when the edit has no proposed text", () => {
    const g = entailmentGateForEdit(
      { action_type: "edit_title", proposed_text: "" },
      "Some page body.",
    );
    expect(g).toBeNull();
  });

  it("returns not-blocked when there is no page body to check against (abstains)", () => {
    const g = entailmentGateForEdit(
      { action_type: "edit_title", proposed_text: "Persian New Year: 3000 Years of Nowruz Traditions" },
      null,
    );
    expect(g?.blocked).toBe(false);
    expect(g?.violations).toEqual([]);
    expect(g?.corrections).toEqual([]);
  });

  it("not blocked for a title whose claim is grounded in the page body", () => {
    const g = entailmentGateForEdit(
      { action_type: "edit_title", proposed_text: "Persian New Year: 3000 Years of Nowruz Traditions in Iran" },
      "Nowruz is a 3000 year old Persian tradition celebrated across Iran every spring.",
    );
    expect(g?.blocked).toBe(false);
  });

  it("BLOCKS an edit_title whose number is not on the page (the exact operator-facing warning)", () => {
    const g = entailmentGateForEdit(
      { action_type: "edit_title", proposed_text: "Nowruz: 3000 Years of Persian New Year Celebrations" },
      "Nowruz marks the Persian new year and the arrival of spring.",
    );
    expect(g?.blocked).toBe(true);
    expect(g?.violations[0]).toContain("3000");
    expect(g?.violations[0]).toContain("I could not find that number in your page or my data. Check it before you paste.");
  });

  it("BLOCKS an add_answer_block draft with an unsupported number", () => {
    const g = entailmentGateForEdit(
      {
        action_type: "add_answer_block",
        proposed_text:
          "Iran's national animal is the Asiatic cheetah, with fewer than 50 individuals remaining in the wild across protected reserves.",
      },
      "The Asiatic cheetah is Iran's national animal, a critically endangered subspecies found on the central plateau.",
    );
    expect(g?.blocked).toBe(true);
    expect(g?.violations[0]).toContain("50");
  });

  it("BLOCKS an unsourced superlative on a change_h1", () => {
    const g = entailmentGateForEdit(
      { action_type: "change_h1", proposed_text: "Persepolis: The Largest Ancient Persian Site" },
      "Persepolis was a ceremonial capital of the Achaemenid Empire.",
    );
    expect(g?.blocked).toBe(true);
  });

  it("a number that CONTRADICTS the page but is backed by a dated authoritative fact does NOT block (correction)", () => {
    const g = entailmentGateForEdit(
      { action_type: "edit_title", proposed_text: "Iranopedia: 4500 Persian Recipes and Traditions" },
      "Iranopedia has 3000 Persian recipes and traditions.",
      [{ source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" }],
    );
    expect(g?.blocked).toBe(false);
    expect(g?.violations).toEqual([]);
    expect(g?.corrections.length).toBe(1);
    expect(g?.corrections[0]).toContain("4500");
    expect(g?.corrections[0]).toContain("your site's recipe count (Wix connector)");
    expect(g?.corrections[0]).toContain("2026-07-01");
  });

  it("the SAME contradicting number with no authoritative fact stays BLOCKED", () => {
    const g = entailmentGateForEdit(
      { action_type: "edit_title", proposed_text: "Iranopedia: 4500 Persian Recipes and Traditions" },
      "Iranopedia has 3000 Persian recipes and traditions.",
    );
    expect(g?.blocked).toBe(true);
    expect(g?.corrections).toEqual([]);
  });

  it("a sourced, dated superlative does NOT block (correction, not a violation)", () => {
    const g = entailmentGateForEdit(
      { action_type: "change_h1", proposed_text: "Persepolis: The Largest UNESCO Site in the Region" },
      "Persepolis was a ceremonial capital of the Achaemenid Empire.",
      [{ source: "UNESCO's own published register", date: "2026-01-10", detail: "Persepolis is the largest UNESCO site in the region" }],
    );
    expect(g?.blocked).toBe(false);
    expect(g?.corrections.length).toBeGreaterThan(0);
  });
});
