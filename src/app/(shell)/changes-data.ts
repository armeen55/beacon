import "server-only";

/**
 * changes-data (CORE 100K cutover, 2026-07-22) — the server loader for the
 * canonical Changes list, now backed entirely by the Decision kernel. The old
 * worklist / build-canonical-changes / allocator / demand-graph shaping pipeline
 * is retired: the ranked queue is now the tenant's persisted, re-validated
 * `ChangeProposal`s (decision/load-proposals), and the measuring/decided side of
 * the lifecycle still comes from the proof-gsc ledger (the ONE-COUNT RULE).
 *
 * Lifecycle mapping (preserved OUTCOME, cruder-but-honest shape):
 *   Ready       — proposals with status "proposed": validated safe, exact copy.
 *   To do       — proposals with status "needs_review": generated, wants a look.
 *   Measuring   — shipped changes still under measurement (proof ledger).
 *   Results     — shipped changes with a final read (proof ledger).
 *
 * READ-ONLY + fail-soft. Proposal PRODUCTION (the cold, gated drafter) runs in
 * the background release build (surface-release → produceProposalsForTenant), not
 * on the render path. Publishing stays MANUAL.
 */
import { cache } from "react";
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProposalQueue, resolveCurrentBasis } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { loadProofLedgerCached } from "@/domains/measurement";
import { countLedgerLifecycle } from "@/domains/decision";
import { buildReceiptLine } from "@/components/data/receipt-line";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";

export type ChangesSummary = { todo: number; ready: number; measuring: number; results: number };

export type ChangesView = {
  /** The ranked pre-ship queue (every non-rejected, non-applied proposal). */
  proposals: ChangeProposal[];
  /** Validated-safe, exact-copy-ready proposals (the Ready tab). */
  ready: ChangeProposal[];
  /** Generated but held for a human look (the To do tab). */
  toDo: ChangeProposal[];
  /** New-page briefs, kept distinct from existing-page edits. */
  summary: ChangesSummary;
  /** Whole-tenant measuring count (proof ledger, the ONE-COUNT RULE). */
  measuringCountCanonical: number;
  /** Validator-passed rows set aside because they predate the current decision bar. */
  demotedStaleBasis: number;
  /** True when I could not read the current bar, so the count above is not a raised bar. */
  basisUnreadable?: boolean;
  /** Whole-tenant decided count (proof ledger). */
  decidedCountCanonical: number;
  /** Set only when Ready is 0, so the tab is never a bare "0" with no reason. */
  readyZeroHint: string | null;
  /** One-line receipt above the list (when + from what this was ranked). */
  receiptLine: string | null;
  /** When this ranked list was actually built (honest staleness line). */
  surfaceComputedAt?: string | null;
  /** True only on a cold first-ever render (background build just scheduled). */
  surfaceBuilding?: boolean;
  /** Atomic customer release id shared with Today. */
  surfaceVersion?: string | null;
};

/** The client payload is the same shape (a ChangeProposal is fully serializable). */
export type ChangesClientView = ChangesView;

/** PURE: the client-payload projection of a ChangesView. */
export function toClientView(view: ChangesView): ChangesClientView {
  return view;
}

/** DATE-BOMB GUARD — an epoch-0 / pre-2026 stamp is never a real ranking time. */
const MIN_VALID_COMPUTED_AT_MS = Date.parse("2026-01-01T00:00:00Z");
export function sanitizeSurfaceComputedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < MIN_VALID_COMPUTED_AT_MS) return null;
  return iso;
}

/** THE one sentence Changes tells when earlier ideas no longer clear my evidence bar. */
export function setAsideClause(n: number): string {
  return `I raised the bar for what counts as worth your time, so I set aside ${n} earlier ${n === 1 ? "idea" : "ideas"} that no longer clear it.`;
}
export function setAsideHint(n: number, toDo = 0): string {
  // "Nothing needs your time today" is FALSE with review work waiting, and it was
  // printed directly above a tab labelled To do.
  return `${setAsideClause(n)} ${toDo > 0
    ? `The ${toDo} ${toDo === 1 ? "idea" : "ideas"} still on your To do list are the ones I can back today.`
    : "Nothing needs your time today: I am still checking your pages and I will rank your next change here as soon as one earns it."}`;
}

/** A STORED release is a photograph, and the bar may have moved since it was taken.
 *  Every row is checked against the basis the account holds RIGHT NOW: same basis
 *  stays, anything else is withheld. Comparing the release only against ITSELF was
 *  the hole: a release whose rows are uniformly stale looks perfectly consistent and
 *  sailed through with exact copy and an implement button. A basis I cannot read
 *  withholds everything: I would rather show you nothing than yesterday's work. */
export function withCurrentBasisOnly(view: ChangesView, currentBasis: string | null): ChangesView {
  const keep = currentBasis == null ? [] : view.proposals.filter((p) => p.basis === currentBasis);
  if (keep.length === view.proposals.length && currentBasis != null) return view;
  const id = new Set(keep.map((p) => p.id));
  const ready = view.ready.filter((p) => id.has(p.id));
  const toDo = view.toDo.filter((p) => id.has(p.id));
  // MAX, never a sum: an old-rule release counted rows it also listed, so adding inflates.
  const setAside = Math.max(view.demotedStaleBasis, view.proposals.length - keep.length);
  return { ...view, proposals: keep, ready, toDo,
    summary: { ...view.summary, ready: ready.length, todo: toDo.length },
    demotedStaleBasis: setAside, basisUnreadable: currentBasis == null,
    readyZeroHint: ready.length === 0 && setAside > 0 ? setAsideHint(setAside, toDo.length) : view.readyZeroHint };
}

const EMPTY_CHANGES_VIEW: ChangesView = {
  proposals: [],
  ready: [],
  toDo: [],
  summary: { todo: 0, ready: 0, measuring: 0, results: 0 },
  measuringCountCanonical: 0,
  demotedStaleBasis: 0,
  decidedCountCanonical: 0,
  readyZeroHint: null,
  receiptLine: null,
  surfaceComputedAt: null,
  surfaceBuilding: true,
};

/**
 * THE render entry (request-cached). Serves the ranked ChangesView from the
 * tenant-scoped customer release: a present release serves instantly and, when
 * stale, schedules the ONE background rebuild. A cold first-ever load serves the
 * honest "building" empty state and schedules the rebuild.
 */
export const loadChangesView = cache(
  async (): Promise<ChangesView> => loadChangesViewWithSwr(await currentTenantId()),
);

/** Exported for tests; render paths go through loadChangesView above. */
export async function loadChangesViewWithSwr(tenantId: string): Promise<ChangesView> {
  const scheduleReleaseRebuild = (action: string) =>
    after(async () => {
      try {
        const { refreshCustomerSurface } = await import("./surface-release");
        await refreshCustomerSurface(tenantId);
      } catch (e) {
        await recordAppError({ route: "/changes", tenantId, action, ...errorFieldsFrom(e) });
      }
    });

  const customer = await readCustomerSurface(tenantId).catch(() => null);
  // Shape guard (CORE 100K kernel cutover): a blob written by the pre-kernel
  // changes-data has no `proposals` array. Ignore a stale-shaped release and
  // rebuild in the new shape rather than crash on `view.proposals`.
  const changesShapeOk =
    customer != null && Array.isArray((customer.changes as ChangesView | undefined)?.proposals);
  if (customer && changesShapeOk) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild("background-refresh");
    return withCurrentBasisOnly({
      ...customer.changes,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt),
      surfaceBuilding: false,
      surfaceVersion: customer.releaseId,
    }, await resolveCurrentBasis(tenantId).catch(() => null));
  }
  scheduleReleaseRebuild("cold-rebuild");
  return EMPTY_CHANGES_VIEW;
}

/**
 * THE heavy build body, called from refreshCustomerSurface AFTER proposal
 * production has persisted this tenant's proposals. Reads the persisted proposal
 * queue + the proof ledger; runs no LLM itself. Tenant passed explicitly.
 */
export async function buildChangesViewUncached(tenantId: string): Promise<ChangesView> {
  const [queue, ledgerRows] = await Promise.all([
    loadProposalQueue(tenantId).catch(() => ({ ranked: [], ready: [], toDo: [], demotedStaleBasis: 0, basisUnreadable: true })),
    loadProofLedgerCached(tenantId).catch(() => []),
  ]);

  const ledgerCounts = countLedgerLifecycle(ledgerRows);
  const summary: ChangesSummary = {
    todo: queue.toDo.length,
    ready: queue.ready.length,
    measuring: ledgerCounts.measuring,
    results: ledgerCounts.decided,
  };

  let readyZeroHint: string | null = null;
  if (summary.ready === 0) {
    if (queue.demotedStaleBasis > 0) {
      readyZeroHint = setAsideHint(queue.demotedStaleBasis, summary.todo);
    } else if (summary.todo > 0) {
      readyZeroHint =
        "None has cleared Ready yet. These ideas still need a human look before I hand you exact copy. Open one to review it.";
    } else if (summary.measuring > 0) {
      readyZeroHint = `0 ready right now because everything I prepared is already live and measuring (${summary.measuring} in progress). I'll rank new ideas here as fresh demand data comes in.`;
    } else {
      readyZeroHint =
        "0 ready right now because I don't have a prepared idea for you yet. Once your Google and AI demand data syncs, I'll draft and rank real changes here.";
    }
  }

  const nowMs = Date.now();
  const receiptLine = buildReceiptLine({
    source: "your Search Console and AI demand data",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "ranked",
    nowMs,
    note: null,
  });

  return {
    proposals: queue.ranked,
    ready: queue.ready,
    toDo: queue.toDo,
    summary,
    basisUnreadable: queue.basisUnreadable,
    measuringCountCanonical: ledgerCounts.measuring,
    demotedStaleBasis: queue.demotedStaleBasis,
    decidedCountCanonical: ledgerCounts.decided,
    readyZeroHint,
    receiptLine,
  };
}
