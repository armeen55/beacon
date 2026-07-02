import { describe, it, expect } from "vitest";
import {
  competitorPageTextFromFacts,
  pickAnswerExcerptForTopic,
  toPersistable,
  parsePersistedAnswerAlignment,
  type ProfoundAnswerExcerpt,
} from "./answer-alignment-store";
import type { CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";
import type { AlignedPassage } from "./answer-alignment";

function facts(overrides: Partial<CompetitorPageFacts> = {}): CompetitorPageFacts {
  return {
    canonicalUrl: null,
    title: null,
    metaDescription: null,
    h1: null,
    h2Count: 0,
    h3Count: 0,
    outline: [],
    schemaTypes: [],
    hasFaq: false,
    faqQuestionCount: 0,
    faqQuestions: [],
    hasAnswerBlock: false,
    wordCount: 0,
    sectionCount: 0,
    internalLinkCount: 0,
    externalLinkCount: 0,
    imageCount: 0,
    hasToolOrCalculator: false,
    freshnessDate: null,
    ogTitle: null,
    ogType: null,
    topTerms: [],
    ...overrides,
  };
}

describe("competitorPageTextFromFacts", () => {
  it("returns null when facts is null", () => {
    expect(competitorPageTextFromFacts(null)).toBeNull();
  });

  it("returns null when every text field is empty", () => {
    expect(competitorPageTextFromFacts(facts())).toBeNull();
  });

  it("joins title, meta description, outline, and FAQ questions", () => {
    const text = competitorPageTextFromFacts(
      facts({
        title: "Best Widgets 2026",
        metaDescription: "A full guide to buying widgets.",
        outline: ["How widgets work", "Pricing"],
        faqQuestions: ["What is a widget?"],
      }),
    );
    expect(text).toContain("Best Widgets 2026");
    expect(text).toContain("A full guide to buying widgets.");
    expect(text).toContain("How widgets work");
    expect(text).toContain("Pricing");
    expect(text).toContain("What is a widget?");
  });

  it("skips blank/whitespace-only fields", () => {
    const text = competitorPageTextFromFacts(facts({ title: "  ", metaDescription: "Real content here" }));
    expect(text).toBe("Real content here");
  });
});

describe("pickAnswerExcerptForTopic", () => {
  const row = (prompt: string, responseExcerpt = "some excerpt"): ProfoundAnswerExcerpt => ({
    prompt,
    model: "chatgpt",
    responseExcerpt,
  });

  it("returns null for an empty excerpt list", () => {
    expect(pickAnswerExcerptForTopic([], "widgets")).toBeNull();
  });

  it("returns null for an empty topic", () => {
    expect(pickAnswerExcerptForTopic([row("best widgets 2026")], "")).toBeNull();
  });

  it("picks the excerpt whose prompt best overlaps the topic tokens", () => {
    const excerpts = [row("best hiking boots for winter"), row("best widgets for small business 2026")];
    const best = pickAnswerExcerptForTopic(excerpts, "widgets for business");
    expect(best?.prompt).toBe("best widgets for small business 2026");
  });

  it("returns null when nothing clears the overlap floor", () => {
    const excerpts = [row("completely unrelated topic about gardening")];
    expect(pickAnswerExcerptForTopic(excerpts, "widgets for business automation")).toBeNull();
  });

  it("does not match on a single coincidental shared word (regression: iran flag vs most beautiful cities in iran)", () => {
    // Ground-truth bug found against real Iranopedia data: "iran flag" incorrectly
    // matched a "most beautiful cities in Iran" prompt purely because both mention
    // "iran". Two generic/common tokens overlapping must never count as a real
    // topic match once there is a genuinely distinguishing word ("flag") absent.
    const excerpts = [row("What are the most beautiful cities in Iran?")];
    expect(pickAnswerExcerptForTopic(excerpts, "iran flag")).toBeNull();
  });

  it("still matches when the distinguishing word IS present", () => {
    const excerpts = [
      row("What are the most beautiful cities in Iran?"),
      row("What does the Iran flag look like and what do its colors mean?"),
    ];
    const best = pickAnswerExcerptForTopic(excerpts, "iran flag");
    expect(best?.prompt).toContain("flag");
  });

  it("requires at least 2 shared meaningful tokens even at high containment", () => {
    // Topic has only one non-generic token beyond a generic filler word - a single
    // shared meaningful token should not be enough on its own once minSharedMeaningful
    // would otherwise demand 2 for a longer, more specific topic.
    const excerpts = [row("What is the best gardening tool for beginners?")];
    expect(pickAnswerExcerptForTopic(excerpts, "best gardening supplies for professionals")).toBeNull();
  });
});

describe("toPersistable / parsePersistedAnswerAlignment round-trip", () => {
  function passage(overrides: Partial<AlignedPassage> = {}): AlignedPassage {
    return {
      answerSentence: "Our widgets ship in three days.",
      pageSentence: "Our widgets ship in three days.",
      score: 0.9,
      sharedShingleCount: 3,
      answerSentenceIndex: 0,
      pageSentenceIndex: 0,
      ...overrides,
    };
  }

  it("round-trips through JSON serialize/parse", () => {
    const built = toPersistable("hash123", "chatgpt", "what widgets ship fastest", [passage()]);
    const parsed = parsePersistedAnswerAlignment(JSON.stringify(built));
    expect(parsed).toEqual(built);
  });

  it("computes a shape summary from the passed passages", () => {
    const built = toPersistable("hash123", "chatgpt", "prompt", [passage()]);
    expect(built.shape).not.toBeNull();
    expect(built.shape?.sampleSize).toBe(1);
  });

  it("truncates an oversized passage sentence to the cap", () => {
    const longSentence = "word ".repeat(500).trim(); // way over 600 chars
    const built = toPersistable("hash123", null, null, [passage({ pageSentence: longSentence, answerSentence: longSentence })]);
    expect(built.passages[0]!.pageSentence.length).toBeLessThanOrEqual(601); // 600 + ellipsis char
    expect(built.passages[0]!.pageSentence.endsWith("…")).toBe(true);
  });

  it("truncates an oversized prompt text to the cap", () => {
    const longPrompt = "x".repeat(1000);
    const built = toPersistable("hash123", null, longPrompt, [passage()]);
    expect(built.promptText?.length).toBeLessThanOrEqual(601);
  });

  it("does not truncate short text", () => {
    const built = toPersistable("hash123", "claude", "short prompt", [passage()]);
    expect(built.promptText).toBe("short prompt");
    expect(built.passages[0]!.pageSentence).toBe("Our widgets ship in three days.");
  });

  it("parsePersistedAnswerAlignment returns null for malformed JSON", () => {
    expect(parsePersistedAnswerAlignment("not json")).toBeNull();
  });

  it("parsePersistedAnswerAlignment returns null for missing passages array", () => {
    expect(parsePersistedAnswerAlignment(JSON.stringify({ contentHash: "x" }))).toBeNull();
  });

  it("parsePersistedAnswerAlignment returns null for empty/undefined content", () => {
    expect(parsePersistedAnswerAlignment(null)).toBeNull();
    expect(parsePersistedAnswerAlignment(undefined)).toBeNull();
    expect(parsePersistedAnswerAlignment("")).toBeNull();
  });

  it("never throws on garbage content", () => {
    expect(() => parsePersistedAnswerAlignment("{{{not valid")).not.toThrow();
  });
});
