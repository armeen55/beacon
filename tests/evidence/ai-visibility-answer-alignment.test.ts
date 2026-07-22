import { describe, it, expect } from "vitest";
import {
  splitSentences,
  shingles,
  shingleContainment,
  alignAnswerToPage,
  bestAlignedPassage,
  summarizeWinningShapes,
  alignmentContentHash,
  type AlignedPassage,
} from "@/domains/ai-visibility/answer-alignment";

describe("splitSentences", () => {
  it("splits plain prose into sentences", () => {
    const out = splitSentences("Widgets ship in three days. They come in five colors. Returns are free.");
    expect(out.map((s) => s.text)).toEqual([
      "Widgets ship in three days.",
      "They come in five colors.",
      "Returns are free.",
    ]);
  });

  it("assigns stable 0-based indexes and word counts", () => {
    const out = splitSentences("One two three four. Five six seven eight nine.");
    expect(out[0]?.index).toBe(0);
    expect(out[0]?.wordCount).toBe(4);
    expect(out[1]?.index).toBe(1);
    expect(out[1]?.wordCount).toBe(5);
  });

  it("does not split on common abbreviations", () => {
    const out = splitSentences("Dr. Smith runs the clinic. It opens at 9 a.m. every day.");
    expect(out.length).toBe(2);
    expect(out[0]?.text).toContain("Dr. Smith");
  });

  it("splits on newlines for list-like content even without terminal punctuation", () => {
    const out = splitSentences("Step one start the engine\nStep two check the oil\nStep three drive away");
    expect(out.length).toBe(3);
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n  ")).toEqual([]);
  });

  it("never throws on garbage input", () => {
    expect(() => splitSentences("...!!! ??? \t\t")).not.toThrow();
    expect(() => splitSentences("a".repeat(5000))).not.toThrow();
  });
});

describe("shingles", () => {
  it("builds order-sensitive 5-gram shingles", () => {
    const s = shingles("the quick brown fox jumps over the lazy dog");
    expect(s.has("the quick brown fox jumps")).toBe(true);
    expect(s.has("quick brown fox jumps over")).toBe(true);
    // reversed order must NOT match
    expect(s.has("dog lazy the over jumps")).toBe(false);
  });

  it("falls back to a single shingle for short text", () => {
    const s = shingles("hello world");
    expect(s.size).toBe(1);
    expect([...s][0]).toBe("hello world");
  });

  it("returns an empty set for empty text", () => {
    expect(shingles("").size).toBe(0);
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    const a = shingles("The Quick Brown Fox Jumps!");
    const b = shingles("the quick brown fox jumps");
    expect(a).toEqual(b);
  });

  it("respects a custom n", () => {
    const s = shingles("a b c d", 2);
    expect(s.has("a b")).toBe(true);
    expect(s.has("b c")).toBe(true);
    expect(s.has("c d")).toBe(true);
    expect(s.size).toBe(3);
  });
});

describe("shingleContainment", () => {
  it("scores 1 when every needle shingle is present in the haystack", () => {
    const needle = shingles("the quick brown fox jumps");
    const haystack = shingles("well the quick brown fox jumps over the lazy dog today");
    expect(shingleContainment(needle, haystack)).toBe(1);
  });

  it("scores 0 for completely disjoint text", () => {
    const needle = shingles("the quick brown fox jumps");
    const haystack = shingles("completely unrelated sentence about something else entirely");
    expect(shingleContainment(needle, haystack)).toBe(0);
  });

  it("scores 0 when either side is empty", () => {
    const needle = shingles("");
    const haystack = shingles("some real content here");
    expect(shingleContainment(needle, haystack)).toBe(0);
    expect(shingleContainment(haystack, needle)).toBe(0);
  });

  it("is asymmetric (containment, not Jaccard)", () => {
    const short = shingles("widgets ship in three days");
    const long = shingles(
      "our widgets ship in three days and also come with a lifetime warranty and free returns on every order",
    );
    // All of `short`'s one shingle should be inside `long`.
    expect(shingleContainment(short, long)).toBe(1);
    // But `long` has many shingles not present in `short` -> low reverse score.
    expect(shingleContainment(long, short)).toBeLessThan(0.2);
  });
});

describe("alignAnswerToPage", () => {
  it("finds the literal page sentence that matches an AI answer sentence", () => {
    const answer = "Our widgets ship in three business days with free returns on every order.";
    const page =
      "Welcome to our store. Our widgets ship in three business days with free returns on every order. Contact us anytime.";
    const results = alignAnswerToPage(answer, page);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.pageSentence).toContain("ship in three business days");
    expect(results[0]?.score).toBeGreaterThan(0.9);
  });

  it("returns an empty array when there is no real overlap", () => {
    const answer = "The capital of France is Paris and it has a famous tower.";
    const page = "Our bakery sells fresh sourdough bread every morning at dawn.";
    expect(alignAnswerToPage(answer, page)).toEqual([]);
  });

  it("returns an empty array for empty inputs", () => {
    expect(alignAnswerToPage("", "some page text here")).toEqual([]);
    expect(alignAnswerToPage("some answer text here", "")).toEqual([]);
    expect(alignAnswerToPage("", "")).toEqual([]);
  });

  it("skips short fragments that cannot form a meaningful shingle", () => {
    const answer = "FAQ. Yes. Our widgets ship in three business days with free returns on every order.";
    const page = "Our widgets ship in three business days with free returns on every order.";
    const results = alignAnswerToPage(answer, page);
    // Only the long sentence should produce a result; "FAQ." and "Yes." are noise.
    expect(results.length).toBe(1);
  });

  it("sorts best-score-first and respects maxResults", () => {
    const answer =
      "Our widgets ship in three business days with free returns. Our gadgets ship within one business week normally.";
    const page =
      "Our widgets ship in three business days with free returns on every single order we process today. Our gadgets ship within one business week normally for everyone.";
    const results = alignAnswerToPage(answer, page, { maxResults: 1 });
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThanOrEqual(0);
  });

  it("never throws on adversarial input (very long text, repeated tokens)", () => {
    const answer = "word ".repeat(3000);
    const page = "word ".repeat(3000);
    expect(() => alignAnswerToPage(answer, page)).not.toThrow();
  });
});

describe("bestAlignedPassage", () => {
  it("returns the single best match", () => {
    const answer = "Our widgets ship in three business days with free returns on every order.";
    const page = "Our widgets ship in three business days with free returns on every order.";
    const best = bestAlignedPassage(answer, page);
    expect(best).not.toBeNull();
    expect(best?.score).toBeGreaterThan(0.9);
  });

  it("returns null when nothing clears the score floor", () => {
    const best = bestAlignedPassage(
      "The capital of France is Paris and it has a famous tower.",
      "Our bakery sells fresh sourdough bread every morning at dawn.",
    );
    expect(best).toBeNull();
  });
});

describe("summarizeWinningShapes", () => {
  it("returns null for an empty passage list", () => {
    expect(summarizeWinningShapes([])).toBeNull();
  });

  function passage(pageSentence: string): AlignedPassage {
    return {
      answerSentence: pageSentence,
      pageSentence,
      score: 1,
      sharedShingleCount: 5,
      answerSentenceIndex: 0,
      pageSentenceIndex: 0,
    };
  }

  it("detects a short length band", () => {
    const summary = summarizeWinningShapes([passage("Widgets ship in three days flat.")]);
    expect(summary?.lengthBand).toBe("short");
  });

  it("detects a long length band", () => {
    const longSentence =
      "Our premium widget line ships within three business days to every address in the continental United States and comes bundled with a lifetime warranty, free returns, a dedicated account manager for enterprise customers who need volume pricing, priority phone support around the clock, and a satisfaction guarantee that covers the full first year of ownership";
    const summary = summarizeWinningShapes([passage(longSentence)]);
    expect(summary?.lengthBand).toBe("long");
  });

  it("detects number-first opening pattern", () => {
    const summary = summarizeWinningShapes([passage("30 days is the standard return window for all orders.")]);
    expect(summary?.openingPattern).toBe("number_first");
  });

  it("detects definition-first opening pattern", () => {
    const summary = summarizeWinningShapes([passage("A widget is a small mechanical device used in manufacturing.")]);
    expect(summary?.openingPattern).toBe("definition_first");
  });

  it("detects entity-first opening pattern", () => {
    const summary = summarizeWinningShapes([passage("Acme Corporation ships every order within three business days.")]);
    expect(summary?.openingPattern).toBe("entity_first");
  });

  it("detects list structure from a bullet marker", () => {
    const summary = summarizeWinningShapes([passage("- Free shipping on every order over fifty dollars")]);
    expect(summary?.structure).toBe("list");
  });

  it("detects table structure from pipe delimiters", () => {
    const summary = summarizeWinningShapes([passage("Plan | Price | Storage limit for every tier available")]);
    expect(summary?.structure).toBe("table");
  });

  it("defaults to prose structure", () => {
    const summary = summarizeWinningShapes([passage("Our widgets ship within three business days of ordering.")]);
    expect(summary?.structure).toBe("prose");
  });

  it("reports sampleSize and rounds avgWordCount across multiple passages", () => {
    const summary = summarizeWinningShapes([
      passage("Our widgets ship fast."),
      passage("Our widgets ship within three full business days."),
    ]);
    expect(summary?.sampleSize).toBe(2);
    expect(typeof summary?.avgWordCount).toBe("number");
  });
});

describe("alignmentContentHash", () => {
  it("is deterministic for the same inputs", () => {
    const a = alignmentContentHash("answer text here", "page text here");
    const b = alignmentContentHash("answer text here", "page text here");
    expect(a).toBe(b);
  });

  it("changes when either input changes", () => {
    const base = alignmentContentHash("answer text here", "page text here");
    const changedAnswer = alignmentContentHash("different answer", "page text here");
    const changedPage = alignmentContentHash("answer text here", "different page");
    expect(changedAnswer).not.toBe(base);
    expect(changedPage).not.toBe(base);
  });

  it("is stable across leading/trailing whitespace differences", () => {
    const a = alignmentContentHash("  answer text  ", "  page text  ");
    const b = alignmentContentHash("answer text", "page text");
    expect(a).toBe(b);
  });

  it("never throws on empty strings", () => {
    expect(() => alignmentContentHash("", "")).not.toThrow();
  });
});
