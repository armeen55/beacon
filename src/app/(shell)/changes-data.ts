import "server-only";

/** changes-data: the server loader for the canonical Changes list, backed entirely by the Decision kernel. The ranked queue is the
 *  account's persisted, re-validated `ChangeProposal`s, and it is PAGED IN THE DATABASE off the position stamped on each row when the
 *  ranking was built: the release carries one page and the counts. THE FIVE STAGES THE OPERATOR IS SHOWN: To do (needs_review), Ready
 *  (ready), Implemented (they say it is done and I have not read their page yet, counted here and never queued), then Measuring and
 *  Results, which are DERIVED from the shipment ledger and never stored as a status, so the two can never disagree (the ONE-COUNT RULE).
 *  READ-ONLY + fail-soft; production runs in the background release build. Publishing stays MANUAL. */
import { cache } from "react";
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { actionableProposalFailures, loadProposalQueue, readQueuePage, resolveCurrentBasis, stampQueueRanking } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { loadProofLedgerCached } from "@/domains/measurement";
import { countLedgerLifecycle } from "@/domains/decision";
import { buildReceiptLine } from "@/components/data/receipt-line";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { readCustomerSurface, isCustomerSurfaceStale, type CustomerSurface } from "./surface-release";
import { CHANGES_PAGE_SIZE } from "./changes/types";
import { loadWithDeadline } from "@/lib/load-with-deadline";

type ChangesSummary = { todo: number; ready: number; implemented: number; measuring: number; results: number };

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
  /** TRUE when the ledger behind the two counts above could not be READ: they are zero because I could not look, and every surface says so
   *  rather than printing the zero. */
  countsUnavailable?: boolean;
  /** TRUE when the customer RELEASE itself could not be read. Distinct from a cold first-ever load, which is what this used to be
   *  indistinguishable from, so an outage painted "I am building it for the first time". */
  releaseUnreadable?: boolean;
  /** TRUE when the rows below came from the LAST GOOD release held in this process, because the stored one did not answer twice. The
   *  screen says how old the list is instead of showing a spinner over a list it already has. */
  releaseFromMemory?: boolean;
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
  /** EVERY PAGE THAT HAS A CARD IN THE QUEUE, as a path, taken from the whole ranking before it was cut to one screen. The feed reads it
   *  so a page whose fix is sitting in the queue can never also be listed as a page I have no change for. */
  queuedPages?: string[];
  /** Where each lane's NEXT page resumes: the last RANK on this screen, never its row count. A change put aside since the ranking was
   *  stamped leaves a hole, and counting rows through it repeats one change. */
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
  return `The bar for what counts as worth your time went up, so ${n} earlier ${n === 1 ? "idea" : "ideas"} that no longer clear it went aside.`;
}
/** THE READY LANE'S OWN EMPTY COPY, and only that. The set-aside sentence above belongs to Watching, which is
 *  where those ideas actually sit; saying it in both places printed one fact on one screen twice.
 *  "Nothing needs your time today" is FALSE with review work waiting, and it was printed above a To do tab. */
export function setAsideHint(toDo = 0): string {
  return toDo > 0
    ? `The ${toDo} ${toDo === 1 ? "idea" : "ideas"} still on your To do list are the ones backed by evidence today.`
    : "No change has cleared Ready yet. The research below is what is being done about that, and the next one that earns it lands here.";
}

/** A STORED release is a photograph, and the bar may have moved since it was taken. Every row is put through the SAME one verdict the
 *  ranked queue, the detail page and the mutations ask, so a release can never serve what those doors refuse: right account, current bar,
 *  still waiting on you, a receipt that still resolves, readings that still stand. Comparing the release only against ITSELF was the hole,
 *  because a uniformly stale release looks perfectly consistent. A basis I cannot read withholds everything. */
export function withCurrentBasisOnly(view: ChangesView, ctx: { tenantId: string; currentBasis: string | null }): ChangesView {
  const currentBasis = ctx.currentBasis;
  const keep = view.proposals.filter((p) => actionableProposalFailures(p, ctx).length === 0);
  if (keep.length === view.proposals.length && currentBasis != null) return view;
  const id = new Set(keep.map((p) => p.id));
  const ready = view.ready.filter((p) => id.has(p.id));
  const toDo = view.toDo.filter((p) => id.has(p.id));
  // MAX, never a sum: an old-rule release counted rows it also listed, so adding inflates.
  const setAside = Math.max(view.demotedStaleBasis, view.proposals.length - keep.length);
  return { ...view, proposals: keep, ready, toDo,
    summary: { ...view.summary, ready: ready.length, todo: toDo.length },
    demotedStaleBasis: setAside, basisUnreadable: currentBasis == null,
    readyZeroHint: ready.length === 0 && setAside > 0 ? setAsideHint(toDo.length) : view.readyZeroHint };
}

const EMPTY_CHANGES_VIEW: ChangesView = {
  proposals: [], ready: [], toDo: [], measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
  summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 },
  readyZeroHint: null, receiptLine: null, surfaceComputedAt: null, surfaceBuilding: true,
};

/** THE render entry (request-cached). A present release serves instantly and, when stale, schedules the ONE background rebuild; a cold
 *  first-ever load serves the honest "building" empty state. */
export const loadChangesView = cache(async (): Promise<ChangesView> => loadChangesViewWithSwr(await currentTenantId()));

/** What one press of "Show more" gets back. `total` is a COUNT in the database, never a loaded length; `cursor` is where the NEXT press
 *  resumes; `refreshed` is set ONLY when the ranking they were paging is gone, and they get the fresh FIRST page and the sentence why. */
export type ChangesPage = {
  rows: ChangeProposal[]; total: number; cursor: number; releaseId: string | null; refreshed: string | null;
  /** Whether the database read a FULL raw page: the only honest basis for offering another press. */ more: boolean;
  /** Changes THIS page was stamped for and then refused. The screen takes them off its own count, so a refusal sitting on page nineteen
   *  lowers the number the operator reads instead of inflating it. */ dropped: number;
};

/** ONE PAGE OF ONE LANE, CUT IN THE DATABASE. Rows come back keyed off the position stamped when the ranking was built, filtered at the
 *  query for this account, the bar it holds now, still waiting on the operator, and the lane, so page nineteen costs what page one costs.
 *  A CURSOR IS A POSITION IN A RANKING: a stale cursor is caught here and answered with the fresh first page. */
export async function readChangesPage(
  tenantId: string, lane: "ready" | "todo", cursor: number, releaseId?: string | null,
): Promise<ChangesPage> {
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  // A bar I cannot read is not proof anything is current, so I show nothing rather than yesterday's work.
  if (basis == null) return { rows: [], total: 0, cursor: 0, releaseId: null, refreshed: null, more: false, dropped: 0 };
  const asked = await readQueuePage(tenantId, lane, basis, cursor, CHANGES_PAGE_SIZE);
  const moved = releaseId != null && asked.release != null && releaseId !== asked.release;
  const page = moved ? await readQueuePage(tenantId, lane, basis, 0, CHANGES_PAGE_SIZE) : asked;
  return { rows: page.rows, total: page.total, cursor: page.nextRank, releaseId: page.release, more: page.more, dropped: page.dropped,
    refreshed: moved ? "The list moved under you while you were reading it, so here is the fresh first page." : null };
}

/** THE FIRST SCREEN IS NOT THE WHOLE QUEUE. The release carries the receipt, the lifecycle counts and the reason a lane is empty; the ROWS
 *  and the true lane totals come from the persisted ranking, one bounded page each. With no ranking stamped yet the release's own first
 *  page is served, never an empty screen. */
async function loadChangesViewWithSwr(tenantId: string): Promise<ChangesView> {
  const view = await readReleasedChanges(tenantId);
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  if (basis == null) return view;
  const [ready, toDo] = await Promise.all([
    readQueuePage(tenantId, "ready", basis, 0, CHANGES_PAGE_SIZE),
    readQueuePage(tenantId, "todo", basis, 0, CHANGES_PAGE_SIZE),
  ]);
  // No ranking stamped: serve the release's own page, and COUNT ONLY WHAT I CAN SERVE, so the screen never offers a "show more" that has
  // nothing behind it.
  if (ready.release == null) return { ...view, summary: { ...view.summary, ready: view.ready.length, todo: view.toDo.length } };
  return { ...view, proposals: [...ready.rows, ...toDo.rows], ready: ready.rows, toDo: toDo.rows,
    summary: { ...view.summary, ready: ready.total, todo: toDo.total }, surfaceVersion: ready.release,
    queueCursor: { ready: ready.nextRank, todo: toDo.nextRank },
    queueMore: { ready: ready.more, todo: toDo.more } };
}

/** THE RELEASE BLOB READ IS THE ONE THAT MUST NOT HANG. When it exceeded the section's whole 5s deadline the screen printed a retry
 *  spinner over a list it had already served minutes earlier. It gets its own short deadline and ONE warm retry, and the last release this
 *  process read successfully is kept per account so a second failure serves that list with its age instead of a spinner. In-process only:
 *  every instance warms its own copy, which is exactly the scope of a fallback that must cost no read. */
const RELEASE_READ_DEADLINE_MS = 2_500;
const lastGoodRelease = new Map<string, CustomerSurface>();

async function readReleaseTwice(tenantId: string): Promise<{ s: CustomerSurface | null; ok: boolean; fromMemory: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raced = await loadWithDeadline(readCustomerSurface(tenantId), RELEASE_READ_DEADLINE_MS).catch(() => null);
    if (raced && !raced.timedOut) {
      // A SUCCESSFUL null IS AN ANSWER (no release published yet) and must not be papered over with a remembered one.
      if (raced.data) lastGoodRelease.set(tenantId, raced.data);
      return { s: raced.data, ok: true, fromMemory: false };
    }
  }
  const remembered = lastGoodRelease.get(tenantId);
  return remembered ? { s: remembered, ok: true, fromMemory: true } : { s: null, ok: false, fromMemory: false };
}

/** The released Changes state for this account, basis-checked, scheduling the ONE background rebuild when the release is stale or missing.
 */
async function readReleasedChanges(tenantId: string): Promise<ChangesView> {
  const scheduleReleaseRebuild = (action: string) =>
    after(async () => {
      try {
        const { refreshCustomerSurface } = await import("./surface-release");
        await refreshCustomerSurface(tenantId);
      } catch (e) { await recordAppError({ route: "/changes", tenantId, action, ...errorFieldsFrom(e) }); }
    });

  const read = await readReleaseTwice(tenantId);
  const customer = read.s;
  // Shape guard (CORE 100K kernel cutover): a blob written by the pre-kernel changes-data has no `proposals` array. Ignore a stale-shaped
  // release and rebuild rather than crash on `view.proposals`.
  const changesShapeOk =
    customer != null && Array.isArray((customer.changes as ChangesView | undefined)?.proposals);
  if (customer && changesShapeOk) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild("background-refresh");
    return withCurrentBasisOnly({
      ...customer.changes,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt),
      surfaceBuilding: false,
      surfaceVersion: customer.releaseId,
      ...(read.fromMemory ? { releaseFromMemory: true } : {}),
    }, { tenantId, currentBasis: await resolveCurrentBasis(tenantId).catch(() => null) });
  }
  scheduleReleaseRebuild("cold-rebuild");
  // A RELEASE I COULD NOT READ IS NOT A FIRST-EVER LOAD: claiming I am building their ranking for the first time during an outage is a
  // sentence an established customer knows is false the moment they read it.
  return read.ok ? EMPTY_CHANGES_VIEW : { ...EMPTY_CHANGES_VIEW, surfaceBuilding: false, releaseUnreadable: true };
}

/** THE heavy build body, called from refreshCustomerSurface AFTER proposal production has persisted this tenant's proposals. Reads the
 *  persisted proposal queue + the proof ledger; runs no LLM itself. Tenant passed explicitly. */
export async function buildChangesViewUncached(tenantId: string, releaseId: string): Promise<ChangesView> {
  // ONE basis per release: the queue, the ranking stamp and every page cut from it answer to the same bar, so the list can never page a
  // ranking built against a bar it is no longer filtering on.
  const currentBasis = await resolveCurrentBasis(tenantId).catch(() => null);
  const [queue, ledger] = await Promise.all([
    loadProposalQueue(tenantId, { currentBasis }).catch(() => ({ ranked: [], ready: [], toDo: [], implementedPendingVerification: 0, demotedStaleBasis: 0, basisUnreadable: true })),
    // A LEDGER I COULD NOT READ IS NOT AN EMPTY LEDGER: swallowing the error printed "0 measuring, 0 results" during an outage, which reads
    // as "nothing you shipped is being watched" and is a lie they cannot check.
    loadProofLedgerCached(tenantId).then((rows) => ({ rows, read: true })).catch(() => ({ rows: [] as Awaited<ReturnType<typeof loadProofLedgerCached>>, read: false })),
  ]);

  const ledgerCounts = countLedgerLifecycle(ledger.rows);
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
      readyZeroHint = setAsideHint(summary.todo);
    } else if (summary.todo > 0) {
      readyZeroHint =
        "None has cleared Ready yet. These ideas still need a human look before exact copy is handed over. Open one to review it.";
    } else if (summary.measuring > 0) {
      readyZeroHint = `Nothing is ready right now because everything prepared is already live and being read (${summary.measuring} in progress). New ideas get ranked here as fresh demand data comes in.`;
    } else {
      readyZeroHint =
        "Nothing is ready right now because no prepared idea has earned its place yet. Once your Google and AI demand data syncs, real changes get drafted and ranked here.";
    }
  }

  // THE RANKING IS PERSISTED, THE RELEASE IS NOT THE QUEUE. Every row gets its position in THIS ranking written down, so the list pages it
  // in the database and the release carries one page. The stamp names the ID this release publishes under, so Today, Changes and every
  // "show more" name one release; a stamp that does not land ABORTS THE PUBLISH and the previous complete release keeps serving.
  const nowMs = Date.now();
  if (!(await stampQueueRanking(tenantId, releaseId,
    queue.ready.map((p) => p.id), queue.toDo.map((p) => p.id)).catch(() => false))) {
    throw new Error("The order of your changes could not be written down, so your previous list was kept rather than publishing one that cannot be paged.");
  }
  const receiptLine = buildReceiptLine({
    source: "your Search Console and AI demand data",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "ranked",
    nowMs,
    note: null,
  });

  return {
    proposals: queue.ranked.slice(0, CHANGES_PAGE_SIZE),
    // BEFORE THE SLICE, because the contradiction this kills lives on page nineteen as much as page one.
    queuedPages: [...new Set(queue.ranked.map((p) => (p.pagePath ?? p.pageUrl ?? "").replace(/^https?:\/\/[^/]+/, "")).filter((s) => s.length > 0))],
    ready: queue.ready.slice(0, CHANGES_PAGE_SIZE),
    toDo: queue.toDo.slice(0, CHANGES_PAGE_SIZE),
    summary,
    basisUnreadable: queue.basisUnreadable,
    measuringCountCanonical: ledgerCounts.measuring,
    demotedStaleBasis: queue.demotedStaleBasis,
    decidedCountCanonical: ledgerCounts.decided,
    readyZeroHint,
    receiptLine,
    surfaceVersion: releaseId,
    ...(ledger.read ? {} : { countsUnavailable: true }),
  };
}
