import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { SerializedContaminationAttachment } from "@/domains/proof-gsc/attach-control-contamination";

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

export type ResultsSurfaceRow = {
  computedAt: string;
  ledger: ShippedChangeRecord[];
  /**
   * Precomputed control-contamination verdicts for CLOSED (frozen 28-day) rows
   * only, keyed by ShippedChangeRecord.id. Computed once at rebuild time (the
   * background pass that already pays the heavy median-band permutation-null
   * reads) so a GET serves a frozen row's verdict from here instead of
   * recomputing it. Optional and additive: a snapshot written before this field
   * (or one whose rows were all open) simply omits it, and the GET falls back to
   * live compute for any row not present. Open rows are never stored here.
   */
  contaminationByClosedRow?: Record<string, SerializedContaminationAttachment>;
};

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
  contaminationByClosedRow?: Record<string, SerializedContaminationAttachment>,
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
  const row: ResultsSurfaceRow = { computedAt: computedAtIso, ledger };
  // Only attach the field when there is something to store, so a rebuild with no
  // frozen rows leaves the snapshot byte-identical to the pre-field shape.
  if (contaminationByClosedRow && Object.keys(contaminationByClosedRow).length > 0) {
    row.contaminationByClosedRow = contaminationByClosedRow;
  }
  await writeStore<ResultsSurfaceRow>(STORE, [row], { tenantId }).catch(() => {});
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
