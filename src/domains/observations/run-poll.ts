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
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

export type NativePollPlatform = "perplexity" | "openai";

export type NativePollStatus =
  | "completed"
  | "partial"
  | "failed"
  | "skipped_already_ran_today"
  | "skipped_chunk_recently_ran";

export type NativePollResult = {
  status: NativePollStatus;
  runId: string | null;
  platform: NativePollPlatform;
  /**
   * What slice of the prompt list this invocation targeted. For full-run
   * calls, offset=0, limit=null, promptsPolled = total eligible prompts.
   * For chunked calls, offset/limit reflect the requested window.
   */
  chunk: {
    offset: number;
    limit: number | null;
    promptsPolled: number;
  };
  observationsWritten: number;
  /**
   * Count of daily_metric_snapshots rows derived on this call. For chunked
   * calls this reflects the CUMULATIVE derivation for the whole day (all
   * chunks so far), not just this chunk.
   */
  snapshotsWritten: number;
  errorCount: number;
  costEstimateUsd: number;
  completedAt: string | null;
  note?: string;
};

export type RunNativePollArgs = {
  tenantId: string;
  platform: NativePollPlatform;
  /**
   * Chunk window start (skip first N eligible prompts). Defaults to 0.
   * Setting offset OR limit activates chunk mode: budget guard is bypassed
   * and snapshot derivation reads all of today's observations (cumulative)
   * instead of just this chunk's.
   */
  offset?: number;
  /** Chunk window size (max prompts to poll from `offset`). */
  limit?: number;
  /** Bypass the 20-hour budget guard. Defaults to false. Implicit in chunk mode. */
  force?: boolean;
};

export type RunNativePollDeps = {
  /** Adapter resolver. Default routes to the real Perplexity/OpenAI adapters. */
  runAdapter?: (
    platform: NativePollPlatform,
    tenantId: string,
    chunk: { offset?: number; limit?: number },
  ) => Promise<PerplexityPollResult>;
  /** Budget guard. Returns true if a completed run for `source` exists in the last 20h. */
  hasRecentCompletedRun?: (source: string) => Promise<boolean>;
  /**
   * Chunk retry dedupe. Returns true if a completed run for the same chunk
   * identity (source + offset + limit) was landed within the last 15 minutes.
   * Purpose: catch double-fires and cron retry storms without blocking
   * intentional later re-runs. Works for both N=1 and N>1 cadences.
   */
  hasRecentCompletedChunk?: (
    source: string,
    offset: number,
    limit: number | null,
  ) => Promise<boolean>;
  /** Sync wrappers — all default to real dual-write helpers. */
  syncObservationRuns?: typeof realSyncRuns;
  syncPromptAnswerObservations?: typeof realSyncObs;
  syncAnswerTexts?: typeof realSyncTexts;
  syncDailyMetricSnapshots?: typeof realSyncSnaps;
  /** Snapshot derivation + entity fetcher. */
  buildDailySnapshotsFromObservations?: typeof realBuildSnaps;
  getTrackedEntities?: () => Promise<TrackedEntity[]>;
  /**
   * Load all observations for (tenant, platform, UTC date). Used in chunk mode
   * to cumulatively derive day-level snapshots across chunks. Default queries
   * Supabase directly.
   */
  getObservationsForDay?: (args: {
    tenantId: string;
    platform: string; // lowercase observation-level label
    date: string; // YYYY-MM-DD (UTC)
  }) => Promise<PromptAnswerObservation[]>;
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
/**
 * The value stored on `prompt_answer_observations.platform` — the
 * observation-level label the adapters write. NOT the same as the
 * snapshot-level label (`"ChatGPT"` vs `"chatgpt"`) or the
 * NativePollPlatform enum ("openai" vs "chatgpt"). Used by chunk-mode
 * cumulative derivation to query today's observations with the correct
 * filter. Perplexity's three labels happen to match ("perplexity"); OpenAI's
 * NativePollPlatform ("openai") and observation label ("chatgpt") differ.
 * Getting this wrong returned zero observations and zeroed the 37 entity
 * rows for ChatGPT on 2026-04-23 — that's what this mapping fixes.
 */
const OBSERVATION_PLATFORM_LABEL: Record<NativePollPlatform, string> = {
  perplexity: "perplexity",
  openai: "chatgpt",
};
const COST_PER_OBS_USD: Record<NativePollPlatform, number> = {
  perplexity: 0.005,
  openai: 0.012,
};
const BUDGET_GUARD_WINDOW_MS = 20 * 60 * 60 * 1000; // 20 hours
const CHUNK_RETRY_DEDUPE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

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
  const hasRecentChunk =
    deps.hasRecentCompletedChunk ?? defaultHasRecentChunk;
  const syncRuns = deps.syncObservationRuns ?? realSyncRuns;
  const syncObs = deps.syncPromptAnswerObservations ?? realSyncObs;
  const syncTexts = deps.syncAnswerTexts ?? realSyncTexts;
  const syncSnaps = deps.syncDailyMetricSnapshots ?? realSyncSnaps;
  const buildSnaps =
    deps.buildDailySnapshotsFromObservations ?? realBuildSnaps;
  const getEntities =
    deps.getTrackedEntities ??
    (async () => getRepository().getTrackedEntities());
  const getDayObs =
    deps.getObservationsForDay ?? defaultGetObservationsForDay;

  const isChunked = args.offset !== undefined || args.limit !== undefined;
  const chunkOffset = args.offset ?? 0;
  const chunkLimit = args.limit ?? null;

  // ── Budget guard ────────────────────────────────────────────────────
  // Two separate guards with different time windows:
  // - Non-chunk mode (full-run call): 20-hour "already ran today" guard.
  //   Blocks accidental double whole-day polls.
  // - Chunk mode: 15-minute per-chunk retry-dedupe. Blocks double-fires /
  //   cron retry storms for the SAME chunk identity, but allows intentional
  //   later re-runs (multi-run sampling, manual force triggers hours later).
  // Both guards respect force=true.
  if (!force) {
    if (isChunked) {
      const recentChunk = await hasRecentChunk(source, chunkOffset, chunkLimit);
      if (recentChunk) {
        return {
          status: "skipped_chunk_recently_ran",
          runId: null,
          platform,
          chunk: {
            offset: chunkOffset,
            limit: chunkLimit,
            promptsPolled: 0,
          },
          observationsWritten: 0,
          snapshotsWritten: 0,
          errorCount: 0,
          costEstimateUsd: 0,
          completedAt: null,
          note: `A completed ${source} run for chunk offset=${chunkOffset} limit=${chunkLimit ?? "all"} landed within the last 15 minutes. Pass force=true to bypass (e.g. legitimate retry).`,
        };
      }
    } else {
      const recent = await hasRecentRun(source);
      if (recent) {
        return {
          status: "skipped_already_ran_today",
          runId: null,
          platform,
          chunk: {
            offset: chunkOffset,
            limit: chunkLimit,
            promptsPolled: 0,
          },
          observationsWritten: 0,
          snapshotsWritten: 0,
          errorCount: 0,
          costEstimateUsd: 0,
          completedAt: null,
          note: `A completed ${source} run already landed within the last 20 hours. Pass force=true to bypass (or use chunk mode, which uses a 15-minute retry-dedupe window instead).`,
        };
      }
    }
  }

  // ── Run the poll ────────────────────────────────────────────────────
  const result = await runAdapter(platform, tenantId, {
    offset: args.offset,
    limit: args.limit,
  });
  const run = result.observationRun;

  // ── Sync raw artifacts ──────────────────────────────────────────────
  await syncRuns([run]);
  await syncObs(result.observations);
  await syncTexts(result.answerTexts);

  // ── Derive + sync daily snapshots ───────────────────────────────────
  // Chunk mode: derive from ALL of today's observations for this tenant +
  // platform, not just this chunk's. This way chunk 1 sees 25 obs, chunk 2
  // sees 50 obs (accumulated), etc. Resulting snapshot always reflects
  // current-day truth regardless of which chunks have completed.
  //
  // Non-chunk mode: keep the original behavior (derive from just this run).
  // Full-run callers see identical semantics to pre-Step-1.5.
  const entities = await getEntities();
  const date = run.completed_at.slice(0, 10); // YYYY-MM-DD (UTC)
  const observationsForDerivation: PromptAnswerObservation[] = isChunked
    ? await getDayObs({
        tenantId,
        // NB: observation-level label, not the NativePollPlatform enum.
        // "openai" (enum) vs "chatgpt" (stored on observations) — mismatched
        // before this mapping was added; caused entity-row zeroing on
        // 2026-04-23 for ChatGPT.
        platform: OBSERVATION_PLATFORM_LABEL[platform],
        date,
      })
    : result.observations;

  const snapshots = buildSnaps({
    tenantId,
    platform: platformLabel,
    observations: observationsForDerivation,
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
    chunk: {
      offset: chunkOffset,
      limit: chunkLimit,
      promptsPolled: result.observations.length,
    },
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
  chunk: { offset?: number; limit?: number },
): Promise<PerplexityPollResult> {
  if (platform === "perplexity")
    return pollPerplexityForTenant(tenantId, {
      offset: chunk.offset,
      limit: chunk.limit,
    });
  if (platform === "openai")
    return pollOpenAIForTenant(tenantId, {
      offset: chunk.offset,
      limit: chunk.limit,
    });
  throw new Error(`Unknown native platform: ${platform}`);
}

async function defaultGetObservationsForDay(args: {
  tenantId: string;
  platform: string;
  date: string;
}): Promise<PromptAnswerObservation[]> {
  const sb = getSupabaseAdmin();
  const dayStart = `${args.date}T00:00:00.000Z`;
  // [dayStart, nextDayStart) — exclusive upper bound avoids 23:59:59.999 edge
  const [y, m, d] = args.date.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  const nextDayStart = next.toISOString().slice(0, 10) + "T00:00:00.000Z";

  const { data, error } = await sb
    .from("prompt_answer_observations")
    .select("*")
    .eq("tenant_id", args.tenantId)
    .eq("platform", args.platform)
    .gte("observed_at", dayStart)
    .lt("observed_at", nextDayStart)
    .limit(10000);
  if (error) {
    throw new Error(
      `getObservationsForDay query failed: ${error.message}`,
    );
  }
  return (data ?? []) as PromptAnswerObservation[];
}

async function defaultHasRecentChunk(
  source: string,
  offset: number,
  limit: number | null,
): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const cutoff = new Date(
      Date.now() - CHUNK_RETRY_DEDUPE_WINDOW_MS,
    ).toISOString();
    // Match on scope_label suffix that embeds chunk identity:
    //   "Native <platform> poll · chunk offset=<N> limit=<M> · ..."
    const chunkLabel = `%chunk offset=${offset} limit=${limit ?? "all"}%`;
    const { data, error } = await sb
      .from("observation_runs")
      .select("run_id")
      .eq("source", source)
      .eq("status", "completed")
      .ilike("scope_label", chunkLabel)
      .gt("completed_at", cutoff)
      .limit(1);
    if (error) {
      console.error(
        `[runNativePoll] chunk-retry-dedupe query failed (fail-open): ${error.message}`,
      );
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error(
      `[runNativePoll] chunk-retry-dedupe threw (fail-open): ${e instanceof Error ? e.message : e}`,
    );
    return false;
  }
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
