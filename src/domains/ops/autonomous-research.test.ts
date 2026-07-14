import { describe, expect, it, vi } from "vitest";

import {
  runAutonomousResearchForTenant,
  type AutonomousResearchDeps,
} from "./autonomous-research";

const TENANT = "tenant-iranopedia";
const NOW = new Date("2026-07-13T18:00:00.000Z");

function deps(calls: string[]): AutonomousResearchDeps {
  return {
    refreshGraph: vi.fn(async () => { calls.push("graph"); }),
    auditCompetitors: vi.fn(async () => {
      calls.push("competitors");
      return { audited: 8, targets: 10, cached: 2 };
    }),
    mineCompetitorKeywords: vi.fn(async () => {
      calls.push("gaps");
      return {
        status: "ok" as const,
        competitors: ["a.example", "b.example"],
        ownDomain: "iranopedia.com",
        calls: [],
        spentUsd: 0.11,
        plannedUsd: 0,
        cacheHits: 1,
        gapsFound: 120,
        gaps: [],
        moneyPagesFound: 10,
        cloneBriefs: [{} as never, {} as never, {} as never],
        message: "done",
      };
    }),
    buildResearchPacks: vi.fn(async () => {
      calls.push("packs");
      return [{ url: "https://example.com/a", primaryIntent: "best singers", own: ["singers"], sibling: ["artists"] }];
    }),
    enrichResearch: vi.fn(async () => {
      calls.push("keywords");
      return {
        mode: "live" as const,
        configured: true,
        plan: {
          volumeTerms: ["singers", "artists"],
          volumeCached: [],
          volumeMissing: ["singers", "artists"],
          serpTerms: ["best singers"],
          serpCached: [],
          serpMissing: ["best singers"],
          volumeCalls: 1,
          serpCalls: 1,
          estUsd: 0.083,
        },
        patternsWritten: 1,
        spentUsd: 0.083,
      };
    }),
    pollAiEngines: vi.fn(async () => {
      calls.push("engines");
      return {
        tenantId: TENANT,
        date: "2026-07-13",
        status: "ok" as const,
        promptsRequested: 25,
        engines: [{ engine: "gemini" as const, status: "ok" as const, answers: 10, citedYou: 2, costUsd: 0.03, detail: "checked" }],
        observationsWritten: 40,
        enginesChecked: ["chatgpt", "perplexity"] as Array<"chatgpt" | "perplexity">,
        gaps: 8,
        detail: "checked",
      };
    }),
    pollAiTopics: vi.fn(async () => {
      calls.push("ai");
      return { tenantId: TENANT, status: "ok" as const, topics: ["singers"], records: 4, costUsd: 0.01, detail: "ok" };
    }),
    rebuildQuestions: vi.fn(async () => {
      calls.push("questions");
      return {
        tenantId: TENANT,
        rows: 50,
        uncovered: 12,
        stats: {
          total: 50,
          bySource: { gsc: 20, ai_fanout: 15, native_poll: 10, paa: 5 },
          answered: 30,
          partial: 8,
          notAnswered: 12,
          unchecked: 0,
          mergedAway: 3,
        },
      };
    }),
    rebuildClaims: vi.fn(async () => {
      calls.push("claims");
      return { tenantId: TENANT, claims: 35, conflicting: 2, consistent: 20, unverified: 13 };
    }),
    rebuildInternalAuthority: vi.fn(async () => {
      calls.push("authority");
      return { tenantId: TENANT, pages: 90, orphaned: 7, edges: 300 };
    }),
    checkDisplacement: vi.fn(async () => {
      calls.push("loss");
      return { checked: 2, cached: 0, skippedRecent: 0, skippedNoBudget: 0, costUsd: 0.006, verdicts: [] };
    }),
    runStealLane: vi.fn(async () => {
      calls.push("steal");
      return {
        beatenKeywordsFound: 5,
        storedSerpHits: 3,
        livePullsUsed: 2,
        liveCostUsd: 0.006,
        briefsBuilt: 4,
        teardownsTorndown: 4,
        briefs: [],
      };
    }),
    runNativeTeardown: vi.fn(async () => {
      calls.push("native");
      return { promptsAnalyzed: 3, torndownPages: 7, fromCache: 2, verdicts: [], results: [] };
    }),
    completeFinalKeywordDemand: vi.fn(async () => {
      calls.push("final-keywords");
      return { status: "ok" as const, candidates: 12, missing: 8, checked: 8, withVolume: 7, costUsd: 0.075 };
    }),
    prepareMoves: vi.fn(async () => {
      calls.push("prepare");
      return {
        considered: 10,
        prepared: 6,
        readyToReview: 5,
        draftReady: 1,
        cached: 2,
        failed: 0,
        regenerated: 2,
        stoppedForBudget: false,
        llmCostUsd: 0.04,
        winnabilityHeld: 0,
        serpCostUsd: 0.003,
        outcomes: [],
      };
    }),
    finishSurfaces: vi.fn(async (tenantId, now, acquired) => {
      calls.push("fuse");
      await acquired.prepare(tenantId, now);
      calls.push("today");
      return {
        tenant_id: tenantId,
        date: "2026-07-13",
        ran_at: now.toISOString(),
        ok: true,
        totalMs: 10,
        steps: [
          { name: "demand-graph", ok: true, ms: 1 },
          { name: "prepare-ahead", ok: true, ms: 1 },
          { name: "today-surface", ok: true, ms: 1 },
        ],
      };
    }),
  };
}

describe("runAutonomousResearchForTenant", () => {
  it("acquires evidence before fusion, preparation, and the Today surface", async () => {
    const calls: string[] = [];
    const receipt = await runAutonomousResearchForTenant(TENANT, NOW, deps(calls));
    expect(calls).toEqual([
      "graph", "competitors", "gaps", "packs", "keywords", "engines", "ai", "questions", "claims", "authority",
      "loss", "steal", "native", "final-keywords", "fuse", "prepare", "today",
    ]);
    expect(receipt.ok).toBe(true);
    expect(receipt.trigger).toBe("visit");
    expect(receipt.summary).toMatchObject({
      keywordTermsPlanned: 2,
      dataForSeoStatus: "live",
      aiEnginePollStatus: "ok",
      competitorPagesAnalyzed: 10,
      competitorsMined: 2,
      keywordGapsFound: 120,
      cloneBriefsBuilt: 3,
      aiCitationRecords: 4,
      aiEnginePrompts: 25,
      aiEnginesChecked: 2,
      aiObservationsWritten: 40,
      aiCitationGaps: 8,
      questionsRanked: 50,
      claimsChecked: 35,
      pagesMapped: 90,
      stealBriefsBuilt: 4,
      finalKeywordTermsChecked: 8,
      readyToReview: 5,
      draftsRegenerated: 2,
      spendUsd: 0.363,
    });
  });

  it("records an isolated producer failure and still fuses the remaining evidence", async () => {
    const calls: string[] = [];
    const d = deps(calls);
    d.enrichResearch = vi.fn(async () => { calls.push("keywords"); throw new Error("provider unavailable"); });
    const receipt = await runAutonomousResearchForTenant(TENANT, NOW, d);
    expect(calls).toContain("today");
    expect(receipt.ok).toBe(false);
    expect(receipt.steps.find((step) => step.name === "keyword-serp-enrichment")?.note).toContain("provider unavailable");
    expect(receipt.summary?.readyToReview).toBe(5);
  });
});
