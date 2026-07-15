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

export type ChangesSurfaceRow = { computedAt: string; tenantId?: string; view: ChangesView };

export async function readChangesSurface(tenantId?: string): Promise<ChangesSurfaceRow | null> {
  const rows = await readStore<ChangesSurfaceRow>(STORE, [], { tenantId }).catch(() => [] as ChangesSurfaceRow[]);
  const row = rows[0];
  // Fail closed on a legacy or mismatched snapshot. The store key alone is not
  // sufficient: before the 2026-07-14 P0 fix, an explicit Iranopedia write could
  // contain worklist content loaded from the ambient Ritz env fallback.
  if (tenantId && row?.tenantId !== tenantId) return null;
  return row && row.view && Array.isArray(row.view.changes) ? row : null;
}

/**
 * P2-f (2026-07-10, visual audit) - `tenantId` should always be passed by a background
 * caller: changes-data.ts's after() rebuild already threads the correct tenant into
 * `build(tenantId)`, so this write (and its internal existing-snapshot read below) must
 * resolve the SAME tenant explicitly, never fall back to json-store's ambient
 * currentTenantSlug() resolution outside the render's request scope. Optional only for
 * backward compatibility; every real caller today passes it.
 */
export async function writeChangesSurface(view: ChangesView, computedAtIso: string, tenantId?: string): Promise<void> {
  // Empty-rebuild guard (replicates worklist-surface-store's 2026-07-02 guard):
  // buildChangesViewUncached is fail-soft, so a degraded build during a data outage
  // can "successfully" produce a zero-change list. Persisting that over a real
  // snapshot poisons the SWR cache and /changes renders "No changes yet" (a lie)
  // until the next healthy rebuild. An empty rebuild never replaces a non-empty
  // snapshot; a legitimate reset goes through invalidateChangesSurface() explicitly.
  if (view.changes.length === 0) {
    const existing = await readChangesSurface(tenantId);
    if (existing && existing.view.changes.length > 0) {
      console.warn(
        `[changes-surface] refusing to overwrite a snapshot holding ${existing.view.changes.length} ranked changes with an empty rebuild (likely a degraded build during a data outage); keeping the snapshot from ${existing.computedAt}`,
      );
      return;
    }
  }
  await writeStore<ChangesSurfaceRow>(STORE, [{ computedAt: computedAtIso, tenantId, view }], { tenantId }).catch(() => {});
}

/**
 * Mark the snapshot stale without deleting the last-known-good list.
 *
 * Mutations used to empty this store. The very next navigation therefore had
 * nothing useful to render and showed a rebuilding screen even though Beacon
 * still had a perfectly valid previous ranking. Preserve that ranking, age its
 * timestamp, and let the normal SWR path replace it atomically in the
 * background. A true first-ever tenant still has no row and remains cold.
 */
export async function invalidateChangesSurface(tenantId?: string): Promise<void> {
  const existing = await readChangesSurface(tenantId).catch(() => null);
  if (!existing) return;
  await writeStore<ChangesSurfaceRow>(
    STORE,
    [{ ...existing, computedAt: new Date(0).toISOString() }],
    tenantId ? { tenantId } : {},
  ).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isChangesSurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > CHANGES_SURFACE_FRESH_MS;
}
