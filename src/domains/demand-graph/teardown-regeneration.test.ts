import { describe, it, expect } from "vitest";
import { competitorTeardownHints, hasUsableTeardown } from "./prepare-today-moves";
import { buildPreparedMovePack, toPersistedPack, parsePreparedPack, type RegenMeta } from "./prepared-move-pack";
import type { EvidencePacket } from "./evidence-packet";

// Minimal packet exposing only what the hint builder reads.
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

describe("competitorTeardownHints — thread real facts, beat-don't-copy", () => {
  it("emits grounded structure facts + the source URL + a do-not-copy instruction", () => {
    const hints = competitorTeardownHints(packetWith({}));
    const blob = hints.join("\n");
    expect(blob).toMatch(/parentcalc\.com/);
    expect(blob).toMatch(/637 words/);
    expect(blob).toMatch(/FAQ/);
    expect(blob).toMatch(/interactive tool/);
    expect(blob).toMatch(/2 schema type/);
    expect(blob).toMatch(/Persian Baby Names/); // title
    expect(blob).toMatch(/do not copy/i);
    expect(blob).toMatch(/https:\/\/parentcalc\.com\/baby-names\/persian/); // grounding source
  });
  it("returns nothing for a loosely-matched (off-topic) teardown", () => {
    expect(competitorTeardownHints(packetWith({ looselyMatched: true }))).toEqual([]);
    expect(hasUsableTeardown(packetWith({ looselyMatched: true }))).toBe(false);
  });
  it("returns nothing when the fetch failed or facts are absent", () => {
    expect(competitorTeardownHints(packetWith({ fetchStatus: "http_error" as never }))).toEqual([]);
    expect(competitorTeardownHints(packetWith({ facts: null }))).toEqual([]);
    expect(hasUsableTeardown(packetWith({ facts: null }))).toBe(false);
  });
});

describe("PreparedMovePack regenMeta — persists + round-trips (no migration)", () => {
  const meta: RegenMeta = {
    regeneratedFromTeardown: true, competitorUrl: "https://x.com/p", competitorDomain: "x.com",
    previousQuality: "too_thin", newQuality: "ready", costUsd: 0.011, source: "gpt-5-mini",
    previousExcerpt: "old draft text", regeneratedAt: "2026-06-28T00:00:00.000Z",
  };
  // A minimal valid pack the parser accepts (version/moveId/routerDecision present).
  const base = {
    version: 1 as const, tenantId: "t", moveId: "m1", moveType: "answer_block", parentType: "aeo_move",
    targetUrl: null, proposedSlug: null, primaryQuery: "q", secondaryQueries: [], specialistOpinions: [],
    routerDecision: { action: "add_answer_block", confidenceLevel: "high", rationale: "r" }, proofPlan: { metrics: [], windowsDays: [7], controls: "" },
    structuredDraft: { kind: "answer_block", value: { answer: "a" } }, experiment: null, implementationChecklist: [],
    costSpent: { llmUsd: 0.011, serpUsd: 0 }, confidence: "high", evidenceHash: "h", generatedAt: "2026-06-28T00:00:00.000Z",
    staleAt: "2026-07-12T00:00:00.000Z", preparedStatus: "ready_to_review",
  };
  it("preserves regenMeta through serialize → parse", () => {
    const parsed = parsePreparedPack(toPersistedPack({ ...base, regenMeta: meta } as never));
    expect(parsed?.regenMeta?.regeneratedFromTeardown).toBe(true);
    expect(parsed?.regenMeta?.competitorDomain).toBe("x.com");
    expect(parsed?.regenMeta?.previousQuality).toBe("too_thin");
    expect(parsed?.regenMeta?.newQuality).toBe("ready");
  });
  it("is absent on a normal (non-regenerated) pack", () => {
    const parsed = parsePreparedPack(toPersistedPack(base as never));
    expect(parsed?.regenMeta).toBeUndefined();
  });
});

import { canAffordDraft } from "./prepare-today-moves";

describe("canAffordDraft — hard per-run $ cap predicate", () => {
  it("affords when projection still fits under the cap", () => {
    expect(canAffordDraft(0.05, 0.02, 0.1)).toBe(true);
    expect(canAffordDraft(0.0, 0.03, 0.1)).toBe(true);
    expect(canAffordDraft(0.08, 0.02, 0.1)).toBe(true); // exactly at the cap is allowed
  });
  it("refuses to START a draft that would push spend over the cap", () => {
    expect(canAffordDraft(0.09, 0.02, 0.1)).toBe(false);
    expect(canAffordDraft(0.1, 0.02, 0.1)).toBe(false); // already at cap
  });
  it("always affords when no cap is set (Infinity = legacy prepare path)", () => {
    expect(canAffordDraft(999, 0.03, Infinity)).toBe(true);
  });
});
