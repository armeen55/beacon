import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { runSingleFlight } from "@/lib/single-flight";
import { readLastFinalizedDate } from "@/domains/proof-gsc";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/proof-gsc";
import { readLedger, type KernelRead } from "@/domains/proof-gsc";
import {
  isResultsSurfaceStale,
  readResultsSurface,
  writeResultsSurface,
} from "./results-surface-store";

/**
 * results-ledger-data (CORE 100K) - the stale-while-revalidate entry point for the
 * /results measured ledger. Serves the last persisted kernel reads INSTANTLY (with
 * their computedAt for the honest "I last re-checked N ago" line), refreshes in the
 * background when stale, and pays the full synchronous re-measure only on a true
 * cold start. Measurement history is never touched here.
 */

export type ResultsLedgerSurface = {
  reads: KernelRead[];
  computedAt: string | null;
};

/** Build the kernel reads for a tenant from the persisted records (no re-measure). */
async function persistedReads(tenantId: string): Promise<KernelRead[]> {
  const records = await loadProofLedgerPersisted(tenantId).catch(() => []);
  if (records.length === 0) return [];
  const latestGscDate = await readLastFinalizedDate(tenantId).catch(() => null);
  return readLedger(records, new Date(), latestGscDate);
}

export async function loadLedgerWithSwr(tenantId: string): Promise<ResultsLedgerSurface> {
  const cached = await readResultsSurface(tenantId).catch(() => null);
  if (cached) {
    if (isResultsSurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
        } catch (e) {
          await recordAppError({ route: "/results", tenantId, action: "background-refresh", ...errorFieldsFrom(e) });
        }
      });
    }
    return { reads: cached.reads, computedAt: cached.computedAt };
  }
  // First-ever / invalidated: do NOT re-measure on the GET. Serve the persisted
  // reads instantly and schedule the heavy rebuild in the background.
  const reads = await persistedReads(tenantId).catch(() => [] as KernelRead[]);
  after(async () => {
    try {
      await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
    } catch (e) {
      await recordAppError({ route: "/results", tenantId, action: "cold-rebuild", ...errorFieldsFrom(e) });
    }
  });
  return { reads, computedAt: reads.length > 0 ? null : null };
}

/** Request-memoized /results reads, SWR-cached cross-request. */
export const loadResultsLedgerSurface = cache(
  async (): Promise<ResultsLedgerSurface> => loadLedgerWithSwr(await currentTenantId()),
);

/**
 * Re-measure the whole ledger NOW and persist the snapshot - the background-refresh
 * body. Build-then-write: a failed re-measure throws and the previous snapshot stays.
 */
export async function rebuildResultsSurface(tenantId: string): Promise<void> {
  const computedAt = new Date().toISOString();
  const records = await loadProofLedger(tenantId);
  const latestGscDate = await readLastFinalizedDate(tenantId).catch(() => null);
  const reads = readLedger(records, new Date(), latestGscDate);
  await writeResultsSurface(reads, computedAt, tenantId);
}

/**
 * The honest staleness line under the /results header. PURE. Null on a missing or
 * unparseable timestamp; a snapshot younger than a minute reads "just now". Beacon
 * voice: first person, no lab words, no dashes.
 */
export function ledgerCheckedAgoLine(computedAtIso: string | null, nowMs: number): string | null {
  if (computedAtIso == null) return null;
  const t = Date.parse(computedAtIso);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - t) / 60_000);
  if (minutes < 1) return "I re-checked these numbers against your Google data just now.";
  const unit =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? "" : "s"}`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) === 1 ? "" : "s"}`
        : `${Math.floor(minutes / 1440)} days`;
  return `I last re-checked these numbers against your Google data ${unit} ago. I refresh them in the background.`;
}
