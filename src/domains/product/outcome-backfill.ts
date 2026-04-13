/**
 * Post-import outcome backfill — runs after data import to keep the outcome
 * store in sync with recommendation responses, experiments, and scorecard
 * verdicts. Previously ran during Today's server render (Phase 1C-1 moved it).
 */

import "server-only";

import {
  results,
  changelogEntries,
  opportunities,
} from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { recommendationResponses } from "@/domains/product/recommendation-response-store";
import { getActiveExperiments } from "@/domains/product/experiment-store";
import {
  backfillFromExistingData,
  persistOutcomes,
} from "@/domains/product/outcome-store";

/**
 * Idempotent backfill: scans current recommendation responses, experiments,
 * and scorecard verdicts and appends any missing entries to the outcome store.
 * Persists to disk only when new records are added.
 */
export async function runOutcomeBackfill(): Promise<{
  added: number;
  skipped: number;
}> {
  const scorecardRows = computeScorecard(
    changelogEntries,
    results,
    opportunities,
    eventDecisions,
  );

  const result = backfillFromExistingData({
    responses: recommendationResponses.map((r) => ({
      recId: r.recId,
      status: r.status,
      respondedAt: r.respondedAt,
    })),
    experiments: getActiveExperiments().map((e) => ({
      id: e.id,
      recId: e.recId,
      status: e.status,
      targetPageUrl: e.targetPageUrl,
      baselineCitations: e.baselineCitations,
      latestCitations: e.latestCitations,
      startedAt: e.startedAt,
    })),
    scorecardVerdicts: scorecardRows
      .filter((r) => r.verdict !== "pending" && r.verdict !== "too_early")
      .map((r) => ({
        changeId: r.change.id,
        verdict: r.verdict,
        assetName: r.change.asset_name,
        topic: r.topics[0] ?? null,
        url: null,
      })),
  });

  if (result.added > 0) {
    await persistOutcomes();
  }

  return result;
}
