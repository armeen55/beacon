import "server-only";

/**
 * N13 recrawl demotion, the tenant runner (2026-07-03).
 *
 * Thin I/O shell around the pure `selectRecrawlDemotions` core, mirroring
 * `queue-sweeper.ts`'s `sweepQueueForTenant`: load the tenant's rows + latest
 * page snapshots, select the rows a fresh crawl proves are already resolved,
 * mark each `expired` (machine hygiene, re-promotable if the page regresses),
 * and STAMP the honest retirement note onto `why` so the retired card can
 * explain itself. Idempotent (status upsert by row id). Runs inside the nightly
 * generation job alongside the sweeper (no new cron).
 *
 * Byte-identical when nothing is resolved: the runner returns early with zero
 * writes when `selectRecrawlDemotions` finds no satisfied precondition.
 */

import { getRepository } from "@/lib/persistence/repositories";
import { syncRecommendedEdits } from "@/lib/persistence/dual-write";
import {
  persistRecommendedEditsLocal,
  type RecommendedEditRow,
} from "./recommended-edits-persistence";
import { selectRecrawlDemotions, latestSnapshotByPath } from "./recrawl-demotion";
import type { PageSnapshot } from "@/domains/pages/types";

export type RecrawlDemotionResult = {
  retired: number;
  sync_warning: string | null;
};

export type RecrawlDemotionDeps = {
  loadRows?: (tenantId: string) => Promise<RecommendedEditRow[]>;
  loadSnapshots?: (tenantId: string) => Promise<PageSnapshot[]>;
  persistLocal?: (rows: RecommendedEditRow[]) => Promise<void>;
  syncRows?: (rows: RecommendedEditRow[], tenantId: string) => Promise<void>;
  now?: Date;
};

export async function demoteResolvedForTenant(
  tenantId: string,
  deps: RecrawlDemotionDeps = {},
): Promise<RecrawlDemotionResult> {
  const now = deps.now ?? new Date();
  const loadRows =
    deps.loadRows ?? ((id: string) => getRepository().forTenant(id).getRecommendedEdits());
  const loadSnapshots =
    deps.loadSnapshots ?? ((id: string) => getRepository().forTenant(id).getPageSnapshots());

  const [rows, snapshots] = await Promise.all([loadRows(tenantId), loadSnapshots(tenantId)]);
  const demotions = selectRecrawlDemotions(rows, latestSnapshotByPath(snapshots));

  if (demotions.length === 0) {
    return { retired: 0, sync_warning: null };
  }

  const nowIso = now.toISOString();
  const updated = demotions.map(({ row, note }) => ({
    ...row,
    implementation_status: "expired" as const,
    // Stamp the honest "you already fixed this" note so the retired card
    // explains itself instead of vanishing silently.
    why: note,
    updated_at: nowIso,
  }));

  await (deps.persistLocal ?? persistRecommendedEditsLocal)(updated);
  let sync_warning: string | null = null;
  try {
    await (deps.syncRows ?? syncRecommendedEdits)(updated, tenantId);
  } catch (err) {
    sync_warning = err instanceof Error ? err.message : String(err);
  }

  return { retired: demotions.length, sync_warning };
}
