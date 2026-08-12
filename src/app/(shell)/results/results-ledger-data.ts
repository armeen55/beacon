import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { checkedAgoLabel } from "@/components/data/receipt-line";
import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { runSingleFlight } from "@/lib/single-flight";
import { readLastFinalizedDate } from "@/domains/measurement";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/measurement";
import { applyPinnedRead, pinFor, readLedger, recordPinnedRead, withCorrection,
  recordPinnedReadCorrection, type ShippedChangeRecord } from "@/domains/measurement";
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
    // A FINISHED READING IS SERVED AS IT WAS READ. Everything below still recomputes from live Google data,
    // which is right while a window is open and wrong the moment it closes: a backfilled day inside a closed
    // window, or one more shipped change joining the comparison set, moved a number the operator had already
    // been told. Where the ledger holds a frozen tuple, that is what this hands back.
    const read = applyPinnedRead(reads[i]!, r.pinnedRead);
    const basis = read.basisDay == null ? null : r.windows?.find((w) => w.day === read.basisDay && w.ran);
    return {
      read,
      // Whether a fair comparison exists for this one, recorded beside the implementation itself.
      measurement: r.measurementState ?? null,
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
      // Which pages stood behind this one, so the screen can name them rather than assert similarity.
      controlsReceipt: r.controlsReceipt ?? null,
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
  // FREEZE WHAT IS FINISHED, HERE, BEFORE IT IS PRESENTED AGAIN. This is the pass that re-measures the whole
  // ledger every fifteen minutes, so it is the one that must stop asking a settled question. A reading whose
  // window has closed with every day behind it finalized is written down once and served from then on.
  await pinFinishedReads(tenantId, records);
  const shipments = await presentShipments(tenantId, records);
  await writeResultsSurface(shipments, computedAt, tenantId);
}

/** Write down every reading that is finished and not yet held still, and return how many were frozen. The
 *  records in hand are updated in place, so the presentation right behind this serves the frozen tuple on the
 *  very first pass. Fail-soft per row: a freeze that cannot be stored is retried on the next rebuild. */
export async function pinFinishedReads(tenantId: string, records: ShippedChangeRecord[]): Promise<number> {
  const open = records.filter((r) => r.pinnedRead == null);
  const held = records.filter((r) => r.pinnedRead != null);
  const now = new Date();
  // A RECOMPUTE THAT DISAGREES WITH A HELD READING IS AN AUDITED CORRECTION, never a silent rewrite:
  // the frozen tuple keeps serving, and the disagreement is appended to its own record with a reason.
  if (held.length > 0) {
    const latest = await readLastFinalizedDate(tenantId).catch(() => null);
    const fresh = readLedger(held, now, latest);
    for (let i = 0; i < held.length; i += 1) {
      const record = held[i]!;
      const corrected = withCorrection(record.pinnedRead, fresh[i]!, now);
      if (corrected && corrected !== record.pinnedRead) {
        if (await recordPinnedReadCorrection(tenantId, record.id, corrected).catch(() => false)) record.pinnedRead = corrected;
      }
    }
  }
  if (open.length === 0) return 0;
  const latestGscDate = await readLastFinalizedDate(tenantId).catch(() => null);
  const reads = readLedger(open, now, latestGscDate);
  let pinned = 0;
  for (let i = 0; i < open.length; i += 1) {
    const record = open[i]!;
    const pin = pinFor(record, reads[i]!, latestGscDate, now);
    if (!pin) continue;
    if (!(await recordPinnedRead(tenantId, record.id, pin).catch(() => false))) continue;
    record.pinnedRead = pin;
    pinned += 1;
  }
  return pinned;
}
