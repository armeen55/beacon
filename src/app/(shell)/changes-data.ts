import "server-only";

/**
 * changes-data: the server loader for the canonical Changes list, backed entirely by the Decision kernel.
 * The ranked queue is the account's persisted, re-validated `ChangeProposal`s, and it is PAGED IN THE
 * DATABASE off the position stamped on each row when the ranking was built: the customer release carries
 * one page and the counts, never the queue.
 *
 * THE FIVE STAGES THE OPERATOR IS SHOWN, and where each one is decided:
 *   To do       = status "needs_review": generated, wants a look.
 *   Ready       = status "ready": validated safe, exact copy.
 *   Implemented = status "implemented_pending_verification": they say it is done, I have not read
 *                 their page yet. Counted here, never queued: it is not work waiting on them.
 *   Measuring   = the ledger: a verification landed and the reading windows are open.
 *   Results     = the ledger: the reading is decided.
 * The last two are DERIVED from the shipment ledger and never stored as a status, so the two can never
 * disagree (the ONE-COUNT RULE). READ-ONLY + fail-soft. Proposal PRODUCTION runs in the background release
 * build, not on the render path. Publishing stays MANUAL.
 */
import { cache } from "react";
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProposalQueue, readQueuePage, resolveCurrentBasis, stampQueueRanking } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { loadProofLedgerCached } from "@/domains/measurement";
import { countLedgerLifecycle } from "@/domains/decision";
import { buildReceiptLine } from "@/components/data/receipt-line";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { CHANGES_PAGE_SIZE } from "./changes/types";

export type ChangesSummary = { todo: number; ready: number; implemented: number; measuring: number; results: number };

export type ChangesView = {
  /** The ranked pre-ship queue, cut to ONE page. `summary` carries the true totals, counted in the database. */
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
  /** Where each lane's NEXT page resumes: the last RANK on this screen, never its row count. A change put
   *  aside since the ranking was stamped leaves a hole, and counting rows through it repeats one change. */
  queueCursor?: { ready: number; todo: number };
  queueMore?: { ready: boolean; todo: boolean };
};

/** DATE-BOMB GUARD: an epoch-0 / pre-2026 stamp is never a real ranking time. */
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

/** A STORED release is a photograph, and the bar may have moved since it was taken. Every row is checked
 *  against the basis the account holds RIGHT NOW: same basis stays, anything else is withheld. Comparing the
 *  release only against ITSELF was the hole, because a uniformly stale release looks perfectly consistent. A
 *  basis I cannot read withholds everything: better nothing than yesterday's work. */
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
  proposals: [], ready: [], toDo: [], measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
  summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 },
  readyZeroHint: null, receiptLine: null, surfaceComputedAt: null, surfaceBuilding: true,
};

/** THE render entry (request-cached). A present release serves instantly and, when stale, schedules the ONE
 *  background rebuild; a cold first-ever load serves the honest "building" empty state. */
export const loadChangesView = cache(
  async (): Promise<ChangesView> => loadChangesViewWithSwr(await currentTenantId()),
);

/** What one press of "Show more" gets back. `total` is the exact count of the lane, taken as a COUNT in the
 *  database and never the length of anything loaded. `cursor` is where the NEXT press resumes. `refreshed` is
 *  set ONLY when the ranking the operator was paging through is gone: they get the fresh FIRST page and the
 *  sentence saying why. */
export type ChangesPage = {
  rows: ChangeProposal[]; total: number; cursor: number; releaseId: string | null; refreshed: string | null;
  /** Whether the database read a FULL raw page: the only honest basis for offering another press. */ more: boolean;
};

/** ONE PAGE OF ONE LANE, CUT IN THE DATABASE. Nothing here loads the queue or the customer release: the rows
 *  come back keyed off the position stamped on each change when the ranking was built, filtered at the query
 *  for this account, the bar it holds now, still waiting on the operator, and the lane, so page nineteen
 *  costs exactly what page one costs. A CURSOR IS NOT JUST A NUMBER: it is a position IN A RANKING, and when
 *  the rebuild has replaced that ranking, position 25 of the new order is a different change from position 25
 *  of the old one, so paging on regardless would silently skip some and repeat others. A stale cursor is
 *  caught here and answered with the fresh first page and a sentence. */
export async function readChangesPage(
  tenantId: string, lane: "ready" | "todo", cursor: number, releaseId?: string | null,
): Promise<ChangesPage> {
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  // A bar I cannot read is not proof anything is current, so I show nothing rather than yesterday's work.
  if (basis == null) return { rows: [], total: 0, cursor: 0, releaseId: null, refreshed: null, more: false };
  const asked = await readQueuePage(tenantId, lane, basis, cursor, CHANGES_PAGE_SIZE);
  const moved = releaseId != null && asked.release != null && releaseId !== asked.release;
  const page = moved ? await readQueuePage(tenantId, lane, basis, 0, CHANGES_PAGE_SIZE) : asked;
  return { rows: page.rows, total: page.total, cursor: page.nextRank, releaseId: page.release, more: page.more,
    refreshed: moved ? "The list moved under you while you were reading it, so here is the fresh first page." : null };
}

/** THE FIRST SCREEN IS NOT THE WHOLE QUEUE, and it never was in memory either. The release carries the
 *  receipt, the lifecycle counts and the reason a lane is empty; the ROWS and the true lane totals come from
 *  the persisted ranking, one bounded page each. When no ranking is stamped yet (a first deploy, or a stamp
 *  that could not land) the release's own first page is served rather than an empty screen. */
async function loadChangesViewWithSwr(tenantId: string): Promise<ChangesView> {
  const view = await readReleasedChanges(tenantId);
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  if (basis == null) return view;
  const [ready, toDo] = await Promise.all([
    readQueuePage(tenantId, "ready", basis, 0, CHANGES_PAGE_SIZE),
    readQueuePage(tenantId, "todo", basis, 0, CHANGES_PAGE_SIZE),
  ]);
  // No ranking stamped: serve the release's own page, and COUNT ONLY WHAT I CAN SERVE, so the screen never
  // offers a "show more" that has nothing behind it.
  if (ready.release == null) return { ...view, summary: { ...view.summary, ready: view.ready.length, todo: view.toDo.length } };
  return { ...view, proposals: [...ready.rows, ...toDo.rows], ready: ready.rows, toDo: toDo.rows,
    summary: { ...view.summary, ready: ready.total, todo: toDo.total }, surfaceVersion: ready.release,
    queueCursor: { ready: ready.nextRank, todo: toDo.nextRank },
    queueMore: { ready: ready.more, todo: toDo.more } };
}

/** The released Changes state for this account, basis-checked, scheduling the ONE background rebuild when
 *  the release is stale or missing. */
async function readReleasedChanges(tenantId: string): Promise<ChangesView> {
  const scheduleReleaseRebuild = (action: string) =>
    after(async () => {
      try {
        const { refreshCustomerSurface } = await import("./surface-release");
        await refreshCustomerSurface(tenantId);
      } catch (e) { await recordAppError({ route: "/changes", tenantId, action, ...errorFieldsFrom(e) }); }
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
    loadProposalQueue(tenantId).catch(() => ({ ranked: [], ready: [], toDo: [], implementedPendingVerification: 0, demotedStaleBasis: 0, basisUnreadable: true })),
    loadProofLedgerCached(tenantId).catch(() => []),
  ]);

  const ledgerCounts = countLedgerLifecycle(ledgerRows);
  const summary: ChangesSummary = {
    todo: queue.toDo.length,
    ready: queue.ready.length,
    implemented: queue.implementedPendingVerification,
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

  // THE RANKING IS PERSISTED, THE RELEASE IS NOT THE QUEUE. Every row of the queue gets its position in THIS
  // ranking written down, so the list pages it in the database; the release below then carries one page, not
  // an unlimited blob of changes nobody on that screen can read.
  const nowMs = Date.now();
  await stampQueueRanking(tenantId, `${tenantId}:${new Date(nowMs).toISOString()}`,
    queue.ready.map((p) => p.id), queue.toDo.map((p) => p.id)).catch(() => false);
  const receiptLine = buildReceiptLine({
    source: "your Search Console and AI demand data",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "ranked",
    nowMs,
    note: null,
  });

  return {
    proposals: queue.ranked.slice(0, CHANGES_PAGE_SIZE),
    ready: queue.ready.slice(0, CHANGES_PAGE_SIZE),
    toDo: queue.toDo.slice(0, CHANGES_PAGE_SIZE),
    summary,
    basisUnreadable: queue.basisUnreadable,
    measuringCountCanonical: ledgerCounts.measuring,
    demotedStaleBasis: queue.demotedStaleBasis,
    decidedCountCanonical: ledgerCounts.decided,
    readyZeroHint,
    receiptLine,
  };
}
