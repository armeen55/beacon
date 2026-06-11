/**
 * Answer Snapshot Store — persists captured AI answers from native querying.
 *
 * Stage 1: Perplexity-only. Stage 2+: multi-model.
 * Follows the same json-store pattern as experiment-store and recommendation-response-store.
 */

import "server-only";

import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { AnswerSnapshot } from "./types";

const STORE_NAME = "answer-snapshots";

// Sprint 7 Phase 7.8e-3 (2026-04-26): module-level top-level await
// replaced with cached async getter. Mutators are now async.
//
// Night-shift cache sweep (2026-06-11): answer-snapshots is a
// TENANT_SCOPED store, but this held a process-global `let _state` keyed
// by NOTHING — in a warm process the first tenant's snapshots pinned for
// every later tenant (cross-pin). The ambient-routed disk read masked it,
// and this store reads via `readStore` directly (not getRepository), so
// the tenant-scoped-reads ratchet structurally can't catch it. Per-tenant
// Map keyed by currentTenantId now; stable per-tenant array refs preserve
// appendSnapshot()'s in-place push/replace semantics.
const _byTenant = new Map<string, AnswerSnapshot[]>();

const ensureLoaded = cache(async (): Promise<AnswerSnapshot[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await readStore<AnswerSnapshot>(STORE_NAME);
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getAnswerSnapshots = cache(
  async (): Promise<AnswerSnapshot[]> => {
    return ensureLoaded();
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
  _byTenant.clear();
}
