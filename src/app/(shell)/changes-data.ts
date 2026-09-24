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
import { actionableProposalFailures, confirmedVersion, loadChangeProposals, loadProposalQueue, openHold, readAiCaseDispositions, readQueuePage, resolveCurrentBasis } from "@/domains/decision";
import type { AiCaseFile } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { loadProofLedgerCached } from "@/domains/measurement";
import { countLedgerLifecycle, splitLedgerLifecycle } from "@/domains/decision";
import { buildReceiptLine } from "@/components/data/receipt-line";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { readCustomerSurface, isCustomerSurfaceStale, type CustomerSurface } from "./surface-release";
import operatorUiPolicy, { CHANGES_PAGE_SIZE } from "./changes/types";
import { loadWithDeadline } from "@/lib/load-with-deadline";

type ChangesSummary = { todo: number; ready: number; research: number; implemented: number; measuring: number; results: number };

export type ChangesView = {
  /** THE ONE GLOBAL ORDER, every lane interleaved by worth: committed with the surface and used to reconcile off-page retirements. */
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
  waitingLiveCountCanonical?: number;
  blockedCountCanonical?: number;
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
function setAsideHint(open = 0): string {
  return open > 0
    ? `No finished change is ready right now. ${open} ${open === 1 ? "opportunity is" : "opportunities are"} open below, with what is written for each and what is still missing.`
    : "No finished change is ready yet. The next one lands here when the exact work is written.";
}

/** The release manifest is the database's stamped order (one-based ordinality). */
export function releasedQueueCursors(manifest: CustomerSurface["manifest"], view: ChangesView): { all: number; ready: number } {
  const ranks = new Map((manifest ?? []).map((row, i) => [row.id, i + 1]));
  return { all: ranks.get(view.proposals.at(-1)?.id ?? "") ?? 0,
    ready: Math.max(0, ...view.ready.map((p) => ranks.get(p.id) ?? 0)) };
}

/** A STORED release is a photograph, and the bar may have moved since it was taken. Every row is put through the SAME one verdict the
 *  ranked queue, the detail page and the mutations ask, so a release can never serve what those doors refuse: right account, current bar,
 *  still waiting on you, a receipt that still resolves, readings that still stand. Comparing the release only against ITSELF was the hole,
 *  because a uniformly stale release looks perfectly consistent. A basis I cannot read withholds everything. */
export function withCurrentBasisOnly(view: ChangesView, ctx: { tenantId: string; currentBasis: string | null; currentRows?: ReadonlyMap<string, ChangeProposal> }): ChangesView {
  const currentBasis = ctx.currentBasis;
  if (currentBasis == null) return { ...view, proposals: [], ready: [], toDo: [], research: [], laneById: {},
    summary: { ...view.summary, ready: 0, todo: 0, research: 0 }, basisUnreadable: true,
    readyZeroHint: setAsideHint() };
  // Ready has its own page and can sit below the first global page. Recheck every
  // lane the release carries, not only that global slice.
  const all = new Map([...view.proposals, ...view.ready, ...view.toDo, ...(view.research ?? [])].map((p) => [p.id, p]));
  const standing = new Set([...all.values()].filter((p) => {
    if (actionableProposalFailures(p, ctx).length > 0) return false;
    if (!ctx.currentRows) return true;
    const current = ctx.currentRows.get(p.id);
    return !!current && operatorUiPolicy.isManualEditProofWork(current) && current.status === p.status && current.researchOnly === p.researchOnly
      && confirmedVersion(current) === confirmedVersion(p) && actionableProposalFailures(current, ctx).length === 0
      && openHold(current).lane === openHold(p).lane;
  }).map((p) => p.id));
  // A PHOTOGRAPH IS RE-SORTED, NEVER EMPTIED. A blob published before a gate tightened can be carrying a row in
  // the wrong lane, so every surviving row is put back through the ONE hold: nothing is dropped for being
  // unfinished, it is shown where it belongs and the count follows the list.
  const kept = [...view.ready, ...view.toDo, ...(view.research ?? [])].filter((p) => standing.has(p.id));
  const research = kept.filter((p) => openHold(p).lane === "research");
  // THE SAME READY PREDICATE load-proposals applies: status, an open review lane and NO DEFECT under the one verdict (journey review, 2026-09-06: this read `blocking`, which is drawn from the hard arms alone, beside a second name for the same value, so a row held by a typed fault could re-sort into the released ready lane while the queue refused it).
  const ready = kept.filter((p) => p.status === "ready" && openHold(p).lane === "review" && openHold(p).defects.length === 0);
  const toDo = kept.filter((p) => !research.includes(p) && !ready.includes(p));
  // Totals cover the whole tenant; lane arrays may carry only their first page.
  // Move or remove only rows this release actually exposed to the recheck.
  const oldLane = new Map<string, "ready" | "todo" | "research">([
    ...view.ready.map((p) => [p.id, "ready" as const] as const),
    ...view.toDo.map((p) => [p.id, "todo" as const] as const),
    ...(view.research ?? []).map((p) => [p.id, "research" as const] as const),
  ]);
  const counts = { ready: view.summary.ready, todo: view.summary.todo, research: view.summary.research };
  const newLane = new Map<string, "ready" | "todo" | "research">([
    ...ready.map((p) => [p.id, "ready" as const] as const),
    ...toDo.map((p) => [p.id, "todo" as const] as const),
    ...research.map((p) => [p.id, "research" as const] as const),
  ]);
  for (const [id, from] of oldLane) { const to = newLane.get(id); if (to === from) continue; counts[from] = Math.max(0, counts[from] - 1); if (to) counts[to] += 1; }
  // The release can carry only the first Ready/To do page. A retirement beyond it still lowers the whole-tenant count.
  if (ctx.currentRows) for (const row of view.stampRows ?? []) {
    if (oldLane.has(row.id)) continue;
    const current: ChangeProposal | undefined = ctx.currentRows.get(row.id);
    const hold: ReturnType<typeof openHold> | undefined = current ? openHold(current) : undefined;
    const lane = hold?.lane === "research" ? "research" : current?.status === "ready" && hold?.defects.length === 0 ? "ready" : "todo";
    if (!current || !operatorUiPolicy.isManualEditProofWork(current) || actionableProposalFailures(current, ctx).length > 0) counts[row.lane] = Math.max(0, counts[row.lane] - 1);
    else if (lane !== row.lane) { counts[row.lane] = Math.max(0, counts[row.lane] - 1); counts[lane] += 1; }
  }
  // MAX, never a sum: an old-rule release counted rows it also listed, so adding inflates.
  const setAside = Math.max(view.demotedStaleBasis, [...all.values()].filter((p) => actionableProposalFailures(p, ctx).length > 0).length);
  const firstPage = view.proposals.filter((p) => standing.has(p.id));
  const shown = new Set(ready.map((p) => p.id));
  return { ...view, proposals: [...ready, ...firstPage.filter((p) => !shown.has(p.id))], ready, toDo, research, aiCases: view.aiCases ?? { state: "unavailable" },
    // THE STAMPED LANES FOLLOW THE RE-SORT (operator walk, 2026-09-16 00:00Z): the client reads a row's lane off `laneById` and fails closed to "todo" for a row the stamp does not know, so a remembered release re-sorted here painted "Ready now: 8 finished changes" over an empty box and a "Show 8 more" button, with every finished card hidden.
    laneById: Object.fromEntries([...ready.map((p) => [p.id, "ready" as const]), ...toDo.map((p) => [p.id, "todo" as const]), ...research.map((p) => [p.id, "research" as const])]),
    summary: { ...view.summary, ...counts },
    demotedStaleBasis: setAside, basisUnreadable: currentBasis == null,
    readyZeroHint: counts.ready === 0 ? setAsideHint(counts.todo + counts.research) : null };
}

const EMPTY_CHANGES_VIEW: ChangesView = {
  proposals: [], ready: [], toDo: [], research: [], aiCases: { state: "unavailable" }, measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
  summary: { todo: 0, ready: 0, research: 0, implemented: 0, measuring: 0, results: 0 },
  readyZeroHint: setAsideHint(), receiptLine: null, surfaceComputedAt: null, surfaceBuilding: true, // the empty lane's sentence is on the view, so the list, the page and Today read one copy of it
};

/** THE render entry (request-cached). A present release serves instantly and, when stale, schedules the ONE background rebuild; a cold
 *  first-ever load serves the honest "building" empty state. */
export const loadChangesView = cache(async (): Promise<ChangesView> => loadChangesViewWithSwr(await currentTenantId()));

/** What one press of "Show more" gets back. `total` is a COUNT in the database, never a loaded length; `cursor` is where the NEXT press
 *  resumes; `refreshed` is set ONLY when the ranking they were paging is gone, and they get the fresh FIRST page and the sentence why. */
export type ChangesPage = {
  rows: ChangeProposal[]; laneById: Record<string, "ready" | "todo" | "research">; total: number; cursor: number; releaseId: string | null; refreshed: string | null;
  /** The saved release is still current, but its live rank stamps are incomplete; keep the caller's cards and cursor. */
  pending?: string;
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
  const asked = await readQueuePage(tenantId, lane, basis, cursor, CHANGES_PAGE_SIZE, operatorUiPolicy.isManualEditProofWork);
  const moved = releaseId != null && asked.release != null && releaseId !== asked.release;
  const page = moved ? await readQueuePage(tenantId, lane, basis, 0, CHANGES_PAGE_SIZE, operatorUiPolicy.isManualEditProofWork) : asked;
  if (releaseId && !moved) {
    const pending = (why: string): ChangesPage => ({ rows: [], laneById: {}, total: 0, cursor, releaseId, refreshed: null, more: true, dropped: 0, pending: why });
    if (asked.release !== releaseId) return pending("The saved ranking is updating. Your changes remain above; try Show more again after it refreshes.");
    const [saved, current] = await Promise.all([readCustomerSurface(tenantId), loadChangeProposals(tenantId, { failClosed: true, canonicalOnly: true })]).catch(() => [null, null] as const);
    if (!saved || saved.releaseId !== releaseId || !saved.manifest || !current) return pending("The saved ranking could not be checked just now. Your changes remain above; try Show more again.");
    const standing = (row: { id: string; lane: "ready" | "todo" | "research" }) => {
      const p = current.get(row.id);
      return (lane === "all" || row.lane === lane) && !!p && actionableProposalFailures(p, { tenantId, currentBasis: basis }).length === 0
        && operatorUiPolicy.isManualEditProofWork(p) && (lane !== "ready" || p.status === "ready" && p.researchOnly !== true && openHold(p).defects.length === 0);
    };
    const ids = saved.manifest.filter(standing).map((r) => r.id);
    const slice = saved.manifest.slice(Math.max(0, cursor), page.nextRank).filter(standing).map((r) => r.id);
    const exactStamp = page.rows.every((p) => { const rank = page.rankById[p.id], row = saved.manifest?.[rank - 1];
      return Number.isInteger(rank) && rank > cursor && row?.id === p.id && row.lane === page.stampedLaneById[p.id]; });
    if (ids.length !== page.total || !exactStamp || JSON.stringify(slice) !== JSON.stringify(page.rows.map((r) => r.id)))
      return pending("The saved ranking is updating. Your changes remain above; try Show more again after it refreshes.");
  }
  return { rows: page.rows, laneById: page.laneById, total: page.total, cursor: page.nextRank, releaseId: page.release, more: page.more, dropped: page.dropped,
    refreshed: moved ? "The list moved under you while you were reading it, so here is the fresh first page." : null };
}

/** One release supplies the first screen. Current canonical rows may withhold a retired or changed copy, but a rank stamp cleared during
 *  research never erases a still-current Ready change. Show more reads the live ranking with its release cursor. */
async function loadChangesViewWithSwr(tenantId: string): Promise<ChangesView> {
  const t0 = Date.now();
  const view = await readReleasedChanges(tenantId);
  if (!view.surfaceVersion || view.basisUnreadable) return view;
  // A verification can move between releases; Results reads these same persisted rows and counter.
  const joinBudget = Math.max(0, 4_400 - (Date.now() - t0));
  const [current, ledger] = await Promise.all([loadWithDeadline(loadChangeProposals(tenantId, { failClosed: true, canonicalOnly: true }), joinBudget).catch(() => null), loadWithDeadline(loadProofLedgerCached(tenantId), Math.min(joinBudget, 700)).catch(() => null)]);
  const counts = ledger && !ledger.timedOut ? countLedgerLifecycle(ledger.data) : null;
  const live = counts ? { ...view, summary: { ...view.summary, measuring: counts.measuring, results: counts.decided }, measuringCountCanonical: counts.measuring, waitingLiveCountCanonical: counts.waiting, blockedCountCanonical: counts.blocked, decidedCountCanonical: counts.decided, wonCountCanonical: counts.won, countsUnavailable: false } : { ...view, countsUnavailable: true };
  if (!current || current.timedOut) return live;
  const basis = await currentBasisFast(tenantId);
  return basis == null ? live : withCurrentBasisOnly(live, { tenantId, currentBasis: basis, currentRows: current.data });
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
  // A REMEMBERED BASIS BEATS A BLANK ONE (operator, 2026-09-01): a lookup that failed under a background rebuild read as "no basis", the ready list emptied, and the heading kept the release's count of one. The last basis this process resolved stands until the store answers again.
  return value ?? held?.value ?? null;
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
      stampRows: customer.manifest ?? customer.changes.stampRows,
      queueCursor: customer.manifest?.length ? releasedQueueCursors(customer.manifest, customer.changes) : customer.changes.queueCursor,
      // THE RELEASE'S OWN LANES ARE ITS STAMPS (operator walk, 2026-09-16 00:00Z): the saved release carries `ready`, `toDo` and `research` but no `laneById`, the live join is the only writer of stamps, and the client fails closed to "todo" for an unstamped row, so whenever the join ran out of budget the screen painted "Ready now: 8 finished changes" over an empty box. The lanes the release published are the server's own servability verdict and stamp the rows they hold.
      laneById: customer.changes.laneById ?? Object.fromEntries([...(customer.changes.ready ?? []).map((p) => [p.id, "ready" as const]), ...(customer.changes.toDo ?? []).map((p) => [p.id, "todo" as const]), ...(customer.changes.research ?? []).map((p) => [p.id, "research" as const])]),
      // A stored-only freshness check may advance computedAt without changing this release's ranking.
      surfaceComputedAt: customer.releaseId.startsWith(`${tenantId}:`)
        ? sanitizeSurfaceComputedAt(customer.releaseId.slice(tenantId.length + 1)) : null,
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
    loadProposalQueue(tenantId, { currentBasis, deliveryScope: "all_changes", eligible: operatorUiPolicy.isManualEditProofWork }).catch(() => ({ ranked: [], ready: [], toDo: [], research: [], implementedPendingVerification: 0, demotedStaleBasis: 0, basisUnreadable: true })),
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
  // opportunity underneath it: zero ready is never zero work in view. ONE SENTENCE, ONE SOURCE: the last arm
  // used to spell `setAsideHint()`'s own words out a second time, so two copies of one sentence could drift.
  const openNow = queue.toDo.length + queue.research.length;
  const readyZeroHint = queue.ready.length > 0 ? null
    : openNow === 0 && summary.measuring > 0
      ? `No finished change is ready right now. ${summary.measuring} recorded ${summary.measuring === 1 ? "change is" : "changes are"} in progress; Results shows which live checks are still owed.`
      : setAsideHint(openNow);

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
    ready: queue.ready.slice(0, CHANGES_PAGE_SIZE),
    toDo: queue.toDo.slice(0, CHANGES_PAGE_SIZE),
    // RESEARCH IS NEVER CUT TO ONE PAGE: it rides the release blob whole, already in hand, so a page-size cut here only ever dropped a reachless opportunity behind an honest count. The feed decides how many render open, never how many exist.
    research: queue.research,
    aiCases,
    summary,
    basisUnreadable: queue.basisUnreadable,
    measuringCountCanonical: ledgerCounts.measuring,
    waitingLiveCountCanonical: ledgerCounts.waiting,
    blockedCountCanonical: ledgerCounts.blocked,
    demotedStaleBasis: queue.demotedStaleBasis,
    decidedCountCanonical: ledgerCounts.decided,
    wonCountCanonical: won,
    readyZeroHint,
    receiptLine,
    surfaceVersion: releaseId,
    ...(ledger.read ? {} : { countsUnavailable: true }),
  };
}
