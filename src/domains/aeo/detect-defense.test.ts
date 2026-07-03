import { describe, it, expect } from "vitest";
import {
  detectZeroSourceOpenings,
  detectDefendCitedQueries,
  detectBrandDescriptionMismatches,
  isReferencePlatform,
  isUuidShaped,
  stripWww,
  type TopicCitationRollup,
  type TopicCaptureSlice,
  type BrandMentionAnswer,
  type KnownBrandFacts,
} from "./detect-defense";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function rollup(overrides: Partial<TopicCitationRollup> & { categoryId: string }): TopicCitationRollup {
  return {
    topicLabel: "best time to visit Iran",
    observedAnswers: 20,
    modelCount: 3,
    citationsByDomain: new Map(),
    ...overrides,
  };
}

function slice(
  categoryId: string,
  date: string,
  byDomain: Record<string, number>,
  topicLabel: string | null = "persian saffron",
): TopicCaptureSlice {
  return {
    categoryId,
    topicLabel,
    date,
    citationsByDomain: new Map(Object.entries(byDomain)),
  };
}

// ===========================================================================
// 1. Zero-source opening
// ===========================================================================

describe("detectZeroSourceOpenings", () => {
  it("EMPTY on no rollups", () => {
    expect(detectZeroSourceOpenings([])).toEqual([]);
  });

  it("fires when a topic AI answers has no confident source (no citations at all)", () => {
    const out = detectZeroSourceOpenings([
      rollup({ categoryId: "c1", observedAnswers: 30, citationsByDomain: new Map() }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].categoryId).toBe("c1");
    expect(out[0].topSourceShare).toBe(0);
    expect(out[0].topSourceDomain).toBeNull();
    expect(out[0].observedAnswers).toBe(30);
  });

  it("fires when the strongest source stays below the confidence floor", () => {
    // 5 domains each with 2 citations -> top share = 0.2 (<= 0.25).
    const out = detectZeroSourceOpenings([
      rollup({
        categoryId: "c2",
        observedAnswers: 15,
        citationsByDomain: new Map([
          ["a.com", 2],
          ["b.com", 2],
          ["c.com", 2],
          ["d.com", 2],
          ["e.com", 2],
        ]),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].topSourceShare).toBeCloseTo(0.2, 5);
  });

  it("does NOT fire (no false positive) when a source is confidently cited", () => {
    // One domain owns 8 of 10 citations -> top share 0.8 > floor.
    const out = detectZeroSourceOpenings([
      rollup({
        categoryId: "c3",
        observedAnswers: 40,
        citationsByDomain: new Map([
          ["dominant.com", 8],
          ["b.com", 1],
          ["c.com", 1],
        ]),
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("does NOT fire on thin data (below the observed-answer floor)", () => {
    const out = detectZeroSourceOpenings([
      rollup({ categoryId: "c4", observedAnswers: 3, citationsByDomain: new Map() }),
    ]);
    expect(out).toEqual([]);
  });

  it("skips a topic with only a UUID-shaped label (never leaks a UUID to copy)", () => {
    const out = detectZeroSourceOpenings([
      rollup({
        categoryId: "c5",
        topicLabel: "123e4567-e89b-12d3-a456-426614174000",
        observedAnswers: 30,
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("ranks biggest opening first and caps the count", () => {
    const out = detectZeroSourceOpenings(
      [
        rollup({ categoryId: "small", observedAnswers: 12 }),
        rollup({ categoryId: "big", observedAnswers: 90 }),
        rollup({ categoryId: "mid", observedAnswers: 40 }),
        rollup({ categoryId: "tiny", observedAnswers: 11 }),
      ],
      { maxCandidates: 2 },
    );
    expect(out.map((o) => o.categoryId)).toEqual(["big", "mid"]);
  });
});

// ===========================================================================
// 2. Defend a cited query (real 2-capture history delta)
// ===========================================================================

describe("detectDefendCitedQueries", () => {
  const ownDomains = new Set(["iranopedia.com"]);

  it("EMPTY on no slices", () => {
    expect(detectDefendCitedQueries(new Map(), ownDomains)).toEqual([]);
  });

  it("fires when a NEW competitor is cited in the latest capture on a topic we owned before", () => {
    // Prior: we (iranopedia.com) are cited, no competitor.
    // Latest: a new competitor (surfiran.com) appears; we are still there.
    const slices = new Map([
      [
        "c1",
        {
          prior: slice("c1", "2026-06-25", { "iranopedia.com": 5 }),
          latest: slice("c1", "2026-07-02", { "iranopedia.com": 4, "surfiran.com": 3 }),
        },
      ],
    ]);
    const out = detectDefendCitedQueries(slices, ownDomains);
    expect(out).toHaveLength(1);
    expect(out[0].competitorDomain).toBe("surfiran.com");
    expect(out[0].competitorCitations).toBe(3);
    expect(out[0].ownPriorCitations).toBe(5);
    expect(out[0].priorCaptureDate).toBe("2026-06-25");
    expect(out[0].latestCaptureDate).toBe("2026-07-02");
  });

  it("does NOT fire (no false positive) when the competitor was already cited in the prior capture", () => {
    const slices = new Map([
      [
        "c2",
        {
          prior: slice("c2", "2026-06-25", { "iranopedia.com": 5, "surfiran.com": 2 }),
          latest: slice("c2", "2026-07-02", { "iranopedia.com": 4, "surfiran.com": 3 }),
        },
      ],
    ]);
    expect(detectDefendCitedQueries(slices, ownDomains)).toEqual([]);
  });

  it("does NOT fire when the tenant never owned the topic (own prior = 0)", () => {
    const slices = new Map([
      [
        "c3",
        {
          prior: slice("c3", "2026-06-25", { "other.com": 3 }),
          latest: slice("c3", "2026-07-02", { "surfiran.com": 4 }),
        },
      ],
    ]);
    expect(detectDefendCitedQueries(slices, ownDomains)).toEqual([]);
  });

  it("ignores a reference platform newly appearing (Wikipedia is not a rival locking you out)", () => {
    const slices = new Map([
      [
        "c4",
        {
          prior: slice("c4", "2026-06-25", { "iranopedia.com": 5 }),
          latest: slice("c4", "2026-07-02", { "iranopedia.com": 4, "en.wikipedia.org": 6 }),
        },
      ],
    ]);
    expect(detectDefendCitedQueries(slices, ownDomains)).toEqual([]);
  });

  it("treats www-prefixed own domain as owned (does not flag ourselves as a competitor)", () => {
    const slices = new Map([
      [
        "c5",
        {
          prior: slice("c5", "2026-06-25", { "iranopedia.com": 5 }),
          latest: slice("c5", "2026-07-02", { "www.iranopedia.com": 4 }),
        },
      ],
    ]);
    expect(detectDefendCitedQueries(slices, ownDomains)).toEqual([]);
  });

  it("ranks the hardest-pressing new competitor first", () => {
    const slices = new Map([
      [
        "small",
        {
          prior: slice("small", "2026-06-25", { "iranopedia.com": 5 }),
          latest: slice("small", "2026-07-02", { "iranopedia.com": 4, "weak.com": 1 }),
        },
      ],
      [
        "big",
        {
          prior: slice("big", "2026-06-25", { "iranopedia.com": 5 }),
          latest: slice("big", "2026-07-02", { "iranopedia.com": 4, "strong.com": 9 }),
        },
      ],
    ]);
    const out = detectDefendCitedQueries(slices, ownDomains);
    expect(out.map((o) => o.competitorDomain)).toEqual(["strong.com", "weak.com"]);
  });
});

// ===========================================================================
// 3. Brand-description accuracy
// ===========================================================================

describe("detectBrandDescriptionMismatches", () => {
  const factsGuide: KnownBrandFacts = {
    industry: "persian culture guide",
    locations: ["san francisco"],
    services: ["restaurant guide"],
  };

  function mention(excerpt: string, model: string | null = "ChatGPT"): BrandMentionAnswer {
    return { excerpt, model };
  }

  it("EMPTY on no brand mentions", () => {
    expect(detectBrandDescriptionMismatches([], factsGuide)).toEqual([]);
  });

  it("EMPTY when there is no precise known industry family to check against", () => {
    const out = detectBrandDescriptionMismatches(
      [mention("Iranopedia is a hotel chain in Iran.")],
      { industry: "general reference", locations: [], services: [] },
    );
    expect(out).toEqual([]);
  });

  it("does NOT fire (no false positive) when the AI description matches the known family", () => {
    const factsRestaurant: KnownBrandFacts = {
      industry: "restaurant guide",
      locations: [],
      services: [],
    };
    const out = detectBrandDescriptionMismatches(
      [mention("Iranopedia is a restaurant guide covering Persian food.")],
      factsRestaurant,
    );
    expect(out).toEqual([]);
  });

  it("fires when the AI places the brand in a different, incompatible industry family", () => {
    const factsRestaurant: KnownBrandFacts = {
      industry: "restaurant guide",
      locations: [],
      services: [],
    };
    const out = detectBrandDescriptionMismatches(
      [mention("Iranopedia is a hotel and resort operator in Tehran.")],
      factsRestaurant,
    );
    expect(out).toHaveLength(1);
    expect(out[0].factKind).toBe("industry");
    expect(out[0].ownFact).toBe("restaurant guide");
    expect(out[0].aiDescriptor).toBe("hotel");
    expect(out[0].model).toBe("ChatGPT");
    expect(out[0].evidenceExcerpt.length).toBeGreaterThan(0);
  });

  it("does NOT fire when the answer mentions BOTH families (additive context, not a contradiction)", () => {
    const factsRestaurant: KnownBrandFacts = {
      industry: "restaurant guide",
      locations: [],
      services: [],
    };
    const out = detectBrandDescriptionMismatches(
      [mention("Iranopedia is a restaurant guide that also lists a few hotel options.")],
      factsRestaurant,
    );
    expect(out).toEqual([]);
  });

  it("dedupes repeated identical mismatches and caps the count", () => {
    const factsRestaurant: KnownBrandFacts = {
      industry: "restaurant guide",
      locations: [],
      services: [],
    };
    const out = detectBrandDescriptionMismatches(
      [
        mention("Iranopedia is a hotel brand."),
        mention("Iranopedia is a hotel company.", "Perplexity"),
      ],
      factsRestaurant,
    );
    expect(out).toHaveLength(1); // same descriptor "hotel" -> deduped
  });
});

// ===========================================================================
// Pure helpers
// ===========================================================================

describe("detect-defense pure helpers", () => {
  it("stripWww lowercases and strips www.", () => {
    expect(stripWww("WWW.Example.com")).toBe("example.com");
  });

  it("isReferencePlatform recognizes generic platforms and rejects real rivals", () => {
    expect(isReferencePlatform("en.wikipedia.org")).toBe(true);
    expect(isReferencePlatform("reddit.com")).toBe(true);
    expect(isReferencePlatform("surfiran.com")).toBe(false);
  });

  it("isUuidShaped detects a UUID", () => {
    expect(isUuidShaped("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuidShaped("best time to visit Iran")).toBe(false);
  });
});
