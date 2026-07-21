import { describe, expect, it } from "vitest";

import { autonomousResearchStatusLine } from "./autonomous-research-status";
import type { WarmRunReceipt, WarmRunSummary } from "@/domains/ops/warm-receipt-store";

const summary: WarmRunSummary = {
  dataForSeoStatus: "live",
  aiEnginePollStatus: "ok",
  competitorPagesAnalyzed: 10,
  competitorPagesRefreshed: 4,
  competitorsMined: 3,
  keywordGapsFound: 120,
  cloneBriefsBuilt: 5,
  keywordTermsPlanned: 500,
  serpPatternsWritten: 3,
  aiTopicsPolled: 5,
  aiCitationRecords: 20,
  aiEnginePrompts: 25,
  aiEnginesChecked: 2,
  aiObservationsWritten: 40,
  aiCitationGaps: 8,
  questionsRanked: 80,
  uncoveredQuestions: 25,
  claimsChecked: 40,
  conflictingClaims: 2,
  pagesMapped: 100,
  orphanPagesFound: 5,
  beatenKeywords: 8,
  stealBriefsBuilt: 4,
  nativePromptsAnalyzed: 5,
  citedPagesAnalyzed: 12,
  finalSerpQueriesChecked: 10,
  finalSerpWinnersAnalyzed: 8,
  finalKeywordTermsChecked: 12,
  movesPrepared: 7,
  readyToReview: 6,
  draftsRegenerated: 3,
  spendUsd: 0.12,
};

function receipt(ok: boolean): WarmRunReceipt {
  return {
    tenant_id: "tenant-iranopedia",
    date: "2026-07-13",
    ran_at: "2026-07-13T18:00:00.000Z",
    ok,
    totalMs: 100,
    steps: [],
    trigger: "visit",
    summary,
  };
}

describe("autonomousResearchStatusLine", () => {
  it("explains the automatic behavior before the first receipt", () => {
    expect(autonomousResearchStatusLine(null)).toContain("automatically after this visit");
  });

  it("surfaces evidence and prepared outcomes without another button", () => {
    const line = autonomousResearchStatusLine(receipt(true));
    expect(line).toContain("500 keyword signals");
    expect(line).toContain("12 final keyword volumes");
    expect(line).toContain("120 competitor keyword gaps");
    expect(line).toContain("10 competitor pages");
    expect(line).toContain("8 final Google winners");
    expect(line).toContain("5 AI topics");
    expect(line).toContain("6 drafts waiting for your review");
  });

  it("states a partial pass and safe retry honestly", () => {
    expect(autonomousResearchStatusLine(receipt(false))).toContain("retry safely");
  });

  it("states plainly when the paid research connector is unavailable, with no vendor name", () => {
    const row = receipt(true);
    row.summary = { ...summary, dataForSeoStatus: "disabled" };
    const line = autonomousResearchStatusLine(row);
    expect(line).toContain("Competitor keyword mining is off right now.");
    expect(line).not.toMatch(/dataforseo/i);
  });

  it("distinguishes an earlier same-day AI poll from zero new work", () => {
    const row = receipt(true);
    row.summary = { ...summary, aiEnginePollStatus: "already_ran", aiObservationsWritten: 0 };
    expect(autonomousResearchStatusLine(row)).toContain("already refreshed today");
  });
});
