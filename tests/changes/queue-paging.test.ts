import { describe, expect, it, beforeEach, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
const db = vi.hoisted(() => ({ rows: [] as Row[], legacy: [] as Row[], reads: [] as number[], basis: "b1" as string | null, stampFails: false }));
const client: Record<string, unknown> = {
  rpc(name: string, a: { p_tenant_id: string; p_release: string; p_expected_prior?: string | null; p_content?: Array<{ manifest?: Array<{ id: string; lane: string }>; changes?: { proposals?: ChangeProposal[]; ready?: ChangeProposal[]; toDo?: ChangeProposal[]; research?: ChangeProposal[] } }> }) {
    if (db.stampFails) return Promise.resolve({ data: null, error: { message: "the ranking did not stamp" } });
    if (name === "publish_customer_release") {
      const prior = (blob.stored as { releaseId?: string } | null)?.releaseId ?? null;
      if ((a.p_expected_prior ?? null) !== prior) return Promise.resolve({ data: null, error: { message: `release conflict: expected prior ${a.p_expected_prior}, found ${prior}` } }); }
    const content = a.p_content?.[0], manifest = content?.manifest ?? [], lane = new Map(manifest.map((r) => [r.id, r.lane])), cards = content?.changes?.proposals ?? [], laneCards = [...(content?.changes?.ready ?? []), ...(content?.changes?.toDo ?? []), ...(content?.changes?.research ?? [])], laneRows = [...(content?.changes?.ready ?? []).map((p) => [p.id, "ready"]), ...(content?.changes?.toDo ?? []).map((p) => [p.id, "todo"]), ...(content?.changes?.research ?? []).map((p) => [p.id, "research"])];
    if (new Set(cards.map((p) => p.id)).size !== cards.length || new Set(laneRows.map(([id]) => id)).size !== laneRows.length || cards.some((p) => !laneRows.some(([id]) => id === p.id)) || cards.some((p) => !lane.has(p.id)) || laneRows.some(([id, l]) => lane.get(id) !== l)) return Promise.resolve({ data: null, error: { message: "release cards conflict with the manifest" } });
    const prohibited = (p: ChangeProposal) => !operatorUiPolicy.isManualEditProofWork(p) || p.kind === "new_page" && deliverableGaps(p).length > 0; if ([...cards, ...laneCards].some(prohibited) || manifest.some(({ id }) => { const row = db.rows.find((r) => r.tenant_id === a.p_tenant_id && r.id === id), p = (row?.payload as { proposal?: ChangeProposal } | undefined)?.proposal; return !p || prohibited(p); })) return Promise.resolve({ data: null, error: { message: "prohibited release payload" } });
    for (const r of db.rows) if (r.tenant_id === a.p_tenant_id) { r.queue_lane = null; r.queue_rank = null; }
    manifest.forEach(({ id, lane }, i) => { const r = db.rows.find((x) => x.tenant_id === a.p_tenant_id && x.id === id);
      if (r) { r.queue_lane = `${a.p_release}::${lane}`; r.queue_rank = i + 1; } });
    if (name === "publish_customer_release") blob.stored = (a.p_content ?? [null])[0];
    return Promise.resolve({ data: a.p_release ?? null, error: null });},};
Object.assign(client, supabaseFake({ rows: (t) => (t === "change_proposals" ? db.rows : db.legacy),
  onSelect: (t, r) => { if (t === "change_proposals" && !r.head) db.reads.push(r.max); } }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/changes", useRouter: () => ({ refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a", runWithTenant: async (_t: string, f: () => unknown) => f() }));
const releaseFails = vi.hoisted(() => ({ value: false }));
vi.mock("@/app/(shell)/surface-release", () => ({
  invalidateCoreSurfaces: async () => {}, refreshCustomerSurface: async () => {}, isCustomerSurfaceStale: () => false,
  readCustomerSurface: async () => { if (releaseFails.value) throw new Error("the release did not read"); // a read that FAILED, not an absent release
    return blob.stored ?? ({ releaseId: "rel-1", computedAt: "2026-08-02T00:00:00.000Z", manifest: ALL.map((p) => ({ id: p.id, lane: "ready" })),
    today: { today: { headerSentence: "stale", nextOpportunities: [] }, hasChanges: false },
    changes: { proposals: ALL.slice(0, CHANGES_PAGE_SIZE), ready: ALL.slice(0, CHANGES_PAGE_SIZE), toDo: [], research: [], measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
      readyZeroHint: null, receiptLine: null, summary: { todo: 0, ready: N, research: 0, implemented: 0, measuring: 0, results: 0 } } }); },}));
const budget = vi.hoisted(() => ({ allowed: true, throws: false }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  resolveCurrentBasis: async () => db.basis, produceProposalsForTenant: async () => ({ outcome: "proposals_persisted", candidates: [] }), checkBudget: async () => { if (budget.throws) throw new Error("unreadable"); return budget.allowed ? { allowed: true, remaining: 1 } : { allowed: false, reason: "cap" }; } }));
vi.mock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")),
  countTrackedQuestions: async () => 30 }));
const blob = vi.hoisted(() => ({ stored: null as unknown, writeFails: false }));
vi.mock("@/lib/persistence/json-store", async () => ({ ...(await vi.importActual<typeof import("@/lib/persistence/json-store")>("@/lib/persistence/json-store")),
  readStore: async (name: string) => (name === "customer-surface" && blob.stored ? [blob.stored] : []),
  writeStore: async () => { if (blob.writeFails) throw new Error("the release blob did not land"); } }));
const ledgerFails = vi.hoisted(() => ({ value: false }));
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  loadProofLedgerCached: async () => { if (ledgerFails.value) throw new Error("the ledger did not read"); return []; } }));
import { renderToStaticMarkup } from "react-dom/server"; import { createElement } from "react";
import { readChangesPage, loadChangesView, buildChangesViewUncached, releasedQueueCursors } from "@/app/(shell)/changes-data";
import { buildTodayViewFromChanges, loadTodayView } from "@/app/(shell)/today-view-data";
import { readQueuePage, loadChangeProposals, publishCustomerRelease, queueLaneCounts } from "@/domains/decision/proposal-store";
import { actionableProposalFailures, deliverableGaps } from "@/domains/decision"; import operatorUiPolicy from "@/app/(shell)/changes/types";
import { deserializeChangeProposal, serializeChangeProposal, type ChangeProposal } from "@/domains/decision/contracts";
import { CHANGES_PAGE_SIZE } from "@/app/(shell)/changes/types";
const T = "acct-a", N = 501;
const proposal = (i: number, over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${T}::/p${i}::existing_edit::title`, tenantId: T, kind: "existing_edit", pagePath: `/p${i}`,
  pageUrl: `https://www.fixture.example/p${i}`, pageLabel: `/p${i}`, primaryQuery: `q${i}`,
  opportunityType: "Capture clicks", changeFamily: "title", status: "ready",
  recommendedChange: { kind: "existing_edit", field: "title", before: "a", after: `Title ${i}` },
  whyItMatters: "The line Google shows misses the words people search for.", estimatedEffortMinutes: 1,
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: `q${i}`, hints: [], evidenceRefCount: 1 },
  impactScore: 1000 - i, upsidePerMonth: null, basis: "b1", publish: "manual", createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), diagnosisCause: "ctr_snippet", ...over,
} as unknown as ChangeProposal);
const seed = (p: ChangeProposal, over: Row = {}): Row => ({ id: p.id, tenant_id: T, basis: p.basis ?? null,
  status: p.status, terminal_disposition: null, superseded_by: null, proposal_version: 1,
  payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: `2026-07-30T00:00:${String(p.impactScore).padStart(4, "0")}Z`, ...over });
const ALL = Array.from({ length: N }, (_, i) => proposal(i));
async function stamp(release: string, rows: Array<{ id: string; lane: string }> = ALL.map((p) => ({ id: p.id, lane: "ready" }))) {
  for (const r of db.rows) if (r.tenant_id === T) { r.queue_lane = null; r.queue_rank = null; }
  rows.forEach((x, i) => { const r = db.rows.find((y) => y.tenant_id === T && y.id === x.id); if (r) { r.queue_lane = `${release}::${x.lane}`; r.queue_rank = i + 1; } });}
beforeEach(async () => {
  db.rows = ALL.map((p) => seed(p)); db.legacy = []; db.reads = []; db.basis = "b1"; db.stampFails = false; blob.stored = null; blob.writeFails = false;
  await stamp("rel-1"); });
describe("Today and Changes answer one question once", () => {
  it("keeps a current Ready copy through an incomplete rank stamp and gives Today the same released counts", async () => {
    const ready = ALL[0]!, todo = ALL.slice(1, 20).map((p) => ({ ...p, status: "needs_review" as const })), research = ALL.slice(20, 177).map((p) => ({ ...p, status: "needs_review" as const, researchOnly: true }));
    const ordered = [ready, ...todo, ...research], manifest = ordered.map((p) => ({ id: p.id, lane: p === ready ? "ready" as const : p.researchOnly ? "research" as const : "todo" as const }));
    db.rows = ordered.map((p) => seed(p)); await stamp("rel-interim", manifest); blob.stored = { releaseId: "rel-interim", computedAt: new Date().toISOString(), manifest, changes: { proposals: ordered.slice(0, CHANGES_PAGE_SIZE), ready: [ready], toDo: todo, research, summary: { ready: 1, todo: 19, research: 157, implemented: 0, measuring: 0, results: 0 }, measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null }, today: { today: { nextOpportunities: [] } } };
    for (const p of [ready, todo[0]!, ...research.slice(0, 36)]) { const row = db.rows.find((r) => r.id === p.id)!; row.queue_lane = null; row.queue_rank = null; row.updated_at = new Date().toISOString(); }
    expect(await queueLaneCounts(T, "rel-interim", "b1"), "the live stamp has the production intermediate 0/18/121 shape").toEqual({ ready: 0, todo: 18, research: 121 });
    const changes = await loadChangesView(), today = await loadTodayView(); expect([changes.summary.ready, changes.summary.todo, changes.summary.research, changes.ready[0]?.id, today.today.readyTotal, today.surfaceVersion, changes.surfaceVersion]).toEqual([1, 19, 157, ready.id, 1, "rel-interim", "rel-interim"]);
    const held = await readChangesPage(T, "ready", 0, "rel-interim"); expect([held.pending?.includes("ranking is updating"), held.cursor, held.releaseId, held.rows.length]).toEqual([true, 0, "rel-interim", 0]);
    await stamp("rel-interim", manifest); db.rows[0]!.queue_rank = 2; db.rows[1]!.queue_rank = 1;
    const swapped = await readChangesPage(T, "ready", 0, "rel-interim"); expect([swapped.pending?.includes("ranking is updating"), swapped.cursor, swapped.rows.length]).toEqual([true, 0, 0]);
    await stamp("rel-next", manifest); const next = await readChangesPage(T, "ready", 0, "rel-interim"); expect([next.refreshed?.includes("list moved"), next.rows[0]?.id, next.releaseId]).toEqual([true, ready.id, "rel-next"]);
    const { ChangesListClient } = await import("@/app/(shell)/changes-list-client"); const html = renderToStaticMarkup(createElement(ChangesListClient, { view: changes }));
    expect([html.includes("Ready now: 1 finished change"), html.includes((ready.recommendedChange as { after: string }).after), today.today.nextOpportunities[0]?.changeId]).toEqual([true, true, ready.id]); });
  it("drops dismissed and implemented changes from both surfaces on the next render", async () => {
    expect((await loadTodayView()).today.readyTotal).toBe(N);
    budget.allowed = false; const refused = (await loadTodayView()).modelBudgetSpent; budget.throws = true; const unread = (await loadTodayView()).modelBudgetSpent; budget.throws = false; budget.allowed = true; expect([refused, unread, (await loadTodayView()).modelBudgetSpent], "refused says so, unreadable and allowed say nothing").toEqual([true, undefined, undefined]);
    db.rows.find((r) => r.id === ALL[0]!.id)!.terminal_disposition = "dismissed"; db.rows.find((r) => r.id === ALL[1]!.id)!.payload = JSON.parse(serializeChangeProposal(proposal(1, { status: "implemented_pending_verification" })));
    db.rows.find((r) => r.id === ALL[150]!.id)!.payload = JSON.parse(serializeChangeProposal(proposal(150, { status: "needs_review", researchOnly: true })));
    const after = await loadTodayView(), changes = await loadChangesView(); expect([after.today.readyTotal, after.surfaceVersion, changes.summary.ready, changes.summary.research]).toEqual([N - 3, changes.surfaceVersion, N - 3, 1]); });
  it("builds Today's label, copy and link from one ranked proposal, and never flattens a bundle into one Copy", () => { const first = proposal(1), second = proposal(2), scrambled = { proposals: [first, second], ready: [second, first], toDo: [], research: [], summary: { ready: 2, todo: 0, research: 0 } } as unknown as Parameters<typeof buildTodayViewFromChanges>[0], aligned = buildTodayViewFromChanges(scrambled); expect([aligned.nextOpportunities[0]!.changeId, aligned.topEdit!.after]).toEqual([first.id, (first.recommendedChange as { after: string }).after]);
    const bundle = { objective: "Replace the title and opening together.", metric: "clicks", scope: { queries: [], prompts: [] }, components: [{ kind: "title", label: "Title", before: "a", after: "b", evidenceKeys: ["k"], risk: "safe" }], receipt: { items: [{ key: "k", kind: "gsc_demand", fact: "Seen", observedAt: null }], missing: [], freshestObservedAt: null }, alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "Read after 28 days." } as NonNullable<ChangeProposal["bundle"]>, bundled = buildTodayViewFromChanges({ ...scrambled, proposals: [{ ...first, bundle }], ready: [{ ...first, bundle }], summary: { ready: 1 } } as never); expect([bundled.topEdit!.paste, bundled.topEdit!.after, bundled.topEdit!.pieceCount]).toEqual([false, "", 1]); });
  it("says so when the last finished change leaves the lane before the next rebuild, instead of painting a blank box", async () => {
    for (const [i, r] of db.rows.entries()) if (r.tenant_id === T) { if (i < CHANGES_PAGE_SIZE) r.terminal_disposition = "dismissed"; else r.payload = JSON.parse(serializeChangeProposal(proposal(i, { status: "implemented_pending_verification" }))); }
    const view = await loadChangesView();
    expect([view.ready.length, view.summary.ready, view.readyZeroHint?.startsWith("No finished change is ready")], "the lane is empty, the count follows it, and the sentence is re-derived from the live lane rather than read off a release that still had rows (journey review, 2026-09-06)").toEqual([0, 0, true]); });
  it("withholds a count it could not read, and never counts a lane higher than it can hand over", async () => {
    ledgerFails.value = true;
    const view = await buildChangesViewUncached(T, "rel-8"), today = buildTodayViewFromChanges(view); expect([view.countsUnavailable, view.summary.measuring]).toEqual([true, 0]);
    expect(today.headerSentence).not.toMatch(/measuring/i); // no clause I cannot stand behind
    ledgerFails.value = false;
    expect((await buildChangesViewUncached(T, "rel-8")).countsUnavailable).toBeUndefined();
    await stamp("rel-1"); // back to the ranking the paging half of this promise reads
    const cold = new Date(Date.now() - 200 * 86_400_000).toISOString(); // REPLACES the cold-receipt drop (owner's editorial policy, 2026-09-06): age alone no longer takes a row out of the lane, so the row that cannot be handed over is one whose own piece cites evidence its receipt never carried
    const expired = (i: number) => proposal(i, { bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] },
      confidenceReasons: [], alternatives: [], risks: [], components: [{ kind: "title", label: "T", risk: "safe", before: "a", after: "b", evidenceKeys: ["nothing-holds-this"] }],
      receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "f", observedAt: cold }], missing: [], freshestObservedAt: cold } } } as Partial<ChangeProposal>);
    for (const i of [1, 2, 130]) db.rows.find((r) => r.id === ALL[i]!.id)!.payload = JSON.parse(serializeChangeProposal(expired(i))); // 130 sits past the first page, so the cross-page shrink below stays proven at any page size
    const first = await readChangesPage(T, "ready", 0), second = await readChangesPage(T, "ready", first.cursor); expect([first.total, first.rows.length, first.dropped, second.dropped, first.total - second.dropped]).toEqual([N - 2, CHANGES_PAGE_SIZE - 2, 2, 1, N - 3]); });
  it("falls back to the last release that landed rather than claiming a cold start or an outage, on Changes and on Today", async () => {
    releaseFails.value = true; db.rows = [];
    const view = await loadChangesView(), { ChangesSection } = await import("@/app/(shell)/changes/page");
    expect([view.releaseUnreadable ?? false, view.releaseFromMemory, view.surfaceBuilding, view.proposals.length,
      renderToStaticMarkup(await ChangesSection()).includes("Your saved changes could not be read just now"),
      (await loadTodayView()).today.headerSentence.includes("Your changes could not be read just now")]).toEqual([false, true, false, 0, false, false]);
    releaseFails.value = false; }); });
describe("one release identity, or no release at all", () => {
  it("admits the proving scope before rank, counts, stamps and pagination while retaining private whole-page history", async () => {
    const target = { mode: "whole_body" as const, anchorKind: null, anchor: null }, where = "Replace the entire visible main-content body with this complete copy; retain the page headline, title tag, description, navigation and structured data unless separately changed.", whole = (i: number): ChangeProposal => proposal(i, { impactScore: 10_000 - i, changeFamily: "full_rewrite", recommendedChange: { kind: "existing_edit", field: "section", before: "old", after: `whole replacement ${i}`, target, where } } as Partial<ChangeProposal>);
    const newPage = proposal(900, { id: `${T}::topic:new-guide::new_page::page`, kind: "new_page", pagePath: null, pageUrl: "topic:new-guide", pageLabel: "New guide", primaryQuery: "new guide", changeFamily: "new_page", impactScore: 20_000, recommendedChange: { kind: "new_page", proposedTitle: "New guide", metaDescription: "A complete guide.", openingAnswer: "This guide answers the question directly.", outline: ["First answer", "Details"], faqQuestions: [], schemaTypes: [] } } as Partial<ChangeProposal>), direct = proposal(901, { impactScore: 19_000, changeFamily: "title", recommendedChange: { kind: "existing_edit", field: "section", before: "old", after: "direct whole-body replacement", target, where } } as Partial<ChangeProposal>), legacyNew = proposal(902, { impactScore: 18_000, changeFamily: "title", recommendedChange: { kind: "new_page", proposedTitle: "Contradictory legacy guide", metaDescription: "A stale outer record carrying a new page.", openingAnswer: "This is creation work despite stale outer labels.", outline: ["Answer", "Details"], faqQuestions: [], schemaTypes: [] } } as Partial<ChangeProposal>), edit = proposal(999, { impactScore: 1 }), prohibited = [newPage, direct, legacyNew, ...Array.from({ length: 97 }, (_, i) => whole(1_000 + i))]; db.rows = [...prohibited, edit].map((p) => seed(p)); blob.stored = null;
    const view = await buildChangesViewUncached(T, "rel-scope"); expect([view.stampRows?.map((r) => r.id), view.proposals.map((p) => p.id), view.summary.ready], "one hundred higher-value prohibited rows never enter overlap, rank, lanes, or the release hand-off").toEqual([[edit.id], [edit.id], 1]);
    expect((await loadChangeProposals(T)).size, "the rows remain private history; release admission deletes nothing").toBe(101);
    await stamp("rel-scope", [...view.stampRows!]); const [page, counts] = await Promise.all([readQueuePage(T, "all", "b1", 0, 2), queueLaneCounts(T, "rel-scope", "b1")]); expect([page.rows.map((p) => p.id), page.total, page.nextRank, page.more, counts], "private history consumes no database page, rank, count, or cursor position").toEqual([[edit.id], 1, 1, false, { ready: 1, todo: 0, research: 0 }]); });
  it("keeps rank two visible when a complete rank-one new page is held after release", async () => {
    const sections = ["First", "Second", "Third"], opening = "A complete direct answer.", components = [{ kind: "title", label: "Page title", after: "Guide" }, { kind: "meta", label: "Meta description", after: "A complete guide." }, { kind: "h1", label: "Page heading (H1)", after: "The guide" }, { kind: "opening_answer", label: "Opening answer", after: opening }, ...sections.map(h => ({ kind: "section", label: h, after: `${h}\n\n${h}: full explanation.` }))].map(c => ({ ...c, before: null, evidenceKeys: ["fact-1"], risk: "review" as const }));
    const page = proposal(700, { id: `${T}::topic:guide::new_page`, kind: "new_page", pagePath: null, pageUrl: null, changeFamily: "new_page", status: "needs_review", researchOnly: false, recommendedChange: { kind: "new_page", proposedTitle: "Guide", metaDescription: "A complete guide.", openingAnswer: opening, outline: sections, faqQuestions: [], schemaTypes: [] }, bundle: { objective: "Complete guide", metric: "clicks", scope: { queries: [], prompts: [] }, components, receipt: { items: [{ key: "fact-1", kind: "independent_source", fact: "A sourced fact", observedAt: null }], missing: [], freshestObservedAt: null }, alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "Read clicks." }, newPageDraft: { brief: { kind: "new_page", identity: "id", material: "m", pageHeading: "The guide", sections: sections.map(heading => ({ heading })) }, pieces: [{ slot: 0, heading: null, after: opening }, ...sections.map((heading, i) => ({ slot: i + 1, heading, after: `${heading}: full explanation.` }))].map(p => ({ ...p, claims: [], supportFacts: [], review: [] })) } } as Partial<ChangeProposal>), second = proposal(701); db.rows = [page, second].map(p => seed(p)); await stamp("rel-page", [{ id: page.id, lane: "todo" }, { id: second.id, lane: "ready" }]);
    expect([!!deserializeChangeProposal(serializeChangeProposal(page)), actionableProposalFailures(page, { tenantId: T, currentBasis: "b1" }), operatorUiPolicy.isManualEditProofWork(page)]).toEqual([true, [], true]); expect((await readChangesPage(T, "all", 0)).rows.map(p => p.id)).toEqual([page.id, second.id]); const held = { ...page, status: "needs_review" as const, researchOnly: true }; db.rows[0]!.payload = JSON.parse(serializeChangeProposal(held)); db.rows[0]!.queue_lane = null; db.rows[0]!.queue_rank = null;
    const [after, counts] = await Promise.all([readChangesPage(T, "all", 0), queueLaneCounts(T, "rel-page", "b1", operatorUiPolicy.isManualEditProofWork)]); expect([after.rows.map(p => p.id), after.total, after.releaseId, counts]).toEqual([[second.id], 1, "rel-page", { ready: 1, todo: 0, research: 0 }]); });
  it("serves the reasoning the rules that stand today produce, never the one banked when the row was saved", async () => {
    const one = ALL[0]!; db.rows = [seed(one)]; // THE ORDER is recomputed at every release and stamped on the row; the RECEIPT beside it rode in the
    const payload = db.rows[0]!.payload as { proposal: Record<string, unknown> }; payload.proposal.rankingReceipt = { score: -15.57, directional: true, basis: "banked under rules that no longer decide anything", factors: [{ name: "treatment", max: 45, input: "rewriting a line of metadata is the kind of change that has lost here at high confidence", contribution: -45 }] }; payload.proposal.whyRankedAboveNext = "ranked here by a rule that is gone";
    await stamp("rel-1", [{ id: one.id, lane: "ready" }]); const got = (await readQueuePage(T, "ready", "b1", 0, CHANGES_PAGE_SIZE)).rows[0] as unknown as { rankingReceipt?: { factors?: { name: string }[]; score?: number } }; expect(got.rankingReceipt?.factors?.some((f) => f.name === "treatment"), "a deleted factor may not explain a live rank").toBe(false); expect(got.rankingReceipt?.score).not.toBe(-15.57); });

  it("builds the one order without touching the live ranking, commits ranking and surface together or not at all, and pages no change whose receipt stopped resolving", async () => {
    const one = ALL[0]!, view = await buildChangesViewUncached(T, "rel-9"); expect([view.surfaceVersion, view.summary.ready, buildTodayViewFromChanges(view).readyTotal]).toEqual(["rel-9", N, N]); expect([(await readQueuePage(T, "ready", "b1", 0, 1)).release, view.stampRows?.length]).toEqual(["rel-1", N]);
    const broken = proposal(0, { bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] }, confidenceReasons: [], alternatives: [], risks: [], receipt: { items: [], missing: [], freshestObservedAt: null }, components: [{ kind: "title", label: "Title", risk: "safe", before: "a", after: "b", evidenceKeys: ["nothing-holds-this"] }] } } as Partial<ChangeProposal>);
    db.rows[0]!.payload = JSON.parse(serializeChangeProposal(broken));
    expect((await readQueuePage(T, "ready", "b1", 0, CHANGES_PAGE_SIZE)).rows.map((p) => p.id)).not.toContain(broken.id);
    const args = (release: string, expectedPrior: string | null) => ({ tenantId: T, expectedPrior, release, scopeKey: "customer-surface::tenant:fixture", storeName: "customer-surface", content: { releaseId: release, tenantId: T, manifest: view.stampRows!, changes: { proposals: view.proposals, ready: view.ready, toDo: view.toDo, research: view.research }, today: { today: { nextOpportunities: [] } } } });
    expect(await publishCustomerRelease(args("rel-9", null))).toBe("rel-9");
    const committed = async () => [(await readQueuePage(T, "ready", "b1", 0, 1)).release, (blob.stored as { releaseId?: string } | null)?.releaseId ?? null]; expect(await committed()).toEqual(["rel-9", "rel-9"]);
    db.stampFails = true;
    await expect(publishCustomerRelease(args("rel-10", "rel-9"))).rejects.toThrow("could not commit");
    expect(await committed()).toEqual(["rel-9", "rel-9"]);
    db.stampFails = false;
    await expect(publishCustomerRelease(args("rel-10", null))).rejects.toThrow("release conflict");
    await expect(publishCustomerRelease(args("rel-10", "rel-7"))).rejects.toThrow("release conflict");
    await expect(publishCustomerRelease({ ...args("rel-10", "rel-9"), content: { ...args("rel-10", "rel-9").content, manifest: [{ id: one.id, lane: "research" }], changes: { proposals: [one], ready: [one], toDo: [], research: [] } } })).rejects.toThrow("conflict with the manifest");
    const wholeBody = { ...one, recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: "Old body", after: "Replacement body", target: { mode: "whole_body" as const, anchorKind: null, anchor: null }, where: "Replace the whole body." } }, staleFamily = { ...one, changeFamily: "full_rewrite" as const }, componentWhole = { ...one, bundle: { ...broken.bundle!, components: [{ ...broken.bundle!.components[0]!, target: { mode: "whole_body" as const, anchorKind: null, anchor: null } }] } }, contradictory = { ...one, recommendedChange: { kind: "new_page" } } as unknown as ChangeProposal, refused = (p: ChangeProposal) => expect(publishCustomerRelease({ ...args("rel-10", "rel-9"), content: { ...args("rel-10", "rel-9").content, changes: { proposals: [p], ready: [p], toDo: [], research: [] } } })).rejects.toThrow("prohibited release payload"); await Promise.all([{ ...one, kind: "new_page" } as ChangeProposal, wholeBody, staleFamily, componentWhole, contradictory].map(refused));
    expect(await committed()).toEqual(["rel-9", "rel-9"]);
    const research = proposal(100, { status: "needs_review", researchOnly: true }), first100 = view.ready.slice(0, 100), independent = { ...args("rel-11", "rel-9"), content: { ...args("rel-11", "rel-9").content, manifest: [...first100.map((p) => ({ id: p.id, lane: "ready" as const })), { id: research.id, lane: "research" as const }], changes: { proposals: first100, ready: first100, toDo: [], research: [research] } } }; db.rows[100]!.payload = JSON.parse(serializeChangeProposal(research)); expect(await publishCustomerRelease(independent)).toBe("rel-11");
    const todo = { ...args("rel-12", "rel-11"), content: { ...args("rel-12", "rel-11").content, manifest: [{ id: one.id, lane: "todo" as const }], changes: { proposals: [one], ready: [], toDo: [one], research: [] } } }; expect(await publishCustomerRelease(todo)).toBe("rel-12"); await expect(publishCustomerRelease({ ...args("rel-13", "rel-12"), content: { ...args("rel-13", "rel-12").content, manifest: [{ id: one.id, lane: "ready" }, { id: ALL[1]!.id, lane: "ready" }], changes: { proposals: [one], ready: [ALL[1]!], toDo: [], research: [] } } })).rejects.toThrow("conflict with the manifest"); expect(await committed()).toEqual(["rel-12", "rel-12"]);
  }); });
describe("one global rank across every lane", () => {
  it("interleaves research and drafts with ready work by worth, and a stamp never outranks the row it stamps", async () => {
    await stamp("rel-mixed", [{ id: ALL[0]!.id, lane: "research" }, { id: ALL[1]!.id, lane: "ready" }, { id: ALL[2]!.id, lane: "todo" }, { id: ALL[3]!.id, lane: "ready" }]); const page = await readQueuePage(T, "all", "b1", 0, 10);
    expect(page.rows.map((p) => p.id)).toEqual([ALL[0]!.id, ALL[1]!.id, ALL[2]!.id, ALL[3]!.id]); expect(page.rows.map((p) => page.laneById[p.id])).toEqual(["ready", "ready", "ready", "ready"]); // every fixture row is finished, so every lane is ready whatever the release stamped (operator, 2026-09-02): a stamp outlived its row and painted a brief as finished work
    db.rows.find((r) => r.id === ALL[0]!.id)!.payload = JSON.parse(serializeChangeProposal(proposal(0, { status: "needs_review", researchOnly: true }))); // a brief still wearing the release's `research` stamp
    db.rows.find((r) => r.id === ALL[2]!.id)!.payload = JSON.parse(serializeChangeProposal(proposal(2, { status: "needs_review" }))); // a review draft still wearing a `ready` stamp
    const mixed = await readQueuePage(T, "all", "b1", 0, 10), painted = { ready: 0, todo: 0, research: 0 };
    for (const p of mixed.rows) painted[mixed.laneById[p.id]!] += 1;
    expect([painted, await queueLaneCounts(T, "rel-mixed", "b1")], "the counts equal the painted lanes exactly: a needs_review row stamped ready counts as todo, and a research row counts as research").toEqual([{ ready: 2, todo: 1, research: 1 }, { ready: 2, todo: 1, research: 1 }]);
    await stamp("rel-1"); // restore the fixture ranking for the suites below
  });});
describe("the ranked queue pages in the database", () => {
  it("hands over all 501 changes exactly once, and every request reads one bounded page", async () => {
    const view = await loadChangesView(); const seen = view.ready.map((p) => p.id);
    let cursor = view.queueCursor!.all; // the RANK the screen reached, in the ONE global order
    for (let guard = 0; guard < 40 && seen.length < N; guard += 1) {
      const page = await readChangesPage(T, "ready", cursor, "rel-1");
      seen.push(...page.rows.map((p) => p.id));
      cursor = page.cursor;
      expect(page.total).toBe(N); // a COUNT, never the length of something loaded
    }
    expect([seen, new Set(seen).size]).toEqual([ALL.map((p) => p.id), N]); // every one, in the stamped order, and not one of them twice
    expect(Math.max(...db.reads)).toBeLessThanOrEqual(500); expect(buildTodayViewFromChanges(view).nextOpportunities.map((o) => o.changeId)).toEqual(ALL.slice(0, 3).map((p) => p.id)); // bounded canonical read, one rank across surfaces
  });
  it("pages after the saved off-page Ready card using its manifest rank", async () => { const manifest = ALL.slice(0, 150).map((p, i) => ({ id: p.id, lane: i === 129 || i === 149 ? "ready" : "research" })); await stamp("rel-offset", manifest); const saved = { proposals: ALL.slice(0, 100), ready: [ALL[129]!] } as Parameters<typeof releasedQueueCursors>[1], cursor = releasedQueueCursors(manifest as NonNullable<Parameters<typeof releasedQueueCursors>[0]>, saved), page = await readChangesPage(T, "ready", cursor.ready); expect([cursor, page.rows.map((p) => p.id), page.cursor]).toEqual([{ all: 100, ready: 130 }, [ALL[149]!.id], 150]); });
  it("restarts honestly when the ranking moved, and never serves a retired or implemented row", async () => {
    await stamp("rel-2"); const page = await readChangesPage(T, "ready", 100, "rel-1");
    expect(page.releaseId).toBe("rel-2"); expect(page.rows.map((p) => p.id)).toEqual(ALL.slice(0, CHANGES_PAGE_SIZE).map((p) => p.id));
    db.rows[1]!.terminal_disposition = "dismissed";              // put aside after the ranking was stamped
    db.rows[2]!.terminal_disposition = "withdrawn";
    db.rows[3]!.payload = JSON.parse(serializeChangeProposal(proposal(3, { status: "implemented_pending_verification" })));
    const after = await readChangesPage(T, "ready", 0); const ids = after.rows.map((p) => p.id);
    for (const gone of [1, 2, 3]) expect(ids).not.toContain(ALL[gone]!.id);
    expect(after.cursor).toBeGreaterThan(after.rows.length); // the cursor is the RANK read, not a row count
  });
});
describe("a publish that half landed", () => {
  it("rolls the order back onto the release still serving when the blob does not land", async () => {
    const real = await vi.importActual<typeof import("@/app/(shell)/surface-release")>("@/app/(shell)/surface-release"); await stamp("rel-prev", ALL.slice(0, 3).map((p) => ({ id: p.id, lane: "ready" })));
    blob.stored = { schemaVersion: 2, releaseId: "rel-prev", computedAt: "2026-08-03T00:00:00.000Z", tenantId: T,
      changes: { surfaceVersion: "rel-prev", ready: ALL.slice(0, 3), toDo: [] }, today: {} };
    blob.writeFails = true;
    await expect(real.refreshCustomerSurface(T)).rejects.toThrow(); const page = await readQueuePage(T, "ready", "b1", 0, CHANGES_PAGE_SIZE);
    expect([page.release, page.rows.map((p) => p.id)]).toEqual(["rel-prev", ALL.slice(0, 3).map((p) => p.id)]); });});
