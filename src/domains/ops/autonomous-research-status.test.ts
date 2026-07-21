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

// pipelineAdvancedAt is written by on-visit-refresh, not the shared store type;
// this builder attaches it so the status reader can be exercised as prod sees it.
type PipelineWithAdvance = NonNullable<WarmRunReceipt["pipeline"]> & { pipelineAdvancedAt?: string };
function pipe(over: Partial<PipelineWithAdvance> = {}): WarmRunReceipt["pipeline"] {
  return {
    version: 1,
    completedStages: ["baseline"],
    nextStage: "graph",
    updatedAt: RAN_AT,
    ...over,
  } as WarmRunReceipt["pipeline"];
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

  it("keeps a stale receipt whose pipeline is still ADVANCING as refreshing, not cut short", () => {
    // pipelineAdvancedAt is recent, so the pipeline provably grew a stage lately;
    // the next visit resumes it. ran_at being stale (startedReceipt rewrote it) is
    // irrelevant - progress freshness, not ran_at, governs a pipeline.
    const advancing = new Date(STALE_NOW.getTime() - 60_000).toISOString();
    const status = autonomousResearchHeaderStatus(receipt({
      ran_at: RAN_AT,
      summary,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
      pipeline: pipe({ pipelineAdvancedAt: advancing }),
    }), STALE_NOW);
    expect(status.tone).toBe("ready");
    expect(status.title).not.toBe(CUT_SHORT_COPY);
  });

  it("stops calling a STALLED pipeline 'Refreshing' and tells the truth", () => {
    // completedStages has not grown for longer than the stale window
    // (pipelineAdvancedAt is old): the background pass keeps dying at stage 0. No
    // eternal "Refreshing 0/8".
    const stalled = receipt({
      ran_at: RAN_AT,
      summary,
      steps: [{ name: "autonomous-research", ok: true, ms: 0, note: "running after this response" }],
      pipeline: pipe({ completedStages: [], nextStage: "baseline", pipelineAdvancedAt: RAN_AT }),
    });
    expect(autonomousResearchStatusLine(stalled, STALE_NOW)).toBe(CUT_SHORT_COPY);
    expect(autonomousResearchHeaderStatus(stalled, STALE_NOW)).toMatchObject({
      label: "Last pass cut short",
      tone: "partial",
      title: CUT_SHORT_COPY,
      progress: null,
    });
  });

  it("falls back to updatedAt for a legacy pipeline with no pipelineAdvancedAt", () => {
    // Existing prod receipts predate the field. A recent updatedAt keeps them
    // refreshing; an old one honestly reads cut-short, and the next checkpoint
    // stamps the precise field.
    const freshUpdatedAt = new Date(STALE_NOW.getTime() - 60_000).toISOString();
    const legacyFresh = autonomousResearchHeaderStatus(receipt({
      summary,
      pipeline: { version: 1, completedStages: ["baseline"], nextStage: "graph", updatedAt: freshUpdatedAt },
    }), STALE_NOW);
    expect(legacyFresh.tone).toBe("ready");
    expect(legacyFresh.title).not.toBe(CUT_SHORT_COPY);

    const legacyStale = autonomousResearchHeaderStatus(receipt({
      summary,
      pipeline: { version: 1, completedStages: ["baseline"], nextStage: "graph", updatedAt: RAN_AT },
    }), STALE_NOW);
    expect(legacyStale.title).toBe(CUT_SHORT_COPY);
  });

  it("keeps a checkpointed partial pipeline customer-ready between navigations", () => {
    const advancing = new Date(STALE_NOW.getTime() - 60_000).toISOString();
    const status = autonomousResearchHeaderStatus(receipt({
      summary,
      pipeline: pipe({
        completedStages: ["baseline", "graph", "competitors"],
        nextStage: "keywords",
        pipelineAdvancedAt: advancing,
      }),
    }), STALE_NOW);
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
      label: "3 drafts to review",
      tone: "ready",
    });
  });
});
