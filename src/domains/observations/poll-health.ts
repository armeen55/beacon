import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { ObservationRun } from "./types";

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

export type PollPlatform = "perplexity" | "chatgpt";
export type PollHealthStatus = "ok" | "partial" | "failed" | "pending";

export type PlatformPollHealth = {
  platform: PollPlatform;
  /** Chunk target (typically 4). Falls back to 1 for legacy whole-mode runs. */
  expectedChunks: number;
  completedChunks: number;
  failedChunks: number;
  /** Sum of successful prompt counts across completed chunks. */
  observationsWritten: number;
  status: PollHealthStatus;
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
 */
export function computePollHealthFromRuns(
  dateISO: string,
  runs: ObservationRun[],
): PollHealthSnapshot {
  return {
    date: dateISO,
    platforms: PLATFORM_SOURCES.map(({ source, platform }) =>
      computePlatformHealth(
        platform,
        runs.filter((r) => r.source === source),
      ),
    ),
  };
}

/**
 * Fetch observation_runs for the given UTC date and compute the per-platform
 * health. Thin wrapper over Supabase + `computePollHealthFromRuns`.
 */
export async function fetchPollHealthForDate(
  dateISO: string,
): Promise<PollHealthSnapshot> {
  const dayStart = `${dateISO}T00:00:00.000Z`;
  const dayEnd = `${dateISO}T23:59:59.999Z`;

  const { data, error } = await getSupabaseAdmin()
    .from("observation_runs")
    .select("*")
    .in(
      "source",
      PLATFORM_SOURCES.map((p) => p.source),
    )
    .gte("started_at", dayStart)
    .lte("started_at", dayEnd)
    .order("started_at", { ascending: false });

  if (error) {
    throw new Error(`poll-health query failed: ${error.message}`);
  }

  const runs = (data ?? []) as ObservationRun[];
  return computePollHealthFromRuns(dateISO, runs);
}

/** YYYY-MM-DD in UTC from an optional injected clock. */
export function todayISOUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function computePlatformHealth(
  platform: PollPlatform,
  runs: ObservationRun[],
): PlatformPollHealth {
  if (runs.length === 0) {
    return {
      platform,
      expectedChunks: EXPECTED_CHUNKS,
      completedChunks: 0,
      failedChunks: 0,
      observationsWritten: 0,
      status: "pending",
    };
  }

  const sortedDesc = [...runs].sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );

  // Partition chunk-mode vs whole-mode runs by scope_label shape.
  // Chunk runs carry "chunk offset=N limit=M"; whole-mode runs don't.
  const chunks = sortedDesc.filter((r) => /chunk offset=/i.test(r.scope_label));
  const wholes = sortedDesc.filter(
    (r) => !/chunk offset=/i.test(r.scope_label),
  );

  if (chunks.length === 0) {
    // Legacy whole-mode path (e.g. local CLI runs or pre-chunk-era rows).
    const latest = wholes[0];
    const observations = parseObsCountFromScopeLabel(latest.scope_label);
    const status: PollHealthStatus = mapRunStatusToHealthStatus(latest.status);
    return {
      platform,
      expectedChunks: 1,
      completedChunks: latest.status === "completed" ? 1 : 0,
      failedChunks: latest.status === "failed" ? 1 : 0,
      observationsWritten: latest.status === "completed" ? observations : 0,
      status,
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
  const observationsWritten = uniqueChunks
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + parseObsCountFromScopeLabel(r.scope_label), 0);

  const status: PollHealthStatus =
    completedChunks >= EXPECTED_CHUNKS
      ? "ok"
      : completedChunks > 0
        ? "partial"
        : "failed";

  const latest = uniqueChunks[0];
  return {
    platform,
    expectedChunks: EXPECTED_CHUNKS,
    completedChunks,
    failedChunks,
    observationsWritten,
    status,
    latestRun: {
      runId: latest.run_id,
      startedAt: latest.started_at,
      completedAt: latest.completed_at,
      scopeLabel: latest.scope_label,
      runStatus: latest.status,
    },
  };
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
