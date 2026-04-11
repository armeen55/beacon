/**
 * Answer Snapshot Store — persists captured AI answers from native querying.
 *
 * Stage 1: Perplexity-only. Stage 2+: multi-model.
 * Follows the same json-store pattern as experiment-store and recommendation-response-store.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { AnswerSnapshot } from "./types";

const STORE_NAME = "answer-snapshots";

export const answerSnapshots: AnswerSnapshot[] =
  readStore<AnswerSnapshot>(STORE_NAME);

export async function persistAnswerSnapshots(): Promise<void> {
  await writeStore(STORE_NAME, answerSnapshots);
}

export function appendSnapshot(snapshot: AnswerSnapshot): void {
  const existing = answerSnapshots.findIndex((s) => s.id === snapshot.id);
  if (existing >= 0) {
    answerSnapshots[existing] = snapshot;
  } else {
    answerSnapshots.push(snapshot);
  }
}

export function getSnapshotsByPrompt(promptId: string): AnswerSnapshot[] {
  return answerSnapshots.filter((s) => s.prompt_id === promptId);
}

export function getLatestSnapshots(limit = 50): AnswerSnapshot[] {
  return [...answerSnapshots]
    .sort((a, b) => b.sampled_at.localeCompare(a.sampled_at))
    .slice(0, limit);
}

export function getSnapshotsByPlatform(platform: string): AnswerSnapshot[] {
  return answerSnapshots.filter((s) => s.platform === platform);
}

export function getSnapshotsByRunId(runId: string): AnswerSnapshot[] {
  return answerSnapshots.filter((s) => s.run_id === runId);
}

export function getSnapshotSummary(): {
  total: number;
  byPlatform: Record<string, number>;
  latestSampledAt: string | null;
  uniquePrompts: number;
} {
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
