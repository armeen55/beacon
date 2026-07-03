import "server-only";
import { cache } from "react";

/**
 * GSC Proof ledger — read loader (Phase 5, Path B).
 *
 * Loads the tenant's shipped-change records and RE-MEASURES each against fresh
 * GSC on read (no cron — same on-demand posture as the proof recompute action).
 * Returns display-ready records; does not persist (a GET stays side-effect-free).
 */

import { loadShippedChanges, type ShippedChangeRecord } from "./shipped-change-store";
import { measureRecord } from "./run-measurement";
import { readLastFinalizedDate } from "./gsc-window";
import { buildShockWindows } from "./algorithm-weather";
import { loadDetectedChangepoints } from "./algorithm-weather-store";
import { attachFdrToLedger } from "./fdr-adjust";
import { activeTreatmentPaths } from "@/domains/experiments/experiment-eligibility";

export async function loadProofLedger(
  tenantId: string,
  now: Date = new Date(),
): Promise<ShippedChangeRecord[]> {
  const records = await loadShippedChanges().catch(() => [] as ShippedChangeRecord[]);
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
      measureRecord(tenantId, r, now, lastFinal, activeTreatments, true, shockWindows).catch(() => r),
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
 * Request-cached single-arg entry point. The ledger RE-MEASURES every shipped
 * change against fresh GSC on read (heavy) — so when more than one surface loads
 * it on the same request (the /results page + a proof summary hero), `react.cache`
 * shares ONE re-measurement per tenant per request. Use on render paths.
 */
export const loadProofLedgerCached = cache(
  (tenantId: string): Promise<ShippedChangeRecord[]> => loadProofLedger(tenantId),
);
