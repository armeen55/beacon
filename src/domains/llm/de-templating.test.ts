import { describe, it, expect } from "vitest";
import {
  ngramSet,
  ngramOverlap,
  repeatSimilarity,
  looksTemplated,
  REPEAT_THRESHOLD,
  REPEAT_FLAG,
  VARIATION_INSTRUCTION,
} from "./de-templating";

const TEMPLATE_A =
  "Ghormeh sabzi is a traditional Persian stew made with herbs, kidney beans, and dried lime, served over rice at family gatherings across Iran.";
const TEMPLATE_A_CLONE =
  "Fesenjan is a traditional Persian stew made with herbs, kidney beans, and dried lime, served over rice at family gatherings across Iran.";
const DIFFERENT =
  "Chaharshanbe Suri falls on the eve of the last Wednesday before Nowruz; people jump over bonfires and share ajil while singing traditional verses.";

describe("de-templating - n-gram mechanics", () => {
  it("builds word 3-grams case/punctuation-insensitively", () => {
    const grams = ngramSet("Hello, brave new World!");
    expect(grams.has("hello brave new")).toBe(true);
    expect(grams.has("brave new world")).toBe(true);
    expect(grams.size).toBe(2);
  });

  it("identical text overlaps 1; unrelated text overlaps near 0", () => {
    expect(ngramOverlap(TEMPLATE_A, TEMPLATE_A)).toBe(1);
    expect(ngramOverlap(TEMPLATE_A, DIFFERENT)).toBeLessThan(0.1);
  });

  it("a swapped-subject clone still overlaps far above the threshold", () => {
    expect(ngramOverlap(TEMPLATE_A_CLONE, TEMPLATE_A)).toBeGreaterThan(REPEAT_THRESHOLD);
  });
});

describe("de-templating - the repeat guard", () => {
  it("flags a near-copy of a recent same-family output", () => {
    expect(looksTemplated(TEMPLATE_A_CLONE, [DIFFERENT, TEMPLATE_A])).toBe(true);
    expect(repeatSimilarity(TEMPLATE_A_CLONE, [DIFFERENT, TEMPLATE_A])).toBeGreaterThan(REPEAT_THRESHOLD);
  });

  it("passes genuinely different writing", () => {
    expect(looksTemplated(DIFFERENT, [TEMPLATE_A, TEMPLATE_A_CLONE])).toBe(false);
  });

  it("is dormant with no history or empty text", () => {
    expect(looksTemplated(TEMPLATE_A, [])).toBe(false);
    expect(looksTemplated("", [TEMPLATE_A])).toBe(false);
  });

  it("is deterministic on fixtures (same inputs, same verdict)", () => {
    const a = repeatSimilarity(TEMPLATE_A_CLONE, [TEMPLATE_A]);
    const b = repeatSimilarity(TEMPLATE_A_CLONE, [TEMPLATE_A]);
    expect(a).toBe(b);
  });
});

describe("de-templating - operator copy", () => {
  it("flag + variation instruction carry no em/en dashes and no lab jargon", () => {
    for (const s of [REPEAT_FLAG, VARIATION_INSTRUCTION]) {
      expect(s).not.toMatch(/[–—]/);
      expect(s.toLowerCase()).not.toMatch(/\b(n-gram|ngram|similarity|threshold)\b/);
    }
    expect(REPEAT_FLAG).toBe("reads like a repeat");
  });
});
