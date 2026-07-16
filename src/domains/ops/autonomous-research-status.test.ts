import { describe, expect, it } from "vitest";

import { autonomousResearchHeaderStatus } from "./autonomous-research-status";
import type { WarmRunReceipt, WarmRunSummary } from "./warm-receipt-store";

const summary: WarmRunSummary = {
  dataForSeoStatus: "live",
  aiEnginePollStatus: "ok",
  competitorPagesAnalyzed: 0,
  competitorPagesRefreshed: 0,
  competitorsMined: 0,
  keywordGapsFound: 0,
  cloneBriefsBuilt: 0,
  keywordTermsPlanned: 0,
  serpPatternsWritten: 0,
  aiTopicsPolled: 0,
  aiCitationRecords: 0,
  aiEnginePrompts: 0,
  aiEnginesChecked: 0,
  aiObservationsWritten: 0,
  aiCitationGaps: 0,
  questionsRanked: 0,
  uncoveredQuestions: 0,
  claimsChecked: 0,
  conflictingClaims: 0,
  pagesMapped: 0,
  orphanPagesFound: 0,
  beatenKeywords: 0,
  stealBriefsBuilt: 0,
  nativePromptsAnalyzed: 0,
  citedPagesAnalyzed: 0,
  movesPrepared: 0,
  readyToReview: 3,
  draftsRegenerated: 0,
  spendUsd: 0,
};

function receipt(over: Partial<WarmRunReceipt> = {}): WarmRunReceipt {
  return {
    tenant_id: "tenant-iranopedia",
    date: "2026-07-14",
    ran_at: "2026-07-14T18:00:00.000Z",
    ok: false,
    totalMs: 0,
    steps: [],
    trigger: "visit",
    ...over,
  };
}

describe("autonomousResearchHeaderStatus", () => {
  it("shows the honest first-visit state", () => {
    expect(autonomousResearchHeaderStatus(null)).toMatchObject({
      label: "Research starts on visit",
      tone: "idle",
    });
  });

  it("shows first preparation as non-blocking background work", () => {
    expect(autonomousResearchHeaderStatus(receipt({
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
    }))).toMatchObject({
      label: "Preparing in background",
      tone: "running",
    });
  });

  it("keeps the saved result ready while a newer pass refreshes", () => {
    expect(autonomousResearchHeaderStatus(receipt({
      summary,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
    }))).toMatchObject({
      label: "Up to date · refreshing",
      tone: "ready",
    });
  });

  it("keeps a checkpointed partial pipeline customer-ready between navigations", () => {
    expect(autonomousResearchHeaderStatus(receipt({
      summary,
      pipeline: {
        version: 1,
        completedStages: ["baseline", "graph", "competitors"],
        nextStage: "keywords",
        updatedAt: "2026-07-14T18:01:00.000Z",
      },
    }))).toMatchObject({
      label: "Up to date · refreshing",
      tone: "ready",
    });
  });

  it("collapses a completed pass to the outcome that matters", () => {
    const row = receipt({
      ok: true,
      summary,
    });
    expect(autonomousResearchHeaderStatus(row)).toMatchObject({
      label: "3 moves ready",
      tone: "ready",
    });
  });
});
