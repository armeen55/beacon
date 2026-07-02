import { describe, it, expect } from "vitest";
import { buildOutlineFromFacts } from "./build-today-preview";
import type { PageFacts } from "./build-daily-candidates";

/**
 * BEACON_500 item 48 pin - the nightly title/meta LLM pass must be grounded in the page's own
 * cached crawl facts (title/h1/meta/body) instead of an empty outline. This pins the pure helper
 * that turns PageFacts into the drafter's `outline` array: populated when a snapshot exists,
 * empty-safe otherwise, and bounded so a long page never blows the prompt budget.
 */
describe("buildOutlineFromFacts (item 48 - ground the title/meta LLM pass)", () => {
  it("returns [] when there is no snapshot (empty-safe)", () => {
    expect(buildOutlineFromFacts(undefined)).toEqual([]);
    expect(buildOutlineFromFacts(null)).toEqual([]);
  });

  it("returns [] when facts exist but every field is empty", () => {
    const facts: PageFacts = { title: null, meta: null, h1: null, bodyParagraphs: [] };
    expect(buildOutlineFromFacts(facts)).toEqual([]);
  });

  it("populates the outline from title/h1/meta/body when a snapshot exists", () => {
    const facts: PageFacts = {
      title: "Persian Wedding Traditions",
      h1: "Persian Wedding Traditions Explained",
      meta: "Everything about a Persian wedding ceremony.",
      bodyParagraphs: [
        "The Sofreh Aghd is the ceremonial spread laid out before the couple.",
        "Guests often throw sugar over the couple's heads for a sweet life.",
      ],
    };
    const outline = buildOutlineFromFacts(facts);
    expect(outline.some((l) => l.includes("Title: Persian Wedding Traditions"))).toBe(true);
    expect(outline.some((l) => l.includes("H1: Persian Wedding Traditions Explained"))).toBe(true);
    expect(outline.some((l) => l.includes("Meta: Everything about a Persian wedding ceremony."))).toBe(true);
    expect(outline.some((l) => l.includes("Sofreh Aghd"))).toBe(true);
    expect(outline.some((l) => l.includes("sugar over the couple's heads"))).toBe(true);
  });

  it("skips blank body paragraphs", () => {
    const facts: PageFacts = { title: "T", meta: null, h1: null, bodyParagraphs: ["", "   ", "Real paragraph."] };
    const outline = buildOutlineFromFacts(facts);
    expect(outline).toEqual(["Title: T", "Real paragraph."]);
  });

  it("bounds the total outline to ~1500 chars so a long page never blows the prompt budget", () => {
    const longParagraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} `.repeat(20));
    const facts: PageFacts = { title: "T", meta: "M", h1: "H", bodyParagraphs: longParagraphs };
    const outline = buildOutlineFromFacts(facts);
    const totalChars = outline.reduce((n, l) => n + l.length, 0);
    expect(totalChars).toBeLessThanOrEqual(1500);
    expect(outline.length).toBeGreaterThan(0);
  });
});
