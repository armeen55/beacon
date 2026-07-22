/**
 * COMPETITOR TEARDOWN COMMONALITY + VERDICT (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/demand-graph/teardown-commonality.test.ts
 *   src/domains/demand-graph/teardown-commonality-verdict.test.ts
 *   src/domains/demand-graph/teardown-regeneration.test.ts
 * Pins kept: N20 3-of-5 consensus with single-winner outliers never copied,
 * no fabricated consensus below 2 sources, no verbatim competitor prose,
 * dash-free rendered copy, hard per-run draft $ cap predicate.
 */
import { describe, it, expect } from "vitest";
import {
  buildCommonalityBrief,
  extractSharedHeadings,
  commonalitySentence,
  consensusOf,
  CONSENSUS_MIN_WINNERS,
} from "@/domains/demand-graph/teardown-commonality";
import { routeGapVerdict } from "@/domains/demand-graph/teardown-commonality-verdict";
import {
  competitorTeardownHints,
  hasUsableTeardown,
  canAffordDraft,
} from "@/domains/demand-graph/prepare-today-moves";
import {
  toPersistedPack,
  parsePreparedPack,
  type RegenMeta,
} from "@/domains/demand-graph/prepared-move-pack";
import type { CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

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
    const pages = [
      facts({ outline: ["Sofreh Aghd explained", "Wedding costs", "Guest etiquette"] }),
      facts({ outline: ["What is Sofreh Aghd?", "Average wedding cost", "Timeline"] }),
      facts({ outline: ["History", "Sofreh Aghd meaning", "Guest etiquette tips"] }),
    ];
    const shared = extractSharedHeadings(pages);
    const sofreh = shared.find((s) => s.label.toLowerCase().includes("sofreh"));
    expect(sofreh?.winners).toBe(3);
  });

  it("does NOT include a heading only one page has (no consensus)", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"] }),
      facts({ outline: ["Sofreh Aghd meaning"] }),
      facts({ outline: ["A totally unrelated one-off section about shoes"] }),
    ];
    expect(extractSharedHeadings(pages).some((s) => s.label.toLowerCase().includes("shoes"))).toBe(false);
  });
});

describe("buildCommonalityBrief", () => {
  it("returns null with fewer than 2 usable teardown facts (never fabricates a consensus)", () => {
    expect(buildCommonalityBrief([facts()])).toBeNull();
    expect(buildCommonalityBrief([])).toBeNull();
    expect(buildCommonalityBrief([null, undefined])).toBeNull();
  });

  it("filters null entries before counting sources and caps at 5 sources", () => {
    expect(buildCommonalityBrief([facts(), null, facts(), undefined])?.sourceCount).toBe(2);
    expect(buildCommonalityBrief(Array.from({ length: 6 }, () => facts()))?.sourceCount).toBe(5);
  });

  it("computes a word-count band around the median, not one competitor's exact count", () => {
    const brief = buildCommonalityBrief([facts({ wordCount: 1000 }), facts({ wordCount: 1400 }), facts({ wordCount: 1800 })]);
    expect(brief!.wordBand.median).toBe(1400);
    expect(brief!.wordBand.low).toBeLessThanOrEqual(1400);
    expect(brief!.wordBand.high).toBeGreaterThanOrEqual(1400);
  });

  it("answerShape: FAQ wins when a majority of pages have 3+ FAQ questions", () => {
    const brief = buildCommonalityBrief([
      facts({ hasFaq: true, faqQuestionCount: 4, hasAnswerBlock: false }),
      facts({ hasFaq: true, faqQuestionCount: 5, hasAnswerBlock: false }),
      facts({ hasFaq: false, faqQuestionCount: 0, hasAnswerBlock: true }),
    ]);
    expect(brief!.answerShape).toBe("faq");
  });

  it("whatTheyAllHaveThatWeDont flags a missing FAQ vs our own page and stays empty when covered", () => {
    const pages = [facts({ hasFaq: true, faqQuestionCount: 4 }), facts({ hasFaq: true, faqQuestionCount: 5 })];
    const gap = buildCommonalityBrief(pages, { ownedFacts: facts({ hasFaq: false, faqQuestionCount: 0 }) });
    expect(gap!.whatTheyAllHaveThatWeDont.some((s) => /FAQ/i.test(s))).toBe(true);

    const covered = buildCommonalityBrief(
      [
        facts({ outline: ["Sofreh Aghd explained"], hasFaq: true, faqQuestionCount: 3, schemaTypes: ["FAQPage"], wordCount: 1000 }),
        facts({ outline: ["Sofreh Aghd meaning"], hasFaq: true, faqQuestionCount: 3, schemaTypes: ["FAQPage"], wordCount: 1000 }),
      ],
      {
        ownedFacts: facts({
          outline: ["Sofreh Aghd deep dive"], hasFaq: true, faqQuestionCount: 3,
          schemaTypes: ["FAQPage"], wordCount: 1500, hasAnswerBlock: true,
        }),
      },
    );
    expect(covered!.whatTheyAllHaveThatWeDont).toEqual([]);
  });

  it("never includes verbatim competitor prose, only shape/counts/heading topics", () => {
    const brief = buildCommonalityBrief([
      facts({ outline: ["How much does a Persian wedding cost in 2026?"] }),
      facts({ outline: ["Persian wedding cost breakdown for 2026"] }),
    ]);
    for (const h of brief!.sharedHeadings) expect(h.label.length).toBeLessThan(200);
  });
});

describe("consensusOf (N20: 3-of-5 consensus, single-winner outliers)", () => {
  it("an element on 3+ of the top 5 winners becomes consensus", () => {
    const pages = [
      facts({ hasAnswerBlock: true, hasFaq: false }),
      facts({ hasAnswerBlock: true, hasFaq: false }),
      facts({ hasAnswerBlock: true, hasFaq: false }),
      facts({ hasAnswerBlock: false, hasFaq: false }),
      facts({ hasAnswerBlock: false, hasFaq: false }),
    ];
    const spec = consensusOf(pages)!;
    expect(spec.consensus.answerBlock).toBe(true);
    expect(spec.votes.answer_block).toBe(3);
  });

  it("PIN: an element present on only ONE winner is an outlier, never consensus", () => {
    const pages = [
      facts({ hasFaq: true, faqQuestionCount: 4 }),
      facts({ hasFaq: false }), facts({ hasFaq: false }), facts({ hasFaq: false }), facts({ hasFaq: false }),
    ];
    const spec = consensusOf(pages)!;
    expect(spec.consensus.faq).toBe(false);
    expect(spec.outliers).toContain("faq");
  });

  it("returns null below CONSENSUS_MIN_WINNERS usable teardowns; brief stays honestly null at 2", () => {
    expect(CONSENSUS_MIN_WINNERS).toBe(3);
    expect(consensusOf([facts(), facts()])).toBeNull();
    const two = buildCommonalityBrief([facts(), facts()]);
    expect(two).not.toBeNull();
    expect(two!.consensusSpec).toBeNull();
  });
});

describe("commonalitySentence", () => {
  it("renders a plain-language, dash-free sentence with real numbers", () => {
    const brief = buildCommonalityBrief([
      facts({ outline: ["Sofreh Aghd explained"], hasFaq: true, faqQuestionCount: 4, wordCount: 1200 }),
      facts({ outline: ["Sofreh Aghd meaning"], hasFaq: true, faqQuestionCount: 5, wordCount: 1400 }),
    ])!;
    const sentence = commonalitySentence(brief);
    expect(sentence).toContain("2 of the top pages");
    expect(sentence).not.toMatch(/[–—]/);
  });
});

describe("routeGapVerdict", () => {
  it("no_verdict when brief is null (fewer than 2 usable teardowns)", () => {
    const v = routeGapVerdict({ promptId: "p1", brief: null, ownership: { ownedUrl: null } });
    expect(v.outcome).toBe("no_verdict");
    expect(v.atomicEdit).toBeNull();
    expect(v.newPage).toBeNull();
  });

  it("routes to atomic_edit when we own a matching page, listing missing shared elements", () => {
    const pages = [
      facts({ outline: ["Sofreh Aghd explained"], hasFaq: true, faqQuestionCount: 4 }),
      facts({ outline: ["Sofreh Aghd meaning"], hasFaq: true, faqQuestionCount: 5 }),
    ];
    const brief = buildCommonalityBrief(pages, { ownedFacts: facts({ outline: ["Introduction only"] }) });
    const v = routeGapVerdict({
      promptId: "p1", brief, ownership: { ownedUrl: "https://iranopedia.com/persian-wedding" },
      fanoutQuestions: ["What is Sofreh Aghd made of?"],
    });
    expect(v.outcome).toBe("atomic_edit");
    expect(v.atomicEdit?.additions.length).toBeGreaterThan(0);
    expect(v.atomicEdit?.fanoutQuestionsToWeave).toContain("What is Sofreh Aghd made of?");
    expect(v.newPage).toBeNull();
  });

  it("routes to new_page when unowned and dedupes fanout questions", () => {
    const brief = buildCommonalityBrief([
      facts({ outline: ["Sofreh Aghd explained"], hasToolOrCalculator: true }),
      facts({ outline: ["Sofreh Aghd meaning"], hasToolOrCalculator: true }),
    ]);
    const v = routeGapVerdict({
      promptId: "p3", brief, ownership: { ownedUrl: null },
      fanoutQuestions: ["Q1?", "Q1?", "Q2?"],
    });
    expect(v.outcome).toBe("new_page");
    expect(v.newPage?.hasToolConsensus).toBe(true);
    expect(v.newPage?.fanoutQuestionsToWeave).toEqual(["Q1?", "Q2?"]);
  });

  it("rendered sentence and rationale are dash-free", () => {
    const brief = buildCommonalityBrief([facts(), facts({ wordCount: 1800 })]);
    const v = routeGapVerdict({ promptId: "p5", brief, ownership: { ownedUrl: "https://iranopedia.com/x" } });
    expect(v.renderedSentence).not.toMatch(/[–—]/);
    expect(v.atomicEdit?.rationale).not.toMatch(/[–—]/);
  });

  it("N20 PIN: a single-winner outlier element is NEVER copied into either brief outcome", () => {
    const pages = [
      facts({ hasFaq: true, faqQuestionCount: 5, schemaTypes: ["FAQPage"], outline: ["Sofreh Aghd explained", "A one-off quiz section"] }),
      facts({ hasFaq: false, faqQuestionCount: 0, schemaTypes: [], outline: ["Sofreh Aghd meaning"] }),
      facts({ hasFaq: false, faqQuestionCount: 0, schemaTypes: [], outline: ["Sofreh Aghd history"] }),
      facts({ hasFaq: false, faqQuestionCount: 0, schemaTypes: [], outline: ["Sofreh Aghd items"] }),
      facts({ hasFaq: false, faqQuestionCount: 0, schemaTypes: [], outline: ["Sofreh Aghd table setup"] }),
    ];
    const unowned = routeGapVerdict({ promptId: "p7", brief: buildCommonalityBrief(pages), ownership: { ownedUrl: null } });
    expect(unowned.newPage?.consensusSpec?.outliers).toContain("faq");
    expect(unowned.newPage?.hasFaqConsensus).toBe(false);
    expect(unowned.newPage?.schemaTypesToInclude).toEqual([]);
    expect(unowned.newPage?.sharedHeadingsToInclude.some((h) => /quiz/i.test(h))).toBe(false);

    const owned = routeGapVerdict({
      promptId: "p8",
      brief: buildCommonalityBrief(pages, { ownedFacts: facts({ outline: ["Intro"] }) }),
      ownership: { ownedUrl: "https://iranopedia.com/sofreh-aghd" },
    });
    expect(owned.atomicEdit?.additions.some((a) => /FAQ/i.test(a))).toBe(false);
    expect(owned.atomicEdit?.consensusSpec?.outliers).toContain("faq");
  });
});

// ── teardown hints + regen meta + draft $ cap (from teardown-regeneration) ──

function packetWith(competitor: Partial<EvidencePacket["competitor"]>): EvidencePacket {
  return {
    competitor: {
      topUrl: "https://parentcalc.com/baby-names/persian",
      domain: "parentcalc.com",
      fetchStatus: "ok",
      looselyMatched: false,
      whatWins: "",
      relevance: 1,
      facts: {
        canonicalUrl: null, title: "Persian Baby Names: Meanings & Origins", metaDescription: null, h1: "Persian Names",
        h2Count: 8, h3Count: 0, outline: ["Boy names", "Girl names", "By meaning"], schemaTypes: ["FAQPage", "Article"],
        hasFaq: true, faqQuestionCount: 6, faqQuestions: ["What are common Persian boy names?", "What do they mean?"],
        hasAnswerBlock: true, wordCount: 637, sectionCount: 8, internalLinkCount: 10, externalLinkCount: 2,
        imageCount: 4, hasToolOrCalculator: true, freshnessDate: null, ogTitle: null, ogType: null, topTerms: [],
      },
      ...competitor,
    },
  } as unknown as EvidencePacket;
}

describe("competitorTeardownHints: thread real facts, beat-don't-copy", () => {
  it("emits grounded structure facts + the source URL + a do-not-copy instruction", () => {
    const blob = competitorTeardownHints(packetWith({})).join("\n");
    expect(blob).toMatch(/parentcalc\.com/);
    expect(blob).toMatch(/637 words/);
    expect(blob).toMatch(/do not copy/i);
    expect(blob).toMatch(/https:\/\/parentcalc\.com\/baby-names\/persian/);
  });

  it("returns nothing for loosely-matched, failed-fetch, or factless teardowns", () => {
    expect(competitorTeardownHints(packetWith({ looselyMatched: true }))).toEqual([]);
    expect(hasUsableTeardown(packetWith({ looselyMatched: true }))).toBe(false);
    expect(competitorTeardownHints(packetWith({ fetchStatus: "http_error" as never }))).toEqual([]);
    expect(competitorTeardownHints(packetWith({ facts: null }))).toEqual([]);
  });
});

describe("PreparedMovePack regenMeta round-trip", () => {
  const meta: RegenMeta = {
    regeneratedFromTeardown: true, competitorUrl: "https://x.com/p", competitorDomain: "x.com",
    previousQuality: "too_thin", newQuality: "ready", costUsd: 0.011, source: "gpt-5-mini",
    previousExcerpt: "old draft text", regeneratedAt: "2026-06-28T00:00:00.000Z",
  };
  const base = {
    version: 1 as const, tenantId: "t", moveId: "m1", moveType: "answer_block", parentType: "aeo_move",
    targetUrl: null, proposedSlug: null, primaryQuery: "q", secondaryQueries: [], specialistOpinions: [],
    routerDecision: { action: "add_answer_block", confidenceLevel: "high", rationale: "r" }, proofPlan: { metrics: [], windowsDays: [7], controls: "" },
    structuredDraft: { kind: "answer_block", value: { answer: "a" } }, experiment: null, implementationChecklist: [],
    costSpent: { llmUsd: 0.011, serpUsd: 0 }, confidence: "high", evidenceHash: "h", generatedAt: "2026-06-28T00:00:00.000Z",
    staleAt: "2026-07-12T00:00:00.000Z", preparedStatus: "ready_to_review",
  };
  it("preserves regenMeta through serialize > parse and is absent on a normal pack", () => {
    const parsed = parsePreparedPack(toPersistedPack({ ...base, regenMeta: meta } as never));
    expect(parsed?.regenMeta?.regeneratedFromTeardown).toBe(true);
    expect(parsed?.regenMeta?.previousQuality).toBe("too_thin");
    expect(parsePreparedPack(toPersistedPack(base as never))?.regenMeta).toBeUndefined();
  });
});

describe("canAffordDraft: hard per-run $ cap predicate", () => {
  it("affords under the cap, refuses past it, always affords with no cap", () => {
    expect(canAffordDraft(0.05, 0.02, 0.1)).toBe(true);
    expect(canAffordDraft(0.08, 0.02, 0.1)).toBe(true); // exactly at the cap
    expect(canAffordDraft(0.09, 0.02, 0.1)).toBe(false);
    expect(canAffordDraft(0.1, 0.02, 0.1)).toBe(false);
    expect(canAffordDraft(999, 0.03, Infinity)).toBe(true);
  });
});
