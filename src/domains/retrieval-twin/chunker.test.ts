import { describe, it, expect } from "vitest";
import { chunkPageText, chunkStructuredPage, sectionizePlainText } from "./chunker";

describe("sectionizePlainText", () => {
  it("splits on short heading-shaped lines", () => {
    const sections = sectionizePlainText("When is Nowruz?\nNowruz begins on the first day of spring.\n\nHow is it celebrated?\nFamilies gather around the haft-sin table.");
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("When is Nowruz?");
    expect(sections[0].text).toContain("first day of spring");
    expect(sections[1].heading).toBe("How is it celebrated?");
  });

  it("falls back to one headingless section when no heading-shaped lines exist", () => {
    const sections = sectionizePlainText("This is a plain sentence with no headings at all.");
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBeNull();
  });

  it("returns [] for empty input", () => {
    expect(sectionizePlainText("")).toEqual([]);
    expect(sectionizePlainText("   ")).toEqual([]);
  });
});

describe("chunkPageText", () => {
  it("produces chunks carrying their nearest heading", () => {
    const chunks = chunkPageText("When is Nowruz?\nNowruz begins on the first day of spring, around March 20th each year.");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].heading).toBe("When is Nowruz?");
    expect(chunks[0].embedText).toContain("When is Nowruz?");
    expect(chunks[0].embedText).toContain("first day of spring");
  });

  it("never splits a paragraph mid-word: rejoining chunk text still contains the source words", () => {
    const para = "word ".repeat(50).trim();
    const chunks = chunkPageText(para);
    const rejoined = chunks.map((c) => c.text).join(" ");
    expect(rejoined.split(/\s+/).every((w) => w === "word")).toBe(true);
  });

  it("keeps chunk text within the 1200-char cap even for a huge single paragraph", () => {
    const para = "x".repeat(5000);
    const chunks = chunkPageText(para);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1200);
      expect(c.embedText.length).toBeLessThanOrEqual(1200);
    }
  });

  it("targets roughly 200 tokens (~800 chars) per chunk by default on long prose", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} has a handful of words describing Nowruz traditions and history in Iran.`);
    const chunks = chunkPageText(paragraphs.join("\n\n"));
    // Most chunks should be in a reasonable band around the 800-char target, none absurdly tiny except possibly the last.
    for (const c of chunks.slice(0, -1)) {
      expect(c.text.length).toBeGreaterThan(100);
    }
  });

  it("is deterministic on the same input", () => {
    const input = "Heading One\nSome body text here.\n\nHeading Two\nMore body text here.";
    expect(chunkPageText(input)).toEqual(chunkPageText(input));
  });

  it("returns [] for empty input", () => {
    expect(chunkPageText("")).toEqual([]);
  });
});

describe("chunkStructuredPage", () => {
  it("builds chunks from title/h1/meta/body/headings/faq fields", () => {
    const chunks = chunkStructuredPage({
      title: "Nowruz Guide",
      h1: "How Persians Celebrate Nowruz",
      metaDescription: "A complete guide to Nowruz traditions.",
      headings: ["The Haft-Sin Table", "Sizdah Bedar"],
      bodyParagraphs: ["Nowruz marks the Persian new year and the first day of spring."],
      faqQuestions: ["What is the haft-sin table?"],
    });
    expect(chunks.length).toBeGreaterThan(0);
    const allText = chunks.map((c) => c.embedText).join(" | ");
    expect(allText).toContain("Nowruz marks the Persian new year");
    expect(allText).toContain("The Haft-Sin Table");
    expect(allText).toContain("What is the haft-sin table?");
  });

  it("skips empty/whitespace-only fields without throwing", () => {
    const chunks = chunkStructuredPage({ title: "", h1: null, metaDescription: "   ", headings: [], bodyParagraphs: [], faqQuestions: [] });
    expect(chunks).toEqual([]);
  });

  it("caps output at maxChunks", () => {
    const manyHeadings = Array.from({ length: 100 }, (_, i) => `Heading ${i}`);
    const chunks = chunkStructuredPage({ headings: manyHeadings }, { maxChunks: 10 });
    expect(chunks.length).toBeLessThanOrEqual(10);
  });

  it("never emits a chunk over 1200 chars", () => {
    const chunks = chunkStructuredPage({ bodyParagraphs: ["y".repeat(3000)] });
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1200);
    }
  });
});
