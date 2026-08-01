import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { KernelRead } from "@/domains/measurement/proof-gsc";
import type { ShipmentPresentation } from "./results-presentation";

/**
 * results-surface-store (CORE 100K) - a tenant-scoped stale-while-revalidate cache
 * of the fully re-measured proof reads the /results page renders. Caches
 * PRESENTATION ONLY (the kernel reads); measurement history lives in
 * shipped_change_proof and is never mutated here, so deleting this snapshot loses
 * nothing.
 */

const STORE = "results-surface";

/** Serve the cached snapshot instantly always; background-refresh once older than this. */
const RESULTS_SURFACE_FRESH_MS = 15 * 60 * 1000;

type ResultsSurfaceRow = {
  computedAt: string;
  /** The whole shipment story per change: the read, what the live check found, the immutable
   *  starting point, and the AI side. A snapshot written before Phase 8 holds `reads` only and
   *  decodes into shipments with the other halves honestly absent. */
  shipments?: ShipmentPresentation[];
  reads: KernelRead[];
};

/**
 * The snapshot, decoded. A pre-Phase-8 snapshot holds `reads` only and still renders: the read is
 * there, and the halves it never stored say honestly that they are not on file rather than
 * inventing a passing live check or a zero starting point.
 */
export async function readResultsSurface(
  tenantId?: string,
): Promise<{ computedAt: string; shipments: ShipmentPresentation[] } | null> {
  const rows = await readStore<ResultsSurfaceRow>(STORE, [], { tenantId }).catch(() => [] as ResultsSurfaceRow[]);
  const row = rows[0];
  if (!row || !Array.isArray(row.reads)) return null;
  const shipments = Array.isArray(row.shipments) && row.shipments.length === row.reads.length
    ? row.shipments
    : row.reads.map((read) => ({ read, implementedAt: null, verification: null, baseline: null, ai: null }));
  return { computedAt: row.computedAt, shipments };
}

export async function writeResultsSurface(
  shipments: ShipmentPresentation[],
  computedAtIso: string,
  tenantId?: string,
): Promise<void> {
  const reads = shipments.map((s) => s.read);
  // Empty-rebuild guard: loadProofLedger is fail-soft, so during an outage it can
  // "successfully" build an empty ledger. Never replace a non-empty snapshot with
  // an empty one; a legitimate reset goes through invalidateResultsSurface().
  if (reads.length === 0) {
    const existing = await readResultsSurface(tenantId);
    if (existing && existing.shipments.length > 0) {
      console.warn(
        `[results-surface] refusing to overwrite a snapshot holding ${existing.shipments.length} measured changes with an empty rebuild; keeping the snapshot from ${existing.computedAt}`,
      );
      return;
    }
  }
  await writeStore<ResultsSurfaceRow>(STORE, [{ computedAt: computedAtIso, reads, shipments }], { tenantId }).catch(() => {});
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
