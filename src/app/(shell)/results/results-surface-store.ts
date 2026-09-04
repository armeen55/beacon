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
  // A READS-ONLY SNAPSHOT IS NOT SERVED (truth review, 2026-09-01): with no implementation stamps every confirmed change would paint
  // as history. Returning null sends the loader to the persisted records, which carry the stamps. A SNAPSHOT WRITTEN BEFORE THE ROW
  // CARRIED ITS OWN LEARNING FACTS IS THE SAME KIND OF SILENCE (2026-09-03): the belief would size itself on nothing until this
  // expired on its own clock, so the shape it is missing is what retires it. ONE row short of the facts retires the whole snapshot: it is the adapter filling them unconditionally that makes a half-shaped one impossible, and a guard should not rest on a fact stated nowhere near it.
  if (!row || !Array.isArray(row.reads) || !Array.isArray(row.shipments) || row.shipments.length !== row.reads.length) return null;
  if (row.shipments.some((s) => s.learning == null)) return null;
  return { computedAt: row.computedAt, shipments: row.shipments };
}

export async function writeResultsSurface(
  shipments: ShipmentPresentation[],
  computedAtIso: string,
  tenantId?: string,
): Promise<void> {
  const reads = shipments.map((s) => s.read);
  // Empty-rebuild guard, now the SECOND line of defence rather than the only one: loadProofLedger
  // THROWS on a ledger it could not read, so an outage no longer reaches this write at all. This still
  // stands, because an empty snapshot must never replace a real one whatever produced it; a legitimate
  // reset goes through invalidateResultsSurface().
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
