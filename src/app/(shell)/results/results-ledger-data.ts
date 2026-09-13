import "server-only";

import { cache } from "react";
import { after } from "next/server";

import { checkedAgoLabel } from "@/components/data/receipt-line";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { runSingleFlight } from "@/lib/single-flight";
import { aiOutcomesForShipments, readLastFinalizedDate } from "@/domains/measurement";
import { loadProofLedger, loadProofLedgerPersisted } from "@/domains/measurement";
import { applyPinnedRead, pinFor, readLedger, recordPinnedRead, withCorrection, type ShippedChangeRecord } from "@/domains/measurement";
import {
  isResultsSurfaceStale,
  readResultsSurface,
  writeResultsSurface,
} from "./results-surface-store";
import type { ShipmentPresentation } from "./results-presentation";

/** Serve saved Results; refresh stale or missing snapshots after the response. */
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

type Recommendation = NonNullable<ShipmentPresentation["recommendation"]>;
/** The dispositions that RETIRE the advice. `settled` is deliberately absent: it is the queue closing its own loop once a
 *  reading finished ("the reading finished and the result is on Results"), and five of this account's own shipments carry it,
 *  one of them a win. Printing "retired" over them would deny a result this very page claims. */
const RETIRING = new Set(["withdrawn", "superseded", "dismissed", "gone"]);
/** WHETHER THE RECOMMENDATION BEHIND EACH SHIPMENT STILL STANDS: ONE bounded, tenant scoped read of the proposal rows the loaded
 *  records name. A shipment is immutable operator history, so nothing here removes a row; it only lets the surface tell a change
 *  whose advice was later taken back apart from a current one. Fail soft: a read that errors, throws or is not covered answers
 *  nothing at all, and the surface says "unknown" rather than painting history as withdrawn on a database hiccup. */
async function recommendationStates(tenantId: string, ids: string[]): Promise<Map<string, Recommendation>> {
  const out = new Map<string, Recommendation>();
  const wanted = ids.slice(0, 300);
  if (wanted.length === 0) return out;
  try {
    const { data, error } = await getSupabaseAdmin().from("change_proposals").select("id, terminal_disposition").eq("tenant_id", tenantId).in("id", wanted);
    if (error != null || !Array.isArray(data)) return out;
    const held = new Map((data as Array<{ id: string; terminal_disposition: string | null }>).map((r) => [r.id, r.terminal_disposition ?? null]));
    for (const id of wanted) {
      // A NAMED RECOMMENDATION THAT IS NO LONGER ON FILE IS RETIRED: this table supersedes and withdraws, it does not forget.
      const disposition = held.has(id) ? held.get(id) ?? null : "gone";
      out.set(id, disposition != null && RETIRING.has(disposition) ? { state: "retired", disposition } : { state: "current" });
    }
  } catch { return out; }
  return out;
}

/**
 * One shipment story per record: the kernel's read, the live check the Shipment store holds, the
 * immutable starting point written at mark time, and THIS PAGE'S OWN movement over the read that
 * was used, so the surface can print a before and an after without inventing either. How often AI
 * assistants name the account is drawn on Visibility, so nothing here reads answers.
 */
export async function presentShipments(tenantId: string, records: ShippedChangeRecord[]): Promise<ShipmentPresentation[]> {
  if (records.length === 0) return [];
  const [latestGscDate, aiReads, recommendations] = await Promise.all([
    readLastFinalizedDate(tenantId).catch(() => null),
    aiOutcomesForShipments(tenantId, records.map((r) => ({
      implementedAt: r.implementedAt, shipmentBaseline: r.shipmentBaseline, scopeQueries: r.targetQueries, aiScope: r.aiScope,
    }))).catch(() => records.map(() => null)),
    recommendationStates(tenantId, [...new Set(records.map((r) => r.proposalId).filter((id): id is string => !!id))]),
  ]);
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
      // THE SEARCH HALF MAY BE ABSENT and the AI half present: a change on a page Google has nothing to say
      // about yet still froze its own AI starting numbers. No search baseline is no search baseline, never a
      // row of zeroes that reads as a page which earned nothing.
      baseline: r.shipmentBaseline?.search
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
      // THE OBJECTIVE'S OWN NUMBERS TRAVEL WITH THE SENTENCE. A change raised to earn a citation showed only
      // the mention line, so a flat citation rate beside rising mentions read on screen as the change working.
      // THE DECLARATION TRAVELS WITH THE ROW: Results groups on the yardstick the change was pressed under,
      // so a citation change that won its citation is filed as a win rather than as traffic that did not move.
      judgedMetric: r.judgedMetric ?? null,
      // A ROW THAT NAMES NO RECOMMENDATION, OR ONE NOTHING COULD BE READ FOR, SAYS NOTHING: history is never repainted on a silence.
      recommendation: (r.proposalId ? recommendations.get(r.proposalId) : null) ?? { state: "unknown" as const },
      // THE OPERATOR'S OWN WORDING TRAVELS WITH THE RECORD, and only where it genuinely differs from what was prepared. `label` is deliberately NOT carried: four live records hold the writer's brief there, so the screen names each piece by its kind instead and a brief can never be printed as a name.
      applied: (r.componentsApplied ?? []).filter((c) => (c.appliedAfter ?? "").trim() !== "" && (c.appliedAfter ?? "").trim() !== (c.after ?? "").trim()).map((c) => ({ kind: c.kind, prepared: (c.after ?? "").trim() || null, operator: (c.appliedAfter ?? "").trim() })),
      // Qualification needs the full applied unit. Labels are presentation-only and carry no authority.
      learning: { id: r.id, path: r.path, page: r.page, before: r.before, actionType: r.actionType, after: r.after, windows: r.windows, baseline: r.baseline, implementedAt: r.implementedAt,
        verification: r.verification, operatorVerdictOverride: r.operatorVerdictOverride, pinnedRead: r.pinnedRead, treatmentStamp: r.treatmentStamp,
        // Carry comparison provenance and actual wording without leaking writer briefs as labels.
        measurementState: r.measurementState, controlsReceipt: r.controlsReceipt,
        componentsApplied: r.componentsApplied?.map((c) => ({ ...c, label: "" })) ?? null },
      // The days that have passed ride with it, because the group holds an AI direction as still reading until this change's own 28 days
      // have run: an early lean is never banked as a win, on either side of the same row.
      ai: aiReads[i]
        ? { direction: aiReads[i]!.direction, line: aiReads[i]!.line, metricLines: aiReads[i]!.metricLines,
          boundary: aiReads[i]!.boundary, daysElapsed: aiReads[i]!.coverage.daysElapsed, terminal: aiReads[i]!.terminal === true }
        : null,
    };
  });
}

/** Build the shipment stories for a tenant from the persisted records (no re-measure). A read that FAILED
 *  throws: it is the caller's job to say "I could not read this", never to serve an empty ledger. */
async function persistedShipments(tenantId: string): Promise<ShipmentPresentation[]> {
  return presentShipments(tenantId, await loadProofLedgerPersisted(tenantId));
}

async function loadLedgerWithSwr(tenantId: string, cached: Awaited<ReturnType<typeof readResultsSurface>>, access: Promise<unknown>): Promise<ResultsLedgerSurface> {
  // Read-only cold work overlaps account validation; no refresh is registered until access succeeds.
  const surface = cached ?? await persistedShipments(tenantId)
    .then((shipments) => ({ shipments, computedAt: null, unavailable: false }))
    .catch(() => ({ shipments: [] as ShipmentPresentation[], computedAt: null, unavailable: true }));
  await access;
  if (!cached || isResultsSurfaceStale(cached.computedAt, Date.now())) {
    after(async () => {
      try {
        await runSingleFlight(`results-surface:${tenantId}`, () => rebuildResultsSurface(tenantId));
      } catch (e) {
        await recordAppError({ route: "/results", tenantId, action: cached ? "background-refresh" : "cold-rebuild", ...errorFieldsFrom(e) });
      }
    });
  }
  return surface;
}

/** Request-memoized /results reads, SWR-cached cross-request. */
export const loadResultsLedgerSurface = cache(
  async (preloaded?: Awaited<ReturnType<typeof readResultsSurface>>, access: Promise<unknown> = Promise.resolve()): Promise<ResultsLedgerSurface> => {
    const tenantId = await currentTenantId();
    const cached = preloaded === undefined ? await readResultsSurface(tenantId).catch(() => null) : preloaded;
    const surface = await loadLedgerWithSwr(tenantId, cached, access);
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
async function pinFinishedReads(tenantId: string, records: ShippedChangeRecord[]): Promise<number> {
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
        if (await recordPinnedRead(tenantId, record.id, corrected, true).catch(() => false)) record.pinnedRead = corrected;
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
