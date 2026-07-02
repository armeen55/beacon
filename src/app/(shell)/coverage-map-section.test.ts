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

  it("shows the coverage join copy (answers X of Y, AI picks you)", () => {
    expect(SRC).toContain("answers {row.answeredCount} of {row.totalQuestions}");
    expect(SRC).toContain("AI picks you on {row.aiCitedCount} of {row.aiCheckedCount} checked");
    expect(SRC).toContain("no AI checks on this topic yet");
    expect(SRC).toContain("Best next page:");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(SRC).not.toMatch(/[\u2013\u2014]/);
  });

  it("is mounted on the Today page after the war room", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(page).toContain('import { CoverageMapSection } from "./coverage-map-section"');
    expect(page).toContain("<CoverageMapSection tenantId={tenantId} />");
  });
});
