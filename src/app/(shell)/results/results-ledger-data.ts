import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { runSingleFlight } from "@/lib/single-flight";
import { readLastFinalizedDate } from "@/domains/measurement";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/measurement";
import { aiOutcomesForShipments, readLedger, type ShippedChangeRecord } from "@/domains/measurement";
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
  /** The staleness line, clocked HERE at load time so the page render stays pure. */
  checkedAgoLine?: string | null;
};

/**
 * One shipment story per record: the kernel's read, the live check the Shipment store holds, the
 * immutable starting point written at mark time, and what AI answers did around it. The AI side is
 * read from answers already bought, so nothing here spends anything; a record with no stamp has no
 * moment to measure an AI outcome from and honestly carries none.
 *
 * ONE READ FOR THE WHOLE LEDGER. Each shipment used to open its own paged 56 day read of whole
 * observation rows, and all of them fired at once, so ten shipments meant eighty round trips carrying
 * every answer text and retrieval journey in the window. The union window is read once now, on the lean
 * outcome projection, and each shipment is computed off that set.
 */
export async function presentShipments(tenantId: string, records: ShippedChangeRecord[]): Promise<ShipmentPresentation[]> {
  if (records.length === 0) return [];
  const latestGscDate = await readLastFinalizedDate(tenantId).catch(() => null);
  const reads = readLedger(records, new Date(), latestGscDate);
  const ai = await aiOutcomesForShipments(tenantId, records.map((r) => ({
    implementedAt: r.implementedAt ?? null, shipmentBaseline: r.shipmentBaseline,
  }))).catch(() => records.map(() => null));
  return records.map((r, i) => ({
    read: reads[i]!,
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
    ai: ai[i] ?? null,
  }));
}

/** Build the shipment stories for a tenant from the persisted records (no re-measure). */
async function persistedShipments(tenantId: string): Promise<ShipmentPresentation[]> {
  const records = await loadProofLedgerPersisted(tenantId).catch(() => []);
  return presentShipments(tenantId, records);
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
  const shipments = await persistedShipments(tenantId).catch(() => [] as ShipmentPresentation[]);
  after(async () => {
    try {
      await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
    } catch (e) {
      await recordAppError({ route: "/results", tenantId, action: "cold-rebuild", ...errorFieldsFrom(e) });
    }
  });
  return { shipments, computedAt: null };
}

/** Request-memoized /results reads, SWR-cached cross-request. */
export const loadResultsLedgerSurface = cache(
  async (): Promise<ResultsLedgerSurface> => {
    const surface = await loadLedgerWithSwr(await currentTenantId());
    return { ...surface, checkedAgoLine: ledgerCheckedAgoLine(surface.computedAt, Date.now()) };
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

/**
 * The honest staleness line under the /results header. PURE. Null on a missing or
 * unparseable timestamp; a snapshot younger than a minute reads "just now". Beacon
 * voice: first person, no lab words, no dashes.
 */
function ledgerCheckedAgoLine(computedAtIso: string | null, nowMs: number): string | null {
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
