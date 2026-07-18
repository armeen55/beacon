import { describe, expect, it } from "vitest";

import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { KeywordLibrary } from "./keyword-library";
import type { ResearchCorpus } from "./research-dossier";
import {
  buildResearchDossier,
  dossierReferenceCandidates,
  researchDossierHints,
} from "./research-dossier";

const move = (): MoveCandidate => ({
  demandKey: "https://iranopedia.com/nowruz",
  label: "nowruz traditions",
  gap: "answer_block",
  score: 900,
  components: { demand: 1200, winnability: 0.7, dollarValue: 0, visibilityGap: 1, friction: 0 },
  confidence: "high",
  signals: ["GSC", "AI"],
  ownedUrl: "https://iranopedia.com/nowruz",
  competitorUrls: ["https://winner.example/nowruz-guide"],
  fanoutSeeds: ["when is nowruz 2027"],
  rationale: "real demand and AI citation gap",
  aeoEvidence: {
    source: "profound",
    prompts: ["what are nowruz traditions"],
    promptCount: 8,
    fanoutQueries: ["what happens at haft sin"],
    topCitedPages: [
      { url: "https://winner.example/nowruz-guide", hostname: "winner.example", isOwned: false, answers: 5 },
    ],
    topCitedDomains: [{ hostname: "winner.example", answers: 5 }],
    ownCitationCount: 0,
    competitorCitationCount: 9,
    recommendedContentShape: "direct answer plus guide",
    confidence: "high",
    matchBasis: "same competitors and subject",
  },
});
const keywordLibrary = (): KeywordLibrary => ({
  rows: [
    {
      keyword: "nowruz traditions",
      searchesPerMo: 1900,
      timesShownPerMo: 1200,
      clicks: 90,
      yourPosition: 8.4,
      difficulty: 31,
      trend: "seasonal",
      ownerPage: "https://iranopedia.com/nowruz",
      ownerPageHref: "/page/nowruz",
      competitorOwners: ["winner.example"],
      relatedQuestions: ["what is haft sin"],
      sources: ["gsc", "dataforseo_demand", "dataforseo_difficulty", "serp_history"],
      lastChecked: "2026-07-14T00:00:00.000Z",
    },
    {
      keyword: "best plumbing company",
      searchesPerMo: 5000,
      timesShownPerMo: null,
      clicks: null,
      yourPosition: null,
      difficulty: 50,
      trend: null,
      ownerPage: null,
      ownerPageHref: null,
      competitorOwners: [],
      relatedQuestions: [],
      sources: ["dataforseo_demand"],
      lastChecked: "2026-07-14T00:00:00.000Z",
    },
  ],
  volumeCoverage: 2,
  total: 2,
  bySource: {
    gsc: 1,
    dataforseo_demand: 2,
    dataforseo_difficulty: 1,
    keyword_gap: 0,
    serp_history: 1,
    trend_radar: 0,
  },
});

function corpus(): ResearchCorpus {
  return {
    keywordLibrary: keywordLibrary(),
    serpPatterns: new Map([
      ["nowruz traditions", {
        query: "nowruz traditions",
        format: "guide",
        titlePattern: "guide / explainer titles",
        modifiers: ["guide"],
        winningDomains: ["winner.example", "history.example"],
        elementImplication: "open with a direct answer, then sectioned H2s (a proper guide)",
        fetchedAt: "2026-07-14T00:00:00.000Z",
      }],
    ]),
    cloneBriefs: [{
      url: "https://winner.example/nowruz-guide",
      competitorDomain: "winner.example",
      trafficWeight: 5000,
      whatWins: "a direct answer and a structured ceremony guide",
      teardownStatus: "torn_down",
      demand: [{ keyword: "nowruz traditions", volume: 1900 }],
      coverageGaps: ["haft", "sin"],
      buildPointer: { label: "nowruz traditions", reason: "the competitor owns the demand" },
      summary: "winner.example owns this query with a direct answer and structured guide.",
    }],
    questions: [{
      tenant_id: "tenant-iranopedia",
      id: "uq-1",
      question: "what happens at haft sin",
      variants: [],
      sources: ["ai_fanout", "paa"],
      gscImpressions: 0,
      gscClicks: 0,
      fanoutWeight: 4,
      paaSeen: true,
      inNativeLibrary: true,
      demandScore: 140,
      ownership: "https://iranopedia.com/nowruz",
      coverageStatus: "not_answered",
      coverageDetail: "The page does not answer this yet.",
      priority: 140,
      builtAt: "2026-07-14T00:00:00.000Z",
    }],
    citationIntelligence: {
      tenantId: "tenant-iranopedia",
      computedAt: "2026-07-14T00:00:00.000Z",
      patterns: {
        tenant_id: "tenant-iranopedia",
        computed_at: "2026-07-14T00:00:00.000Z",
        observationsWithCitations: 20,
        observationsWithText: 18,
        sentencesClassified: 14,
        bucketCounts: { stat_first: 7, definition: 4, attributed_claim: 3, list_lead: 0, date_anchored: 0, other: 0 },
        bucketSharePct: { stat_first: 50, definition: 29, attributed_claim: 21, list_lead: 0, date_anchored: 0, other: 0 },
        dominantPatterns: ["stat_first", "definition", "attributed_claim"],
      },
      drift: {
        coverage: { pairsWithHistory: 4, pairsComparable: 3, observationsConsidered: 12 },
        events: [{
          promptText: "what are nowruz traditions",
          engine: "ChatGPT",
          kind: "brand_dropped",
          beforeSentence: "Iranopedia explained Nowruz traditions.",
          afterSentence: null,
          whenIso: "2026-07-14T00:00:00.000Z",
          relatedMoveLabel: "nowruz traditions",
        }],
      },
      secondOrder: {
        rowsScanned: 50,
        domains: [{
          domain: "culture-directory.example",
          class: "directory",
          isOutreachTarget: true,
          citationCount: 12,
          topTopics: ["nowruz traditions guide"],
          exampleCitedUrl: "https://culture-directory.example/directory/nowruz",
          examplePrompt: "What are Nowruz traditions?",
          suggestedAction: "Add a listing.",
          outreach: { inOutreachPipeline: false },
        }],
      },
    },
  };
}

describe("buildResearchDossier", () => {
  it("converges keyword, SERP, AI, citation, competitor and question evidence for one move", () => {
    const dossier = buildResearchDossier({
      tenantId: "tenant-iranopedia",
      move: move(),
      demandQueries: [{ query: "nowruz traditions", impressions: 1200 }],
      corpus: corpus(),
      nowIso: "2026-07-14T12:00:00.000Z",
    });

    expect(dossier.keywords.map((row) => row.query)).toEqual(["nowruz traditions"]);
    expect(dossier.serpPatterns).toHaveLength(1);
    expect(dossier.cloneBriefs).toHaveLength(1);
    expect(dossier.questions.map((row) => row.question)).toContain("what happens at haft sin");
    expect(dossier.ai?.promptCount).toBe(8);
    expect(dossier.evidenceSources).toEqual(expect.arrayContaining([
      "gsc",
      "keyword_volume",
      "keyword_difficulty",
      "live_serp",
      "ai_answers",
      "ai_citations",
      "ai_fanout",
      "competitor_teardown",
      "paa",
      "citation_patterns",
      "answer_drift",
      "second_order_citations",
    ]));
    expect(dossierReferenceCandidates(dossier)).toEqual([
      "https://winner.example/nowruz-guide",
      "https://culture-directory.example/directory/nowruz",
    ]);
    expect(researchDossierHints(dossier).join(" ")).toContain("1,900 searches/month");
    expect(researchDossierHints(dossier).join(" ")).toContain("Live Google results");
    expect(researchDossierHints(dossier).join(" ")).toContain("AI evidence");
    expect(researchDossierHints(dossier).join(" ")).toContain("Competitor reverse-engineering");
    expect(researchDossierHints(dossier).join(" ")).toContain("Observed citation phrasing");
    expect(researchDossierHints(dossier).join(" ")).toContain("brand dropped");
    expect(researchDossierHints(dossier).join(" ")).toContain("Second-order citation evidence");
  });

  it("drops an unrelated AI fanout even when the parent topic has valid native evidence", () => {
    const m = move();
    m.label = "iran natural attractions";
    m.aeoEvidence = {
      ...m.aeoEvidence!,
      source: "native",
      prompts: ["what are iran natural attractions"],
      fanoutQueries: ["what are the most beautiful words in the persian language"],
      winnerConsensus: {
        sourceCount: 3,
        sharedHeadings: ["Natural wonders", "Mountains and deserts"],
        answerShape: "guide",
        wordBand: { low: 1000, high: 1800, median: 1400 },
        schemaTypes: ["Article"],
        openingPattern: "direct_definition",
        hasFaqConsensus: false,
        hasToolConsensus: false,
      },
    };
    const dossier = buildResearchDossier({
      tenantId: "tenant-iranopedia",
      move: m,
      demandQueries: [],
      corpus: { keywordLibrary: keywordLibrary(), serpPatterns: new Map(), cloneBriefs: [], questions: [] },
      nowIso: "2026-07-14T00:00:00.000Z",
    });
    expect(dossier.ai?.fanoutQueries).toEqual([]);
    expect(dossier.evidenceSources).not.toContain("ai_fanout");
  });

  it("does not mix unrelated high-volume research into the move", () => {
    const dossier = buildResearchDossier({
      tenantId: "tenant-iranopedia",
      move: move(),
      demandQueries: [{ query: "nowruz traditions", impressions: 1200 }],
      corpus: corpus(),
      nowIso: "2026-07-14T12:00:00.000Z",
    });
    expect(dossier.keywords.some((row) => row.query === "best plumbing company")).toBe(false);
  });

  it("keeps the evidence hash stable across timestamps but changes it when material facts change", () => {
    const firstCorpus = corpus();
    const first = buildResearchDossier({
      tenantId: "tenant-iranopedia",
      move: move(),
      demandQueries: [{ query: "nowruz traditions", impressions: 1200 }],
      corpus: firstCorpus,
      nowIso: "2026-07-14T12:00:00.000Z",
    });
    firstCorpus.keywordLibrary.rows[0]!.lastChecked = "2026-07-15T00:00:00.000Z";
    firstCorpus.serpPatterns.get("nowruz traditions")!.fetchedAt = "2026-07-15T00:00:00.000Z";
    const timestampOnly = buildResearchDossier({
      tenantId: "tenant-iranopedia",
      move: move(),
      demandQueries: [{ query: "nowruz traditions", impressions: 1200 }],
      corpus: firstCorpus,
      nowIso: "2026-07-15T12:00:00.000Z",
    });
    expect(timestampOnly.evidenceHash).toBe(first.evidenceHash);

    firstCorpus.keywordLibrary.rows[0]!.searchesPerMo = 2900;
    const changed = buildResearchDossier({
      tenantId: "tenant-iranopedia",
      move: move(),
      demandQueries: [{ query: "nowruz traditions", impressions: 1200 }],
      corpus: firstCorpus,
      nowIso: "2026-07-15T12:00:00.000Z",
    });
    expect(changed.evidenceHash).not.toBe(first.evidenceHash);
  });
});
