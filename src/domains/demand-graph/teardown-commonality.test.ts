import { describe, it, expect } from "vitest";
import {
  buildCommonalityBrief,
  extractSharedHeadings,
  commonalitySentence,
} from "./teardown-commonality";
import type { CompetitorPageFacts } from "./competitor-page-audit";

function facts(over: Partial<CompetitorPageFacts> = {}): CompetitorPageFacts {
  return {
    canonicalUrl: null,
    title: "Persian Wedding Traditions",
    metaDescription: null,
    h1: "Persian Wedding Traditions",
    h2Count: 4,
    h3Count: 0,
    outline: ["What is a Persian wedding?", "Sofreh Aghd explained", "Modern traditions", "FAQ"],
    schemaTypes: [],
    hasFaq: false,
    faqQuestionCount: 0,
    faqQuestions: [],
    hasAnswerBlock: true,
    wordCount: 1200,
    sectionCount: 4,
    internalLinkCount: 5,
    externalLinkCount: 2,
    imageCount: 3,
    hasToolOrCalculator: false,
    freshnessDate: null,
    ogTitle: null,
    ogType: null,
    topTerms: [],
    ...over,
  };
}

describe("extractSharedHeadings", () => {
  it("clusters headings that share a distinguishing token across a majority of pages", () => {
    const pages: CompetitorPageFacts[] = [
      facts({ outline: ["Sofreh Aghd explained", "Wedding costs", "Guest etiquette"] }),
      facts({ outline: ["What is Sofreh Aghd?", "Average wedding cost", "Timeline"] }),
      facts({ outline: ["History", "Sofreh Aghd meaning", "Guest etiquette tips"] }),
    ];
    const shared = extractSharedHeadings(pages);
    const labels = shared.map((s) => s.label.toLowerCase());
    expect(labels.some((l) => l.includes("sofreh"))).toBe(true);
    // "Sofreh Aghd" appears (in some form) on all 3 pages -> winners === 3
    const sofreh = shared.find((s) => s.label.toLowerCase().includes("sofreh"));
    expect(sofreh?.winners).toBe(3);
  });

  it("does NOT include a heading only one page has (no consensus)", () => {
    const pages: CompetitorPageFacts[] = [
      facts({ outline: ["Sofreh Aghd explained"] }),
      facts({ outline: ["Sofreh Aghd meaning"] }),
      facts({ outline: ["A totally unrelated one-off section about shoes"] }),
    ];
    const shared = extractSharedHeadings(pages);
    expect(shared.some((s) => s.label.toLowerCase().includes("shoes"))).toBe(false);
  });

  it("returns empty when pages share no headings at all", () => {
    const pages: CompetitorPageFacts[] = [
      facts({ outline: ["Alpha topic here"] }),
      facts({ outline: ["Beta subject matter"] }),
    ];
    expect(extractSharedHeadings(pages)).toEqual([]);
  });
});

describe("buildCommonalityBrief", () => {
  it("returns null with fewer than 2 usable teardown facts (never fabricates a consensus)", () => {
    expect(buildCommonalityBrief([facts()])).toBeNull();
    expect(buildCommonalityBrief([])).toBeNull();
    expect(buildCommonalityBrief([null, undefined])).toBeNull();
  });

  it("filters null/undefined entries before counting sources", () => {
    const brief = buildCommonalityBrief([facts(), null, facts(), undefined]);
    expect(brief?.sourceCount).toBe(2);
  });

  it("caps at 5 sources even when more are passed", () => {
    const six = Array.from({ length: 6 }, () => facts());
    const brief = buildCommonalityBrief(six);
    expect(brief?.sourceCount).toBe(5);
  });

  it("computes a word-count band around the median, not a single competitor's exact count", () => {
    const pages = [facts({ wordCount: 1000 }), facts({ wordCount: 1400 }), facts({ wordCount: 1800 })];
    const brief = buildCommonalityBrief(pages);
    expect(brief!.wordBand.median).toBe(1400);
    expect(brief!.wordBand.low).toBeLessThanOrEqual(1400);
    expect(brief!.wordBand.high).toBeGreaterThanOrEqual(1400);
  });

  it("answerShape: FAQ wins when a majority of pages have 3+ FAQ questions", () => {
    const pages = [
      facts({ hasFaq: true, faqQuestionCount: 4, hasAnswerBlock: false }),
      facts({ hasFaq: true, faqQuestionCount: 5, hasAnswerBlock: false }),
      facts({ hasFaq: false, faqQuestionCount: 0, hasAnswerBlock: true }),
    ];
    const brief = buildCommonalityBrief(pages);
    expect(brief!.answerShape).toBe("faq");
  });

  it("answerShape: definition_first wins when most pages have an answer block, no FAQ consensus", () => {
    const pages = [
      facts({ hasAnswerBlock: true, hasFaq: false }),
      facts({ hasAnswerBlock: true, hasFaq: false }),
      facts({ hasAnswerBlock: false, hasFaq: false }),
    ];
    const brief = buildCommonalityBrief(pages);
    expect(brief!.answerShape).toBe("definition_first");
  });

  it("schemaTypes: only types a MAJORITY of pages share make the consensus list", () => {
    const pages = [
      facts({ schemaTypes: ["FAQPage", "Article"] }),
      facts({ schemaTypes: ["FAQPage"] }),
      facts({ schemaTypes: ["Article"] }),
    ];
    const brief = buildCommonalityBrief(pages);
    // FAQPage: 2/3 (majority=2) -> included. Article: 2/3 -> included.
    expect(brief!.schemaTypes.sort()).toEqual(["Article", "FAQPage"]);
  });

  it("hasFaqConsensus / hasToolConsensus require a majority", () => {
    const pages = [
      facts({ hasFaq: true, hasToolOrCalculator: false }),
      facts({ hasFaq: true, hasToolOrCalculator: false }),
      facts({ hasFaq: false, hasToolOrCalculator: true }),
    ];
    const brief = buildCommonalityBrief(pages);
    expect(brief!.hasFaqConsensus).toBe(true);
    expect(brief!.hasToolConsensus).toBe(false);
  });

  it("whatTheyAllHaveThatWeDont stays empty when ownedFacts is not passed", () => {
    const pages = [facts({ hasFaq: true }), facts({ hasFaq: true })];
    const brief = buildCommonalityBrief(pages);
    expect(brief!.whatTheyAllHaveThatWeDont).toEqual([]);
  });

  it("whatTheyAllHaveThatWeDont flags a missing FAQ vs our own page", () => {
    const pages = [facts({ hasFaq: true, faqQuestionCount: 4 }), facts({ hasFaq: true, faqQuestionCount: 5 })];
    const owned = facts({ hasFaq: false, faqQuestionCount: 0 });
    const brief = buildCommonalityBrief(pages, { ownedFacts: owned });
    expect(brief!.whatTheyAllHaveThatWeDont.some((s) => /FAQ/i.test(s))).toBe(true);
  });

  it("whatTheyAllHaveThatWeDont flags a missing shared heading vs our own outline", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained", "Costs"] }),
      facts({ outline: ["Sofreh Aghd meaning", "Costs breakdown"] }),
    ];
    const owned = facts({ outline: ["Introduction", "History"] });
    const brief = buildCommonalityBrief(pages, { ownedFacts: owned });
    expect(brief!.whatTheyAllHaveThatWeDont.some((s) => /sofreh/i.test(s))).toBe(true);
  });

  it("whatTheyAllHaveThatWeDont is empty when our page already covers everything shared", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"], hasFaq: true, faqQuestionCount: 3, schemaTypes: ["FAQPage"], wordCount: 1000 }),
      facts({ outline: ["Sofreh Aghd meaning"], hasFaq: true, faqQuestionCount: 3, schemaTypes: ["FAQPage"], wordCount: 1000 }),
    ];
    const owned = facts({
      outline: ["Sofreh Aghd deep dive"],
      hasFaq: true,
      faqQuestionCount: 3,
      schemaTypes: ["FAQPage"],
      wordCount: 1500,
      hasAnswerBlock: true,
    });
    const brief = buildCommonalityBrief(pages, { ownedFacts: owned });
    expect(brief!.whatTheyAllHaveThatWeDont).toEqual([]);
  });

  it("never includes verbatim competitor prose, only shape/counts/heading topics", () => {
    const pages = [
      facts({ outline: ["How much does a Persian wedding cost in 2026?"] }),
      facts({ outline: ["Persian wedding cost breakdown for 2026"] }),
    ];
    const brief = buildCommonalityBrief(pages);
    // The brief should describe structure (heading label), never a full paragraph.
    expect(brief).not.toBeNull();
    for (const h of brief!.sharedHeadings) {
      expect(h.label.length).toBeLessThan(200); // heading, not a scraped paragraph
    }
  });
});

describe("commonalitySentence", () => {
  it("renders a plain-language, dash-free sentence with real numbers", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"], hasFaq: true, faqQuestionCount: 4, wordCount: 1200 }),
      facts({ outline: ["Sofreh Aghd meaning"], hasFaq: true, faqQuestionCount: 5, wordCount: 1400 }),
    ];
    const brief = buildCommonalityBrief(pages)!;
    const sentence = commonalitySentence(brief);
    expect(sentence).toContain("2 of the top pages");
    expect(sentence).not.toMatch(/[–—]/); // no em/en dashes
  });
});
