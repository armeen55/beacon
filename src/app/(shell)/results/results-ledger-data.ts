import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { runSingleFlight } from "@/lib/single-flight";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/proof-gsc/load-ledger";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  attachControlContaminationForLedger,
  serializeContaminationAttachment,
  deserializeContaminationAttachment,
  isContaminationFrozen,
  type ContaminationAttachment,
  type SerializedContaminationAttachment,
} from "@/domains/proof-gsc/attach-control-contamination";
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
   *  cold synchronous compute). Null when the persisted ledger has never actually
   *  been measured (Wave 1 P2 fix, 2026-07-10) - the freshness line must never
   *  claim a check that did not happen. */
  computedAt: string | null;
  /** Precomputed contamination verdicts for CLOSED (frozen 28-day) rows, keyed by
   *  record id, deserialized from the snapshot. The GET hands this to
   *  attachControlContaminationForLedger so a frozen row is served from here
   *  instead of recomputing its median-band permutation-null read. Empty on a
   *  cold/persisted path (every row then computes live) and for snapshots written
   *  before the field existed. Open rows are never in here. */
  closedContaminationById: Map<string, ContaminationAttachment>;
};

/** Rehydrate the snapshot's stored (JSON) frozen-row verdicts into runtime
 *  ContaminationAttachments. Fail-soft per entry: a malformed row is skipped and
 *  simply recomputes live, never crashing the whole read. PURE. */
function deserializeClosedContamination(
  raw: Record<string, SerializedContaminationAttachment> | undefined,
): Map<string, ContaminationAttachment> {
  const out = new Map<string, ContaminationAttachment>();
  if (!raw) return out;
  for (const [id, s] of Object.entries(raw)) {
    try {
      out.set(id, deserializeContaminationAttachment(s));
    } catch {
      // skip; the row computes live on the GET
    }
  }
  return out;
}

/** Exported for tests; render paths use loadResultsLedgerSurface below. Sibling fix
 *  (2026-07-10 hygiene batch) - thread the EXPLICIT tenantId into the read and both
 *  after() background rebuilds, the same P2-f discipline changes-surface-store
 *  already applies: writeResultsSurface's own persistence would otherwise resolve
 *  the write's tenant via json-store's ambient currentTenantSlug(), which is not
 *  guaranteed correct in a background task outside the render's request scope. */
export async function loadLedgerWithSwr(tenantId: string): Promise<ResultsLedgerSurface> {
  const cached = await readResultsSurface(tenantId).catch(() => null);
  if (cached) {
    if (isResultsSurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          // W2-B - single-flight: concurrent stale readers in this lambda collapse
          // to ONE background re-measure instead of racing duplicate rebuilds.
          await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
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
    return {
      ledger: cached.ledger,
      computedAt: cached.computedAt,
      closedContaminationById: deserializeClosedContamination(cached.contaminationByClosedRow),
    };
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
      // W2-B - single-flight (same key as the stale path): the cold GET and any
      // concurrent readers schedule ONE background rebuild, never a stampede.
      await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
    } catch (e) {
      await recordAppError({
        route: "/results",
        tenantId,
        action: "cold-rebuild",
        ...errorFieldsFrom(e),
      });
    }
  });
  // Cold/persisted path serves no precomputed contamination - the background
  // rebuild scheduled above will populate the snapshot's frozen-row cache, and
  // until then every row computes live on the GET (the pre-cache behavior).
  return {
    ledger: persisted,
    computedAt: latestMeasuredAt(persisted),
    closedContaminationById: new Map(),
  };
}

/** The freshest `measuredAt` across the stored ledger, so the cold GET can serve
 *  an honest "last re-checked N ago" line off the persisted verdicts. Returns
 *  null when NO record has ever been measured (Wave 1 P2 fix, 2026-07-10) - this
 *  used to fall back to `now()`, which would render "I re-checked these numbers
 *  just now" over rows that were never actually checked. An empty/first-run
 *  ledger also lands here and renders nothing anyway (the caller only shows the
 *  checked-line when `ledger.length > 0`). PURE. */
function latestMeasuredAt(ledger: ReadonlyArray<ShippedChangeRecord>): string | null {
  let best = 0;
  for (const r of ledger) {
    const t = r.measuredAt ? Date.parse(r.measuredAt) : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best > 0 ? new Date(best).toISOString() : null;
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
  // Precompute contamination for the WHOLE ledger HERE, in this background
  // rebuild, so the heavy median-band permutation-null reads (the ~4.3s cold
  // cost the GET used to pay for closed rows) run off the request path. Persist
  // only the FROZEN (closed 28-day) rows into the snapshot: those are immutable
  // until the next ledger mutation invalidates this snapshot, so serving them
  // from cache on a GET is exact, not stale. Open rows are intentionally left
  // out and stay live on the GET. Fail-soft: a contamination failure must never
  // block the ledger snapshot itself (the GET then simply computes live).
  let contaminationByClosedRow: Record<string, SerializedContaminationAttachment> | undefined;
  try {
    const contamination = await attachControlContaminationForLedger(tenantId, fresh);
    const frozen: Record<string, SerializedContaminationAttachment> = {};
    for (const r of fresh) {
      if (!isContaminationFrozen(r)) continue;
      const att = contamination.get(r.id);
      if (att) frozen[r.id] = serializeContaminationAttachment(att);
    }
    if (Object.keys(frozen).length > 0) contaminationByClosedRow = frozen;
  } catch {
    contaminationByClosedRow = undefined;
  }
  await writeResultsSurface(fresh, computedAt, tenantId, contaminationByClosedRow);
}

/**
 * The honest staleness line under the /results header. PURE. Null on a missing
 * or unparseable timestamp (Wave 1 P2: `computedAt` is null when the ledger has
 * never actually been measured, so we say nothing rather than claim a check
 * that did not happen); a snapshot younger than a minute reads "just now".
 * Beacon voice: first person, no lab words, no em or en dashes.
 */
export function ledgerCheckedAgoLine(
  computedAtIso: string | null,
  nowMs: number,
): string | null {
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
