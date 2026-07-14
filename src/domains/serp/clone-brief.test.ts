import { describe, it, expect } from "vitest";
import { buildCloneBrief, computeCoverageGaps, type BuildCloneBriefInput } from "./clone-brief";
import type { MoneyPage } from "./money-pages";
import type { CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";

const page = (over: Partial<MoneyPage> = {}): MoneyPage => ({
  url: "https://supplehomes.com/sofreh-guide",
  competitorDomain: "supplehomes.com",
  trafficWeight: 1900,
  keywordCount: 2,
  topKeywords: [
    { keyword: "persian wedding sofreh", volume: 1900, rank: 3, weight: 1900 },
    { keyword: "sofreh aghd meaning", volume: 500, rank: 10, weight: 425 },
  ],
  ...over,
});

const facts = (over: Partial<CompetitorPageFacts> = {}): CompetitorPageFacts => ({
  canonicalUrl: null,
  title: "The Complete Persian Wedding Sofreh Aghd Guide",
  metaDescription: null,
  h1: "Persian Wedding Sofreh Aghd",
  h2Count: 6,
  h3Count: 2,
  outline: [],
  schemaTypes: ["FAQPage"],
  hasFaq: true,
  faqQuestionCount: 4,
  faqQuestions: [],
  hasAnswerBlock: true,
  wordCount: 2200,
  sectionCount: 6,
  internalLinkCount: 12,
  externalLinkCount: 3,
  imageCount: 8,
  hasToolOrCalculator: false,
  freshnessDate: "2026-05-01",
  ogTitle: null,
  ogType: null,
  topTerms: ["sofreh", "wedding", "persian", "aghd", "ceremony"],
  ...over,
});

describe("computeCoverageGaps", () => {
  it("returns tokens the tenant has no owned page for", () => {
    // "persian" is a generic brand token (relevance-gate.ts) and never counts as its
    // own distinguishing gap, so it never appears in the input tokens here either.
    const gaps = computeCoverageGaps(["sofreh", "wedding", "ceremony"], ["Wedding Traditions"]);
    expect(gaps).toEqual(["sofreh", "ceremony"]);
  });

  it("returns [] when everything is already owned", () => {
    const gaps = computeCoverageGaps(["sofreh", "wedding"], ["Sofreh Aghd Wedding Setup"]);
    expect(gaps).toEqual([]);
  });

  it("bounds the output", () => {
    const many = Array.from({ length: 10 }, (_, i) => `topic${i}`);
    expect(computeCoverageGaps(many, [])).toHaveLength(6);
  });
});

describe("buildCloneBrief - torn down", () => {
  const base: BuildCloneBriefInput = {
    page: page(),
    audit: { fetchStatus: "ok", facts: facts() },
    whatWins: "FAQ schema · answer block · 2.2k words · 6 sections",
    ownedTopics: ["Persian Wedding Traditions"],
  };

  it("names the competitor, the traffic weight, and the top keyword with real volume", () => {
    const brief = buildCloneBrief(base);
    expect(brief.teardownStatus).toBe("torn_down");
    expect(brief.summary).toContain("supplehomes.com");
    expect(brief.summary).toContain("1,900");
    expect(brief.summary).toContain("persian wedding sofreh");
    expect(brief.summary).toContain("FAQ schema");
  });

  it("caps compact demand evidence at 25, highest weight first", () => {
    const many = page({
      topKeywords: Array.from({ length: 30 }, (_, i) => ({ keyword: `kw ${i}`, volume: 100 * (i + 1), rank: 3, weight: 100 * (i + 1) })),
    });
    const brief = buildCloneBrief({ ...base, page: many });
    expect(brief.demand).toHaveLength(25);
    expect(brief.demand[0].keyword).toBe("kw 29"); // highest weight
  });

  it("promotes the exact-page research receipt and measured winner blueprint", () => {
    const brief = buildCloneBrief({
      ...base,
      keywordResearch: { status: "cache_hit", keywordCount: 500, withVolume: 420, totalSearchVolume: 148000 },
    });
    expect(brief.keywordResearch?.keywordCount).toBe(500);
    expect(brief.blueprint).toMatchObject({
      observedWordCount: 2200,
      observedSectionCount: 6,
      faqQuestionCount: 4,
      requiresDirectAnswer: true,
      observedInternalLinks: 12,
      observedImages: 8,
    });
    expect(brief.blueprint?.schemaTypes).toContain("FAQPage");
  });

  it("names real coverage gaps vs the tenant's own pages", () => {
    const brief = buildCloneBrief(base);
    expect(brief.coverageGaps).toContain("sofreh");
    expect(brief.summary).toContain("We have no page covering");
  });

  it("says 'already cover' when nothing is missing", () => {
    const brief = buildCloneBrief({ ...base, ownedTopics: ["Sofreh Aghd Ceremony ceremony wedding persian ohja"] });
    expect(brief.coverageGaps).toEqual([]);
    expect(brief.summary).toContain("already cover");
  });

  it("sets a build pointer naming the top keyword and the real reason", () => {
    const brief = buildCloneBrief(base);
    expect(brief.buildPointer?.label).toBe("persian wedding sofreh");
    expect(brief.buildPointer?.reason).toContain("sofreh");
  });

  it("is honest when the page has no real structure (whatWins null)", () => {
    const brief = buildCloneBrief({ ...base, whatWins: null });
    expect(brief.whatWins).toBeNull();
    expect(brief.summary).toContain("little real structure");
  });
});

describe("buildCloneBrief - not read / blocked", () => {
  it("is honest when the teardown never ran (audit null)", () => {
    const brief = buildCloneBrief({ page: page(), audit: null, whatWins: null, ownedTopics: [] });
    expect(brief.teardownStatus).toBe("not_read");
    expect(brief.whatWins).toBeNull();
    expect(brief.coverageGaps).toEqual([]);
    expect(brief.buildPointer).toBeNull();
    expect(brief.summary).toContain("have not read their page yet");
  });

  it("is honest when the page blocks crawlers", () => {
    const brief = buildCloneBrief({ page: page(), audit: { fetchStatus: "blocked_robots", facts: null }, whatWins: null, ownedTopics: [] });
    expect(brief.teardownStatus).toBe("blocked");
    expect(brief.summary).toContain("blocks crawlers");
    expect(brief.buildPointer).toBeNull();
  });

  it("is honest on a fetch failure (not silently 'not read')", () => {
    const brief = buildCloneBrief({ page: page(), audit: { fetchStatus: "fetch_failed", facts: null }, whatWins: null, ownedTopics: [] });
    expect(brief.teardownStatus).toBe("not_read");
  });
});

describe("buildCloneBrief - dash guard (hard rule)", () => {
  it("NEVER contains an em or en dash in the summary or build-pointer reason", () => {
    const variants: BuildCloneBriefInput[] = [
      { page: page(), audit: { fetchStatus: "ok", facts: facts() }, whatWins: "FAQ schema · answer block", ownedTopics: [] },
      { page: page(), audit: { fetchStatus: "ok", facts: facts() }, whatWins: null, ownedTopics: ["Sofreh Aghd Wedding Persian Ceremony"] },
      { page: page(), audit: null, whatWins: null, ownedTopics: [] },
      { page: page(), audit: { fetchStatus: "blocked_robots", facts: null }, whatWins: null, ownedTopics: [] },
      { page: page({ topKeywords: [] }), audit: { fetchStatus: "ok", facts: facts() }, whatWins: "thin page (low structure)", ownedTopics: [] },
    ];
    for (const v of variants) {
      const brief = buildCloneBrief(v);
      expect(/[–—]/.test(brief.summary)).toBe(false);
      if (brief.buildPointer) expect(/[–—]/.test(brief.buildPointer.reason)).toBe(false);
    }
  });
});
