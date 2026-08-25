/** A change I set aside stays set aside (truth convergence). The ranked queue is the ONLY source a direct link may render exact copy from, a stored release that predates my current evidence bar may not present its rows as work, and an empty queue reads as a decision on Changes and on Today alike. Every test name states the promise it pins. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import type { ReactElement } from "react";
import type { ChangeProposal } from "@/domains/decision";
import { actionableProposalFailures as failures } from "@/domains/decision/validate-proposal";
import type { ChangesView } from "@/app/(shell)/changes-data";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => { const redirected = (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); };
  return { redirect: redirected, permanentRedirect: redirected, notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    usePathname: () => "/changes", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }; });
vi.mock("@/domains/account/lifecycle", () => ({ requireReadyAccount: vi.fn(async () => ({ access: { kind: "ready", account: { status: "active" } } })),
  resolveAccountAccess: vi.fn(async () => ({ kind: "ready", account: { status: "active" } })), AccountUnavailableError: class extends Error {} }));
vi.mock("@/lib/tenant-context", async () => ({ ...(await vi.importActual<typeof import("@/lib/tenant-context")>("@/lib/tenant-context")),
  currentTenantId: vi.fn(async () => "t") }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  loadChangeProposal: vi.fn(), resolveCurrentBasis: vi.fn(), transitionProposalToImplemented: vi.fn(async () => true), saveChangeProposal: vi.fn(async () => "saved"),
  answerReviewedProposal: vi.fn(async () => ({ status: "promoted" as const })) }));
vi.mock("@/app/(shell)/changes-data", async () => ({ ...(await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data")),
  loadChangesView: vi.fn() }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));
const shipped = vi.hoisted(() => ({ records: [] as unknown[], held: [] as any[] }));
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  loadShippedChanges: async () => shipped.held, captureChangeMeta: async () => null, loadProofLedgerPersisted: async () => shipped.held,
  // THE ONE DOOR that writes a record, standing in for the real one: it always writes and always answers with the id the flip is required to carry, so there is no press that closes a change no record stands behind. What it can be compared against is pinned in mark-implemented-transaction.
  recordShipment: async (r: unknown) => { shipped.records.push(r); return { shipmentId: "rec-1", measurement: "measuring" }; } }));
const NOW = "basis_now::d4";
const EXACT = "Iranian Comedians: the 12 names people actually search for";
const ID = "t::/famous-iranian-comedians::existing_edit::bundle";
/** Relative to now: a hard-coded reading date is a test that fails on a calendar day nobody chose. */
const SEEN = new Date(Date.now() - 2 * 86_400_000).toISOString();
const bundled = (basis: string, id = ID): ChangeProposal => ({
  id, tenantId: "t", kind: "existing_edit", pagePath: "/famous-iranian-comedians", pageLabel: "Famous Iranian comedians", primaryQuery: "iranian comedians",
  whyItMatters: "This page lost 163 clicks last month.", opportunityType: "Answer the exact search", estimatedEffortMinutes: 6, upsidePerMonth: 163,
  confidence: "high", riskLevel: "low", status: "ready", basis, limitations: [], changeFamily: "title", createdAt: SEEN,
  recommendedChange: { kind: "existing_edit", field: "title", before: "Comedians", after: EXACT },
  bundle: { objective: "Answer the exact question people search", metric: "clicks from that search", measurementPlan: "I compare the next 28 days with the last 28.",
    scope: { queries: ["iranian comedians"], prompts: [] }, confidenceReasons: ["163 clicks lost in 4 weeks"], alternatives: [], risks: [],
    components: [{ kind: "title", label: "Title", risk: "safe", before: "Comedians", after: EXACT, evidenceKeys: ["k1"] }],
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "163 clicks lost in 4 weeks.", observedAt: SEEN }], missing: [], freshestObservedAt: SEEN } },
} as unknown as ChangeProposal);
const emptyView = (demotedStaleBasis: number): ChangesView => ({ proposals: [], ready: [], toDo: [], research: [], aiCases: { state: "read" as const, rows: [] },
  summary: { todo: 0, ready: 0, research: 0, implemented: 0, measuring: 0, results: 0 }, measuringCountCanonical: 0, demotedStaleBasis, decidedCountCanonical: 0,
  readyZeroHint: null, receiptLine: null, surfaceComputedAt: "2026-07-27T00:00:00.000Z", surfaceBuilding: false });
async function renderDetail(): Promise<string> {
  const { default: Page } = await import("@/app/(shell)/changes/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: encodeURIComponent(ID) }) }) as ReactElement);
}
async function renderChanges(view: ChangesView): Promise<string> {
  vi.mocked((await import("@/app/(shell)/changes-data")).loadChangesView).mockResolvedValue(view);
  const { ChangesSection } = await import("@/app/(shell)/changes/page");
  return renderToStaticMarkup(await ChangesSection() as ReactElement);
}
describe("a direct link renders only what the ranked list would, and always lands somewhere honest", () => {
  beforeEach(() => vi.clearAllMocks());
  /** Serve one stored row at the link and render it. `retired` is what a history-including read finds. */
  async function link(p: ChangeProposal | null, retired: ChangeProposal | null = null): Promise<string> {
    const { loadChangeProposal, resolveCurrentBasis } = await import("@/domains/decision");
    vi.mocked(resolveCurrentBasis).mockResolvedValue(NOW); // the bar the account holds NOW
    vi.mocked(loadChangeProposal).mockImplementation(async (_t: string, _id: string, o?: { retired?: string }) =>
      (o?.retired === "include" ? retired ?? p : p) as ChangeProposal | null);
    return renderDetail();
  }
  it("hands over the exact edits for current work, and no copy at all for a change I set aside", async () => {
    const live = await link(bundled(NOW)); // the row IS the current bar's work
    expect([live.includes(EXACT), live.includes("Mark done"), live.includes("This idea was set aside")]).toEqual([true, true, false]);
    const stale = await link(bundled("basis_old::d2")); // no exact copy, no before/after, no way to record it
    expect([stale.includes("This idea was set aside"), stale.includes("See the work that stands now")]).toEqual([true, true]); expect(stale).not.toMatch(new RegExp(`${EXACT}|Comedians</p>|Mark done`)); });
  // THE DOOR IS THE SAME DOOR. A direct link is not a side entrance: everything the ranked list refuses is refused here too, on the row's own evidence rather than on its basis stamp alone.
  it("refuses at the link what the list refuses: a receipt that does not resolve, a merge filed as ready, evidence gone cold", async () => {
    const b = bundled(NOW).bundle!, cold = new Date(Date.now() - 120 * 86_400_000).toISOString();
    for (const bundle of [
      { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] },
      { ...b, components: [{ ...b.components[0]!, kind: "consolidation", label: "Merge the two pages", risk: "dangerous" }] },
      { ...b, receipt: { items: [{ ...b.receipt.items[0]!, observedAt: cold }], missing: [], freshestObservedAt: cold } },
    ]) {
      const html = await link({ ...bundled(NOW), bundle } as ChangeProposal); expect([html.includes(EXACT), html.includes("Mark done")], JSON.stringify(bundle.components[0])).toEqual([false, false]);
    }
  });
  /** P1-2. The picker pre-ticked EVERY piece with no memory of what is already recorded, so the obvious next press offered to record a component I am already measuring. It now opens on what is genuinely still theirs to do. */
  it("opens the picker on the pieces nobody has recorded yet", async () => {
    const b = bundled(NOW).bundle!;
    shipped.held = [{ proposalId: ID, componentsApplied: [{ id: "0:title", kind: "title", label: "Title" }] }];
    const html = await link({ ...bundled(NOW), bundle: { ...b, components: [b.components[0]!, { ...b.components[0]!, kind: "meta", label: "Description", after: "A description" }] } } as ChangeProposal);
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]); shipped.held = []; expect([boxes.length, boxes[0]!.includes("checked"), boxes[1]!.includes("checked")]).toEqual([2, false, true]); });
  /** FRESHNESS IS PER COMPONENT, because a receipt is mixed by design. One AI answer taken this morning used to keep a whole change alive beside a page reading and a results check nobody had taken in months. And an atomic change carried no receipt at all, so it could never go stale: it ages on the day it was drafted. The gated rebuild used to be handed NOTHING, so a basis shift silently erased the retry date, the pages under investigation, the ideas held back and the kernel's own verdicts. THE APPROVAL BOUNDARY IS THE SERVER'S, NOT THE SCREEN'S. Editorial judgement is the operator's to answer; an unsupported claim, a blank, a wrong page or a placement nobody can check is a fact about the work, and no yes waves one through. THE COMPACT SENTENCE IS TYPED BY THE KIND OF WORK, never the internal brief said back: an ownership row says Beacon is reading the competing pages, and an unfamiliar family falls back to one plain sentence. EVERY GENUINE OPPORTUNITY IS REACHABLE, COMPACTLY: the preparing lane is collapsed by default, one plain sentence per row, its own detail link, and NEVER the internal research essay (operator, 2026-08-21). ONE STORY ACROSS BOTH SURFACES (operator, 2026-08-15): a gate decides the LANE, never whether genuine work is seen; the same counts appear on Today and Changes, and no row is in two lanes. Connecting Google is worth doing and it is not the price of entry: an account with approved questions and research of its own must not be told to connect before it may see anything at all. AND THE PROMOTION ITSELF NEVER RUNS AS A READ AND A SAVE: the action hands the store the exact version that was confirmed, and the store writes only while the row still IS that version (pinned in proposal-canon). */
  it("expires the change whose own component cites only cold readings, keeps the one whose readings are current, and ages a change with no receipt on its drafted date", () => {
    const cold = new Date(Date.now() - 40 * 86_400_000).toISOString(), ctx = { tenantId: "t", currentBasis: NOW }; const b = bundled(NOW).bundle!, item = b.receipt.items[0]!;
    const mixed = { ...bundled(NOW), bundle: { ...b, components: [b.components[0]!, { ...b.components[0]!, kind: "meta" as const, label: "Description", after: "A description", evidenceKeys: ["k2"] }],
      receipt: { items: [item, { ...item, key: "k2", observedAt: cold }], missing: [], freshestObservedAt: SEEN } } } as ChangeProposal;
    const { bundle: _b, ...atomic } = bundled(NOW);
    // AND A BUNDLE WHOSE EVERY READING IS UNDATED still ages: real receipt keys (the page's own demand, the diagnosis, the winner pattern) carry no observation date at all, so per-component freshness alone would have let such a change stand forever. With nothing dated to age, it ages on the day it was drafted, exactly as an atomic change does.
    const undated = { ...bundled(NOW), createdAt: cold, bundle: { ...b, receipt: { items: [{ ...item, observedAt: null }], missing: [], freshestObservedAt: null } } } as ChangeProposal;
    expect([failures(mixed, ctx).length > 0, failures(bundled(NOW), ctx).length, failures({ ...atomic, createdAt: cold } as ChangeProposal, ctx).length > 0,
      failures(undated, ctx).length > 0, failures({ ...undated, createdAt: SEEN } as ChangeProposal, ctx).length]).toEqual([true, 0, true, true, 0]); });
  it("renders live work with nothing to unpack as its own page, and gives a put-aside change the put-aside screen", async () => {
    const { bundle: _b, ...flat } = bundled(NOW); // live and actionable with no second layer: it gets the one-layer page
    expect(await link(flat as ChangeProposal)).toContain("data-simple-detail");
    expect(await link(null, bundled(NOW))).toContain("This idea was set aside"); // history, not a page that never was
  });
  // AND NOTHING LANDS IN THE LEDGER THAT THIS SCREEN WOULD NOT SHOW: the same verdict runs at the moment of the press, and a stale screen or a hand-made request cannot merge a page on its own say-so.
  it("refuses a receipt that no longer resolves, and holds a page-mover until the operator confirms it here", async () => {
    shipped.records = [];
    const b = bundled(NOW).bundle!;
    // the same stored row this screen would be rendered from
    const mark = async (p: ChangeProposal, args: Record<string, unknown> = {}) => { await link(p); return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, ...args }); };
    const broken = { ...bundled(NOW), bundle: { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] } } as ChangeProposal; expect([(await mark(broken)).success, shipped.records.length]).toEqual([false, 0]);
    const merge = { ...bundled(NOW), status: "needs_review", riskLevel: "high", bundle: { ...b, risks: ["The old address stops answering."], components: [{ ...b.components[0]!, kind: "consolidation", label: "Merge the two pages", risk: "dangerous", redirectTo: "https://site.example/keep" }] } } as unknown as ChangeProposal;
    // A PAGE-MOVER IS GRADED DANGEROUS AND A DANGEROUS PIECE CAN NEVER SIT IN READY, so the lane refuses it before the deliberate yes is ever reached, with or without one: nothing about a change in review is recordable, and no ticked box changes that.
    const refused = await mark(merge); expect([refused.success, refused.error?.includes("still being reviewed"), shipped.records.length]).toEqual([false, true, 0]);
    expect([(await mark(merge, { destructiveConfirmed: true })).success, shipped.records.length]).toEqual([false, 0]);
    // STEP TWO, AND THE ONLY WAY OUT OF THE HOLD: Product Truth asks for two steps and only the first one existed, so a merge, a forward, a canonical or a de-index was held for a confirmation nobody could give. The confirmation lives on the change's own detail page, beside the pieces, the addresses, the destination and the risks, and it binds to ONE version: a version that has moved since the screen was drawn refuses, safe work sitting in review for a quality gate cannot reach this door at all, and the yes is written back onto the row so the queue and the mutation read it rather than trust a screen.
    const { confirmDangerousChangeAction: confirm } = await import("@/app/(shell)/changes/actions"), { confirmedVersion, answerReviewedProposal: promote } = await import("@/domains/decision");
    const safe = { ...merge, bundle: { ...merge.bundle!, components: [b.components[0]!] } } as ChangeProposal;
    await link(merge); const html = await renderDetail(), stale = await confirm({ proposalId: merge.id, version: "a version nobody is looking at" });
    await link(safe); const wrong = await confirm({ proposalId: safe.id, version: confirmedVersion(safe) });
    await link(merge); const ok = await confirm({ proposalId: merge.id, version: confirmedVersion(merge) }), sent = vi.mocked(promote).mock.calls.at(-1);
    expect([html.includes("Confirm this version"), html.includes("Mark done"), stale.success, stale.error?.includes("rewritten since"), wrong.success, wrong.error?.includes("does not move or hide a page"), ok.success, vi.mocked(promote).mock.calls.length, sent?.[1], sent?.[2] === confirmedVersion(merge)]).toEqual([true, false, false, true, false, true, true, 1, merge.id, true]); }); });
describe("an account that skipped the connectors still reaches its own Today", () => {
  it("calls an account a demo only when it truly holds nothing, never merely because it connected nothing", async () => {
    const gate = async (repo: () => unknown) => {
      vi.resetModules();
      vi.doMock("@/lib/seed-data.server", () => ({ hasActiveExperiment: async () => false }));
      vi.doMock("@/lib/connector-store", () => ({ hasAnyConnectedDataSource: async () => false }));
      vi.doMock("@/lib/persistence/repositories", () => ({ getRepository: repo }));
      return (await import("@/app/(shell)/today-gate-data")).loadTodayV2GateData();
    };
    const held = (tracked: unknown[]) => () => ({ forTenant: () => ({ getPromptAnswerObservations: async () => [], getTrackedPrompts: async () => tracked }) });
    expect([(await gate(held([{ is_active: true, tags: ["core_v1"] }]))).isDemoMode, (await gate(held([]))).isDemoMode]).toEqual([false, true]);
    const blind = await gate(() => { throw new Error("database unreachable"); }); // A read I could not take is not proof the account is empty, so it may not send them to the connect prompt.
    expect([blind.isDemoMode, blind.unreadable]).toEqual([false, true]);
    for (const m of ["@/lib/seed-data.server", "@/lib/connector-store", "@/lib/persistence/repositories"]) vi.doUnmock(m);
    vi.resetModules(); }); });
describe("an empty Changes queue reads as a decision, not an empty screen", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows every open opportunity with zero ready, never calls a draft finished, and counts the same on both screens", async () => {
    const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data"); const draft = { ...bundled(NOW, "t::draft"), status: "needs_review" } as ChangeProposal;
    const missing = 'The results page for "iranian comedians" has not been read, and that read is what turns this into exact work.';
    const idea = { ...bundled(NOW, "t::idea"), status: "needs_review", researchOnly: true, bundle: undefined, opportunityType: "Find out what took the clicks from /famous-iranian-comedians",
      operatorSteps: [missing, "The exact change lands on this card once that read is on file"], recommendedChange: { kind: "existing_edit", field: "section", before: null, after: missing },
      research: { missing, next: "The exact change lands on this card once that read is on file" } } as unknown as ChangeProposal;
    const view = { ...emptyView(0), proposals: [draft, idea], ready: [], toDo: [draft], research: [idea], summary: { ...emptyView(0).summary, todo: 1, research: 1 } };
    const html = await renderChanges(view), today = buildTodayViewFromChanges(view);
    for (const said of ["Needs your review: 1 draft", EXACT, "Copy draft", "Why it is held", "Future opportunities (1)"]) expect(html).toContain(said);
    expect(html).not.toMatch(/Proven|Mark done|Still missing/);
    expect([today.readyTotal, today.toDoTotal, today.researchTotal, today.nextOpportunities.map((o) => o.lane), today.topEdit, today.headerSentence])
      .toEqual([0, 1, 1, ["review", "research"], undefined, "No finished change is ready today. The next one lands here the moment the exact work is written."]);
    expect(html.match(/data-change-card="true"/g)?.length).toBe(1); }); // the draft is a card once, and preparing rows are their own compact shape
  it("shows all 12 preparing opportunities as compact rows with detail links, never as essays and never as Ready", async () => {
    const ideas = Array.from({ length: 12 }, (_, i) => ({ ...bundled(NOW, `t::idea-${i}`), status: "needs_review", researchOnly: true, bundle: undefined,
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `Internal essay for idea ${i}` } })) as ChangeProposal[];
    const view = { ...emptyView(0), proposals: ideas, ready: [], toDo: [], research: ideas, summary: { ...emptyView(0).summary, research: 12 } }; const html = await renderChanges(view);
    expect([html.match(/data-preparing-row="true"/g)?.length, html.match(/data-research-detail="true"/g)?.length, html.includes("Future opportunities (12)"),
      html.includes("Internal essay for idea"), html.includes("Ready now: 0 finished changes"), html.includes("What the evidence says")])
      .toEqual([12, 12, true, false, true, false]); });
  it("says what Beacon is doing on a preparing row in the family's own plain words", async () => {
    const idea = (id: string) => ({ ...bundled(NOW, id), status: "needs_review", researchOnly: true, bundle: undefined,
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "internal brief text" } }) as unknown as ChangeProposal;
    const rows = [idea("t::/a::existing_edit::ownership"), idea("t::/b::existing_edit::missing_description"), idea("t::idea-typed")];
    const view = { ...emptyView(0), proposals: rows, ready: [], toDo: [], research: rows, summary: { ...emptyView(0).summary, research: 3 } }; const html = await renderChanges(view);
    expect([html.includes("Reading the competing pages before writing distinct titles and openings."),
      html.includes("Writing a page-specific description from the stored page."),
      html.includes("Preparing the exact change from stored evidence."), html.includes("internal brief text")])
      .toEqual([true, true, true, false]); });
  it("takes a yes on judgement alone and refuses one on a fact about the work", async () => {
    const { reviewDraftAction } = await import("@/app/(shell)/changes/actions"), { confirmedVersion, loadChangeProposal, resolveCurrentBasis } = await import("@/domains/decision");
    const link = async (p: ChangeProposal) => { vi.mocked(resolveCurrentBasis).mockResolvedValue(NOW); vi.mocked(loadChangeProposal).mockResolvedValue(p); }; const soft = { ...bundled(NOW, "t::draft"), status: "needs_review" } as ChangeProposal;
    const hard = { ...soft, limitations: ["1 of the 2 pages coming up for \"iranian comedians\" get no words from this change (/other), so the split it names is not settled and this is held for review rather than handed over as ready to paste."] } as ChangeProposal;
    await link(soft); const yes = await reviewDraftAction({ proposalId: soft.id, version: confirmedVersion(soft), decision: "approve" });
    await link(hard); const no = await reviewDraftAction({ proposalId: hard.id, version: confirmedVersion(hard), decision: "approve" });
    await link(soft); const better = await reviewDraftAction({ proposalId: soft.id, version: confirmedVersion(soft), decision: "improve" }); const { answerReviewedProposal: answer } = await import("@/domains/decision");
    expect([yes.success, no.success, no.error?.includes("not settled"), better.success, vi.mocked(answer).mock.calls.map((c) => (c[4] as { kind: string }).kind)])
      .toEqual([true, false, true, true, ["promote", "redraft"]]); });
  it("keeps everything this release actually knows when the bar moves under it", async () => {
    const stored = { schemaVersion: 2, releaseId: "t:1", computedAt: new Date().toISOString(), tenantId: "t",
      changes: { ...emptyView(0), proposals: [bundled("basis_old::d2", "t::old")], ready: [bundled("basis_old::d2", "t::old")],
        summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView,
      today: { hasChanges: true, today: { headerSentence: "stale", nextOpportunities: [], waitingUntil: "2026-08-04T18:00:00.000Z",
        investigating: 2, heldForMeasurement: 3, producerOutcome: "investigating",
        declineNotes: [{ page: "/famous-iranian-comedians", note: "Its click-through is healthy, so I am watching it." }] } } };
    vi.resetModules();
    vi.doMock("@/lib/persistence/json-store", () => ({ readStore: async () => [stored], writeStore: async () => {}, claimScope: async () => true, releaseScope: async () => undefined }));
    vi.doMock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
      resolveCurrentBasis: async () => NOW }));
    vi.doMock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")),
      countTrackedQuestions: async () => 30 }));
    const { loadTodayView } = await import("@/app/(shell)/today-view-data");
    const { today } = await loadTodayView(); // it really was rebuilt from what survived the bar
    expect([today.headerSentence === "stale", today.headerSentence.includes("August 4")]).toEqual([false, true]); expect([today.waitingUntil, today.investigating, today.heldForMeasurement]).toEqual(["2026-08-04T18:00:00.000Z", 2, 3]);
    expect(today.declineNotes).toEqual(stored.today.today.declineNotes);
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/decision"); vi.doUnmock("@/domains/runtime"); vi.resetModules(); });
  it("checks a stored release against the bar I hold NOW, not against itself", async () => {
    const { withCurrentBasisOnly, setAsideHint } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    const mixed = { ...emptyView(2), proposals: [bundled("basis_old::d2", "t::old"), bundled(NOW, "t::now"), { ...bundled("", "t::none"), basis: undefined }], // demotedStaleBasis 2 OVERLAPS the 3 listed rows in an old-rule release: 3, never 5.
      ready: [bundled("basis_old::d2", "t::old")], summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const held = withCurrentBasisOnly(mixed, { tenantId: "t", currentBasis: NOW }); // the current row survives; it was never set aside
    expect([held.proposals.map((p) => p.basis), held.ready.length, held.summary.ready, held.demotedStaleBasis]).toEqual([[NOW], 0, 0, 2]);
    const uniformlyStale = { ...emptyView(0), proposals: [bundled("basis_old::d3", "t::old")], ready: [bundled("basis_old::d3", "t::old")],
      summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const stale = withCurrentBasisOnly(uniformlyStale, { tenantId: "t", currentBasis: NOW }); // ONE bar, and it is not mine: consistency is not currency
    expect([stale.proposals.length, stale.ready.length, stale.summary.ready]).toEqual([0, 0, 0]); expect(stale.readyZeroHint).toBe(setAsideHint());
    const current = { ...emptyView(0), proposals: [bundled(NOW)], ready: [bundled(NOW)] } as ChangesView;
    expect(withCurrentBasisOnly(current, { tenantId: "t", currentBasis: NOW }).proposals).toHaveLength(1); // my own bar, untouched
    expect(withCurrentBasisOnly(current, { tenantId: "t", currentBasis: null }).proposals).toHaveLength(0); }); // a bar I cannot read shows nothing
});
