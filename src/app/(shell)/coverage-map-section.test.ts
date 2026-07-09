/**
 * CoverageMapSection contract pins (2026-07-02, master-plan item 9).
 *
 * Source-level pins (the sibling pattern for server sections): the section
 * must self-hide under 3 hubs, fail soft to null, carry dark-mode + small-
 * screen classes, and never contain an em or en dash in code or copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "coverage-map-section.tsx"), "utf8");

describe("CoverageMapSection contract", () => {
  it("self-hides under 3 hubs", () => {
    expect(SRC).toContain("MIN_HUBS_TO_SHOW = 3");
    expect(SRC).toContain("result.map.rows.length < MIN_HUBS_TO_SHOW) return null");
  });

  it("fails soft to null (never a crashed Today)", () => {
    expect(SRC).toMatch(/catch\s*\{\s*return null;\s*\}/);
  });

  it("is dark-mode and 375px safe like sibling sections", () => {
    expect(SRC).toContain("dark:border-neutral-800");
    expect(SRC).toContain("dark:bg-neutral-900");
    expect(SRC).toContain("break-words");
    expect(SRC).toContain("flex-wrap");
    expect(SRC).toContain("tabular-nums");
  });

  it("separates content coverage (answers X of Y) from AI citation, and frames covered-but-not-cited as the opportunity", () => {
    // Coverage (supply) stays at top; the citation line (demand) is separate so
    // "100% covered" + "AI picks you 0 of 4" no longer reads as a contradiction.
    expect(SRC).toContain("answers {row.answeredCount} of {row.totalQuestions}");
    // Positive citation framing when cited; actionable gap when covered-but-uncited.
    expect(SRC).toContain("AI recommends you for {row.aiCitedCount} of {row.aiCheckedCount}");
    expect(SRC).toContain("Sharpen the answer to get cited.");
    expect(SRC).toContain("no AI check on this topic yet");
    expect(SRC).toContain("Best next page:");
    // The misleading standalone "percent covered" label is gone.
    expect(SRC).not.toContain("percent covered");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(SRC).not.toMatch(/[\u2013\u2014]/);
  });

  it("is NOT mounted on the Today page (operator spec 2026-07-09 B-9: killed, rebuild later)", () => {
    // The operator ordered the coverage map OFF Today until it is rebuilt from scratch.
    // The component stays in the tree for that rebuild, but Today must not render it.
    // This pin flips if someone re-mounts it casually.
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(page).not.toContain("CoverageMapSection");
  });
});
