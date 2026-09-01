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
import { actionableProposalFailures, loadProposalQueue, openHold, queueLaneCounts, readAiCaseDispositions, readQueuePage, resolveCurrentBasis, unsettledCause } from "@/domains/decision";
import type { AiCaseFile } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { loadProofLedgerCached } from "@/domains/measurement";
import { countLedgerLifecycle, splitLedgerLifecycle } from "@/domains/decision";
import { buildReceiptLine } from "@/components/data/receipt-line";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { readCustomerSurface, isCustomerSurfaceStale, type CustomerSurface } from "./surface-release";
import { CHANGES_PAGE_SIZE } from "./changes/types";
import { loadWithDeadline } from "@/lib/load-with-deadline";

type ChangesSummary = { todo: number; ready: number; research: number; implemented: number; measuring: number; results: number };

export type ChangesView = {
  /** THE ONE GLOBAL ORDER, every lane interleaved by worth: computed by the build, COMMITTED by the release in one transaction with the surface blob. Absent on cached reads. */
  stampRows?: ReadonlyArray<{ id: string; lane: "ready" | "todo" | "research" }>;
  /** The ranked pre-ship queue, cut to ONE page. `summary` carries the true totals, counted in the database. */
  proposals: ChangeProposal[];
  /** Validated-safe, exact-copy-ready proposals (the Ready tab). */
  ready: ChangeProposal[];
  /** DRAFTS TO REVIEW: exact copy written, one judgement or one named check still standing. */
  toDo: ChangeProposal[];
  /** OPPORTUNITIES BEING RESEARCHED: ranked signals with nothing exact written yet, shown as cards and never
   *  as a bare count. Carried on the release itself (one screen of them), never paged in the database. */
  research: ChangeProposal[];
  /** WHAT DECISION CONCLUDED about the searches these changes answer, read from the ONE case file Visibility
   *  reads. Both surfaces show the same verdict because both read the same record; neither re-derives it.
   *  `unavailable` is carried through as itself, so an unreadable file never reads as "nothing was decided". */
  aiCases: AiCaseFile;
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
  /** Settled wins on the same ledger, for the one compact line that points at Results. */
  wonCountCanonical?: number;
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
  queueCursor?: { all: number; ready?: number };
  queueMore?: { all: boolean; ready?: boolean };
  /** The database's own count of every nonterminal row in the live ranking, behind the one Show more. */
  queueTotal?: number;
  /** The STAMPED lane per row id: the one source of which controls a card carries. */
  laneById?: Record<string, "ready" | "todo" | "research">;
};

/** DATE-BOMB GUARD: an epoch-0 / pre-2026 stamp is never a real ranking time. */
const MIN_VALID_COMPUTED_AT_MS = Date.parse("2026-01-01T00:00:00Z");
export function sanitizeSurfaceComputedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < MIN_VALID_COMPUTED_AT_MS) return null;
  return iso;
}

/** THE EMPTY READY LANE'S OWN COPY, and it may no longer imply an empty screen: drafts to review and the
 *  opportunities under research render underneath whatever this says, so it states the one fact it owns. */
export function setAsideHint(open = 0): string {
  return open > 0
    ? `No finished change is ready right now. ${open} ${open === 1 ? "opportunity is" : "opportunities are"} open below, with what is written for each and what is still missing.`
    : "No finished change is ready right now. The next one is ranked here the moment Beacon has written the exact work.";
}

/** A STORED release is a photograph, and the bar may have moved since it was taken. Every row is put through the SAME one verdict the
 *  ranked queue, the detail page and the mutations ask, so a release can never serve what those doors refuse: right account, current bar,
 *  still waiting on you, a receipt that still resolves, readings that still stand. Comparing the release only against ITSELF was the hole,
 *  because a uniformly stale release looks perfectly consistent. A basis I cannot read withholds everything. */
export function withCurrentBasisOnly(view: ChangesView, ctx: { tenantId: string; currentBasis: string | null }): ChangesView {
  const currentBasis = ctx.currentBasis;
  const standing = view.proposals.filter((p) => actionableProposalFailures(p, ctx).length === 0);
  if (standing.length === view.proposals.length && currentBasis != null) return view;
  // A PHOTOGRAPH IS RE-SORTED, NEVER EMPTIED. A blob published before a gate tightened can be carrying a row in
  // the wrong lane, so every surviving row is put back through the ONE hold: nothing is dropped for being
  // unfinished, it is shown where it belongs and the count follows the list.
  const id = new Set(standing.map((p) => p.id));
  const kept = [...view.ready, ...view.toDo, ...(view.research ?? [])].filter((p) => id.has(p.id));
  const research = kept.filter((p) => openHold(p).lane === "research");
  // THE SAME READY PREDICATE load-proposals applies: status, an open review lane, no blocking hold, AND no unsettled cause. This filter checked three of the four, so a row the queue would never rank Ready could still re-sort into the released ready lane and the two surfaces disagreed by construction.
  const ready = kept.filter((p) => p.status === "ready" && openHold(p).lane === "review" && openHold(p).blocking == null && unsettledCause(p) == null);
  const toDo = kept.filter((p) => !research.includes(p) && !ready.includes(p));
  // MAX, never a sum: an old-rule release counted rows it also listed, so adding inflates.
  const setAside = Math.max(view.demotedStaleBasis, view.proposals.length - standing.length);
  return { ...view, proposals: standing, ready, toDo, research, aiCases: view.aiCases ?? { state: "unavailable" },
    summary: { ...view.summary, ready: ready.length, todo: toDo.length, research: research.length },
    demotedStaleBasis: setAside, basisUnreadable: currentBasis == null,
    readyZeroHint: ready.length === 0 ? setAsideHint(toDo.length + research.length) : view.readyZeroHint };
}

const EMPTY_CHANGES_VIEW: ChangesView = {
  proposals: [], ready: [], toDo: [], research: [], aiCases: { state: "unavailable" }, measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
  summary: { todo: 0, ready: 0, research: 0, implemented: 0, measuring: 0, results: 0 },
  readyZeroHint: null, receiptLine: null, surfaceComputedAt: null, surfaceBuilding: true,
};

/** THE render entry (request-cached). A present release serves instantly and, when stale, schedules the ONE background rebuild; a cold
 *  first-ever load serves the honest "building" empty state. */
export const loadChangesView = cache(async (): Promise<ChangesView> => loadChangesViewWithSwr(await currentTenantId()));

/** What one press of "Show more" gets back. `total` is a COUNT in the database, never a loaded length; `cursor` is where the NEXT press
 *  resumes; `refreshed` is set ONLY when the ranking they were paging is gone, and they get the fresh FIRST page and the sentence why. */
export type ChangesPage = {
  rows: ChangeProposal[]; laneById: Record<string, "ready" | "todo" | "research">; total: number; cursor: number; releaseId: string | null; refreshed: string | null;
  /** Whether the database read a FULL raw page: the only honest basis for offering another press. */ more: boolean;
  /** Changes THIS page was stamped for and then refused. The screen takes them off its own count, so a refusal sitting on page nineteen
   *  lowers the number the operator reads instead of inflating it. */ dropped: number;
};

/** ONE PAGE OF ONE LANE, CUT IN THE DATABASE. Rows come back keyed off the position stamped when the ranking was built, filtered at the
 *  query for this account, the bar it holds now, still waiting on the operator, and the lane, so page nineteen costs what page one costs.
 *  A CURSOR IS A POSITION IN A RANKING: a stale cursor is caught here and answered with the fresh first page. */
export async function readChangesPage(
  tenantId: string, lane: "ready" | "todo" | "all", cursor: number, releaseId?: string | null,
): Promise<ChangesPage> {
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  // A bar I cannot read is not proof anything is current, so I show nothing rather than yesterday's work.
  if (basis == null) return { rows: [], laneById: {}, total: 0, cursor: 0, releaseId: null, refreshed: null, more: false, dropped: 0 };
  const asked = await readQueuePage(tenantId, lane, basis, cursor, CHANGES_PAGE_SIZE);
  const moved = releaseId != null && asked.release != null && releaseId !== asked.release;
  const page = moved ? await readQueuePage(tenantId, lane, basis, 0, CHANGES_PAGE_SIZE) : asked;
  return { rows: page.rows, laneById: page.laneById, total: page.total, cursor: page.nextRank, releaseId: page.release, more: page.more, dropped: page.dropped,
    refreshed: moved ? "The list moved under you while you were reading it, so here is the fresh first page." : null };
}

/** THE FIRST SCREEN IS NOT THE WHOLE QUEUE. The release carries the receipt, the lifecycle counts and the reason a lane is empty; the ROWS
 *  and the true lane totals come from the persisted ranking, one bounded page each. With no ranking stamped yet the release's own first
 *  page is served, never an empty screen. */
async function loadChangesViewWithSwr(tenantId: string): Promise<ChangesView> {
  const t0 = Date.now();
  const view = await readReleasedChanges(tenantId);
  // THE SAVED RELEASE IS THE FIRST PAINT, AND THE LIVE JOINS ARE AN ENHANCEMENT WITH A BUDGET (operator,
  // 2026-09-01). These joins used to run unbounded inside the section's one 5s deadline, so a research cycle
  // slowing the store made a VALID saved release time out into "This section could not load": the operator's own
  // finished work, in hand, hidden behind a spinner. The joins now get exactly the budget the release read left
  // behind; when they exceed it or throw, the release's own saved first page, lanes and counts paint instead.
  // NO FLOOR (operator, 2026-09-01): a release read that already spent the budget paints the release; an 800 ms floor spent on joins after a slow read is exactly how a valid release in hand missed the section's deadline.
  const joinBudget = Math.max(0, 4_400 - (Date.now() - t0));
  const joined = await loadWithDeadline((async (): Promise<ChangesView | null> => {
    const basis = await currentBasisFast(tenantId);
    if (basis == null) return null;
    // ONE PAGE OF THE ONE GLOBAL ORDER, research included: the stamped rank is the only order any surface
    // shows, and the stamped lane rides each row as the control fact (Codex, 2026-08-21).
    const page = await readQueuePage(tenantId, "all", basis, 0, CHANGES_PAGE_SIZE);
    // No ranking stamped: serve the release's own page, and COUNT ONLY WHAT I CAN SERVE, so the screen never offers a "show more" that has nothing behind it.
    if (page.release == null) return { ...view, summary: { ...view.summary, ready: view.ready.length, todo: view.toDo.length } };
    // FINISHED WORK CAN NEVER FALL OFF THE FIRST PAGE (operator, 2026-08-30). The global page is the window onto
    // internal work; the ready lane is fetched by ITSELF, because this page's contract is finished changes first
    // whatever their global rank. Live: per-entry worth ranked seven corrections below a hundred internal rows and
    // the Ready section served empty under a headline of seven, with the finished work behind a button.
    const readyPage = await readQueuePage(tenantId, "ready", basis, 0, CHANGES_PAGE_SIZE);
    const seen = new Set(readyPage.rows.map((r) => r.id));
    const rows = [...readyPage.rows, ...page.rows.filter((r) => !seen.has(r.id))];
    const laneById = { ...page.laneById, ...readyPage.laneById };
    const lane = (l: "ready" | "todo" | "research") => rows.filter((p) => laneById[p.id] === l);
    const counts = await queueLaneCounts(tenantId, page.release, basis);
    // THE READY LANE NEVER SHOWS FEWER CARDS THAN IT COUNTS (operator, 2026-09-01): while a rebuild re-stamps ranks, the lane page can answer empty against a count of one, and the screen said "no finished change" over "Show 1 more". The release's own saved ready rows paint until the stamps catch up.
    return { ...view, proposals: rows, laneById,
      ready: lane("ready").length === 0 && counts.ready > 0 ? view.ready : lane("ready"), toDo: lane("todo"), research: lane("research").length > 0 ? lane("research") : view.research,
      summary: { ...view.summary, ready: counts.ready, todo: counts.todo, research: counts.research }, surfaceVersion: page.release,
      queueCursor: { all: page.nextRank, ready: readyPage.nextRank }, queueMore: { all: page.more, ready: readyPage.more }, queueTotal: page.total };
  })(), joinBudget).catch(() => null);
  if (joined == null || joined.timedOut || joined.data == null) return view; // the saved truth paints; the fresh joins land on the next visit or the next rebuild
  return joined.data;
}

/** THE RELEASE BLOB READ IS THE ONE THAT MUST NOT HANG. When it exceeded the section's whole 5s deadline the screen printed a retry
 *  spinner over a list it had already served minutes earlier. It gets its own short deadline and ONE warm retry, and the last release this
 *  process read successfully is kept per account so a second failure serves that list with its age instead of a spinner. In-process only:
 *  every instance warms its own copy, which is exactly the scope of a fallback that must cost no read. */
const RELEASE_READ_DEADLINE_MS = 2_000;
const lastGoodRelease = new Map<string, CustomerSurface>();
/** THE BASIS FOR A READ IS REMEMBERED FOR A MINUTE (operator, 2026-09-01): a saved release waited on an uncached account read plus a profile
 *  read before it could paint, on every visit. The basis moves only when the website, profile or goal changes; a minute of memory costs
 *  nothing a customer can see, a rebuild re-resolves it live, and a null is never remembered. Process-local, like the remembered release. */
const BASIS_MEMORY_MS = 60_000;
const rememberedBasis = new Map<string, { value: string; at: number }>();
async function currentBasisFast(tenantId: string): Promise<string | null> {
  const held = rememberedBasis.get(tenantId);
  if (held && Date.now() - held.at < BASIS_MEMORY_MS) return held.value;
  const value = await resolveCurrentBasis(tenantId).catch(() => null);
  if (value != null) rememberedBasis.set(tenantId, { value, at: Date.now() });
  return value;
}

/** MEMORY BEATS A SECOND ATTEMPT (operator, 2026-09-01). The old shape spent two 2.5s attempts BEFORE looking at
 *  the copy this process already held, so a slow store burned the section's whole 5s budget on reads whose answer
 *  was already in hand and the operator got a spinner over a list that existed. One bounded attempt; a failure
 *  with a remembered release serves the remembered release immediately; the second attempt is only for the
 *  process that remembers nothing yet. */
async function readReleaseTwice(tenantId: string): Promise<{ s: CustomerSurface | null; ok: boolean; fromMemory: boolean }> {
  const attempt = async () => loadWithDeadline(readCustomerSurface(tenantId), RELEASE_READ_DEADLINE_MS).catch(() => null);
  const first = await attempt();
  if (first && !first.timedOut) {
    // A SUCCESSFUL null IS AN ANSWER (no release published yet) and must not be papered over with a remembered one.
    if (first.data) lastGoodRelease.set(tenantId, first.data);
    return { s: first.data, ok: true, fromMemory: false };
  }
  const remembered = lastGoodRelease.get(tenantId);
  if (remembered) return { s: remembered, ok: true, fromMemory: true };
  const second = await attempt();
  if (second && !second.timedOut) { if (second.data) lastGoodRelease.set(tenantId, second.data); return { s: second.data, ok: true, fromMemory: false }; }
  return { s: null, ok: false, fromMemory: false };
}

/** The released Changes state for this account, basis-checked, scheduling the ONE background rebuild when the release is stale or missing.
 */
async function readReleasedChanges(tenantId: string): Promise<ChangesView> {
  const scheduleReleaseRebuild = (action: string) =>
    after(async () => {
      try {
        const { refreshCustomerSurface } = await import("./surface-release");
        await refreshCustomerSurface(tenantId, { maxDrafts: 0 }); // a stale-release rebuild republishes stored truth at $0; it never drafts
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
    }, { tenantId, currentBasis: await currentBasisFast(tenantId) });
  }
  // A FAILED READ SCHEDULES NO REBUILD: the heavy rebuild is owed when a release is genuinely absent or
  // stale, and firing it on every visit during a store outage is a rebuild loop on top of the outage
  // (operator, 2026-08-21). The store answering again is what ends this state, not more load on it.
  if (read.ok) scheduleReleaseRebuild("cold-rebuild");
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
  const [queue, ledger, aiCases] = await Promise.all([
    loadProposalQueue(tenantId, { currentBasis }).catch(() => ({ ranked: [], ready: [], toDo: [], research: [], implementedPendingVerification: 0, demotedStaleBasis: 0, basisUnreadable: true })),
    // A LEDGER I COULD NOT READ IS NOT AN EMPTY LEDGER: swallowing the error printed "0 measuring, 0 results" during an outage, which reads
    // as "nothing you shipped is being watched" and is a lie they cannot check.
    loadProofLedgerCached(tenantId).then((rows) => ({ rows, read: true })).catch(() => ({ rows: [] as Awaited<ReturnType<typeof loadProofLedgerCached>>, read: false })),
    // THE ONE CASE FILE, read here exactly as Visibility reads it, so a change and the search it answers can
    // never carry two different verdicts on two screens.
    readAiCaseDispositions(tenantId),
  ]);

  const ledgerCounts = countLedgerLifecycle(ledger.rows);
  const won = ledger.read ? splitLedgerLifecycle(ledger.rows, new Date()).won.length : 0;
  const summary: ChangesSummary = {
    todo: queue.toDo.length,
    ready: queue.ready.length,
    research: queue.research.length,
    implemented: queue.implementedPendingVerification,
    measuring: ledgerCounts.measuring,
    results: ledgerCounts.decided,
  };

  // THE EMPTY READY LANE SAYS WHICH EMPTY IT IS, over a screen that still shows every draft and every
  // opportunity underneath it: zero ready is never zero work in view.
  let readyZeroHint: string | null = null;
  if (queue.ready.length === 0) {
    readyZeroHint = queue.toDo.length + queue.research.length > 0
      ? setAsideHint(queue.toDo.length + queue.research.length)
      : summary.measuring > 0
        ? `No finished change is ready right now. Everything written so far is live and being read (${summary.measuring} in progress), and the next change is ranked here as fresh demand data comes in.`
        : "No finished change is ready right now. The next one is ranked here the moment Beacon has written the exact work.";
  }

  // THE RANKING IS NO LONGER STAMPED HERE (Codex, 2026-08-23): stamping during the build meant a build that later
  // failed had already replaced the live order. The build COMPUTES the one global order (research included,
  // interleaved by worth with the lane as the control fact) and hands it to the release, which commits ranking and
  // surface in ONE database transaction or neither. `stampRows` below is that hand-off.
  const nowMs = Date.now();
  const laneOf = (p: ChangeProposal): "ready" | "todo" | "research" =>
    queue.research.some((r) => r.id === p.id) ? "research" : queue.ready.some((r) => r.id === p.id) ? "ready" : "todo";
  const stampRows = queue.ranked.map((p) => ({ id: p.id, lane: laneOf(p) }));
  const receiptLine = buildReceiptLine({
    source: "your Search Console and AI demand data",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "ranked",
    nowMs,
    note: null,
  });

  return {
    stampRows,
    proposals: queue.ranked.slice(0, CHANGES_PAGE_SIZE),
    // BEFORE THE SLICE, because the contradiction this kills lives on page nineteen as much as page one.
    queuedPages: [...new Set(queue.ranked.map((p) => (p.pagePath ?? p.pageUrl ?? "").replace(/^https?:\/\/[^/]+/, "")).filter((s) => s.length > 0))],
    ready: queue.ready.slice(0, CHANGES_PAGE_SIZE),
    toDo: queue.toDo.slice(0, CHANGES_PAGE_SIZE),
    // RESEARCH IS NEVER CUT TO ONE PAGE: it rides the release blob whole, already in hand, so a page-size cut here only ever dropped a reachless opportunity behind an honest count. The feed decides how many render open, never how many exist.
    research: queue.research,
    aiCases,
    summary,
    basisUnreadable: queue.basisUnreadable,
    measuringCountCanonical: ledgerCounts.measuring,
    demotedStaleBasis: queue.demotedStaleBasis,
    decidedCountCanonical: ledgerCounts.decided,
    wonCountCanonical: won,
    readyZeroHint,
    receiptLine,
    surfaceVersion: releaseId,
    ...(ledger.read ? {} : { countsUnavailable: true }),
  };
}
