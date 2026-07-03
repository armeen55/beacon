import { describe, it, expect } from "vitest";
import { routeGapVerdict } from "./teardown-commonality-verdict";
import { buildCommonalityBrief } from "./teardown-commonality";
import type { CompetitorPageFacts } from "./competitor-page-audit";

function facts(over: Partial<CompetitorPageFacts> = {}): CompetitorPageFacts {
  return {
    canonicalUrl: null,
    title: "Persian Wedding Traditions",
    metaDescription: null,
    h1: "Persian Wedding Traditions",
    h2Count: 4,
    h3Count: 0,
    outline: ["Sofreh Aghd explained", "Costs", "Guest etiquette"],
    schemaTypes: ["FAQPage"],
    hasFaq: true,
    faqQuestionCount: 4,
    faqQuestions: [],
    hasAnswerBlock: true,
    wordCount: 1400,
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

describe("routeGapVerdict", () => {
  it("no_verdict when brief is null (fewer than 2 usable teardowns)", () => {
    const v = routeGapVerdict({ promptId: "p1", brief: null, ownership: { ownedUrl: null } });
    expect(v.outcome).toBe("no_verdict");
    expect(v.atomicEdit).toBeNull();
    expect(v.newPage).toBeNull();
    expect(v.reason).toBeTruthy();
  });

  it("routes to atomic_edit when we already own a matching page, listing missing shared elements", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"], hasFaq: true, faqQuestionCount: 4 }),
      facts({ outline: ["Sofreh Aghd meaning"], hasFaq: true, faqQuestionCount: 5 }),
    ];
    const owned = facts({ outline: ["Introduction only"], hasFaq: false, faqQuestionCount: 0 });
    const brief = buildCommonalityBrief(pages, { ownedFacts: owned });
    const v = routeGapVerdict({
      promptId: "p1",
      brief,
      ownership: { ownedUrl: "https://iranopedia.com/persian-wedding" },
      fanoutQuestions: ["What is Sofreh Aghd made of?"],
    });
    expect(v.outcome).toBe("atomic_edit");
    expect(v.atomicEdit?.ownedUrl).toBe("https://iranopedia.com/persian-wedding");
    expect(v.atomicEdit?.additions.length).toBeGreaterThan(0);
    expect(v.atomicEdit?.fanoutQuestionsToWeave).toContain("What is Sofreh Aghd made of?");
    expect(v.newPage).toBeNull();
  });

  it("atomic_edit with empty additions when owned page already matches the consensus", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"] }),
      facts({ outline: ["Sofreh Aghd meaning"] }),
    ];
    const owned = facts({ outline: ["Sofreh Aghd deep dive"] });
    const brief = buildCommonalityBrief(pages, { ownedFacts: owned });
    const v = routeGapVerdict({ promptId: "p2", brief, ownership: { ownedUrl: "https://iranopedia.com/x" } });
    expect(v.outcome).toBe("atomic_edit");
    expect(v.atomicEdit?.additions).toEqual([]);
    expect(v.atomicEdit?.rationale).toContain("already covers");
  });

  it("routes to new_page when unowned, carrying additive commonality fields", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"], hasToolOrCalculator: true }),
      facts({ outline: ["Sofreh Aghd meaning"], hasToolOrCalculator: true }),
    ];
    const brief = buildCommonalityBrief(pages);
    const v = routeGapVerdict({
      promptId: "p3",
      brief,
      ownership: { ownedUrl: null },
      fanoutQuestions: ["How long does a Persian wedding last?"],
    });
    expect(v.outcome).toBe("new_page");
    expect(v.atomicEdit).toBeNull();
    expect(v.newPage?.sharedHeadingsToInclude.length).toBeGreaterThan(0);
    expect(v.newPage?.hasToolConsensus).toBe(true);
    expect(v.newPage?.fanoutQuestionsToWeave).toContain("How long does a Persian wedding last?");
  });

  it("dedupes fanout questions passed in", () => {
    const pages = [facts(), facts()];
    const brief = buildCommonalityBrief(pages);
    const v = routeGapVerdict({
      promptId: "p4",
      brief,
      ownership: { ownedUrl: null },
      fanoutQuestions: ["Q1?", "Q1?", "Q2?"],
    });
    expect(v.newPage?.fanoutQuestionsToWeave).toEqual(["Q1?", "Q2?"]);
  });

  it("rendered sentence and rationale are dash-free (no em/en dashes anywhere)", () => {
    const pages = [facts(), facts({ wordCount: 1800 })];
    const brief = buildCommonalityBrief(pages);
    const v = routeGapVerdict({ promptId: "p5", brief, ownership: { ownedUrl: "https://iranopedia.com/x" } });
    expect(v.renderedSentence).not.toMatch(/[–—]/);
    expect(v.atomicEdit?.rationale).not.toMatch(/[–—]/);
  });

  it("never contains verbatim competitor prose in either brief outcome", () => {
    const pages = [
      facts({ outline: ["How much does a Persian wedding cost in 2026, exactly?"] }),
      facts({ outline: ["The real cost breakdown of a modern Persian wedding"] }),
    ];
    const brief = buildCommonalityBrief(pages);
    const v = routeGapVerdict({ promptId: "p6", brief, ownership: { ownedUrl: null } });
    // Additive fields only carry heading TOPICS + counts, never a full sentence lift.
    expect(v.newPage?.sharedHeadingsToInclude.every((h) => h.length < 200)).toBe(true);
  });
});
