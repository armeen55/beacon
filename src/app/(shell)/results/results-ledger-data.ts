import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { checkedAgoLabel } from "@/components/data/receipt-line";
import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { runSingleFlight } from "@/lib/single-flight";
import { readLastFinalizedDate } from "@/domains/measurement";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/measurement";
import { readLedger, type ShippedChangeRecord } from "@/domains/measurement";
import {
  isResultsSurfaceStale,
  readResultsSurface,
  writeResultsSurface,
} from "./results-surface-store";
import type { ShipmentPresentation } from "./results-presentation";

/**
 * results-ledger-data (CORE 100K) - the stale-while-revalidate entry point for the
 * /results measured ledger. Serves the last persisted kernel reads INSTANTLY (with
 * their computedAt for the honest "I last re-checked N ago" line), refreshes in the
 * background when stale, and pays the full synchronous re-measure only on a true
 * cold start. Measurement history is never touched here.
 */

type ResultsLedgerSurface = {
  shipments: ShipmentPresentation[];
  computedAt: string | null;
  /** How long ago the numbers were re-checked ("11 minutes ago"), clocked HERE at load time so
   *  the page render stays pure. */
  checkedAgo?: string | null;
  /** TRUE WHEN THE LEDGER COULD NOT BE READ AT ALL. An empty list used to be the only answer this could give, so a database outage rendered as "no changes are
   *  being measured yet" over an account with a full ledger: the one sentence that tells an operator to stop expecting measurement. Nothing read is not nothing. */
  unavailable?: boolean;
};

/**
 * One shipment story per record: the kernel's read, the live check the Shipment store holds, the
 * immutable starting point written at mark time, and THIS PAGE'S OWN movement over the read that
 * was used, so the surface can print a before and an after without inventing either. How often AI
 * assistants name the account is drawn on Visibility, so nothing here reads answers.
 */
export async function presentShipments(tenantId: string, records: ShippedChangeRecord[]): Promise<ShipmentPresentation[]> {
  if (records.length === 0) return [];
  const latestGscDate = await readLastFinalizedDate(tenantId).catch(() => null);
  const reads = readLedger(records, new Date(), latestGscDate);
  return records.map((r, i) => {
    const read = reads[i]!;
    const basis = read.basisDay == null ? null : r.windows?.find((w) => w.day === read.basisDay && w.ran);
    return {
      read,
      implementedAt: r.implementedAt ?? null,
      verification: r.verification ?? null,
      baseline: r.shipmentBaseline
        ? {
          clicks: r.shipmentBaseline.search.clicks,
          impressions: r.shipmentBaseline.search.impressions,
          windowDays: r.shipmentBaseline.search.windowDays,
          capturedAt: r.shipmentBaseline.capturedAt,
        }
        : null,
      basisMove: basis ? { clicks: basis.treatedDelta, impressions: basis.treatedImpressionsDelta ?? 0 } : null,
    };
  });
}

/** Build the shipment stories for a tenant from the persisted records (no re-measure). A read that FAILED
 *  throws: it is the caller's job to say "I could not read this", never to serve an empty ledger. */
async function persistedShipments(tenantId: string): Promise<ShipmentPresentation[]> {
  return presentShipments(tenantId, await loadProofLedgerPersisted(tenantId));
}

async function loadLedgerWithSwr(tenantId: string): Promise<ResultsLedgerSurface> {
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
    return { shipments: cached.shipments, computedAt: cached.computedAt };
  }
  // First-ever / invalidated: do NOT re-measure on the GET. Serve the persisted
  // reads instantly and schedule the heavy rebuild in the background.
  // A COLD START THAT COULD NOT READ IS NOT AN EMPTY LEDGER. It says so, and the rebuild is still scheduled.
  const read = await persistedShipments(tenantId).then((shipments) => ({ shipments, unavailable: false })).catch(() => ({ shipments: [] as ShipmentPresentation[], unavailable: true }));
  after(async () => {
    try {
      await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
    } catch (e) {
      await recordAppError({ route: "/results", tenantId, action: "cold-rebuild", ...errorFieldsFrom(e) });
    }
  });
  return { ...read, computedAt: null };
}

/** Request-memoized /results reads, SWR-cached cross-request. */
export const loadResultsLedgerSurface = cache(
  async (): Promise<ResultsLedgerSurface> => {
    const surface = await loadLedgerWithSwr(await currentTenantId());
    return { ...surface, checkedAgo: checkedAgoLabel(surface.computedAt, Date.now()) };
  },
);

/**
 * Re-measure the whole ledger NOW and persist the snapshot - the background-refresh
 * body. Build-then-write: a failed re-measure throws and the previous snapshot stays.
 */
export async function rebuildResultsSurface(tenantId: string): Promise<void> {
  const computedAt = new Date().toISOString();
  const records = await loadProofLedger(tenantId);
  const shipments = await presentShipments(tenantId, records);
  await writeResultsSurface(shipments, computedAt, tenantId);
}
