import "server-only";

/**
 * runNativePoll — shared entry point for running a Perplexity or ChatGPT
 * native poll end-to-end: budget-guard → adapter → sync → snapshots.
 *
 * Used by the hosted endpoint at `/api/poll/run` and (optionally) any future
 * CLI path that wants the same semantics. The existing local tsx scripts
 * (scripts/poll-perplexity.ts, scripts/poll-openai.ts) continue to work via
 * direct adapter calls — they are NOT refactored in this commit to keep the
 * change bounded.
 *
 * Determinism + idempotency are carried by the existing pipeline:
 * - observation_runs uses a unique run_id per invocation
 * - prompt_answer_observations / answer_texts use deterministic per-prompt IDs
 * - daily_metric_snapshots uses deterministic (date, scope, platform) IDs
 *   → repeated runs for the same date upsert in place, last-write-wins per day
 *
 * Budget guard: if a completed run for the same `source` landed within the
 * last 20 hours, we skip (unless `force=true`). Prevents accidental double
 * runs from cron misconfiguration or manual double-triggers. 20h (not 24h)
 * gives wiggle room for cron drift across day boundaries.
 *
 * Fail-open on budget-check error: if the guard query errors, we log loudly
 * and proceed. Reasoning: a duplicate run costs ~$1.70 and produces idempotent
 * state; a missed day loses a data point permanently. Observability beats
 * over-correction here.
 */

import { pollPerplexityForTenant } from "@/adapters/perplexity/poll";
import { pollOpenAIForTenant } from "@/adapters/openai/poll";
import type { PerplexityPollResult } from "@/adapters/perplexity/poll";
import {
  syncPromptAnswerObservations as realSyncObs,
  syncAnswerTexts as realSyncTexts,
  syncObservationRuns as realSyncRuns,
  syncDailyMetricSnapshots as realSyncSnaps,
} from "@/lib/persistence/dual-write";
import { buildDailySnapshotsFromObservations as realBuildSnaps } from "@/domains/daily-metric-snapshots/build-from-observations";
import { getRepository } from "@/lib/persistence/repositories";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

export type NativePollPlatform = "perplexity" | "openai";

export type NativePollStatus =
  | "completed"
  | "partial"
  | "failed"
  | "skipped_already_ran_today";

export type NativePollResult = {
  status: NativePollStatus;
  runId: string | null;
  platform: NativePollPlatform;
  observationsWritten: number;
  snapshotsWritten: number;
  errorCount: number;
  costEstimateUsd: number;
  completedAt: string | null;
  note?: string;
};

export type RunNativePollArgs = {
  tenantId: string;
  platform: NativePollPlatform;
  /** Bypass the 20-hour budget guard. Defaults to false. */
  force?: boolean;
};

export type RunNativePollDeps = {
  /** Adapter resolver. Default routes to the real Perplexity/OpenAI adapters. */
  runAdapter?: (
    platform: NativePollPlatform,
    tenantId: string,
  ) => Promise<PerplexityPollResult>;
  /** Budget guard. Returns true if a completed run for `source` exists in the last 20h. */
  hasRecentCompletedRun?: (source: string) => Promise<boolean>;
  /** Sync wrappers — all default to real dual-write helpers. */
  syncObservationRuns?: typeof realSyncRuns;
  syncPromptAnswerObservations?: typeof realSyncObs;
  syncAnswerTexts?: typeof realSyncTexts;
  syncDailyMetricSnapshots?: typeof realSyncSnaps;
  /** Snapshot derivation + entity fetcher. */
  buildDailySnapshotsFromObservations?: typeof realBuildSnaps;
  getTrackedEntities?: () => Promise<TrackedEntity[]>;
};

// ── Platform-specific metadata ───────────────────────────────────────
const POLL_SOURCE: Record<NativePollPlatform, string> = {
  perplexity: "perplexity-native-poll",
  openai: "openai-native-poll",
};
const SNAPSHOT_PLATFORM_LABEL: Record<NativePollPlatform, string> = {
  perplexity: "Perplexity",
  openai: "ChatGPT",
};
const COST_PER_OBS_USD: Record<NativePollPlatform, number> = {
  perplexity: 0.005,
  openai: 0.012,
};
const BUDGET_GUARD_WINDOW_MS = 20 * 60 * 60 * 1000; // 20 hours

export async function runNativePoll(
  args: RunNativePollArgs,
  deps: RunNativePollDeps = {},
): Promise<NativePollResult> {
  const { tenantId, platform } = args;
  const force = args.force ?? false;

  const source = POLL_SOURCE[platform];
  const platformLabel = SNAPSHOT_PLATFORM_LABEL[platform];
  const costRate = COST_PER_OBS_USD[platform];

  const runAdapter = deps.runAdapter ?? defaultRunAdapter;
  const hasRecentRun = deps.hasRecentCompletedRun ?? defaultHasRecentRun;
  const syncRuns = deps.syncObservationRuns ?? realSyncRuns;
  const syncObs = deps.syncPromptAnswerObservations ?? realSyncObs;
  const syncTexts = deps.syncAnswerTexts ?? realSyncTexts;
  const syncSnaps = deps.syncDailyMetricSnapshots ?? realSyncSnaps;
  const buildSnaps =
    deps.buildDailySnapshotsFromObservations ?? realBuildSnaps;
  const getEntities =
    deps.getTrackedEntities ??
    (async () => getRepository().getTrackedEntities());

  // ── Budget guard ────────────────────────────────────────────────────
  if (!force) {
    const recent = await hasRecentRun(source);
    if (recent) {
      return {
        status: "skipped_already_ran_today",
        runId: null,
        platform,
        observationsWritten: 0,
        snapshotsWritten: 0,
        errorCount: 0,
        costEstimateUsd: 0,
        completedAt: null,
        note: `A completed ${source} run already landed within the last 20 hours. Pass force=true to bypass.`,
      };
    }
  }

  // ── Run the poll ────────────────────────────────────────────────────
  const result = await runAdapter(platform, tenantId);
  const run = result.observationRun;

  // ── Sync raw artifacts ──────────────────────────────────────────────
  await syncRuns([run]);
  await syncObs(result.observations);
  await syncTexts(result.answerTexts);

  // ── Derive + sync daily snapshots ───────────────────────────────────
  const entities = await getEntities();
  const date = run.completed_at.slice(0, 10); // YYYY-MM-DD (UTC)
  const snapshots = buildSnaps({
    tenantId,
    platform: platformLabel,
    observations: result.observations,
    trackedEntities: entities,
    date,
    observationRunId: run.run_id,
  });
  await syncSnaps(snapshots);

  // ── Summarize ───────────────────────────────────────────────────────
  const status: NativePollStatus =
    run.status === "failed"
      ? "failed"
      : run.status === "partial"
        ? "partial"
        : "completed";

  return {
    status,
    runId: run.run_id,
    platform,
    observationsWritten: result.observations.length,
    snapshotsWritten: snapshots.length,
    errorCount: result.errorCount,
    costEstimateUsd: Number(
      (result.observations.length * costRate).toFixed(4),
    ),
    completedAt: run.completed_at,
  };
}

async function defaultRunAdapter(
  platform: NativePollPlatform,
  tenantId: string,
): Promise<PerplexityPollResult> {
  if (platform === "perplexity") return pollPerplexityForTenant(tenantId);
  if (platform === "openai") return pollOpenAIForTenant(tenantId);
  throw new Error(`Unknown native platform: ${platform}`);
}

async function defaultHasRecentRun(source: string): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - BUDGET_GUARD_WINDOW_MS).toISOString();
    const { data, error } = await sb
      .from("observation_runs")
      .select("run_id")
      .eq("source", source)
      .eq("status", "completed")
      .gt("completed_at", cutoff)
      .limit(1);
    if (error) {
      console.error(
        `[runNativePoll] budget-guard query failed (fail-open): ${error.message}`,
      );
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error(
      `[runNativePoll] budget-guard threw (fail-open): ${e instanceof Error ? e.message : e}`,
    );
    return false;
  }
}
