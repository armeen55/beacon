import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { ObservationRun } from "./types";
// Pure canonicalization helper lives in a client-safe module so the
// Today v2 chart can reuse it without dragging server-only into the
// browser bundle. Re-exported below for backwards compatibility with
// callers that already import from this file.
import {
  canonicalizePollPlatform as canonicalizePollPlatformPure,
  type PollPlatform as PollPlatformPure,
} from "./poll-platform-canonical";

export type PollPlatform = PollPlatformPure;
export const canonicalizePollPlatform = canonicalizePollPlatformPure;

/**
 * Poll-health surfaces whether yesterday's (or today's) native poll cron
 * actually ran cleanly. The UI renders a status strip at the top of /today
 * and the `scripts/check-yesterday-poll.ts` canary calls this module to
 * decide whether to exit non-zero and trip a GitHub Actions email alert.
 *
 * Context: hosted polling chunks each platform's 100 prompts into 4 × 25,
 * fired sequentially from a GitHub Actions workflow. On 2026-04-23, ChatGPT's
 * 4 chunks all failed silently (OPENAI_API_KEY missing from Vercel env);
 * curl returned HTTP 200 with `status: "failed"` JSON bodies, GitHub reported
 * the job green, and the silent failure was only caught hours later via
 * manual probe. This module fixes that blind spot.
 */

/** Sources the native polling pipeline writes to observation_runs. */
const PLATFORM_SOURCES = [
  { source: "perplexity-native-poll", platform: "perplexity" as const },
  { source: "openai-native-poll", platform: "chatgpt" as const },
];

/** Current chunked hosting contract: 4 sequential chunks of 25 prompts each. */
const EXPECTED_CHUNKS = 4;

export type PollHealthStatus = "ok" | "partial" | "failed" | "pending";

/**
 * Partial-day patch (2026-05-04, post-W4 audit): describes the SHAPE
 * of a day's sample, independent of run-level pass/fail.
 *
 *   "full"    → ≥ 80 observations persisted (a normal-sized daily run).
 *   "partial" → 10–79 observations persisted (some chunks landed but
 *               not enough to power headline deltas confidently).
 *   "proof"   → 1–9 observations persisted (a manual-proof-style run;
 *               these days should NOT distort headline KPI deltas as
 *               if they were full days).
 *   "empty"   → 0 observations persisted on this platform today.
 *
 * The thresholds are operator-locked at 80 / 10 / 1; downstream
 * surfaces (KPI tiles, sparklines) read this field to mute or warn
 * on small-sample days. Backwards compatibility: when the cross-check
 * isn't supplied to `computePollHealthFromRuns` (legacy callers), the
 * field is always `"full"` for runs with completedChunks > 0 and
 * `"empty"` otherwise — no behavioral change.
 */
export type SamplingStatus = "full" | "partial" | "proof" | "empty";

/** Operator-locked thresholds. */
export const FULL_RUN_PROMPT_FLOOR = 80;
export const PROOF_RUN_PROMPT_CEIL = 9;

export type PlatformPollHealth = {
  platform: PollPlatform;
  /** Chunk target (typically 4). Falls back to 1 for legacy whole-mode runs. */
  expectedChunks: number;
  completedChunks: number;
  failedChunks: number;
  /** Sum of successful prompt counts across completed chunks. */
  observationsWritten: number;
  status: PollHealthStatus;
  /**
   * Partial-day classifier. Use this to gate headline KPI deltas /
   * sparkline rendering. Defaults to "full" when no cross-check is
   * provided (legacy back-compat).
   */
  samplingStatus: SamplingStatus;
  latestRun?: {
    runId: string;
    startedAt: string;
    completedAt: string;
    scopeLabel: string;
    runStatus: ObservationRun["status"];
  };
};

export type PollHealthSnapshot = {
  /** ISO date (YYYY-MM-DD) of the day checked, UTC. */
  date: string;
  platforms: PlatformPollHealth[];
};

/**
 * Pure compute — takes the observation_runs for a given day and reduces them
 * into a per-platform health summary. Testable without a DB.
 *
 * Bug-1 fix (2026-05-04): the `actualObservationsByPlatform` parameter
 * carries the count of rows actually persisted to
 * `prompt_answer_observations` for the given date+platform+tenant. If the
 * scope_label parsed from `observation_runs` reports "25/25 prompts"
 * (per-chunk, summed across 4 chunks = 100) but only 0 rows actually
 * landed in Supabase (silent dual-write failure pre-2026-05-04 dual-write
 * fix), the platform's status is downgraded from `ok` to `failed` and
 * `observationsWritten` reflects DB truth, not poll-API truth.
 */
export function computePollHealthFromRuns(
  dateISO: string,
  runs: ObservationRun[],
  actualObservationsByPlatform?: Partial<Record<PollPlatform, number>>,
): PollHealthSnapshot {
  return {
    date: dateISO,
    platforms: PLATFORM_SOURCES.map(({ source, platform }) =>
      computePlatformHealth(
        platform,
        runs.filter((r) => r.source === source),
        actualObservationsByPlatform
          ? (actualObservationsByPlatform[platform] ?? 0)
          : null,
      ),
    ),
  };
}

/**
 * Fetch observation_runs for the given UTC date and compute the per-platform
 * health. Thin wrapper over Supabase + `computePollHealthFromRuns`.
 *
 * Bug-1 fix (2026-05-04): also fetches the actual count of
 * `prompt_answer_observations` rows that landed for the given date,
 * scoped by tenant. Cross-checking the run-level scope_label string
 * against DB truth catches the silent-failure pattern where chunks
 * report "completed" but rows didn't persist (e.g., schema gap).
 */
export async function fetchPollHealthForDate(
  dateISO: string,
  tenantId?: string,
): Promise<PollHealthSnapshot> {
  const dayStart = `${dateISO}T00:00:00.000Z`;
  const dayEnd = `${dateISO}T23:59:59.999Z`;
  const sb = getSupabaseAdmin();

  let runsQuery = sb
    .from("observation_runs")
    .select("*")
    .in(
      "source",
      PLATFORM_SOURCES.map((p) => p.source),
    )
    .gte("started_at", dayStart)
    .lte("started_at", dayEnd)
    .order("started_at", { ascending: false });
  if (tenantId) runsQuery = runsQuery.eq("tenant_id", tenantId);
  const { data, error } = await runsQuery;

  if (error) {
    throw new Error(`poll-health query failed: ${error.message}`);
  }

  // Cross-check: count actual observations persisted for the day, per
  // platform. We canonicalize the platform value because native polls
  // write lowercase ("chatgpt") while historical_recovered W4 rows
  // carry capitalized labels ("ChatGPT") — the same canonicalization
  // applied in enrichment-rollup keeps both surfaces consistent.
  const actual: Record<PollPlatform, number> = {
    perplexity: 0,
    chatgpt: 0,
  } as Record<PollPlatform, number>;
  let obsQuery = sb
    .from("prompt_answer_observations")
    .select("platform")
    .gte("observed_at", dayStart)
    .lte("observed_at", dayEnd);
  if (tenantId) obsQuery = obsQuery.eq("tenant_id", tenantId);
  const { data: obsRows, error: obsErr } = await obsQuery;
  if (obsErr) {
    throw new Error(`poll-health obs-count query failed: ${obsErr.message}`);
  }
  for (const row of (obsRows ?? []) as Array<{ platform: string | null }>) {
    const canon = canonicalizePollPlatform(row.platform);
    if (canon === "chatgpt" || canon === "perplexity") {
      actual[canon] = (actual[canon] ?? 0) + 1;
    }
  }

  const runs = (data ?? []) as ObservationRun[];
  return computePollHealthFromRuns(dateISO, runs, actual);
}

// Canonical `canonicalizePollPlatform` lives in `poll-platform-canonical.ts`
// (pure, client-safe). Re-exported at the top of this file for
// backwards compatibility with existing import sites.

/** YYYY-MM-DD in UTC from an optional injected clock. */
export function todayISOUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function computePlatformHealth(
  platform: PollPlatform,
  runs: ObservationRun[],
  /**
   * Bug-1 fix (2026-05-04). When provided, this is the actual count of
   * `prompt_answer_observations` rows that landed in Supabase for the
   * given date+platform+tenant. We use it to:
   *   1. Override `observationsWritten` (DB truth, not poll-API claim).
   *   2. Downgrade status from "ok" → "failed" when chunks reported
   *      "completed" yet zero rows persisted (silent dual-write).
   *
   * `null` preserves legacy behavior — no override, no downgrade.
   * Existing tests that don't supply this arg are unaffected.
   */
  actualObservationsPersisted: number | null,
): PlatformPollHealth {
  if (runs.length === 0) {
    return {
      platform,
      expectedChunks: EXPECTED_CHUNKS,
      completedChunks: 0,
      failedChunks: 0,
      observationsWritten: 0,
      status: "pending",
      samplingStatus: "empty",
    };
  }

  const sortedDesc = [...runs].sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );

  // Partition chunk-mode vs whole-mode runs by scope_label shape.
  //
  // Real chunk runs carry "chunk offset=N limit=M" with a NUMERIC limit
  // (e.g. "limit=25") — those land 4×25 prompts to make 100/day.
  //
  // Whole-mode runs are EITHER pre-chunk-era / local-CLI rows that have
  // no "chunk offset=" token at all, OR — important — direct-CLI cron
  // runs (Bundle 2, 2026-05-07) that emit "chunk offset=0 limit=all"
  // because the adapter's scope_label template always embeds the
  // offset/limit fields. With limit=all the adapter polls 100 prompts
  // in ONE observation_run, so the canary should treat it as whole-mode
  // (1/1 chunks ok), NOT 1-of-4-partial.
  //
  // 2026-05-08 incident regression: pre-fix the regex `/chunk offset=/i`
  // matched both shapes, so today's direct-CLI runs (after the UTC-day
  // guard fix landed and the 200 obs persisted cleanly) got classified
  // as 1/4 partial → check-yesterday-poll exit 1 → verify-persistence
  // job RED despite the data landing perfectly. Tightening the regex
  // to require `limit=\d+` (numeric) routes `limit=all` to the
  // whole-mode branch where the legacy logic at line ~250 correctly
  // reports 1/1 ok.
  const chunks = sortedDesc.filter((r) =>
    /chunk offset=\d+ limit=\d+/i.test(r.scope_label),
  );
  const wholes = sortedDesc.filter(
    (r) => !/chunk offset=\d+ limit=\d+/i.test(r.scope_label),
  );

  if (chunks.length === 0) {
    // Legacy whole-mode path (e.g. local CLI runs or pre-chunk-era rows).
    const latest = wholes[0];
    const reportedObs = parseObsCountFromScopeLabel(latest.scope_label);
    const baseStatus: PollHealthStatus = mapRunStatusToHealthStatus(latest.status);
    const reportedWritten = latest.status === "completed" ? reportedObs : 0;
    // When persistence is unknown (legacy callers), fall back to scope_label.
    // When persistence IS known, prefer DB truth + apply silent-fail downgrade.
    const observationsWritten =
      actualObservationsPersisted !== null
        ? actualObservationsPersisted
        : reportedWritten;
    const finalStatus =
      actualObservationsPersisted !== null
        ? downgradeIfPersistenceMissing(
            baseStatus,
            reportedWritten,
            actualObservationsPersisted,
          )
        : baseStatus;
    return {
      platform,
      expectedChunks: 1,
      completedChunks: latest.status === "completed" ? 1 : 0,
      failedChunks: latest.status === "failed" ? 1 : 0,
      observationsWritten,
      status: finalStatus,
      samplingStatus: classifySampling(observationsWritten),
      latestRun: {
        runId: latest.run_id,
        startedAt: latest.started_at,
        completedAt: latest.completed_at,
        scopeLabel: latest.scope_label,
        runStatus: latest.status,
      },
    };
  }

  // Chunk mode — dedupe by offset, most-recent wins. The hosted endpoint's
  // 15-min retry-dedupe prevents same-offset double-writes within a window,
  // but over 24h a legitimate retry could insert a second row. We always
  // take the latest per-offset as the authoritative state.
  const byOffset = new Map<number, ObservationRun>();
  for (const run of chunks) {
    const offset = parseChunkOffsetFromScopeLabel(run.scope_label);
    if (offset === null) continue;
    const existing = byOffset.get(offset);
    if (
      !existing ||
      new Date(run.started_at).getTime() >
        new Date(existing.started_at).getTime()
    ) {
      byOffset.set(offset, run);
    }
  }

  const uniqueChunks = Array.from(byOffset.values()).sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );

  const completedChunks = uniqueChunks.filter(
    (r) => r.status === "completed",
  ).length;
  const failedChunks = uniqueChunks.filter(
    (r) => r.status === "failed",
  ).length;
  const reportedFromScope = uniqueChunks
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + parseObsCountFromScopeLabel(r.scope_label), 0);

  const baseStatus: PollHealthStatus =
    completedChunks >= EXPECTED_CHUNKS
      ? "ok"
      : completedChunks > 0
        ? "partial"
        : "failed";

  // Bug-1 fix (2026-05-04): cross-check chunk-level scope_label totals
  // against actual rows that landed in `prompt_answer_observations`.
  // Pre-2026-05-04, the dual-write path could silently swallow Supabase
  // schema-cache errors (PGRST204) — the runs would stamp as
  // `completed` with "25/25 prompts" in scope_label even though zero
  // rows persisted. Surface the truth: report the DB count and
  // downgrade status from "ok" → "failed" when persistence is fully
  // missing despite "completed" runs.
  //
  // When persistence is unknown (legacy callers — no third arg), fall
  // back to scope_label totals + don't downgrade.
  const observationsWritten =
    actualObservationsPersisted !== null
      ? actualObservationsPersisted
      : reportedFromScope;
  const finalStatus =
    actualObservationsPersisted !== null
      ? downgradeIfPersistenceMissing(
          baseStatus,
          reportedFromScope,
          actualObservationsPersisted,
        )
      : baseStatus;

  const latest = uniqueChunks[0];
  return {
    platform,
    expectedChunks: EXPECTED_CHUNKS,
    completedChunks,
    failedChunks,
    observationsWritten,
    status: finalStatus,
    samplingStatus: classifySampling(observationsWritten),
    latestRun: {
      runId: latest.run_id,
      startedAt: latest.started_at,
      completedAt: latest.completed_at,
      scopeLabel: latest.scope_label,
      runStatus: latest.status,
    },
  };
}

/**
 * Partial-day classifier (2026-05-04). Operator-locked thresholds at
 * 80 / 10 / 1 reflect the production daily-poll target (100 prompts
 * per platform per day). Days that fall below the floor should not
 * drive headline KPI deltas as if they were full days.
 */
export function classifySampling(observationsWritten: number): SamplingStatus {
  if (observationsWritten <= 0) return "empty";
  if (observationsWritten <= PROOF_RUN_PROMPT_CEIL) return "proof";
  if (observationsWritten < FULL_RUN_PROMPT_FLOOR) return "partial";
  return "full";
}

/**
 * Operator R7 (Poll Integrity Hardening, 2026-05-04). Aggregate the
 * per-platform sampling status into a single headline-level status
 * for /today's KPI tiles. WORST-CASE WINS so a single proof-run
 * platform downgrades the headline — better to over-warn than to
 * silently render a 5-obs day as if it were full.
 *
 * Order (worst → best): empty > proof > partial > full.
 */
export function aggregateSamplingStatus(
  snap: PollHealthSnapshot,
): SamplingStatus {
  const order: SamplingStatus[] = ["empty", "proof", "partial", "full"];
  let worstIndex = order.length - 1; // start at "full"
  for (const p of snap.platforms) {
    const idx = order.indexOf(p.samplingStatus);
    if (idx >= 0 && idx < worstIndex) worstIndex = idx;
  }
  return order[worstIndex];
}

/**
 * Bug-1 helper (2026-05-04): if the run-level summary said "ok" with
 * non-zero `reportedFromScope` (per scope_label parsing) but Supabase
 * actually has 0 rows persisted for the day, the upsert silently
 * failed. Surface this as "failed" so /today's banner reflects truth.
 *
 * For partial-persistence (DB has fewer than expected, but > 0), we
 * keep the run-level status. The chunk count is more authoritative
 * than guessing at row-level shortfall thresholds.
 */
function downgradeIfPersistenceMissing(
  baseStatus: PollHealthStatus,
  reportedFromScope: number,
  actualPersisted: number,
): PollHealthStatus {
  if (
    baseStatus === "ok" &&
    reportedFromScope > 0 &&
    actualPersisted === 0
  ) {
    return "failed";
  }
  return baseStatus;
}

function mapRunStatusToHealthStatus(
  runStatus: ObservationRun["status"],
): PollHealthStatus {
  switch (runStatus) {
    case "completed":
      return "ok";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
  }
}

/** Extract "N" from "… · N/M prompts". Returns 0 if absent. */
function parseObsCountFromScopeLabel(label: string): number {
  const match = label.match(/(\d+)\/\d+\s+prompts/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Extract chunk offset integer from "… chunk offset=N limit=M …". */
function parseChunkOffsetFromScopeLabel(label: string): number | null {
  const match = label.match(/chunk offset=(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}
