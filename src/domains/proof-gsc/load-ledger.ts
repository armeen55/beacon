import "server-only";
import { cache } from "react";

/**
 * GSC Proof ledger — read loader (Phase 5, Path B).
 *
 * Loads the tenant's shipped-change records and RE-MEASURES each against fresh
 * GSC. This is the HEAVY engine (a full-ledger GSC/GA4 diff-in-diff). It is
 * reachable from explicit operator actions + the bounded background rebuild only.
 *
 * P0-B Wave 1 (2026-07-10): the GET-GUARD. A page GET/render must NEVER pay,
 * hit a live SERP, or run an unbounded full-ledger re-measure, so:
 *   - `loadProofLedger` no longer fires the paid live-SERP rank re-check
 *     (allowRankRecheck=false). The only paid rank re-check left is the explicit
 *     operator "Measure now" action (results/actions.ts calls measureRecord
 *     directly). Background passes stay paid-free.
 *   - `loadProofLedgerCached`, THE render entry, no longer re-measures on read.
 *     It serves the last PERSISTED measured state (the /results SWR snapshot, or
 *     the stored verdicts on a cold start) and schedules the heavy rebuild in the
 *     background. See loadProofLedgerPersisted / the delegation below.
 */

import { loadShippedChangesForTenant, type ShippedChangeRecord } from "./shipped-change-store";
import { measureRecord } from "./run-measurement";
import { readLastFinalizedDate } from "./gsc-window";
import { buildShockWindows } from "./algorithm-weather";
import { loadDetectedChangepoints } from "./algorithm-weather-store";
import { attachFdrToLedger } from "./reliability-extras";
import { activeTreatmentPaths } from "@/domains/proof-gsc/change-family";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { log } from "@/lib/logger";

export async function loadProofLedger(
  tenantId: string,
  now: Date = new Date(),
): Promise<ShippedChangeRecord[]> {
  // W2-B (2026-07-10) - tenant-EXPLICIT read. This function is the body of the
  // after() background rebuild (rebuildResultsSurface), which runs OUTSIDE the
  // render's tenant scope; reading the AMBIENT ledger there could resolve the
  // wrong (or an empty founder) tenant. loadShippedChangesForTenant reads exactly
  // the passed tenant (Supabase .eq or the tenant-explicit file fallback).
  const records = await loadShippedChangesForTenant(tenantId).catch(() => [] as ShippedChangeRecord[]);
  if (records.length === 0) return [];
  // Read the finalized-data watermark ONCE for the whole ledger (it gates which
  // windows are judgeable) and pass it to every record, instead of each
  // measureRecord re-reading it.
  const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
  // Shock windows (P4 R10b, v1 152): read the persisted changepoints ONCE for
  // the whole ledger and pass the built list to every record, so the
  // clean-window salvage read never re-reads the store per record. Fail-soft
  // -> [] (no known shocks = nothing to salvage, never a crash).
  const shockWindows = buildShockWindows({
    dailySeries: [],
    priorChangepoints: await loadDetectedChangepoints(tenantId, now).catch(() => []),
  });
  // Control-contamination guard: a control page that is ITSELF an active (measuring)
  // treatment can't anchor another experiment's diff-in-diff (its CTR moved for a
  // non-natural reason). Compute the active-treatment set ONCE and exclude those controls
  // from every record's diff. Empty until a control gets treated (e.g. a meta-vs-title
  // batch on the same animal pages), so today's 10 measurements stay byte-identical.
  const activeTreatments = activeTreatmentPaths(records, now);
  const measured = await Promise.all(
    records.map((r) =>
      // P0-B W1: allowRankRecheck=false, NO paid live-SERP call from a ledger
      // rebuild (render cold path, background refresh, or cron). The only paid
      // rank re-check left is the explicit operator "Measure now" action, which
      // calls measureRecord directly with the default (true).
      measureRecord(tenantId, r, now, lastFinal, activeTreatments, false, shockWindows).catch(() => r),
    ),
  );
  // Many-measurements pass (P4 R10b, v1 291): with every mature win in hand at
  // once - the only place that is true - run the pool-wide adjustment and
  // attach `fdrCaution` to wins too close to the by-chance line. Pure,
  // computed-only (recordToRow never persists it), and a pool under two rows
  // returns the ledger byte-identical.
  return attachFdrToLedger(measured);
}

/**
 * P0-B Wave 1: the render-safe read. Serves the LAST PERSISTED measured ledger
 * (the stored verdicts/windows) with the pure pool-wide FDR adjustment. It does
 * NO measureRecord, NO GSC/GA4 re-read, NO live SERP, and NO mutation. Bounded
 * to one store read plus a pure pass. Use anywhere a GET/render needs the ledger
 * without paying for or triggering a re-measure. The heavy re-measure that
 * refreshes these stored verdicts runs from explicit actions + the bounded
 * background rebuild only.
 */
export async function loadProofLedgerPersisted(tenantId: string): Promise<ShippedChangeRecord[]> {
  // W2-B (2026-07-10) - tenant-EXPLICIT read (fixes the latent multi-tenant seam:
  // this used to ignore its tenantId arg and read the ambient store). Serving the
  // stored verdicts for the EXPLICIT tenant is correct on the render path (ambient
  // == tenantId) AND in the after() cold-rebuild path where ambient may be wrong.
  const start = perfMark();
  const records = await loadShippedChangesForTenant(tenantId).catch(() => [] as ShippedChangeRecord[]);
  perfStage("canonical-ledger-read", start, { rows: records.length });
  if (records.length === 0) return [];
  return attachFdrToLedger(records);
}

/**
 * THE render entry point (request-cached). P0-B Wave 1: this NEVER re-measures on
 * a GET. It serves the /results SWR snapshot (the last fully-measured ledger,
 * with its computed dollar/traffic attachments) instantly, falling back to the
 * stored verdicts on a true cold start, and schedules the heavy rebuild in the
 * background via after(). `react.cache` shares ONE served ledger per tenant per
 * request across every surface that reads it (Today, Changes, the scoreboard).
 */
export const loadProofLedgerCached = cache(
  async (tenantId: string): Promise<ShippedChangeRecord[]> => {
    const start = perfMark();
    try {
      // The /results snapshot IS the persisted, fully-measured proof ledger. Reuse
      // its stale-while-revalidate reader so every surface serves the same last
      // persisted state with zero re-measure on the GET (a stale snapshot triggers
      // exactly one paid-free background rebuild). Dynamic import mirrors the
      // established domain→app pattern in auto-measure-on-use.ts.
      const { loadLedgerWithSwr } = await import("@/app/(shell)/results/results-ledger-data");
      const surface = await loadLedgerWithSwr(tenantId);
      perfStage("proof-ledger-cached", start, { rows: surface.ledger.length, source: "snapshot" });
      return surface.ledger;
    } catch (err) {
      log.warn("load-ledger: SWR snapshot read failed; serving persisted verdicts instead", {
        tenant: tenantId,
        store: "results-ledger-swr",
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-soft: never let the shared ledger read blank a page. Serve the stored
      // verdicts directly (still no re-measure, no paid call).
      const persisted = await loadProofLedgerPersisted(tenantId);
      perfStage("proof-ledger-cached", start, { rows: persisted.length, source: "persisted-fallback" });
      return persisted;
    }
  },
);
