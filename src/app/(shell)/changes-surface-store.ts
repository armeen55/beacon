import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { ChangesView } from "./changes-data";

/**
 * changes-surface-store (W2-B, 2026-07-10) - a tenant-scoped stale-while-revalidate
 * cache of the fully-fused, ranked /changes list (the ChangesView).
 *
 * The cold compute (buildChangesViewUncached) runs fuseUnifiedList (the unified
 * allocator, measured ~14s) AND a demand-graph-backed New-Pages board read for the
 * dedupe pass on EVERY render - only `react.cache` (per-request), no cross-request
 * persistence - flooring /changes (and every surface that reads the same view:
 * Today, the lifecycle counts, the page dossier). This snapshots the finished
 * ChangesView so a warm render serves the last snapshot INSTANTLY and refreshes in
 * the background.
 *
 * Same discipline as worklist-surface-store.ts:
 *   - Honest staleness: the snapshot carries `computedAt` (the page shows an
 *     "I ranked these N ago" line), the TTL bounds drift, and mutating actions
 *     (prepare / curate / regenerate drafts / ship a change) invalidate it.
 *   - Presentation cache ONLY: the moves/plan/ledger sources are untouched;
 *     deleting this snapshot loses nothing (it just recomputes next visit).
 *   - Tenant-scoped (store-classification.ts) + Supabase-mirrored (json-store.ts)
 *     so one tenant never serves another's list and it stays warm across lambdas.
 *
 * Unlike worklist-surface, the COLD path never blocks: a first-ever render serves
 * an honest "building" empty state and schedules the rebuild (see changes-data.ts),
 * because the fuse can exceed the page's 25s always-paint floor.
 */

const STORE = "changes-surface";

/** Serve the cached snapshot instantly always; background-refresh once older than this. */
export const CHANGES_SURFACE_FRESH_MS = 15 * 60 * 1000;

export type ChangesSurfaceRow = { computedAt: string; view: ChangesView };

export async function readChangesSurface(): Promise<ChangesSurfaceRow | null> {
  const rows = await readStore<ChangesSurfaceRow>(STORE, []).catch(() => [] as ChangesSurfaceRow[]);
  const row = rows[0];
  return row && row.view && Array.isArray(row.view.changes) ? row : null;
}

export async function writeChangesSurface(view: ChangesView, computedAtIso: string): Promise<void> {
  // Empty-rebuild guard (replicates worklist-surface-store's 2026-07-02 guard):
  // buildChangesViewUncached is fail-soft, so a degraded build during a data outage
  // can "successfully" produce a zero-change list. Persisting that over a real
  // snapshot poisons the SWR cache and /changes renders "No changes yet" (a lie)
  // until the next healthy rebuild. An empty rebuild never replaces a non-empty
  // snapshot; a legitimate reset goes through invalidateChangesSurface() explicitly.
  if (view.changes.length === 0) {
    const existing = await readChangesSurface();
    if (existing && existing.view.changes.length > 0) {
      console.warn(
        `[changes-surface] refusing to overwrite a snapshot holding ${existing.view.changes.length} ranked changes with an empty rebuild (likely a degraded build during a data outage); keeping the snapshot from ${existing.computedAt}`,
      );
      return;
    }
  }
  await writeStore<ChangesSurfaceRow>(STORE, [{ computedAt: computedAtIso, view }]).catch(() => {});
}

/** Invalidate the cache so the next /changes load recomputes (call after a mutation). */
export async function invalidateChangesSurface(): Promise<void> {
  await writeStore<ChangesSurfaceRow>(STORE, []).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isChangesSurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > CHANGES_SURFACE_FRESH_MS;
}
