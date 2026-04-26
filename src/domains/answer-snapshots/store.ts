/**
 * Answer Snapshot Store — persists captured AI answers from native querying.
 *
 * Stage 1: Perplexity-only. Stage 2+: multi-model.
 * Follows the same json-store pattern as experiment-store and recommendation-response-store.
 */

import "server-only";

import { cache } from "react";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { AnswerSnapshot } from "./types";

const STORE_NAME = "answer-snapshots";

// Sprint 7 Phase 7.8e-3 (2026-04-26): module-level top-level await
// replaced with cached async getter. Mutators are now async.
let _state: AnswerSnapshot[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await readStore<AnswerSnapshot>(STORE_NAME);
});

export const getAnswerSnapshots = cache(
  async (): Promise<AnswerSnapshot[]> => {
    await ensureLoaded();
    return _state!;
  },
);

export async function persistAnswerSnapshots(): Promise<void> {
  await writeStore(STORE_NAME, await getAnswerSnapshots());
}

export async function appendSnapshot(snapshot: AnswerSnapshot): Promise<void> {
  const answerSnapshots = await getAnswerSnapshots();
  const existing = answerSnapshots.findIndex((s) => s.id === snapshot.id);
  if (existing >= 0) {
    answerSnapshots[existing] = snapshot;
  } else {
    answerSnapshots.push(snapshot);
  }
}

export async function getSnapshotsByPrompt(
  promptId: string,
): Promise<AnswerSnapshot[]> {
  return (await getAnswerSnapshots()).filter((s) => s.prompt_id === promptId);
}

export async function getLatestSnapshots(
  limit = 50,
): Promise<AnswerSnapshot[]> {
  return [...(await getAnswerSnapshots())]
    .sort((a, b) => b.sampled_at.localeCompare(a.sampled_at))
    .slice(0, limit);
}

export async function getSnapshotsByPlatform(
  platform: string,
): Promise<AnswerSnapshot[]> {
  return (await getAnswerSnapshots()).filter((s) => s.platform === platform);
}

export async function getSnapshotsByRunId(
  runId: string,
): Promise<AnswerSnapshot[]> {
  return (await getAnswerSnapshots()).filter((s) => s.run_id === runId);
}

export async function getSnapshotSummary(): Promise<{
  total: number;
  byPlatform: Record<string, number>;
  latestSampledAt: string | null;
  uniquePrompts: number;
}> {
  const answerSnapshots = await getAnswerSnapshots();
  const byPlatform: Record<string, number> = {};
  const promptIds = new Set<string>();
  let latest: string | null = null;

  for (const s of answerSnapshots) {
    byPlatform[s.platform] = (byPlatform[s.platform] ?? 0) + 1;
    promptIds.add(s.prompt_id);
    if (!latest || s.sampled_at > latest) {
      latest = s.sampled_at;
    }
  }

  return {
    total: answerSnapshots.length,
    byPlatform,
    latestSampledAt: latest,
    uniquePrompts: promptIds.size,
  };
}

export function _resetAnswerSnapshotsForTests(): void {
  _state = null;
}
