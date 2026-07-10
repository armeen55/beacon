import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/proof-gsc/load-ledger";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  isResultsSurfaceStale,
  readResultsSurface,
  writeResultsSurface,
} from "./results-surface-store";

/**
 * results-ledger-data (2026-07-03, R4) - the stale-while-revalidate entry point for
 * the /results measured ledger, mirroring moves-data.ts's loadSurfaceWithSwr flow:
 * serve the persisted snapshot INSTANTLY (with its computedAt for the honest
 * "I last re-checked N ago" line), refresh in the background via `after()` when it
 * has gone stale, and pay the full synchronous re-measure only on a true cold start
 * (first-ever load, or right after a mutation invalidated the snapshot).
 *
 * Measurement history is never touched here - this layer caches what one render
 * would have computed anyway.
 */

export type ResultsLedgerSurface = {
  ledger: ShippedChangeRecord[];
  /** ISO timestamp the served ledger was measured at (snapshot time, or now on a
   *  cold synchronous compute). */
  computedAt: string;
};

/** Exported for tests; render paths use loadResultsLedgerSurface below. */
export async function loadLedgerWithSwr(tenantId: string): Promise<ResultsLedgerSurface> {
  const cached = await readResultsSurface().catch(() => null);
  if (cached) {
    if (isResultsSurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          await rebuildResultsSurface(tenantId);
        } catch (e) {
          // Best-effort background refresh; the next visit retries. N39: record
          // it durably so a silently-always-stale results page is visible on
          // /diagnostics/errors instead of vanishing with the lambda logs.
          await recordAppError({
            route: "/results",
            tenantId,
            action: "background-refresh",
            ...errorFieldsFrom(e),
          });
        }
      });
    }
    return { ledger: cached.ledger, computedAt: cached.computedAt };
  }
  // First-ever / invalidated → P0-B Wave 1 GET-GUARD: do NOT re-measure on the
  // GET. That cold synchronous rebuild is the >2-minute timeout path (a full
  // GSC/GA4 diff-in-diff across the whole ledger, plus the live-SERP re-check we
  // just removed). Instead serve the last PERSISTED verdicts instantly and
  // schedule the heavy rebuild in the background, so the next open is both
  // instant AND fully measured. The honest "I last re-checked N ago" line still
  // reflects when those stored verdicts were measured.
  const persisted = await loadProofLedgerPersisted(tenantId).catch(() => [] as ShippedChangeRecord[]);
  after(async () => {
    try {
      await rebuildResultsSurface(tenantId);
    } catch (e) {
      await recordAppError({
        route: "/results",
        tenantId,
        action: "cold-rebuild",
        ...errorFieldsFrom(e),
      });
    }
  });
  return { ledger: persisted, computedAt: latestMeasuredAt(persisted) };
}

/** The freshest `measuredAt` across the stored ledger, so the cold GET can serve
 *  an honest "last re-checked N ago" line off the persisted verdicts. Falls back
 *  to now when nothing has ever been measured (an empty/first-run ledger renders
 *  nothing anyway). PURE. */
function latestMeasuredAt(ledger: ReadonlyArray<ShippedChangeRecord>): string {
  let best = 0;
  for (const r of ledger) {
    const t = r.measuredAt ? Date.parse(r.measuredAt) : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best > 0 ? new Date(best).toISOString() : new Date().toISOString();
}

/** Request-memoized /results measured ledger, SWR-cached cross-request. Every
 *  section on /results reads THIS (never loadProofLedgerCached directly) so one
 *  request serves one snapshot. */
export const loadResultsLedgerSurface = cache(
  async (): Promise<ResultsLedgerSurface> => loadLedgerWithSwr(await currentTenantId()),
);

/**
 * Re-measure the whole ledger NOW and persist the snapshot - the background-refresh
 * body, also called after a passive auto-measure pass settles rows so the next
 * /results open is both instant AND current. Build-then-write: a failed re-measure
 * throws and the previous snapshot stays in place.
 */
export async function rebuildResultsSurface(tenantId: string): Promise<void> {
  const computedAt = new Date().toISOString();
  const fresh = await loadProofLedger(tenantId);
  await writeResultsSurface(fresh, computedAt);
}

/**
 * The honest staleness line under the /results header. PURE. Null only on an
 * unparseable timestamp; a snapshot younger than a minute reads "just now".
 * Beacon voice: first person, no lab words, no em or en dashes.
 */
export function ledgerCheckedAgoLine(computedAtIso: string, nowMs: number): string | null {
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
