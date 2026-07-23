import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import type { LoadGraphResult } from "./load-graph";

/**
 * graph-snapshot-store (2026-06-29), a tenant-scoped, cross-request stale-while-
 * revalidate cache of the computed Demand Graph (`LoadGraphResult`). The graph build is
 * ~6s of Supabase reads + assembly and is INDEPENDENTLY rebuilt by every surface that
 * needs it (Worklist/ActionPack, New Pages, Today, Recommendations/Drafts, page-factory,
 * enrichment planning), `react.cache` only dedupes WITHIN one request. This snapshot lets
 * those surfaces share one compute across requests: serve the last graph instantly,
 * refresh in the background when stale.
 *
 * Tenant-scoped (see store-classification) so one tenant NEVER serves another's graph.
 * Versioned so a shape change (or a deploy that alters the graph contract) ignores stale
 * snapshots. Serialization is lossless for ranking/learning/proof/research fields (proven
 * by the round-trip parity test) because the graph is pure data, no Maps/Dates/functions.
 *
 * This module is the INVALIDATION BOUNDARY: actions/connectors import `invalidateDemandGraph`;
 * it does NOT import them (no cycle). It also clears the derived worklist surface, since
 * that snapshot is built FROM the graph.
 */

const STORE = "demand-graph-snapshot";

/** Bump when the graph SHAPE changes (fields consumers read) or the scoring contract
 *  changes, old snapshots are then ignored, not trusted.
 *  v2 (2026-07-03, R8/N5): the information-gain gate now drops/demotes/annotates
 *  create_page Moves, pre-gate snapshots must recompute, not be trusted. */
export const GRAPH_SCHEMA_VERSION = 2;

/** Serve the cached graph instantly always; background-refresh once it's older than this. */
export const GRAPH_FRESH_MS = 15 * 60 * 1000;

/** A hard sanity ceiling, a snapshot bigger than this is treated as corrupt/abnormal and
 *  recomputed rather than trusted (the Iranopedia graph is ~1.5MB; 16MB is far above any
 *  legitimate tenant). */
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export type GraphSnapshotRow = {
  schemaVersion: number;
  computedAt: string;
  data: LoadGraphResult;
};

/**
 * Sibling fix (2026-07-10 hygiene batch) - `opts.tenantId`, the same purpose as
 * changes-surface-store's: load-graph.ts's after()/detached background refresh
 * (buildAndPersistOnce, scheduled from scheduleGraphRefresh) already resolves the
 * tenant it means explicitly - thread that SAME tenant into the read/write instead
 * of falling back to json-store's ambient currentTenantSlug() resolution, which is
 * not guaranteed correct outside the render's request scope inside after(). Optional
 * only for backward compatibility.
 */
export async function readGraphSnapshot(tenantId?: string): Promise<GraphSnapshotRow | null> {
  const rows = await readStore<GraphSnapshotRow>(STORE, [], { tenantId }).catch(() => [] as GraphSnapshotRow[]);
  return rows[0] ?? null;
}

export async function writeGraphSnapshot(data: LoadGraphResult, computedAtIso: string, tenantId?: string): Promise<void> {
  // Bound the snapshot: never persist an absurdly large graph (would slow every read it
  // was meant to speed up). Drop silently, the next load recomputes synchronously.
  try {
    const row: GraphSnapshotRow = { schemaVersion: GRAPH_SCHEMA_VERSION, computedAt: computedAtIso, data };
    const bytes = JSON.stringify(row).length;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      log.warn("[graph-snapshot] refusing to persist oversized snapshot", { bytes });
      return;
    }
    await writeStore<GraphSnapshotRow>(STORE, [row], { tenantId });
  } catch (e) {
    log.warn("[graph-snapshot] write failed (fail-soft)", { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Invalidate the tenant's Demand Graph snapshot AND the derived worklist surface so the
 * next load recomputes. Call after any mutation that changes a GRAPH INPUT (connector
 * sync, proof settlement, a newly-shipped change). `reason` is logged for diagnostics.
 * Tenant-scoped via the ambient tenant context (same as the loaders that wrote it).
 */
export async function invalidateDemandGraph(reason: string): Promise<void> {
  log.info("[graph-snapshot] invalidate", { reason });
  // The graph snapshot hard-empties (recompute from inputs is the point). The
  // derived customer surface (Today + Changes) age-stamps instead of emptying so
  // its blob keeps serving stale-while-revalidate (CORE 100K: the retired worklist
  // surface is gone; the customer release is the one derived snapshot now).
  const { invalidateCustomerSurface } = await import("@/app/(shell)/surface-release");
  await Promise.all([
    writeStore<GraphSnapshotRow>(STORE, []).catch(() => {}),
    invalidateCustomerSurface().catch(() => {}),
  ]);
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isGraphStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > GRAPH_FRESH_MS;
}

/** PURE: is the snapshot trustworthy, right version + the shape consumers depend on?
 *  A version mismatch or a missing `graph.moves`/`pageNodes` array → recompute, don't trust. */
export function isGraphSnapshotValid(row: GraphSnapshotRow | null): row is GraphSnapshotRow {
  if (!row || row.schemaVersion !== GRAPH_SCHEMA_VERSION) return false;
  const g = row.data?.graph as { moves?: unknown; pageNodes?: unknown; demandNodes?: unknown } | undefined;
  return !!g && Array.isArray(g.moves) && Array.isArray(g.pageNodes) && Array.isArray(g.demandNodes);
}
