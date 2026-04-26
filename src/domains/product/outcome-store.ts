/**
 * Outcome Store — unified action→result memory for the collective learning flywheel.
 *
 * Aggregates:
 * - Recommendation responses (accept/dismiss/defer)
 * - Experiment outcomes (status changes with citation deltas)
 * - Scorecard verdicts (validated/partial/negative from attribution)
 *
 * Every entry is append-only. The store compounds with each operator action
 * and import cycle. Feeds the priority engine, what-if simulator, and Beacon Score.
 */

import "server-only";

import { cache } from "react";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type {
  OutcomeRecord,
  OutcomeActionType,
  OutcomeSummary,
} from "./outcome-types";

const STORE_NAME = "outcome-store";

// Sprint 7 Phase 7.8e-3 (2026-04-26): module-level top-level await replaced
// with cached async getter. Mutators (`recordOutcome`, `resolveOutcome`,
// `backfillFromExistingData`) are now async and read the cached array via
// the getter before mutating; same shape as before, just one indirection.
let _state: OutcomeRecord[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await readStore<OutcomeRecord>(STORE_NAME);
});

export const getOutcomeRecords = cache(async (): Promise<OutcomeRecord[]> => {
  await ensureLoaded();
  return _state!;
});

export async function persistOutcomes(): Promise<void> {
  await writeStore(STORE_NAME, await getOutcomeRecords());
}

export async function recordOutcome(opts: {
  action_type: OutcomeActionType;
  action_detail: string;
  rec_id?: string | null;
  experiment_id?: string | null;
  change_id?: string | null;
  target_page?: string | null;
  target_topic?: string | null;
  verdict?: string | null;
  citation_delta?: number | null;
  confidence?: string | null;
  source_signal_tier?: "explicit" | "inferred";
  pattern_id?: string | null;
}): Promise<OutcomeRecord> {
  const id = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const record: OutcomeRecord = {
    outcome_id: id,
    action_type: opts.action_type,
    action_detail: opts.action_detail,
    rec_id: opts.rec_id ?? null,
    experiment_id: opts.experiment_id ?? null,
    change_id: opts.change_id ?? null,
    target_page: opts.target_page ?? null,
    target_topic: opts.target_topic ?? null,
    started_at: now,
    resolved_at: null,
    verdict: opts.verdict ?? null,
    citation_delta: opts.citation_delta ?? null,
    confidence: opts.confidence ?? null,
    source_signal_tier: opts.source_signal_tier ?? "explicit",
    pattern_id: opts.pattern_id ?? null,
  };

  (await getOutcomeRecords()).push(record);
  return record;
}

export async function resolveOutcome(
  outcomeId: string,
  verdict: string,
  citationDelta?: number | null,
): Promise<void> {
  const outcomeRecords = await getOutcomeRecords();
  const record = outcomeRecords.find((r) => r.outcome_id === outcomeId);
  if (!record) return;
  record.resolved_at = new Date().toISOString();
  record.verdict = verdict;
  if (citationDelta !== undefined) {
    record.citation_delta = citationDelta;
  }
}

export async function getOutcomesByActionType(
  actionType: OutcomeActionType,
): Promise<OutcomeRecord[]> {
  return (await getOutcomeRecords()).filter((r) => r.action_type === actionType);
}

export async function getOutcomesByPattern(
  patternId: string,
): Promise<OutcomeRecord[]> {
  return (await getOutcomeRecords()).filter((r) => r.pattern_id === patternId);
}

export async function getOutcomesByPage(
  pageUrl: string,
): Promise<OutcomeRecord[]> {
  return (await getOutcomeRecords()).filter((r) => r.target_page === pageUrl);
}

export async function computeOutcomeSummary(): Promise<OutcomeSummary> {
  const outcomeRecords = await getOutcomeRecords();
  const byActionType: Record<string, number> = {};
  const byVerdict: Record<string, number> = {};
  let positiveCount = 0;
  let resolvedCount = 0;
  let deltaSum = 0;
  let deltaCount = 0;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const r of outcomeRecords) {
    byActionType[r.action_type] = (byActionType[r.action_type] ?? 0) + 1;

    if (r.verdict) {
      byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
      resolvedCount++;
      if (
        r.verdict === "validated" ||
        r.verdict === "positive" ||
        r.verdict === "promising"
      ) {
        positiveCount++;
      }
    }

    if (r.citation_delta !== null) {
      deltaSum += r.citation_delta;
      deltaCount++;
    }

    if (!earliest || r.started_at < earliest) earliest = r.started_at;
    if (!latest || r.started_at > latest) latest = r.started_at;
  }

  return {
    total: outcomeRecords.length,
    by_action_type: byActionType,
    by_verdict: byVerdict,
    positive_rate:
      resolvedCount >= 5
        ? Math.round((positiveCount / resolvedCount) * 100) / 100
        : null,
    avg_citation_delta:
      deltaCount >= 3 ? Math.round((deltaSum / deltaCount) * 10) / 10 : null,
    earliest,
    latest,
  };
}

/**
 * Backfill outcome store from existing recommendation responses, experiments,
 * and scorecard verdicts. Idempotent — skips already-recorded outcomes.
 */
export async function backfillFromExistingData(opts: {
  responses: Array<{
    recId: string;
    status: string;
    respondedAt: string;
  }>;
  experiments: Array<{
    id: string;
    recId: string;
    status: string;
    targetPageUrl: string | null;
    baselineCitations: number | null;
    latestCitations: number | null;
    startedAt: string;
  }>;
  scorecardVerdicts: Array<{
    changeId: string;
    verdict: string;
    assetName: string;
    topic?: string | null;
    url?: string | null;
  }>;
}): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  const outcomeRecords = await getOutcomeRecords();
  const existingRecIds = new Set(
    outcomeRecords
      .filter((r) => r.rec_id)
      .map((r) => `${r.rec_id}-${r.action_type}`),
  );
  const existingExpIds = new Set(
    outcomeRecords
      .filter((r) => r.experiment_id)
      .map((r) => `${r.experiment_id}-${r.action_type}`),
  );
  const existingChangeIds = new Set(
    outcomeRecords
      .filter((r) => r.change_id)
      .map((r) => `${r.change_id}-${r.action_type}`),
  );

  for (const resp of opts.responses) {
    const actionType: OutcomeActionType =
      resp.status === "accepted"
        ? "recommendation_accepted"
        : resp.status === "dismissed"
          ? "recommendation_dismissed"
          : "recommendation_deferred";

    const key = `${resp.recId}-${actionType}`;
    if (existingRecIds.has(key)) {
      skipped++;
      continue;
    }

    await recordOutcome({
      action_type: actionType,
      action_detail: `Recommendation ${resp.status}`,
      rec_id: resp.recId,
      source_signal_tier: "explicit",
    });
    added++;
  }

  for (const exp of opts.experiments) {
    const actionType: OutcomeActionType = `experiment_${
      exp.status === "testing" || exp.status === "watching"
        ? "started"
        : exp.status
    }` as OutcomeActionType;

    const key = `${exp.id}-${actionType}`;
    if (existingExpIds.has(key)) {
      skipped++;
      continue;
    }

    const delta =
      exp.baselineCitations !== null && exp.latestCitations !== null
        ? exp.latestCitations - exp.baselineCitations
        : null;

    await recordOutcome({
      action_type: actionType,
      action_detail: `Experiment ${exp.status}`,
      rec_id: exp.recId,
      experiment_id: exp.id,
      target_page: exp.targetPageUrl,
      citation_delta: delta,
      verdict: exp.status,
      source_signal_tier: "explicit",
    });
    added++;
  }

  for (const sv of opts.scorecardVerdicts) {
    const actionType: OutcomeActionType =
      sv.verdict === "validated"
        ? "scorecard_validated"
        : sv.verdict === "partial"
          ? "scorecard_partial"
          : sv.verdict === "negative"
            ? "scorecard_negative"
            : sv.verdict === "too_early"
              ? "scorecard_too_early"
              : "scorecard_inconclusive";

    const key = `${sv.changeId}-${actionType}`;
    if (existingChangeIds.has(key)) {
      skipped++;
      continue;
    }

    await recordOutcome({
      action_type: actionType,
      action_detail: `Change verdict: ${sv.verdict} for ${sv.assetName}`,
      change_id: sv.changeId,
      target_page: sv.url ?? null,
      target_topic: sv.topic ?? null,
      verdict: sv.verdict,
      source_signal_tier: "inferred",
    });
    added++;
  }

  return { added, skipped };
}

export function _resetOutcomeStoreForTests(): void {
  _state = null;
}
