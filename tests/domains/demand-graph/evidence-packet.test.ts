import { describe, it, expect } from "vitest";
import { buildEvidencePacket, type PageStructureFacts } from "@/domains/demand-graph/evidence-packet";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";

function move(p: Partial<MoveCandidate> & { gap: MoveCandidate["gap"] }): MoveCandidate {
  return {
    demandKey: p.demandKey ?? "https://iranopedia.com/x",
    label: p.label ?? "persian thing",
    gap: p.gap,
    score: p.score ?? 1000,
    components: p.components ?? { demand: 5000, winnability: 0.9, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: p.confidence ?? "high",
    signals: p.signals ?? ["GSC", "AI"],
    ownedUrl: p.ownedUrl ?? null,
    competitorUrls: p.competitorUrls ?? [],
    fanoutSeeds: p.fanoutSeeds ?? [],
    rationale: p.rationale ?? "",
  };
}

function cfacts(p: Partial<CompetitorPageFacts>): CompetitorPageFacts {
  return {
    canonicalUrl: null,
    title: p.title ?? "Competitor",
    metaDescription: p.metaDescription ?? null,
    h1: p.h1 ?? null,
    h2Count: p.h2Count ?? 0,
    h3Count: 0,
    outline: p.outline ?? [],
    schemaTypes: p.schemaTypes ?? [],
    hasFaq: p.hasFaq ?? false,
    faqQuestionCount: p.faqQuestionCount ?? 0,
    faqQuestions: p.faqQuestions ?? [],
    hasAnswerBlock: p.hasAnswerBlock ?? false,
    wordCount: p.wordCount ?? 0,
    sectionCount: p.sectionCount ?? 0,
    internalLinkCount: 0,
    externalLinkCount: 0,
    imageCount: 0,
    hasToolOrCalculator: p.hasToolOrCalculator ?? false,
    freshnessDate: null,
    ogTitle: null,
    ogType: null,
    topTerms: p.topTerms ?? [],
  };
}

function ofacts(p: Partial<PageStructureFacts>): PageStructureFacts {
  return {
    title: p.title ?? "Your page",
    metaDescription: "metaDescription" in p ? (p.metaDescription ?? null) : "a meta",
    h1: p.h1 ?? "Your H1",
    h2Count: p.h2Count ?? 5,
    outline: p.outline ?? [],
    schemaTypes: p.schemaTypes ?? [],
    hasFaq: p.hasFaq ?? false,
    hasAnswerBlock: false,
    wordCount: p.wordCount ?? 1000,
  };
}

describe("buildEvidencePacket — deterministic Source-of-Truth packet", () => {
  it("create_page: no owned page + competitor cited → missing_page + grounded outline + answer-block brief", () => {
    const p = buildEvidencePacket({
      move: move({
        gap: "create_page",
        label: "persian wedding",
        ownedUrl: null,
        competitorUrls: ["https://theknot.com/content/persian-wedding"],
        fanoutSeeds: ["what is a sofreh aghd", "persian wedding ceremony order"],
      }),
      brand: "Iranopedia",
      ownedFacts: null,
      ownedGsc: null,
      competitor: {
        url: "https://theknot.com/content/persian-wedding",
        domain: "theknot.com",
        fetchStatus: "ok",
        facts: cfacts({ outline: ["The Sofreh Aghd", "Ceremony Order"], wordCount: 1800, schemaTypes: ["Article"], hasAnswerBlock: true }),
      },
    });
    expect(p.gaps.some((g) => g.kind === "missing_page")).toBe(true);
    expect(p.draft.kind).toBe("deterministic_skeleton");
    expect(p.draft.titleSuggestion).toContain("Persian Wedding");
    expect(p.draft.titleSuggestion).toContain("Iranopedia");
    expect(p.draft.outline).toEqual(expect.arrayContaining(["The Sofreh Aghd", "what is a sofreh aghd"]));
    expect(p.draft.answerBlockBrief).toBeTruthy();
    expect(p.competitor.whatWins).toContain("answer block");
  });

  it("answer_block: owned page, AI cites competitor → missing_answer_block", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "answer_block", label: "iran flag", ownedUrl: "https://iranopedia.com/iran-flags", competitorUrls: ["https://surfiran.com/mag/x"] }),
      brand: "Iranopedia",
      ownedFacts: ofacts({ title: "Iran Flags", wordCount: 900 }),
      ownedGsc: { clicks: 50, impressions: 20000, ctr: 0.0025, position: 3 },
      competitor: { url: "https://surfiran.com/mag/x", domain: "surfiran.com", fetchStatus: "ok", facts: cfacts({ hasAnswerBlock: true, wordCount: 1200 }) },
    });
    expect(p.gaps.some((g) => g.kind === "missing_answer_block")).toBe(true);
    expect(p.draft.answerBlockBrief).toContain("iran flag");
  });

  it("edit_page: weak title/meta → weak_title + weak_meta", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "edit_page", label: "cities in iran", ownedUrl: "https://iranopedia.com/cities" }),
      brand: "Iranopedia",
      ownedFacts: ofacts({ title: "Cities", metaDescription: null, wordCount: 1200 }),
      ownedGsc: { clicks: 70, impressions: 16000, ctr: 0.004, position: 9 },
      competitor: null,
    });
    expect(p.gaps.some((g) => g.kind === "weak_title")).toBe(true);
    expect(p.gaps.some((g) => g.kind === "weak_meta")).toBe(true);
  });

  it("fix_experience: friction → ux_friction gap", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "fix_experience", label: "persian boy names", ownedUrl: "https://iranopedia.com/persian-boy-names", components: { demand: 44000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 72 } }),
      brand: "Iranopedia",
      ownedFacts: ofacts({}),
      ownedGsc: null,
      competitor: null,
    });
    expect(p.gaps.some((g) => g.kind === "ux_friction")).toBe(true);
  });

  it("thin content + missing schema vs a stronger competitor", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "edit_page", label: "persian holidays", ownedUrl: "https://iranopedia.com/persian-holidays" }),
      brand: "Iranopedia",
      ownedFacts: ofacts({ wordCount: 400, schemaTypes: [] }),
      ownedGsc: { clicks: 10, impressions: 4000, ctr: 0.0025, position: 8 },
      competitor: { url: "https://c.com/x", domain: "c.com", fetchStatus: "ok", facts: cfacts({ wordCount: 3000, h2Count: 20, schemaTypes: ["Article", "FAQPage"] }) },
    });
    expect(p.gaps.some((g) => g.kind === "thin_content")).toBe(true);
    expect(p.gaps.some((g) => g.kind === "missing_schema")).toBe(true);
    expect(p.draft.schemaRecommendations).toEqual(expect.arrayContaining(["Article", "FAQPage"]));
  });

  it("tool gap: competitor has a calculator → missing_tool + asset spec", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "create_page", label: "adu cost", ownedUrl: null, competitorUrls: ["https://c.com/calc"] }),
      brand: "Iranopedia",
      ownedFacts: null,
      ownedGsc: null,
      competitor: { url: "https://c.com/calc", domain: "c.com", fetchStatus: "ok", facts: cfacts({ hasToolOrCalculator: true }) },
    });
    expect(p.gaps.some((g) => g.kind === "missing_tool")).toBe(true);
    expect(p.draft.assetSpec).toBeTruthy();
  });

  it("evidenceHash is stable for identical inputs + changes with the facts", () => {
    const mk = (wc: number) =>
      buildEvidencePacket({
        move: move({ gap: "edit_page", label: "x", ownedUrl: "https://iranopedia.com/x" }),
        brand: "Iranopedia",
        ownedFacts: ofacts({ wordCount: 1000 }),
        ownedGsc: null,
        competitor: { url: "https://c.com/x", domain: "c.com", fetchStatus: "ok", facts: cfacts({ wordCount: wc }) },
      });
    expect(mk(2000).evidenceHash).toBe(mk(2000).evidenceHash); // stable
    expect(mk(2000).evidenceHash).not.toBe(mk(9000).evidenceHash); // changes with facts
  });

  it("never runs an LLM — draft is always a labeled deterministic skeleton", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "create_page", label: "x", competitorUrls: ["https://c.com/x"] }),
      brand: "Iranopedia",
      ownedFacts: null,
      ownedGsc: null,
      competitor: { url: "https://c.com/x", domain: "c.com", fetchStatus: "ok", facts: cfacts({}) },
    });
    expect(p.draft.kind).toBe("deterministic_skeleton");
    expect(p.draft.note.toLowerCase()).toContain("deterministic");
  });
});
