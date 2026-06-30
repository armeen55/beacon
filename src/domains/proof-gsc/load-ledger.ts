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
  // Control-contamination guard: a control page that is ITSELF an active (measuring)
  // treatment can't anchor another experiment's diff-in-diff (its CTR moved for a
  // non-natural reason). Compute the active-treatment set ONCE and exclude those controls
  // from every record's diff. Empty until a control gets treated (e.g. a meta-vs-title
  // batch on the same animal pages), so today's 10 measurements stay byte-identical.
  const activeTreatments = activeTreatmentPaths(records, now);
  const measured = await Promise.all(
    records.map((r) => measureRecord(tenantId, r, now, lastFinal, activeTreatments).catch(() => r)),
  );
  return measured;
}

/**
 * Request-cached single-arg entry point. The ledger RE-MEASURES every shipped
 * change against fresh GSC on read (heavy) — so when more than one surface loads
 * it on the same request (the /proof page + a proof summary hero), `react.cache`
 * shares ONE re-measurement per tenant per request. Use on render paths.
 */
export const loadProofLedgerCached = cache(
  (tenantId: string): Promise<ShippedChangeRecord[]> => loadProofLedger(tenantId),
);
