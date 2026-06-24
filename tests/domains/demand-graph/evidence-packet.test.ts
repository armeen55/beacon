import { describe, it, expect } from "vitest";
import { buildEvidencePacket, competitorRelevance, type PageStructureFacts } from "@/domains/demand-graph/evidence-packet";
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
        facts: cfacts({ title: "Persian Wedding Traditions", topTerms: ["persian", "wedding", "sofreh"], outline: ["The Sofreh Aghd", "Ceremony Order"], wordCount: 1800, schemaTypes: ["Article"], hasAnswerBlock: true }),
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
      competitor: { url: "https://c.com/x", domain: "c.com", fetchStatus: "ok", facts: cfacts({ title: "Persian Holidays Guide", topTerms: ["persian", "holidays"], wordCount: 3000, h2Count: 20, schemaTypes: ["Article", "FAQPage"] }) },
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
      competitor: { url: "https://c.com/calc", domain: "c.com", fetchStatus: "ok", facts: cfacts({ title: "ADU Cost Calculator", topTerms: ["adu", "cost"], hasToolOrCalculator: true }) },
    });
    expect(p.gaps.some((g) => g.kind === "missing_tool")).toBe(true);
    expect(p.draft.assetSpec).toBeTruthy();
    expect(p.draft.asset?.kind).toBe("calculator");
    expect(p.draft.asset?.buildPath.toLowerCase()).toContain("wix");
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

  it("relevance gate: an off-topic cited page is labeled, not inherited", () => {
    // "iran flag" cited a cultural-tours page (shares only "iran") → loosely matched.
    const p = buildEvidencePacket({
      move: move({ gap: "answer_block", label: "iran flag", ownedUrl: "https://iranopedia.com/iran-flag" }),
      brand: "Iranopedia",
      ownedFacts: ofacts({ wordCount: 800 }),
      ownedGsc: { clicks: 10, impressions: 500, ctr: 0.02, position: 8 },
      competitor: {
        url: "https://surfiran.com/mag/top-cultural-tours-in-iran/",
        domain: "surfiran.com",
        fetchStatus: "ok",
        facts: cfacts({
          title: "Top Cultural Tours in Iran",
          outline: ["Tehran: The Capital", "Isfahan", "Key Highlights"],
          schemaTypes: ["TravelAgency", "FAQPage"],
          hasFaq: true,
          faqQuestionCount: 8,
          wordCount: 4000,
          hasToolOrCalculator: true,
          topTerms: ["iran", "cultural", "tours", "tehran", "isfahan"],
        }),
      },
    });
    expect(p.competitor.looselyMatched).toBe(true);
    expect(p.competitor.relevance).toBeLessThan(0.6);
    expect(p.competitor.whatWins.toLowerCase()).toContain("loosely matched");
    expect(p.draft.outline).not.toContain("Tehran: The Capital");
    const kinds = p.gaps.map((g) => g.kind);
    expect(kinds).not.toContain("thin_content");
    expect(kinds).not.toContain("missing_schema");
    expect(kinds).not.toContain("missing_faq");
    expect(kinds).not.toContain("missing_tool");
  });

  it("relevance gate: an on-topic cited page IS inherited", () => {
    const p = buildEvidencePacket({
      move: move({ gap: "edit_page", label: "persian boy names", ownedUrl: "https://iranopedia.com/persian-boy-names" }),
      brand: "Iranopedia",
      ownedFacts: ofacts({ wordCount: 600, schemaTypes: [] }),
      ownedGsc: { clicks: 20, impressions: 2000, ctr: 0.01, position: 6 },
      competitor: {
        url: "https://teamgroupnames.com/300-persian-boy-names/",
        domain: "teamgroupnames.com",
        fetchStatus: "ok",
        facts: cfacts({
          title: "300+ Persian Boy Names with Meanings",
          outline: ["Classic Persian Names", "Nature-Inspired Persian Names"],
          schemaTypes: ["Article", "Person"],
          wordCount: 3600,
          topTerms: ["persian", "names", "name", "boy"],
        }),
      },
    });
    expect(p.competitor.looselyMatched).toBe(false);
    expect(p.competitor.relevance).toBeGreaterThanOrEqual(0.6);
    expect(p.draft.outline).toContain("Classic Persian Names");
    expect(p.gaps.map((g) => g.kind)).toContain("thin_content");
  });
});

describe("competitorRelevance — exact token match (audit wave 2 fix)", () => {
  const facts = (over: { title?: string; topTerms?: string[]; outline?: string[] }) => ({
    canonicalUrl: null, title: over.title ?? null, metaDescription: null, h1: null,
    h2Count: 0, h3Count: 0, outline: over.outline ?? [], schemaTypes: [], hasFaq: false,
    faqQuestionCount: 0, faqQuestions: [], hasAnswerBlock: false, wordCount: 0, sectionCount: 0,
    internalLinkCount: 0, externalLinkCount: 0, imageCount: 0, hasToolOrCalculator: false,
    freshnessDate: null, ogTitle: null, ogType: null, topTerms: over.topTerms ?? [],
  });

  it("does NOT count a substring collision (iran⊄irani, flag⊄flagship)", () => {
    const r = competitorRelevance("iran flag", facts({ title: "Irani Heritage", topTerms: ["flagship", "tourism"] }));
    expect(r).toBe(0);
  });

  it("counts exact tokens and tolerates simple plurals (flags≈flag, names≈name)", () => {
    expect(competitorRelevance("iran flags", facts({ topTerms: ["iran", "flag"] }))).toBe(1);
    expect(competitorRelevance("persian names", facts({ title: "A Persian Name List" }))).toBe(1);
  });

  it("returns 0 for null facts or token-less queries", () => {
    expect(competitorRelevance("iran flag", null)).toBe(0);
    expect(competitorRelevance("a x", facts({ topTerms: ["iran"] }))).toBe(0);
  });
});
