import { describe, it, expect } from "vitest";
import {
  buildQuestionUniverse,
  fanoutQuestionId,
  normalizeQuestion,
  questionJunkReason,
  significantTokens,
  type FanoutQuestionInput,
  type LibraryQuestionInput,
  type ProfoundQuestionInput,
} from "@/domains/ai-visibility/question-universe";
import { NIGHTLY_PROMPT_CAP } from "@/domains/evidence/readers/engine-types";

const lib = (n: number, text?: string): LibraryQuestionInput => ({
  id: `prm-${n}`,
  prompt_text: text ?? `where can i buy persian carpets in city ${n}`,
  topic: "iran",
});

const pf = (n: number, text: string, over: Partial<ProfoundQuestionInput> = {}): ProfoundQuestionInput => ({
  id: `pfp-${n}`,
  text,
  topic: "Iranopedia",
  ...over,
});

const RELEVANCE = ["Iranopedia", "iranopedia.com"];

describe("buildQuestionUniverse - source tags + stable ordering", () => {
  it("orders library first (input order), then profound (volume desc), then fanouts (weight desc)", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [lib(0), lib(1)],
      profoundPrompts: [
        pf(1, "what is the history of persian tea houses", { volume: 2 }),
        pf(2, "which iranian dishes use saffron most", { volume: 9 }),
      ],
      fanoutSeeds: [
        { subQuery: "iran travel visa requirements americans", weight: 1 },
        { subQuery: "chaharshanbe suri fire festival meaning", weight: 7 },
      ],
      relevanceTokens: RELEVANCE,
    });
    expect(u.questions.map((q) => q.source)).toEqual([
      "library", "library", "profound", "profound", "fanout", "fanout",
    ]);
    expect(u.questions.map((q) => q.id).slice(0, 4)).toEqual(["prm-0", "prm-1", "pfp-2", "pfp-1"]);
    // Higher-weight fanout first.
    expect(u.questions[4]!.text).toBe("chaharshanbe suri fire festival meaning");
    expect(u.counts).toEqual({ library: 2, profound: 2, fanout: 2 });
    expect(u.dropped).toEqual({ junk: 0, duplicate: 0, overCap: 0 });
  });

  it("profound ties on volume break by recency, then input order", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [],
      profoundPrompts: [
        pf(1, "persian new year haft sin table items", { volume: 3, lastSeenAt: "2026-06-01" }),
        pf(2, "iranian wedding sofreh aghd traditions", { volume: 3, lastSeenAt: "2026-06-20" }),
      ],
      relevanceTokens: RELEVANCE,
    });
    expect(u.questions.map((q) => q.id)).toEqual(["pfp-2", "pfp-1"]);
  });
});

describe("buildQuestionUniverse - normalized-token dedupe", () => {
  it("drops a profound question that near-duplicates a library one (library wins)", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [lib(0, "What are the best Persian restaurants in Los Angeles?")],
      profoundPrompts: [pf(1, "best persian restaurants los angeles")],
      relevanceTokens: RELEVANCE,
    });
    expect(u.questions).toHaveLength(1);
    expect(u.questions[0]!.source).toBe("library");
    expect(u.dropped.duplicate).toBe(1);
  });

  it("keeps questions that differ only by a number (a year is real demand)", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [],
      profoundPrompts: [pf(1, "when is nowruz 2025"), pf(2, "when is nowruz 2026")],
      relevanceTokens: RELEVANCE,
    });
    expect(u.questions).toHaveLength(2);
    expect(u.dropped.duplicate).toBe(0);
  });

  it("dedupes exact repeats and repeated ids across sources", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [lib(0)],
      profoundPrompts: [pf(1, "iranian saffron harvest season"), pf(1, "iranian pistachio export markets")],
      fanoutSeeds: [
        { subQuery: "Iranian saffron harvest season!", weight: 5 },
      ],
      relevanceTokens: RELEVANCE,
    });
    // pfp-1 appears twice (same id) -> second dropped; the fanout normalizes to
    // the same text as the first profound question -> dropped.
    expect(u.questions).toHaveLength(2);
    expect(u.dropped.duplicate).toBe(2);
  });
});

describe("buildQuestionUniverse - junk gate", () => {
  it("excludes the borrowed-account brand sentiment template even when it names the tenant", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [lib(0)],
      profoundPrompts: [pf(1, "Evaluate the Frontier Models company ChatGPT on Iranopedia")],
      relevanceTokens: RELEVANCE,
    });
    expect(u.counts.profound).toBe(0);
    expect(u.dropped.junk).toBe(1);
  });

  it("excludes off-topic AI-brand questions but keeps tenant questions that mention an AI brand", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [lib(0)],
      profoundPrompts: [
        pf(1, "compare openai chatgpt subscription pricing tiers"), // off-topic
        pf(2, "does chatgpt recommend persian carpets shops"), // shares tenant tokens
      ],
      relevanceTokens: RELEVANCE,
    });
    expect(u.questions.filter((q) => q.source === "profound").map((q) => q.id)).toEqual(["pfp-2"]);
    expect(u.dropped.junk).toBe(1);
  });

  it("never junk-gates curated library prompts", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: [lib(0, "Evaluate the Frontier Models company ChatGPT on carpets")],
      relevanceTokens: RELEVANCE,
    });
    expect(u.counts.library).toBe(1);
    expect(u.dropped.junk).toBe(0);
  });

  it("questionJunkReason classifies too-short, template, and off-topic candidates", () => {
    const pool = significantTokens("persian carpets tehran iranopedia");
    expect(questionJunkReason("hi", pool)).toBe("too_short");
    expect(questionJunkReason("Evaluate the Frontier Models company ChatGPT on Iranopedia", pool)).toBe(
      "brand_sentiment_template",
    );
    expect(questionJunkReason("compare openai subscription plans monthly", pool)).toBe("off_topic_ai_brand");
    expect(questionJunkReason("best persian carpets under 500 dollars", pool)).toBeNull();
    // Empty pool switches the off-topic gate off (no topic scoping available).
    expect(questionJunkReason("compare openai subscription plans monthly", new Set())).toBeNull();
  });
});

describe("buildQuestionUniverse - cap discipline", () => {
  const manyLibs = Array.from({ length: 30 }, (_, i) => lib(i));

  it("caps at NIGHTLY_PROMPT_CAP and counts the overflow honestly", () => {
    const u = buildQuestionUniverse({ libraryPrompts: manyLibs, relevanceTokens: RELEVANCE });
    expect(u.questions).toHaveLength(NIGHTLY_PROMPT_CAP);
    expect(u.dropped.overCap).toBe(30 - NIGHTLY_PROMPT_CAP);
  });

  it("CLAMPS a bigger cap argument - callers can never raise the nightly ceiling", () => {
    const u = buildQuestionUniverse({ libraryPrompts: manyLibs, cap: 500, relevanceTokens: RELEVANCE });
    expect(u.questions).toHaveLength(NIGHTLY_PROMPT_CAP);
  });

  it("honors a lower cap", () => {
    const u = buildQuestionUniverse({
      libraryPrompts: manyLibs,
      profoundPrompts: [pf(1, "iranian saffron harvest season")],
      cap: 5,
      relevanceTokens: RELEVANCE,
    });
    expect(u.questions).toHaveLength(5);
    expect(u.questions.every((q) => q.source === "library")).toBe(true);
    expect(u.counts).toEqual({ library: 5, profound: 0, fanout: 0 });
  });
});

describe("fanout ids + normalization", () => {
  it("fanoutQuestionId is stable and punctuation/case-insensitive", () => {
    const a = fanoutQuestionId("Best Persian Street Food?");
    expect(a).toBe(fanoutQuestionId("best persian street food"));
    expect(a).toMatch(/^fan-[0-9a-f]{8}$/);
  });

  it("normalizeQuestion keeps Persian script tokens", () => {
    expect(normalizeQuestion("Chaharshanbe Suri (چهارشنبه سوری) 2026!")).toBe(
      "chaharshanbe suri چهارشنبه سوری 2026",
    );
  });

  it("fanout entries become tagged questions with hashed ids", () => {
    const seeds: FanoutQuestionInput[] = [{ subQuery: "iranian tea brewing samovar guide", weight: 2 }];
    const u = buildQuestionUniverse({ libraryPrompts: [], fanoutSeeds: seeds, relevanceTokens: RELEVANCE });
    expect(u.questions[0]).toMatchObject({
      source: "fanout",
      text: "iranian tea brewing samovar guide",
      topic: null,
    });
    expect(u.questions[0]!.id).toBe(fanoutQuestionId("iranian tea brewing samovar guide"));
  });
});
