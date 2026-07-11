import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

/**
 * results-surface-store (2026-07-03, R4 - FP1's named follow-up) - a tenant-scoped
 * stale-while-revalidate cache of the fully RE-MEASURED proof ledger `/results`
 * renders. The cold path (loadProofLedger) re-measures EVERY shipped change against
 * GSC on EVERY render - only `react.cache` (per-request), no cross-request
 * persistence. This snapshots the measured presentation records so a cold render
 * serves the last snapshot INSTANTLY and refreshes in the background.
 *
 * Same discipline as worklist-surface-store.ts:
 *   - Honest staleness: the snapshot carries `computedAt` (the page shows an
 *     "I last re-checked N ago" line), the TTL bounds drift, and every ledger
 *     mutation (record / recompute / revert / recrawl / exclude / auto-measure)
 *     invalidates it so operator changes reflect on the next load.
 *   - CACHES PRESENTATION ONLY. Measurement history lives in shipped_changes and
 *     is NEVER mutated here; deleting this snapshot loses nothing.
 *   - Tenant-scoped (store-classification.ts) + Supabase-mirrored (json-store.ts)
 *     so one tenant never serves another's ledger and warm holds across lambdas.
 */

const STORE = "results-surface";

/** Serve the cached snapshot instantly always; background-refresh once it's older than this. */
export const RESULTS_SURFACE_FRESH_MS = 15 * 60 * 1000;

export type ResultsSurfaceRow = { computedAt: string; ledger: ShippedChangeRecord[] };

/**
 * Sibling fix (2026-07-10 hygiene batch) - `opts.tenantId`, the same purpose as
 * changes-surface-store's: results-ledger-data.ts's after() background rebuild
 * already resolves the tenant it means explicitly - thread that SAME tenant into
 * the read/write instead of falling back to json-store's ambient
 * currentTenantSlug() resolution, which is not guaranteed correct outside the
 * render's request scope inside after(). Optional only for backward compatibility.
 */
export async function readResultsSurface(tenantId?: string): Promise<ResultsSurfaceRow | null> {
  const rows = await readStore<ResultsSurfaceRow>(STORE, [], { tenantId }).catch(() => [] as ResultsSurfaceRow[]);
  const row = rows[0];
  return row && Array.isArray(row.ledger) ? row : null;
}

export async function writeResultsSurface(
  ledger: ShippedChangeRecord[],
  computedAtIso: string,
  tenantId?: string,
): Promise<void> {
  // Empty-rebuild guard (replicates worklist-surface-store's 2026-07-02 guard):
  // loadProofLedger is fail-soft, so during a Supabase outage it can "successfully"
  // build an empty ledger. Persisting that over a real snapshot poisons the SWR
  // cache and /results renders "no changes yet" (a lie) until the next healthy
  // rebuild. An empty rebuild never replaces a non-empty snapshot; a legitimate
  // reset goes through invalidateResultsSurface() explicitly.
  if (ledger.length === 0) {
    const existing = await readResultsSurface(tenantId);
    if (existing && existing.ledger.length > 0) {
      console.warn(
        `[results-surface] refusing to overwrite a snapshot holding ${existing.ledger.length} measured changes with an empty rebuild (likely a degraded build during a data outage); keeping the snapshot from ${existing.computedAt}`,
      );
      return;
    }
  }
  await writeStore<ResultsSurfaceRow>(STORE, [{ computedAt: computedAtIso, ledger }], { tenantId }).catch(() => {});
}

/** Invalidate the cache so the next /results load re-measures (call after ANY
 *  ledger mutation - the shipped-change store calls this on every write). */
export async function invalidateResultsSurface(): Promise<void> {
  await writeStore<ResultsSurfaceRow>(STORE, []).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isResultsSurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > RESULTS_SURFACE_FRESH_MS;
}
