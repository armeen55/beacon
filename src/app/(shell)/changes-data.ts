import "server-only";
import { createHash } from "node:crypto";

/** Canonical persisted Changes release: ranked, paged proposals plus ledger-derived lifecycle counts. Manual publishing only. */
import { cache } from "react";
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { actionableProposalFailures, loadChangeProposals, loadProposalQueue, openHold, queueServable, readAiCaseDispositions, readQueuePage, resolveCurrentBasis } from "@/domains/decision";
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
  rankedReceipts?: Record<string, Pick<ChangeProposal, "rankingReceipt" | "whyRankedAboveNext"> & { material: string }>;
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
  surfaceRefreshPending?: boolean;
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

const releasedCards = (view: ChangesView): Map<string, ChangeProposal> => new Map([...view.ready, ...view.toDo, ...(view.research ?? []), ...view.proposals].map((p) => [p.id, p]));
const rankMaterial = (p: ChangeProposal): string => { const { rankingReceipt: _rank, whyRankedAboveNext: _next, createdAt: _clock, ...material } = p;
  return createHash("sha256").update(JSON.stringify(material, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex"); };
const releasedRanking = (p: ChangeProposal, view: ChangesView | null, cards: Map<string, ChangeProposal>, allowOffCard = false): ChangeProposal => {
  const { rankingReceipt: _rank, whyRankedAboveNext: _next, ...current } = p, card = cards.get(p.id);
  const source = view ? card ?? (allowOffCard ? view.rankedReceipts?.[p.id] : undefined) : undefined;
  return source && (card ? rankMaterial(card) === rankMaterial(p) : "material" in source && source.material === rankMaterial(p))
    ? { ...current, ...(source.rankingReceipt ? { rankingReceipt: source.rankingReceipt } : {}), ...(source.whyRankedAboveNext ? { whyRankedAboveNext: source.whyRankedAboveNext } : {}) }
    : current;
};

const activeQueuedWork = (p: ChangeProposal): boolean => operatorUiPolicy.isManualEditProofWork(p) && queueServable(p);

/** Revalidate the release against the current basis and proposal rows; an unreadable basis fails closed. */
export function withCurrentBasisOnly(view: ChangesView, ctx: { tenantId: string; currentBasis: string | null; currentRows?: ReadonlyMap<string, ChangeProposal> }): ChangesView {
  const currentBasis = ctx.currentBasis;
  if (currentBasis == null) return { ...view, proposals: [], ready: [], toDo: [], research: [], laneById: {},
    summary: { ...view.summary, ready: 0, todo: 0, research: 0 }, basisUnreadable: true,
    readyZeroHint: setAsideHint() };
  // Recheck every released lane, including Ready below the global first page.
  const cards = releasedCards(view), stamped = new Set(view.stampRows?.map((r) => r.id));
  const all = new Map([...view.proposals, ...view.ready, ...view.toDo, ...(view.research ?? [])].map((p) => { const current = ctx.currentRows?.get(p.id);
    return [p.id, ctx.currentRows ? current && releasedRanking(current, stamped.size === 0 || stamped.has(p.id) ? view : null, cards) : p] as const; }));
  const standing = new Set([...all].filter(([id, p]) => !!p && p.id === id && activeQueuedWork(p)
    && actionableProposalFailures(p, ctx).length === 0).map(([id]) => id));
  // A PHOTOGRAPH IS RE-SORTED, NEVER EMPTIED. A blob published before a gate tightened can be carrying a row in
  // the wrong lane, so every surviving row is put back through the ONE hold: nothing is dropped for being
  // unfinished, it is shown where it belongs and the count follows the list.
  const kept = [...view.ready, ...view.toDo, ...(view.research ?? [])].filter((p) => standing.has(p.id)).map((p) => all.get(p.id)!);
  const research = kept.filter((p) => openHold(p).lane === "research");
  // THE SAME READY PREDICATE load-proposals applies: status, an open review lane and NO DEFECT under the one verdict (journey review, 2026-09-06: this read `blocking`, which is drawn from the hard arms alone, beside a second name for the same value, so a row held by a typed fault could re-sort into the released ready lane while the queue refused it).
  const ready = kept.filter((p) => p.status === "ready" && openHold(p).lane === "review" && openHold(p).defects.length === 0);
  const toDo = kept.filter((p) => !research.includes(p) && !ready.includes(p));
  // Reconcile whole-tenant totals against only the released rows rechecked here.
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
    if (!current || current.id !== row.id || !activeQueuedWork(current) || actionableProposalFailures(current, ctx).length > 0) counts[row.lane] = Math.max(0, counts[row.lane] - 1);
    else if (lane !== row.lane) { counts[row.lane] = Math.max(0, counts[row.lane] - 1); counts[lane] += 1; }
  }
  // MAX, never a sum: an old-rule release counted rows it also listed, so adding inflates.
  const setAside = Math.max(view.demotedStaleBasis, [...all.values()].filter((p) => !!p && actionableProposalFailures(p, ctx).length > 0).length);
  const firstPage = view.proposals.filter((p) => standing.has(p.id)).map((p) => all.get(p.id)!);
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

/** Read one stamped database page, then bind it to the exact saved release and current proposal rows. */
export async function readChangesPage(
  tenantId: string, lane: "ready" | "todo" | "all", cursor: number, releaseId?: string | null,
): Promise<ChangesPage> {
  const basis = await resolveCurrentBasis(tenantId).catch(() => null);
  // A bar I cannot read is not proof anything is current, so I show nothing rather than yesterday's work.
  if (basis == null) return { rows: [], laneById: {}, total: 0, cursor: 0, releaseId: null, refreshed: null, more: false, dropped: 0 };
  const asked = await readQueuePage(tenantId, lane, basis, cursor, CHANGES_PAGE_SIZE, activeQueuedWork);
  const moved = releaseId != null && asked.release != null && releaseId !== asked.release;
  const page = moved ? await readQueuePage(tenantId, lane, basis, 0, CHANGES_PAGE_SIZE, activeQueuedWork) : asked;
  const effectiveRelease = moved ? page.release : releaseId, start = moved ? 0 : cursor;
  let confirmed: ChangesView | null = null, confirmedTotal: number | null = null, confirmedMore: boolean | null = null;
  if (moved && !effectiveRelease) return { rows: [], laneById: {}, total: 0, cursor, releaseId: releaseId ?? null, refreshed: null, more: true, dropped: 0, pending: "The new ranking could not be checked just now. Your changes remain above; try Show more again." };
  if (effectiveRelease) {
    const pending = (why: string): ChangesPage => ({ rows: [], laneById: {}, total: 0, cursor, releaseId: releaseId ?? null, refreshed: null, more: true, dropped: 0, pending: why });
    if (page.release !== effectiveRelease) return pending("The saved ranking is updating. Your changes remain above; try Show more again after it refreshes.");
    const [saved, current] = await Promise.all([readCustomerSurface(tenantId), loadChangeProposals(tenantId, { failClosed: true, canonicalOnly: true })]).catch(() => [null, null] as const);
    if (!saved || saved.releaseId !== effectiveRelease || !saved.manifest || !current) return pending("The saved ranking could not be checked just now. Your changes remain above; try Show more again.");
    const cards = releasedCards(saved.changes), matches = (p: ChangeProposal): boolean => { const card = cards.get(p.id), digest = saved.changes.rankedReceipts?.[p.id]?.material;
      return card ? rankMaterial(card) === rankMaterial(p) : digest == null || digest === rankMaterial(p); };
    const standing = (row: { id: string; lane: "ready" | "todo" | "research" }) => {
      const p = current.get(row.id);
      return (lane === "all" || row.lane === lane) && !!p && actionableProposalFailures(p, { tenantId, currentBasis: basis }).length === 0
        && activeQueuedWork(p) && (lane !== "ready" || p.status === "ready" && p.researchOnly !== true && openHold(p).defects.length === 0);
    };
    if (saved.manifest.some((r) => { const p = current.get(r.id); return p && standing(r) && !matches(p); })) return pending("The saved ranking is updating. Your changes remain above; try Show more again after it refreshes.");
    const ids = saved.manifest.filter(standing).map((r) => r.id);
    const slice = saved.manifest.slice(Math.max(0, start), page.nextRank).filter(standing).map((r) => r.id);
    const exactStamp = page.rows.every((p) => { const rank = page.rankById[p.id], row = saved.manifest?.[rank - 1];
      return Number.isInteger(rank) && rank > start && row?.id === p.id && row.lane === page.stampedLaneById[p.id]; });
    if (!exactStamp || page.rows.some((p) => !matches(p)) || JSON.stringify(slice) !== JSON.stringify(page.rows.map((r) => r.id)))
      return pending("The saved ranking is updating. Your changes remain above; try Show more again after it refreshes.");
    confirmed = saved.changes; confirmedTotal = ids.length; confirmedMore = saved.manifest.slice(page.nextRank).some(standing);
    if (confirmedMore && page.nextRank <= start) return pending("The saved ranking is updating. Your changes remain above; try Show more again after it refreshes.");
  }
  const cards = confirmed ? releasedCards(confirmed) : new Map<string, ChangeProposal>();
  return { rows: page.rows.map((p) => releasedRanking(p, confirmed, cards, !!confirmed)), laneById: page.laneById, total: confirmedTotal ?? page.total, cursor: page.nextRank, releaseId: page.release, more: confirmedMore ?? page.more, dropped: page.dropped,
    refreshed: moved ? "The list moved under you while you were reading it, so here is the fresh first page." : null };
}

/** One release supplies the first screen. Current canonical rows replace the same released IDs; retired copies are withheld, but a rank stamp cleared during
 *  research never erases a still-current Ready change. Show more reads the live ranking with its release cursor. */
async function loadChangesViewWithSwr(tenantId: string): Promise<ChangesView> {
  const t0 = Date.now();
  const { raw, view } = await readReleasedChanges(tenantId);
  if (!view.surfaceVersion || view.basisUnreadable) return view;
  // A verification can move between releases; Results reads these same persisted rows and counter.
  const joinBudget = Math.max(0, 4_400 - (Date.now() - t0));
  const [current, ledger] = await Promise.all([loadWithDeadline(loadChangeProposals(tenantId, { failClosed: true, canonicalOnly: true }), joinBudget).catch(() => null), loadWithDeadline(loadProofLedgerCached(tenantId), Math.min(joinBudget, 700)).catch(() => null)]);
  const counts = ledger && !ledger.timedOut ? countLedgerLifecycle(ledger.data) : null;
  const basis = current && !current.timedOut && current.data ? await currentBasisFast(tenantId) : null;
  const reconciled = basis == null ? view : withCurrentBasisOnly(raw, { tenantId, currentBasis: basis, currentRows: current!.data! });
  return counts ? { ...reconciled, summary: { ...reconciled.summary, measuring: counts.measuring, results: counts.decided }, measuringCountCanonical: counts.measuring, waitingLiveCountCanonical: counts.waiting, blockedCountCanonical: counts.blocked, decidedCountCanonical: counts.decided, wonCountCanonical: counts.won, countsUnavailable: false } : { ...reconciled, countsUnavailable: true };
}

/** A bounded release read serves the last good in-process release on failure; cold reads get one retry. */
const RELEASE_READ_DEADLINE_MS = 2_000;
const lastGoodRelease = new Map<string, CustomerSurface>();
/** Remember a successfully read basis for one minute; never cache null. */
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

/** On a failed read, serve remembered truth before attempting another database read. */
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

/** Serve the saved release first and schedule its one stored-only rebuild when stale. */
async function readReleasedChanges(tenantId: string): Promise<{ raw: ChangesView; view: ChangesView }> {
  const scheduleReleaseRebuild = (action: string) =>
    after(async () => {
      try {
        const { refreshCustomerSurface } = await import("./surface-release");
        await refreshCustomerSurface(tenantId, { maxDrafts: 0 }); // a stale-release rebuild republishes stored truth at $0; it never drafts
      } catch (e) { await recordAppError({ route: "/changes", tenantId, action, ...errorFieldsFrom(e) }); }
    });

  const read = await readReleaseTwice(tenantId);
  const customer = read.s;
  // Ignore a pre-kernel release missing proposals and rebuild it.
  const changesShapeOk =
    customer != null && Array.isArray((customer.changes as ChangesView | undefined)?.proposals);
  if (customer && changesShapeOk) {
    const stale = !read.fromMemory && isCustomerSurfaceStale(customer.computedAt, Date.now());
    if (stale) scheduleReleaseRebuild("background-refresh");
    const raw: ChangesView = {
      ...customer.changes,
      stampRows: customer.manifest ?? customer.changes.stampRows,
      queueCursor: customer.manifest?.length ? releasedQueueCursors(customer.manifest, customer.changes) : customer.changes.queueCursor,
      // THE RELEASE'S OWN LANES ARE ITS STAMPS (operator walk, 2026-09-16 00:00Z): the saved release carries `ready`, `toDo` and `research` but no `laneById`, the live join is the only writer of stamps, and the client fails closed to "todo" for an unstamped row, so whenever the join ran out of budget the screen painted "Ready now: 8 finished changes" over an empty box. The lanes the release published are the server's own servability verdict and stamp the rows they hold.
      laneById: customer.changes.laneById ?? Object.fromEntries([...(customer.changes.ready ?? []).map((p) => [p.id, "ready" as const]), ...(customer.changes.toDo ?? []).map((p) => [p.id, "todo" as const]), ...(customer.changes.research ?? []).map((p) => [p.id, "research" as const])]),
      // A stored-only freshness check may advance computedAt without changing this release's ranking.
      surfaceComputedAt: customer.releaseId.startsWith(`${tenantId}:`)
        ? sanitizeSurfaceComputedAt(customer.releaseId.slice(tenantId.length + 1)) : null,
      surfaceBuilding: false,
      surfaceRefreshPending: stale,
      surfaceVersion: customer.releaseId,
      ...(read.fromMemory ? { releaseFromMemory: true } : {}),
    };
    return { raw, view: withCurrentBasisOnly(raw, { tenantId, currentBasis: await currentBasisFast(tenantId) }) };
  }
  // A FAILED READ SCHEDULES NO REBUILD: the heavy rebuild is owed when a release is genuinely absent or
  // stale, and firing it on every visit during a store outage is a rebuild loop on top of the outage
  // (operator, 2026-08-21). The store answering again is what ends this state, not more load on it.
  if (read.ok) scheduleReleaseRebuild("cold-rebuild");
  // A RELEASE I COULD NOT READ IS NOT A FIRST-EVER LOAD: claiming I am building their ranking for the first time during an outage is a
  // sentence an established customer knows is false the moment they read it.
  const raw = read.ok ? EMPTY_CHANGES_VIEW : { ...EMPTY_CHANGES_VIEW, surfaceBuilding: false, releaseUnreadable: true };
  return { raw, view: raw };
}

/** THE heavy build body, called from refreshCustomerSurface AFTER proposal production has persisted this tenant's proposals. Reads the
 *  persisted proposal queue + the proof ledger; runs no LLM itself. Tenant passed explicitly. */
export async function buildChangesViewUncached(tenantId: string, releaseId: string): Promise<ChangesView> {
  // One basis per release keeps queue, ranking and page cuts aligned.
  const currentBasis = await resolveCurrentBasis(tenantId).catch(() => null);
  const [queue, ledger, aiCases] = await Promise.all([
    loadProposalQueue(tenantId, { currentBasis, deliveryScope: "all_changes", eligible: activeQueuedWork }).catch(() => ({ ranked: [], ready: [], toDo: [], research: [], implementedPendingVerification: 0, demotedStaleBasis: 0, basisUnreadable: true })),
    // A failed ledger read must not claim zero measured work.
    loadProofLedgerCached(tenantId).then((rows) => ({ rows, read: true })).catch(() => ({ rows: [] as Awaited<ReturnType<typeof loadProofLedgerCached>>, read: false })),
    // Share the Visibility case verdict.
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

  // The empty Ready lane distinguishes completed work from open work using the shared hint.
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
  const carried = new Set([...queue.ranked.slice(0, CHANGES_PAGE_SIZE), ...queue.ready.slice(0, CHANGES_PAGE_SIZE), ...queue.toDo.slice(0, CHANGES_PAGE_SIZE), ...queue.research].map((p) => p.id));
  const omitted = queue.ranked.filter((p) => !carried.has(p.id));
  const receiptLine = buildReceiptLine({
    source: "your Search Console and AI demand data",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "ranked",
    nowMs,
    note: null,
  });

  return {
    stampRows,
    ...(omitted.length ? { rankedReceipts: Object.fromEntries(omitted.map((p) => [p.id, { rankingReceipt: p.rankingReceipt, whyRankedAboveNext: p.whyRankedAboveNext, material: rankMaterial(p) }])) } : {}),
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
