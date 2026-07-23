import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { KernelRead } from "@/domains/proof-gsc";

/**
 * results-surface-store (CORE 100K) - a tenant-scoped stale-while-revalidate cache
 * of the fully re-measured proof reads the /results page renders. Caches
 * PRESENTATION ONLY (the kernel reads); measurement history lives in
 * shipped_change_proof and is never mutated here, so deleting this snapshot loses
 * nothing.
 */

const STORE = "results-surface";

/** Serve the cached snapshot instantly always; background-refresh once older than this. */
export const RESULTS_SURFACE_FRESH_MS = 15 * 60 * 1000;

export type ResultsSurfaceRow = {
  computedAt: string;
  reads: KernelRead[];
};

export async function readResultsSurface(tenantId?: string): Promise<ResultsSurfaceRow | null> {
  const rows = await readStore<ResultsSurfaceRow>(STORE, [], { tenantId }).catch(() => [] as ResultsSurfaceRow[]);
  const row = rows[0];
  return row && Array.isArray(row.reads) ? row : null;
}

export async function writeResultsSurface(
  reads: KernelRead[],
  computedAtIso: string,
  tenantId?: string,
): Promise<void> {
  // Empty-rebuild guard: loadProofLedger is fail-soft, so during an outage it can
  // "successfully" build an empty ledger. Never replace a non-empty snapshot with
  // an empty one; a legitimate reset goes through invalidateResultsSurface().
  if (reads.length === 0) {
    const existing = await readResultsSurface(tenantId);
    if (existing && existing.reads.length > 0) {
      console.warn(
        `[results-surface] refusing to overwrite a snapshot holding ${existing.reads.length} measured changes with an empty rebuild; keeping the snapshot from ${existing.computedAt}`,
      );
      return;
    }
  }
  await writeStore<ResultsSurfaceRow>(STORE, [{ computedAt: computedAtIso, reads }], { tenantId }).catch(() => {});
}

/** Invalidate the cache so the next /results load re-measures. Called on every ledger mutation. */
export async function invalidateResultsSurface(): Promise<void> {
  await writeStore<ResultsSurfaceRow>(STORE, []).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isResultsSurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > RESULTS_SURFACE_FRESH_MS;
}
