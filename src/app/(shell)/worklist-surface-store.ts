import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { TodayMovesHeroData } from "./today-moves-data";

/**
 * worklist-surface-store (2026-06-29), a tenant-scoped stale-while-revalidate cache of
 * the fully-computed `/changes` surface. The cold render rebuilds the demand graph from
 * Supabase (~32s) on EVERY visit, only `react.cache` (per-request), no cross-request
 * persistence, flooring the page at ~50s. This caches the final `TodayMovesHeroData` so
 * a cold render serves the last snapshot INSTANTLY and refreshes in the background.
 *
 * Honest staleness: the snapshot carries `computedAt` (the UI shows "updated N ago"), the
 * TTL bounds drift, and mutating actions (prepare / enrich-live / mark-shipped) invalidate
 * it so operator changes reflect on the next load. Tenant-scoped (see store-classification)
 * so one tenant never serves another's surface.
 */

const STORE = "worklist-surface";

/** Serve the cached snapshot instantly always; background-refresh once it's older than this. */
export const SURFACE_FRESH_MS = 15 * 60 * 1000;

export type WorklistSurfaceRow = { computedAt: string; tenantId?: string; data: TodayMovesHeroData };

/**
 * P2-f sibling fix (2026-07-10 hygiene batch) - `opts.tenantId`, same purpose as
 * changes-surface-store's: a background caller (moves-data.ts's after() rebuild,
 * or the nightly refreshWorklistSurface entry) already resolves the tenant it means
 * explicitly - this lets it thread that SAME tenant into the read/write instead of
 * falling back to json-store's ambient currentTenantSlug() resolution, which is not
 * guaranteed correct outside the render's request scope inside after(). Optional
 * only for backward compatibility with in-request callers.
 */
export async function readWorklistSurface(tenantId?: string): Promise<WorklistSurfaceRow | null> {
  const rows = await readStore<WorklistSurfaceRow>(STORE, [], { tenantId }).catch(() => [] as WorklistSurfaceRow[]);
  const row = rows[0];
  // P0 tenant-isolation guard (2026-07-14): legacy snapshots had no embedded
  // identity, so a background builder could read the env-default tenant and
  // persist that content under another tenant's correctly scoped blob key.
  // Explicit callers fail closed on missing/mismatched identity and rebuild.
  if (tenantId && row?.tenantId !== tenantId) return null;
  return row && row.data ? row : null;
}

export async function writeWorklistSurface(data: TodayMovesHeroData, computedAtIso: string, tenantId?: string): Promise<void> {
  // Empty-rebuild guard (2026-07-02): loadUncached is fail-soft, so during a Supabase
  // outage it can "successfully" build a surface with zero moves. Persisting that over a
  // real snapshot poisons the SWR cache and the operator's main list renders empty until
  // the next healthy rebuild. An empty rebuild never replaces a non-empty snapshot; a
  // legitimate reset goes through invalidateWorklistSurface() explicitly.
  if (data.moves.length === 0) {
    const existing = await readWorklistSurface(tenantId);
    if (existing && existing.data.moves.length > 0) {
      console.warn(
        `[worklist-surface] refusing to overwrite a snapshot holding ${existing.data.moves.length} moves with an empty rebuild (likely a degraded build during a data outage); keeping the snapshot from ${existing.computedAt}`,
      );
      return;
    }
  }
  await writeStore<WorklistSurfaceRow>(STORE, [{ computedAt: computedAtIso, tenantId, data }], { tenantId }).catch(() => {});
}

/** Invalidate the cache so the next /changes load recomputes (call after a mutation). */
export async function invalidateWorklistSurface(): Promise<void> {
  await writeStore<WorklistSurfaceRow>(STORE, []).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isSurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > SURFACE_FRESH_MS;
}
