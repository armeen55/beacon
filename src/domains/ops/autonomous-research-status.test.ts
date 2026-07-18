import { describe, expect, it } from "vitest";

import {
  autonomousResearchHeaderStatus,
  autonomousResearchStatusLine,
  CUT_SHORT_COPY,
  STALE_RUNNING_MS,
} from "./autonomous-research-status";
import type { WarmRunReceipt, WarmRunSummary } from "./warm-receipt-store";

// Injected clocks only: a running receipt is judged "fresh" or "stalled"
// relative to this, never wall-clock Date.now(). Receipts below stamp ran_at at
// 18:00; FRESH is a few minutes later, STALE is well past the 15-minute cutoff.
const RAN_AT = "2026-07-14T18:00:00.000Z";
const FRESH_NOW = new Date("2026-07-14T18:05:00.000Z");
const STALE_NOW = new Date(Date.parse(RAN_AT) + STALE_RUNNING_MS + 60_000);

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
      ran_at: RAN_AT,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
    }), FRESH_NOW)).toMatchObject({
      label: "Preparing in background",
      tone: "running",
    });
  });

  it("keeps the saved result ready while a newer pass refreshes", () => {
    expect(autonomousResearchHeaderStatus(receipt({
      ran_at: RAN_AT,
      summary,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
    }), FRESH_NOW)).toMatchObject({
      label: "Up to date · refreshing",
      tone: "ready",
    });
  });

  it("stops calling a stale running receipt 'running' after 15 minutes and tells the truth", () => {
    const stalled = receipt({
      ran_at: RAN_AT,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
    });
    expect(autonomousResearchStatusLine(stalled, STALE_NOW)).toBe(CUT_SHORT_COPY);
    expect(autonomousResearchHeaderStatus(stalled, STALE_NOW)).toMatchObject({
      label: "Last pass cut short",
      tone: "partial",
      title: CUT_SHORT_COPY,
    });
  });

  it("keeps a stale receipt WITH resumable pipeline progress as refreshing, not cut short", () => {
    // A checkpointed pipeline legitimately persists across navigations; the next
    // visit resumes it, so it is never a dead-lambda ghost.
    const status = autonomousResearchHeaderStatus(receipt({
      ran_at: RAN_AT,
      summary,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
      pipeline: { version: 1, completedStages: ["baseline"], nextStage: "graph", updatedAt: RAN_AT },
    }), STALE_NOW);
    expect(status.tone).toBe("ready");
    expect(status.title).not.toBe(CUT_SHORT_COPY);
  });

  it("keeps a checkpointed partial pipeline customer-ready between navigations", () => {
    const status = autonomousResearchHeaderStatus(receipt({
      summary,
      pipeline: {
        version: 1,
        completedStages: ["baseline", "graph", "competitors"],
        nextStage: "keywords",
        updatedAt: "2026-07-14T18:01:00.000Z",
      },
    }));
    expect(status).toMatchObject({
      label: "Refreshing · 3/8",
      tone: "ready",
      progress: { completed: 3, total: 8, percent: 38, nextLabel: "expanding keywords" },
    });
    expect(status.title).toContain("3 of 8: expanding keywords");
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
