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
 * Budget guard: if a completed run for the same `(tenant, source)` already
 * landed within the current UTC date, we skip (unless `force=true`). Anchored
 * on the UTC-day boundary because the daily cron fires at 07:00 UTC. A late-
 * completing prior-day run no longer shadows past midnight UTC and blocks
 * the next scheduled day's poll.
 *
 * Why UTC-day, not rolling 20 hours (2026-05-08): the prior shape was a
 * rolling 20h window. On 2026-05-07 a late recovery poll completed at
 * 16:11 UTC. The next scheduled cron at 2026-05-08T07:00 UTC fired only
 * 14h49m later — within the rolling window — so the guard returned `true`,
 * `runNativePoll` returned `skipped_already_ran_today`, no paid API was
 * called, and `verify-persistence` failed because target date 2026-05-08
 * had zero observations. UTC-day-anchoring matches the scheduled cron's
 * mental model (one full poll per UTC date) and prevents the recurrence.
 *
 * Fail-open on budget-check error: if the guard query errors, we log loudly
 * and proceed. Reasoning: a duplicate run costs ~$3.07 and produces idempotent
 * state; a missed day loses a data point permanently. Observability beats
 * over-correction here.
 */

import { pollPerplexityForTenant } from "@/adapters/perplexity/poll";
import { pollOpenAIForTenant } from "@/adapters/openai/poll";
import type { PerplexityPollResult } from "@/adapters/perplexity/poll";
import { recordSpendDualWrite } from "@/lib/cost/budget-ledger-supabase";
import {
  syncPromptAnswerObservations as realSyncObs,
  syncAnswerTexts as realSyncTexts,
  syncObservationRuns as realSyncRuns,
  syncDailyMetricSnapshots as realSyncSnaps,
  syncRawPollChunk as realSyncRawChunk,
  stampRawPollChunkReconciliation as realStampRawRecon,
  type RawPollChunkRow,
} from "@/lib/persistence/dual-write";
import { buildDailySnapshotsFromObservations as realBuildSnaps } from "@/domains/daily-metric-snapshots/build-from-observations";
import { getRepository } from "@/lib/persistence/repositories";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
// Poll Integrity Hardening (2026-05-04, post May 2-4 incident):
import {
  reconcilePolledRun as realReconcile,
  markRunPersistenceFailed as realMarkFailed,
  checkPersistenceGate as realCheckGate,
} from "./poll-integrity";

export type NativePollPlatform = "perplexity" | "openai";

export type NativePollStatus =
  | "completed"
  | "partial"
  | "failed"
  | "skipped_already_ran_today"
  | "skipped_chunk_recently_ran"
  // Poll Integrity Hardening (2026-05-04, post May 2-4 incident):
  // Operator R6 — auto-disable paid polling when the prior run on
  // this source failed persistence. The next paid run is BLOCKED
  // until a successful canary clears the gate or the operator
  // manually acknowledges the failure.
  | "skipped_persistence_failure_gate";

/**
 * Poll Integrity Hardening (2026-05-04). Sub-status flags stamped on
 * the observation_run row via the `counts` jsonb column. Each flag
 * reflects a step in the pipeline that must succeed before the run
 * is considered `verified_complete`.
 *
 * Operator R1 contract (verbatim):
 *   "Do not mark a poll run completed until:
 *     • provider call completed
 *     • raw chunk saved or intentionally skipped with reason
 *     • observations persisted
 *     • snapshots derived
 *     • persisted row count verified"
 */
export type PollIntegritySubStatuses = {
  provider_completed: boolean;
  raw_saved: boolean;
  observations_persisted: boolean;
  snapshots_derived: boolean;
  verified_complete: boolean;
  /** Optional short reason when any of the booleans above is false. */
  failure_reason?: string;
};

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
  /**
   * Budget guard. Returns true if a completed run for `(tenant, source)`
   * already landed within the current UTC date. UTC-day-anchored
   * (2026-05-08 fix) — replaces the prior rolling-20h window.
   *
   * `tenantId` is optional in the deps signature so existing test mocks
   * shaped `async () => false|true` keep working without a positional
   * extra arg. The default impl always passes tenantId in production.
   */
  hasRecentCompletedRun?: (
    source: string,
    tenantId?: string,
  ) => Promise<boolean>;
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
  // Poll Integrity Hardening (2026-05-04, post May 2-4 incident).
  // All injectable for tests so the contract can be exercised without
  // hitting Supabase.
  syncRawPollChunk?: typeof realSyncRawChunk;
  stampRawPollChunkReconciliation?: typeof realStampRawRecon;
  reconcilePolledRun?: typeof realReconcile;
  markRunPersistenceFailed?: typeof realMarkFailed;
  checkPersistenceGate?: typeof realCheckGate;
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
/**
 * Start-of-current-UTC-day as ISO string, e.g. "2026-05-08T00:00:00.000Z".
 *
 * Pure / deterministic; `now` injectable for tests. Used by the budget
 * guard to anchor on the UTC-day boundary instead of a rolling window.
 *
 * Exported because (a) the architecture invariant pins the helper exists,
 * and (b) the unit test exercises it directly across day/year boundaries.
 */
export function utcDayStartIso(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00.000Z`;
}
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
  // Poll Integrity Hardening (2026-05-04).
  const syncRawChunk = deps.syncRawPollChunk ?? realSyncRawChunk;
  const stampRawRecon =
    deps.stampRawPollChunkReconciliation ?? realStampRawRecon;
  const reconcile = deps.reconcilePolledRun ?? realReconcile;
  const markFailed = deps.markRunPersistenceFailed ?? realMarkFailed;
  const checkGate = deps.checkPersistenceGate ?? realCheckGate;

  const isChunked = args.offset !== undefined || args.limit !== undefined;
  const chunkOffset = args.offset ?? 0;
  const chunkLimit = args.limit ?? null;

  // ── Persistence-failure gate (Operator R6) ──────────────────────────
  // Auto-disable paid polling if the latest run on this (tenant,
  // source) failed for persistence reasons. Cleared by a successful
  // canary OR by the operator manually editing the failed run row.
  // Honors `force=true` for legitimate manual override. The previous
  // 20h budget guard + 15min chunk-dedupe both run AFTER this gate.
  if (!force) {
    const gate = await checkGate({ tenantId, source });
    if (!gate.allow) {
      return {
        status: "skipped_persistence_failure_gate",
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
        note: gate.reason,
      };
    }
  }

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
      const recent = await hasRecentRun(source, tenantId);
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
          note: `A completed ${source} run already landed for today (UTC). Pass force=true to bypass (e.g. legitimate same-day re-poll).`,
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

  // ── Poll Integrity Hardening: raw chunk safety net (Operator R3) ────
  // Write the raw provider response to `raw_poll_chunks` BEFORE we
  // run the transform/upsert step. If observation upsert fails (the
  // May 2-4 silent-failure pattern), the raw response is preserved
  // here and a recovery script can reconstruct observations later.
  // Schema-stable: the raw chunk table has minimal, fixed columns so
  // it cannot suffer the same column-drift failure that caused the
  // May 2-4 incident.
  const rawChunkRow: RawPollChunkRow = {
    run_id: run.run_id,
    tenant_id: tenantId,
    platform: OBSERVATION_PLATFORM_LABEL[platform],
    source,
    chunk_offset: chunkOffset,
    chunk_limit: chunkLimit,
    prompt_count: result.observations.length,
    prompt_ids: result.observations.map((o) => o.prompt_id),
    raw_response: {
      // Capture the bare-minimum needed to replay/reconstruct.
      observation_count: result.observations.length,
      answer_text_count: Object.keys(result.answerTexts ?? {}).length,
      answer_texts: result.answerTexts ?? {},
      run_status: run.status,
      scope_label: run.scope_label,
    } as Record<string, unknown>,
    cost_usd: Number(
      (result.observations.length * costRate).toFixed(4),
    ),
  };
  await syncRawChunk(rawChunkRow);

  // ── Sync raw artifacts ──────────────────────────────────────────────
  // Phase 7.7b Commit 4 (2026-04-25): tenant-bind the 3 Tier A writes.
  // syncTexts hits the GLOBAL `answer_texts` table — no tenantId.
  //
  // Order matters: syncRuns writes the run row first (so reconciliation
  // can update it later if obs/snaps fail). syncObs is the most-likely
  // failure point — if it throws (Bug-1 fix: dual-write throws on
  // persistent error), we'll catch below, mark the run failed, and
  // re-throw so the API endpoint returns 5xx.
  await syncRuns([run], tenantId);
  try {
    await syncObs(result.observations, tenantId);
  } catch (obsErr) {
    // Stamp the raw chunk + run row as failed BEFORE re-throwing so
    // /today and the canary can show truthful state. Surface the
    // original error to the caller.
    const message =
      obsErr instanceof Error ? obsErr.message : String(obsErr);
    try {
      await stampRawRecon({
        runId: run.run_id,
        observationsPersistedCount: 0,
        reconciliationStatus: "observation_upsert_threw",
      });
    } catch {
      /* best-effort */
    }
    try {
      await markFailed({
        tenantId,
        runId: run.run_id,
        reasons: [`syncObs threw: ${message}`],
        persistedObsCount: 0,
        expectedObsCount: result.observations.length,
        costUsd: rawChunkRow.cost_usd ?? 0,
      });
    } catch {
      /* best-effort */
    }
    throw obsErr;
  }
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

  let snapshots;
  try {
    snapshots = buildSnaps({
      tenantId,
      platform: platformLabel,
      observations: observationsForDerivation,
      trackedEntities: entities,
      date,
      observationRunId: run.run_id,
    });
    await syncSnaps(snapshots, tenantId);
  } catch (snapErr) {
    const message =
      snapErr instanceof Error ? snapErr.message : String(snapErr);
    try {
      await stampRawRecon({
        runId: run.run_id,
        observationsPersistedCount: result.observations.length,
        reconciliationStatus: "snapshot_derivation_failed",
      });
    } catch {
      /* best-effort */
    }
    try {
      await markFailed({
        tenantId,
        runId: run.run_id,
        reasons: [`snapshot derivation/upsert threw: ${message}`],
        persistedObsCount: result.observations.length,
        expectedObsCount: result.observations.length,
        costUsd: rawChunkRow.cost_usd ?? 0,
      });
    } catch {
      /* best-effort */
    }
    throw snapErr;
  }

  // ── Poll Integrity Hardening: reconciliation (Operator R1 + R2) ─────
  // Read truth from Supabase: count actual persisted obs for this run.
  // Compare to expected. Throw on mismatch so /api/poll/run returns
  // 5xx and the GitHub Actions workflow turns red. This is the LAST
  // gate before we report `status: completed` — the operator's
  // contract requires `verified_complete` AFTER persisted-row count
  // verification.
  const expectedObsCount = result.observations.length;
  const verdict = await reconcile({
    tenantId,
    runId: run.run_id,
    expectedObsCount,
    costUsd: rawChunkRow.cost_usd ?? 0,
  });
  if (!verdict.ok) {
    try {
      await stampRawRecon({
        runId: run.run_id,
        observationsPersistedCount: verdict.persistedObsCount,
        reconciliationStatus: "persistence_mismatch",
      });
    } catch {
      /* best-effort */
    }
    await markFailed({
      tenantId,
      runId: run.run_id,
      reasons: [...verdict.reasons],
      persistedObsCount: verdict.persistedObsCount,
      expectedObsCount,
      costUsd: rawChunkRow.cost_usd ?? 0,
    });
    throw new Error(
      `[run-poll] PERSISTENCE RECONCILIATION FAILED for run=${run.run_id}: ${verdict.reasons.join("; ")}`,
    );
  }

  // Reconciliation passed — stamp the raw chunk row + return success.
  try {
    await stampRawRecon({
      runId: run.run_id,
      observationsPersistedCount: verdict.persistedObsCount,
      reconciliationStatus: "verified_complete",
    });
  } catch {
    /* best-effort — reconciliation already passed */
  }

  // ── Phase 2 Stage B.2 (2026-05-09): shadow dual-write to
  // public.llm_budget_ledger. Flag-gated default OFF; never throws.
  // Source of truth in shadow mode is still .data/cost-ledger.json
  // (per-prompt writes inside the adapter). This call records the
  // chunk-level total once per chunk run.
  await recordSpendDualWrite({
    tenantId,
    platform,
    costUsd: rawChunkRow.cost_usd ?? 0,
    promptCount: verdict.persistedObsCount,
    chunkCount: 1,
    runId: run.run_id,
    metadata: {
      scope_label: run.scope_label,
      chunk_offset: chunkOffset,
      chunk_limit: chunkLimit,
    },
  });

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
      // Truth: reconciled persisted-obs count, NOT what the adapter said.
      promptsPolled: verdict.persistedObsCount,
    },
    observationsWritten: verdict.persistedObsCount,
    snapshotsWritten: snapshots.length,
    errorCount: result.errorCount,
    costEstimateUsd: Number(
      (verdict.persistedObsCount * costRate).toFixed(4),
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

/**
 * Default budget guard — UTC-day-anchored (2026-05-08 fix).
 *
 * Returns true iff a completed run for `(source, tenantId?)` exists with
 * `completed_at` falling on the current UTC date. Pre-fix this used a
 * rolling 20h window which silently blocked the next scheduled-day poll
 * after any late prior-day completion (May 7 16:11 UTC → May 8 07:00 UTC =
 * 14h49m, within window).
 *
 * Tenant scope: when `tenantId` is supplied (production callers always do),
 * the query is also `.eq("tenant_id", tenantId)`. With Ritz the only active
 * tenant today, this is byte-equivalent to the unscoped query, but it makes
 * Customer-2 multi-tenant safe — two tenants on the same UTC day no longer
 * shadow each other.
 *
 * Fail-open: any query error logs loudly and returns `false` so the poll
 * proceeds. The downstream chunk-retry-dedupe + persistence-gate cover the
 * accidental-double-fire blast radius if the guard query itself flakes.
 */
async function defaultHasRecentRun(
  source: string,
  tenantId?: string,
): Promise<boolean> {
  try {
    const sb = getSupabaseAdmin();
    const startOfDay = utcDayStartIso();
    let query = sb
      .from("observation_runs")
      .select("run_id")
      .eq("source", source)
      .eq("status", "completed")
      .gte("completed_at", startOfDay)
      .limit(1);
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }
    const { data, error } = await query;
    if (error) {
      console.error(
        `[runNativePoll] today-already-ran query failed (fail-open): ${error.message}`,
      );
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error(
      `[runNativePoll] today-already-ran threw (fail-open): ${e instanceof Error ? e.message : e}`,
    );
    return false;
  }
}
