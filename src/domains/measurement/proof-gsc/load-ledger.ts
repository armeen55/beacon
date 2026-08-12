import "server-only";
import { cache } from "react";

/**
 * Proof ledger read loader (CORE 100K). Thin: serves the PERSISTED shipped-change
 * records (with their stored measured windows). The heavy re-measure is
 * loadProofLedger, called only from the bounded background rebuild + explicit
 * operator actions. A page GET never re-measures.
 */

import { loadShippedChangesForTenant, type ShippedChangeRecord } from "./shipped-change-store";
import { measureRecord, openChangePaths } from "./measure-pass";
import { readLastFinalizedDate } from "./gsc-window";
import { contaminatedPaths, contaminationFor } from "./contamination";

/** Re-measure every record against fresh GSC. The heavy engine; background/actions only. A LEDGER IT COULD NOT READ THROWS rather than
 *  re-measuring nothing: this feeds the snapshot rebuild, so swallowing the failure wrote an EMPTY snapshot over a good one. */
export async function loadProofLedger(tenantId: string, now: Date = new Date()): Promise<ShippedChangeRecord[]> {
  const records = await loadShippedChangesForTenant(tenantId);
  if (records.length === 0) return [];
  const [lastFinal, open] = await Promise.all([
    readLastFinalizedDate(tenantId).catch(() => null),
    openChangePaths(tenantId),
  ]);
  // THE ONE POLICY, asked once per record and scoped to THAT record's window: a page whose own
  // change closed before this window opened is comparable again, so the pool recovers.
  return Promise.all(records.map((r) =>
    measureRecord(tenantId, r, now, lastFinal, contaminatedPaths(contaminationFor(records, open, now, r)))
      .catch(() => r)));
}

/** The render-safe read: serves the last persisted records, no re-measure. It does NOT swallow a failed read. Every caller that would
 *  rather show a quiet empty than an error catches for itself; the surface whose whole job is to say "I could not read this" must be
 *  able to tell the two apart, and it could not while this returned [] for both. */
export async function loadProofLedgerPersisted(tenantId: string): Promise<ShippedChangeRecord[]> {
  return loadShippedChangesForTenant(tenantId);
}

/** THE render entry (request-cached): serves persisted records with zero re-measure. */
export const loadProofLedgerCached = cache(
  async (tenantId: string): Promise<ShippedChangeRecord[]> => loadProofLedgerPersisted(tenantId),
);
