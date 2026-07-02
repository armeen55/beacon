/**
 * language-gap-hints tests (2026-07-02, master plan item 24) - bounding the
 * matrix's gaps into the daily plan builder's hint shape, mirroring the
 * spike-hints/seasonal-hints bounding tests exactly.
 */
import { describe, expect, it } from "vitest";
import { buildLanguageGapHintNotes, MAX_LANGUAGE_GAP_HINTS_PER_NIGHT } from "./language-gap-hints";
import type { LanguageGap } from "./language-gaps";

function gap(page: string, impressions: number, gapKind: LanguageGap["gapKind"] = "farsi_demand_no_farsi_content"): LanguageGap {
  return { page, gapKind, impressions, topVariants: ["example"], sentence: `${page} has a gap.` };
}

describe("buildLanguageGapHintNotes", () => {
  it("caps the feed at MAX_LANGUAGE_GAP_HINTS_PER_NIGHT", () => {
    const gaps = [gap("/a", 900), gap("/b", 800), gap("/c", 700), gap("/d", 600)];
    const hints = buildLanguageGapHintNotes(gaps);
    expect(hints.size).toBe(MAX_LANGUAGE_GAP_HINTS_PER_NIGHT);
  });

  it("keeps the biggest gaps when the input arrives pre-ranked", () => {
    const gaps = [gap("/biggest", 900), gap("/second", 800), gap("/third", 700)];
    const hints = buildLanguageGapHintNotes(gaps, 2);
    expect(hints.has("/biggest")).toBe(true);
    expect(hints.has("/second")).toBe(true);
    expect(hints.has("/third")).toBe(false);
  });

  it("skips a gap with no page", () => {
    const hints = buildLanguageGapHintNotes([gap("", 900)]);
    expect(hints.size).toBe(0);
  });

  it("keeps only the first hint per normalized page path (no duplicates)", () => {
    const gaps = [gap("/a", 900), gap("/a/", 500)];
    const hints = buildLanguageGapHintNotes(gaps);
    expect(hints.size).toBe(1);
  });

  it("normalizes the page path key (query string / trailing slash insensitive)", () => {
    const hints = buildLanguageGapHintNotes([gap("https://example.com/a/?utm=x", 900)]);
    expect(hints.has("/a")).toBe(true);
  });

  it("carries the gap kind, impressions, variants, and sentence through untouched", () => {
    const hints = buildLanguageGapHintNotes([gap("/a", 900, "missing_variant_spellings")]);
    const note = hints.get("/a")!;
    expect(note.gapKind).toBe("missing_variant_spellings");
    expect(note.impressions).toBe(900);
    expect(note.topVariants).toEqual(["example"]);
    expect(note.sentence).toBe("/a has a gap.");
  });

  it("returns an empty map for an empty input", () => {
    expect(buildLanguageGapHintNotes([]).size).toBe(0);
  });

  it("respects a custom limit override", () => {
    const gaps = [gap("/a", 900), gap("/b", 800)];
    expect(buildLanguageGapHintNotes(gaps, 1).size).toBe(1);
    expect(buildLanguageGapHintNotes(gaps, 0).size).toBe(0);
  });
});
