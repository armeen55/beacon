import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import { createRoot } from "react-dom/client"; import { act, createElement, type ReactElement } from "react"; import { createRequire } from "node:module";
import type { ChangeProposal } from "@/domains/decision";
import { confirmedVersion as versionOf } from "@/domains/decision/completeness";
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
const publish = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => publish.allowed }));
const shipped = vi.hoisted(() => ({ records: [] as unknown[], held: [] as any[] }));
const surfaceCalls = vi.hoisted(() => ({ n: 0 }));
const { proofRun, prepareRun } = vi.hoisted(() => ({ proofRun: vi.fn(), prepareRun: vi.fn() }));
vi.mock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")), atomicProof: { run: proofRun, finishPage: prepareRun } }));
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  loadShippedChanges: async () => shipped.held, captureChangeMeta: async () => null, loadProofLedgerPersisted: async () => shipped.held,
  recordShipment: async (r: unknown) => { const f = r as { proposalId: string; proposalVersion: string };
    const held = shipped.held.find((x) => x.proposalId === f.proposalId && x.proposalVersion === f.proposalVersion); // the REAL door's idempotency, mirrored: same proposal and version answers the row already on file and writes nothing
    if (held) return { shipmentId: held.id, measurement: held.measurementState ?? "measuring" };
    shipped.records.push(r); return { shipmentId: "rec-1", measurement: "measuring" }; } }));
const NOW = "basis_now::d4", AUTH = "4b926534-2d8f-4ad8-a84b-15137b8aa007", EXACT = "Iranian Comedians: the 12 names people actually search for";
const ID = "t::/famous-iranian-comedians::existing_edit::bundle";
const SEEN = new Date(Date.now() - 2 * 86_400_000).toISOString();
const bundled = (basis: string, id = ID): ChangeProposal => ({
  id, tenantId: "t", kind: "existing_edit", pagePath: "/famous-iranian-comedians", pageLabel: "Famous Iranian comedians", primaryQuery: "iranian comedians",
  whyItMatters: "This page lost 163 clicks last month.", opportunityType: "Answer the exact search", estimatedEffortMinutes: 6, upsidePerMonth: 163,
  confidence: "high", riskLevel: "low", status: "ready", basis, limitations: [], changeFamily: "title", createdAt: SEEN,
  modeledOn: "the stored results page for this search, whose top titles share this shape", recommendedChange: { kind: "existing_edit", field: "title", before: "Comedians", after: EXACT },
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
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: encodeURIComponent(ID) }) }) as ReactElement);}
async function renderChanges(view: ChangesView): Promise<string> {
  vi.mocked((await import("@/app/(shell)/changes-data")).loadChangesView).mockResolvedValue(view);
  const { ChangesSection } = await import("@/app/(shell)/changes/page");
  return renderToStaticMarkup(await ChangesSection() as ReactElement);}
describe("a direct link renders only what the ranked list would, and always lands somewhere honest", () => {
  beforeEach(() => vi.clearAllMocks());
  async function link(p: ChangeProposal | null, retired: ChangeProposal | null = null): Promise<string> {
    const { loadChangeProposal, resolveCurrentBasis } = await import("@/domains/decision");
    vi.mocked(resolveCurrentBasis).mockResolvedValue(NOW); // the bar the account holds NOW
    vi.mocked(loadChangeProposal).mockImplementation(async (_t: string, _id: string, o?: { retired?: string }) =>
      (o?.retired === "include" ? retired ?? p : p) as ChangeProposal | null);
    return renderDetail();}
  it("hands over the exact edits for current work, and no copy at all for a change whose own receipt does not resolve", async () => {
    const live = await link(bundled(NOW)); // the row IS the current bar's work
    expect([live.includes(EXACT), live.includes("Mark done"), live.includes("This idea was set aside")]).toEqual([true, true, false]);
    const older = await link(bundled("basis_old::d2")); expect([older.includes(EXACT), older.includes("This idea was set aside")], "copy drafted under rules that no longer stand is history, never an actionable handoff").toEqual([false, true]); const broken = bundled(NOW); const stale = await link({ ...broken, bundle: { ...broken.bundle!, components: [{ ...broken.bundle!.components[0]!, evidenceKeys: ["nothing-holds-this"] }] } } as ChangeProposal); expect([stale.includes("This idea was set aside"), stale.includes("See the work that stands now")]).toEqual([true, true]); expect(stale).not.toMatch(new RegExp(`${EXACT}|Comedians</p>|Mark done`)); });
  it("refuses at the link what the list refuses: a receipt that does not resolve and a merge filed as ready, while a dated reading is handed over with its date", async () => {
    const b = bundled(NOW).bundle!, cold = new Date(Date.now() - 120 * 86_400_000).toISOString();
    for (const bundle of [
      { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] },
      { ...b, components: [{ ...b.components[0]!, kind: "consolidation", label: "Merge the two pages", risk: "dangerous" }] },
    ]) {
      const html = await link({ ...bundled(NOW), bundle } as ChangeProposal); expect([html.includes(EXACT), html.includes("Mark done")], JSON.stringify(bundle.components[0])).toEqual([false, false]);}
    const dated = await link({ ...bundled(NOW), bundle: { ...b, receipt: { items: [{ ...b.receipt.items[0]!, observedAt: cold }], missing: [], freshestObservedAt: cold } } } as ChangeProposal); expect([dated.includes(EXACT), dated.includes("Mark done")], "REPLACES the cold-evidence refusal: the exact work is handed over and the date its readings carry is a caveat on the card").toEqual([true, true]); });
  it("opens the picker on the pieces nobody has recorded yet", async () => {
    const b = bundled(NOW).bundle!;
    shipped.held = [{ proposalId: ID, page: "/famous-iranian-comedians", componentsApplied: [{ id: "0:title", ...b.components[0] }] }];
    const html = await link({ ...bundled(NOW), bundle: { ...b, components: [b.components[0]!, { ...b.components[0]!, kind: "meta", label: "Description", after: "Twelve comedians span stand-up, television and film, with their best-known performances." }] } } as ChangeProposal); const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]); shipped.held = []; expect([boxes.length, boxes[0]!.includes("disabled"), boxes.some((x) => x.includes("checked")), html.includes("already recorded")]).toEqual([2, true, false, true]); });
  it("expires no change for the age of its readings, and refuses the one whose piece cites evidence the receipt never carried", () => {
    const cold = new Date(Date.now() - 40 * 86_400_000).toISOString(), ctx = { tenantId: "t", currentBasis: NOW }, b = bundled(NOW).bundle!, item = b.receipt.items[0]!;
    const { bundle: _b, ...atomic } = bundled(NOW), undated = { ...bundled(NOW), createdAt: cold, bundle: { ...b, receipt: { items: [{ ...item, observedAt: null }], missing: [], freshestObservedAt: null } } } as ChangeProposal;
    const unresolved = { ...bundled(NOW), bundle: { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] } } as ChangeProposal;
    expect([failures(bundled(NOW), ctx).length, failures({ ...atomic, createdAt: cold } as ChangeProposal, ctx).length, failures(undated, ctx).length, failures(unresolved, ctx).length > 0], "REPLACES the thirty day freshness window (owner's editorial policy, 2026-09-06): an atomic row drafted forty days ago and a receipt with no date on it are both work, and the card names the date; a piece pointing at evidence the receipt never carried is still a defect that holds it").toEqual([0, 0, 0, true]); });
  it("renders live work with nothing to unpack as its own page, and gives a put-aside change the put-aside screen", async () => {
    const { bundle: _b, ...flat } = bundled(NOW); // live and actionable with no second layer: it gets the one-layer page
    expect(await link(flat as ChangeProposal)).toContain("data-simple-detail");
    expect(await link(null, bundled(NOW))).toContain("This idea was set aside"); // history, not a page that never was
  });
  it("a ready row the hold blocks exposes neither Copy nor Mark done on its direct link", async () => {
    const { bundle: _b2, ...flat } = bundled(NOW);
    const held = { ...flat, limitations: [...(flat.limitations ?? []), "This claim carries no source yet, so it is held for review until one is on file."] } as ChangeProposal; const page = await link(held); expect(page).not.toContain(">Copy<");
    expect(page).not.toContain("Mark done");
    expect(page).toContain("held"); // the reason renders where the controls were
  });
  it("refuses a receipt that no longer resolves, and holds a page-mover until the operator confirms it here", async () => {
    shipped.records = [];
    const b = bundled(NOW).bundle!; const mark = async (p: ChangeProposal, args: Record<string, unknown> = {}) => { await link(p); return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, expectedVersion: versionOf(p), ...args }); }; const broken = { ...bundled(NOW), bundle: { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] } } as ChangeProposal; expect([(await mark(broken)).success, shipped.records.length]).toEqual([false, 0]);
    const merge = { ...bundled(NOW), status: "needs_review", riskLevel: "high", bundle: { ...b, risks: ["The old address stops answering."], components: [{ ...b.components[0]!, kind: "consolidation", label: "Merge the two pages", risk: "dangerous", redirectTo: "https://site.example/keep" }] } } as unknown as ChangeProposal;
    const refused = await mark(merge); expect([refused.success, refused.error?.includes("still being reviewed"), shipped.records.length]).toEqual([false, true, 0]); expect([(await mark(merge, { destructiveConfirmed: true })).success, shipped.records.length]).toEqual([false, 0]);
    const { confirmDangerousChangeAction: confirm } = await import("@/app/(shell)/changes/actions"), { confirmedVersion, answerReviewedProposal: promote } = await import("@/domains/decision");
    const safe = { ...merge, bundle: { ...merge.bundle!, components: [b.components[0]!] } } as ChangeProposal;
    await link(merge); const html = await renderDetail(), stale = await confirm({ proposalId: merge.id, version: "a version nobody is looking at" });
    await link(safe); const wrong = await confirm({ proposalId: safe.id, version: confirmedVersion(safe) });
    await link(merge); const ok = await confirm({ proposalId: merge.id, version: confirmedVersion(merge) }), sent = vi.mocked(promote).mock.calls.at(-1);
    expect([html.includes("Confirm this version"), html.includes("Mark done"), stale.success, stale.error?.includes("rewritten since"), wrong.success, wrong.error?.includes("does not move or hide a page"), ok.success, vi.mocked(promote).mock.calls.length, sent?.[1], sent?.[2] === confirmedVersion(merge)]).toEqual([true, false, false, true, false, true, true, 1, merge.id, true]); });
  it("refuses a hand-made Mark done request for whole-page work during the manual-edit proof", async () => { shipped.records = []; const b = bundled(NOW).bundle!, whole = { ...bundled(NOW), changeFamily: "full_rewrite", bundle: { ...b, components: [{ ...b.components[0]!, kind: "full_rewrite", target: { mode: "whole_body", anchorKind: null, anchor: null } }] } } as ChangeProposal;
    await link(whole); const result = await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: whole.id, expectedVersion: versionOf(whole) }); expect([result.success, result.error?.includes("outside the current manual-edit proof"), shipped.records.length]).toEqual([false, true, 0]); }); });
describe("an account that skipped the connectors still reaches its own Today", () => {
  it("calls an account a demo only when it truly holds nothing, never merely because it connected nothing", async () => {
    const gate = async (repo: () => unknown) => {
      vi.resetModules();
      vi.doMock("@/lib/seed-data.server", () => ({ hasActiveExperiment: async () => false }));
      vi.doMock("@/lib/connector-store", () => ({ hasAnyConnectedDataSource: async () => false }));
      vi.doMock("@/lib/persistence/repositories", () => ({ getRepository: repo }));
      return (await import("@/app/(shell)/today-gate-data")).loadTodayV2GateData();};
    const held = (tracked: unknown[]) => () => ({ forTenant: () => ({ getPromptAnswerObservations: async () => [], getTrackedPrompts: async () => tracked }) }); expect([(await gate(held([{ is_active: true, tags: ["core_v1"] }]))).isDemoMode, (await gate(held([]))).isDemoMode]).toEqual([false, true]);
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
    const view = { ...emptyView(0), proposals: [draft, idea], ready: [], toDo: [draft], research: [idea], summary: { ...emptyView(0).summary, todo: 1, research: 1 } }; const html = await renderChanges(view), today = buildTodayViewFromChanges(view);
    expect(html).toContain("1 change is being written and checked, and 1 opportunity is being researched. They move up here on their own."); // ONE status line with the release's counts (Product Truth, 2026-08-27), never a card and never a tally of internal states
    for (const never of ["Copy draft", "Why it is held", "Needs your review", "Beacon must improve", "Written and being checked", "What you are deciding", "waiting on the final review", EXACT]) expect(html).not.toContain(never);
    expect(html).not.toMatch(/Proven|Mark done|Still missing/);
    expect([today.readyTotal, today.nextOpportunities, today.topEdit, today.headerSentence, today.preparing]).toEqual([0, [], undefined, "No finished change is ready today. The next one lands here the moment the exact work is written.", { written: 1, researching: 1 }]); // Today previews finished work alone and carries the same two counts
    expect(html.match(/data-change-card="true"/g) ?? []).toHaveLength(0); }); // no unfinished work wears a card
  it("collapses 12 preparing opportunities into one counted sentence, never essays, never detail links and never Ready", async () => {
    const ideas = Array.from({ length: 12 }, (_, i) => ({ ...bundled(NOW, `t::idea-${i}`), status: "needs_review", researchOnly: true, bundle: undefined,
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: `Internal essay for idea ${i}` } })) as ChangeProposal[];
    const view = { ...emptyView(0), proposals: ideas, ready: [], toDo: [], research: ideas, summary: { ...emptyView(0).summary, research: 12 } }; const html = await renderChanges(view);
    expect([html.match(/data-lane-preparing="true"/g)?.length, html.match(/data-research-detail="true"/g)?.length ?? 0, html.includes("12 opportunities are being researched. They move up here on their own."),
      html.includes("Internal essay for idea"), html.includes("Ready now: 0"), html.includes("What the evidence says"), html.includes("being written and checked")]) .toEqual([1, 0, true, false, false, false, false]); }); // TWELVE identical drafts are ONE sentence with the count and no written clause when nothing is written (Product Truth; operator, 2026-08-31): the operator is nobody's progress clerk, and no internal essay ever leaks
  it("never narrates a preparing row's obligation or leaks its draft: the counted sentence is the whole of what a customer reads", async () => {
    const idea = (id: string, obligation?: unknown) => ({ ...bundled(NOW, id), status: "needs_review", researchOnly: true, bundle: undefined, ...(obligation ? { obligation } : {}),
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "internal brief text" } }) as unknown as ChangeProposal;
    const rows = [idea("t::/a::existing_edit::ownership", { kind: "evidence", need: { kind: "factual_source", query: "q", reasonCode: "no_fact" } }), idea("t::/b::existing_edit::missing_description", { kind: "review" }), idea("t::/c::existing_edit::gap", { kind: "redraft", attempt: 1, instruction: "say the number" }), idea("t::idea-typed")]; const view = { ...emptyView(0), proposals: rows, ready: [], toDo: [], research: rows, summary: { ...emptyView(0).summary, research: 4 } }; const html = await renderChanges(view);
    expect(["waiting on a source read", "waiting on the final review", "waiting for the next pass", "internal brief text", "sections and answers"].map((s) => html.replace(/&#x27;/g, "'").includes(s)).concat(html.includes("4 opportunities are being researched. They move up here on their own.")), "four research rows under four different obligations are one sentence with one count: the obligation is Beacon's to work through, never the customer's to read, and no word of the internal draft leaks").toEqual([false, false, false, false, false, true]); }); // the per-kind tally went with the written lane (Product Truth, 2026-08-27): internal work is one collapsed status line
  it("takes a yes on judgement alone and refuses one on a fact about the work", async () => {
    const { reviewDraftAction } = await import("@/app/(shell)/changes/actions"), { confirmedVersion, loadChangeProposal, resolveCurrentBasis } = await import("@/domains/decision");
    const link = async (p: ChangeProposal) => { vi.mocked(resolveCurrentBasis).mockResolvedValue(NOW); vi.mocked(loadChangeProposal).mockResolvedValue(p); }; const soft = { ...bundled(NOW, "t::draft"), status: "needs_review" } as ChangeProposal;
    const hard = { ...soft, faults: ["no serious editor would hand this to a customer"] } as ChangeProposal; // a DEFECT of the one verdict (narration), never the old split sentence: a split settled on only some of its pages is the owner's call under the editorial policy of 2026-09-06 and rides the card as a caveat
    await link(soft); const yes = await reviewDraftAction({ proposalId: soft.id, version: confirmedVersion(soft), decision: "approve" });
    await link(hard); const no = await reviewDraftAction({ proposalId: hard.id, version: confirmedVersion(hard), decision: "approve" });
    await link(soft); const better = await reviewDraftAction({ proposalId: soft.id, version: confirmedVersion(soft), decision: "improve" }); const { answerReviewedProposal: answer } = await import("@/domains/decision");
    expect([yes.success, no.success, no.error?.includes("hand this to a customer"), better.success, vi.mocked(answer).mock.calls.map((c) => (c[4] as { kind: string }).kind)]) .toEqual([true, false, true, true, ["promote", "redraft"]]); });
  it("finishes only the named row under the fixed tiny receipt and says the ceiling before the press", async () => {
    proofRun.mockResolvedValueOnce({ success: true, reason: "stored_ready_substantive_and_complete", meter: { providerCalls: 1, costUsd: 0.004748 } });
    const { finishOneProposalAction } = await import("@/app/(shell)/changes/actions"), { SetAsideChange } = await import("@/app/(shell)/changes/change-controls");
    const out = await finishOneProposalAction({ proposalId: ID });
    expect(proofRun).toHaveBeenCalledWith({ tenantId: "t", proposalId: ID, currentBasis: NOW, maxOpenAiCalls: 1, maxOpenAiUsd: 0.05 });
    expect([out.success, out.providerCalls, out.costUsd, Object.keys(out).includes("stored"), out.note?.includes("$0.004748")]).toEqual([true, 1, 0.004748, false, true]);
    proofRun.mockResolvedValueOnce({ success: false, reason: "proof_admission_refused_overrun", meter: { providerCalls: 0, costUsd: 0 } }); const failed = await finishOneProposalAction({ proposalId: ID }); proofRun.mockResolvedValueOnce({ success: false, reason: "candidate_preflight:This repeats the answer already on the page.", meter: null }); const preflight = await finishOneProposalAction({ proposalId: ID }); expect([failed.error, preflight.error]).toEqual(["Today's internal spend breaker is still closed. No provider call was made. Receipt: 0 OpenAI calls, $0.00; DataForSEO $0.", "This repeats the answer already on the page. No provider call was made. Receipt: 0 OpenAI calls, $0.00; DataForSEO $0."]);
    publish.allowed = false; const denied = await finishOneProposalAction({ proposalId: ID }); publish.allowed = true; expect([denied.success, proofRun.mock.calls.length]).toEqual([false, 3]);
    const shown = renderToStaticMarkup(createElement(SetAsideChange, { proposalId: ID, finishable: true })), hidden = renderToStaticMarkup(createElement(SetAsideChange, { proposalId: ID }));
    expect([shown.includes("Finish this one"), shown.includes("Free page and evidence checks run first"), shown.includes("$0.05"), shown.includes("DataForSEO $0"), shown.includes("Research stays paused"), hidden.includes("Finish this one")]).toEqual([true, true, true, true, true, false]); });
  it("prepares the selected page only with disclosed ceilings and never calls a reservation an invoice", async () => {
    const { finishOneProposalAction } = await import("@/app/(shell)/changes/actions"), { SetAsideChange } = await import("@/app/(shell)/changes/change-controls");
    prepareRun.mockResolvedValueOnce({ success: false, allowance: { modelReservedUsd: 0.2, externalReservedUsd: 0.002 }, evidenceOwed: [{ kind: "factual_source", query: "regional weave" }] }).mockResolvedValueOnce({ success: false, reason: "proof_admission_replayed", allowance: null }).mockResolvedValueOnce({ success: false, reason: "openai_not_configured_in_this_runtime", allowance: null });
    const failed = await finishOneProposalAction({ proposalId: ID, prepare: true, authorizationId: AUTH }), used = await finishOneProposalAction({ proposalId: ID, prepare: true, authorizationId: AUTH }), missing = await finishOneProposalAction({ proposalId: ID, prepare: true, authorizationId: AUTH });
    expect(prepareRun).toHaveBeenCalledWith({ tenantId: "t", proposalId: ID, currentBasis: NOW, maxOpenAiCalls: 8, maxOpenAiUsd: 2, maxDataForSeoCalls: 3, maxDataForSeoUsd: 0.4, authorizationId: AUTH });
    expect([failed.success, failed.error?.includes("not invoices"), failed.error?.includes("regional weave"), failed.error?.includes("Research stays paused"), used.error?.includes("already used"), missing.error?.includes("not configured")]).toEqual([false, true, true, true, true, true]);
    publish.allowed = false; const denied = await finishOneProposalAction({ proposalId: ID, prepare: true, authorizationId: AUTH }); publish.allowed = true; expect([denied.success, prepareRun.mock.calls.length]).toEqual([false, 3]);
    const { JSDOM } = createRequire(import.meta.url)("jsdom"), dom = new JSDOM("<div id='root'></div>"), popup = vi.fn(() => false); dom.window.confirm = popup; vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(dom.window.document.getElementById("root")); let release!: (value: { success: boolean; reason: string; allowance: null }) => void; prepareRun.mockClear(); prepareRun.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    try { await act(async () => root.render(createElement(SetAsideChange, { proposalId: ID, finishable: true, prepare: true }))); const button = dom.window.document.querySelector("[data-finish-one]") as HTMLButtonElement; expect(dom.window.document.body.textContent).toContain("Each attempt reuses saved evidence; up to $2 OpenAI and $0.40 DataForSEO."); await act(async () => button.click());
      expect(popup).not.toHaveBeenCalled(); expect(button.disabled).toBe(true); expect(prepareRun).toHaveBeenCalledOnce(); expect(prepareRun.mock.calls[0]?.[0]).toMatchObject({ proposalId: ID, maxOpenAiUsd: 2, maxDataForSeoUsd: 0.4, authorizationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) }); await act(async () => { button.click(); release({ success: false, reason: "no_new_ready_substantive_edit", allowance: null }); }); expect(prepareRun).toHaveBeenCalledOnce(); expect(button.disabled).toBe(false);
    } finally { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); }
  });
  it("keeps everything this release actually knows when the bar moves under it", async () => {
    const stored = { schemaVersion: 2, releaseId: "t:1", computedAt: new Date().toISOString(), tenantId: "t",
      changes: { ...emptyView(0), proposals: [bundled("basis_old::d2", "t::old")], ready: [bundled("basis_old::d2", "t::old")],
        summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView,
      today: { hasChanges: true, today: { headerSentence: "stale", nextOpportunities: [], waitingUntil: "2026-08-04T18:00:00.000Z" } } };
    vi.resetModules();
    vi.doMock("@/lib/persistence/json-store", () => ({ readStore: async () => [stored], writeStore: async () => {}, claimScope: async () => true, releaseScope: async () => undefined }));
    vi.doMock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
      resolveCurrentBasis: async () => NOW }));
    vi.doMock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")),
      countTrackedQuestions: async () => 30 }));
    const { loadTodayView } = await import("@/app/(shell)/today-view-data");
    const { today } = await loadTodayView(); // it really was rebuilt from what survived the bar
    expect([today.headerSentence === "stale", today.headerSentence.includes("August 4"), today.waitingUntil]).toEqual([false, true, "2026-08-04T18:00:00.000Z"]);
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/decision"); vi.doUnmock("@/domains/runtime"); vi.resetModules(); });
  it("revalidates a stored release against the exact current basis before serving any row", async () => {
    const { withCurrentBasisOnly } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    const mixed = { ...emptyView(2), proposals: [bundled("basis_old::d2", "t::old"), bundled(NOW, "t::now"), { ...bundled("", "t::none"), basis: undefined }], // demotedStaleBasis 2 OVERLAPS the 3 listed rows in an old-rule release: 3, never 5.
      ready: [bundled("basis_old::d2", "t::old")], summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const held = withCurrentBasisOnly(mixed, { tenantId: "t", currentBasis: NOW }); // the current row survives; it was never set aside
    expect([held.proposals.length, held.ready.length, held.summary.ready], "only the current-basis row survives; a stale row and a basis-less row are history, and an old ready stamp cannot attach to the survivor").toEqual([1, 0, 0]);
    const faulted = { ...bundled(NOW, "t::faulted"), faults: ["it points at the page instead of answering"] } as ChangeProposal, byFault = withCurrentBasisOnly({ ...emptyView(0), proposals: [faulted, { ...bundled(NOW, "t::gone"), status: "implemented_pending_verification" }], ready: [faulted], summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView, { tenantId: "t", currentBasis: NOW }); // one row that no longer waits on the operator makes the release re-sort, as a real photograph with one skipped row does
    expect([byFault.ready.length, byFault.toDo.length, byFault.summary.ready], "and a stored ready row held by a typed fault re-sorts out of the lane: the release reads the verdict's defects, never the hard arms alone (journey review, 2026-09-06)").toEqual([0, 1, 0]);
    const uniformlyStale = { ...emptyView(0), proposals: [bundled("basis_old::d3", "t::old")], ready: [bundled("basis_old::d3", "t::old")],
      summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const stale = withCurrentBasisOnly(uniformlyStale, { tenantId: "t", currentBasis: NOW }); // ONE bar, and it is not mine: consistency is not currency
    expect([stale.proposals.length, stale.ready.length, stale.summary.ready], "a release whose every row was stamped in an earlier generation is withheld rather than represented as current work").toEqual([0, 0, 0]);
    const current = { ...emptyView(0), proposals: [bundled(NOW)], ready: [bundled(NOW)] } as ChangesView;
    expect(withCurrentBasisOnly(current, { tenantId: "t", currentBasis: NOW }).proposals).toHaveLength(1); // my own bar, untouched
    expect(withCurrentBasisOnly(current, { tenantId: "t", currentBasis: null }).proposals, "an unreadable basis fails closed because no saved row can be proved current").toHaveLength(0); });
});
describe("bulk Mark Done is one batch, durable before acknowledged", () => {
  const readyRow = (id: string, over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id, tenantId: "t", kind: "existing_edit", pagePath: `/${id.split("::")[1] ?? "p"}`.replace("//", "/"), pageUrl: `https://iranopedia.com${`/${id.split("::")[1] ?? "p"}`.replace("//", "/")}`, pageLabel: id, primaryQuery: "q", opportunityType: "Capture clicks",
    changeFamily: "meta", status: "ready", basis: NOW, modeledOn: 'the results page for "q": 3 ranked titles read, 2 of them leading with "q", and this line leads with it too',
    recommendedChange: { kind: "existing_edit", field: "meta", before: "Old.", after: "A finished, specific description of the page, written from its own stored words." },
    whyItMatters: "w", estimatedEffortMinutes: 3, riskLevel: "low", confidence: "high", limitations: [], evidence: { query: "q", hints: [], evidenceRefCount: 1 }, impactScore: 5, upsidePerMonth: null, publish: "manual", createdAt: SEEN, ...over } as unknown as ChangeProposal);
  const wire = async (rows: Map<string, ChangeProposal>, ledger: unknown[]) => {
    vi.resetModules(); surfaceCalls.n = 0; shipped.records = []; shipped.held = ledger as never;
    const transition = vi.fn(async () => true);
    let ledgerReads = 0;
    vi.doMock("next/server", async () => ({ ...(await vi.importActual<typeof import("next/server")>("next/server")), after: (fn: () => unknown) => { void Promise.resolve().then(fn as never); } }));
    vi.doMock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => { surfaceCalls.n += 1; } }));
    vi.doMock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")), ensureResearchRunOnVisit: () => {} }));
    vi.doMock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
      loadChangeProposals: async () => rows, proposalDisposition: async () => null, loadChangeProposal: async () => null,
      resolveCurrentBasis: async () => NOW, transitionProposalToImplemented: transition }));
    vi.doMock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
      loadShippedChanges: async () => { ledgerReads += 1; return shipped.held; }, captureChangeMeta: async () => null,
      recordShipment: async (r: unknown) => { const f = r as { proposalId: string; proposalVersion: string };
        const held = (shipped.held as Array<{ id: string; proposalId: string; proposalVersion: string; measurementState?: string }>).find((x) => x.proposalId === f.proposalId && x.proposalVersion === f.proposalVersion);
        if (held) return { shipmentId: held.id, measurement: held.measurementState ?? "measuring" }; // the REAL door's (proposal, version) idempotency, mirrored: nothing is rewritten
        shipped.records.push(r); return { shipmentId: `rec-${shipped.records.length}`, measurement: "measuring" }; } }));
    const { markManyImplementedAction } = await import("@/app/(shell)/changes/actions");
    return { markManyImplementedAction, transition, reads: () => ledgerReads };
  };
  it("records a deduped batch with one ledger read, one Shipment per success, per-id results, and no per-row rebuild", async () => {
    const rows = new Map(["a", "b", "c"].map((k) => { const r = readyRow(`t::/${k}::existing_edit::missing_description`); return [r.id, r] as const; }));
    const { markManyImplementedAction, transition, reads } = await wire(rows, []);
    const ids = [...rows.keys()];
    const res = await markManyImplementedAction({ proposals: [...ids, ids[0]!].map((id) => ({ id, expectedVersion: versionOf(rows.get(id)!) })) }); // a duplicated input id is one press
    expect([res.success, res.done, res.already, res.failed.length], "three recorded, none failed, the duplicate deduped").toEqual([true, 3, 0, 0]);
    expect(res.results.map((r) => r.outcome), "per-id results say what each row became").toEqual(["recorded", "recorded", "recorded"]);
    expect(res.results.every((r) => !!r.shipmentId), "every success names its Shipment").toBe(true);
    expect([shipped.records.length, reads(), transition.mock.calls.length], "one Shipment per success, ONE ledger read for the whole batch, one flip per success").toEqual([3, 1, 3]);
    expect(surfaceCalls.n, "one surface refresh for the whole batch, never one per row").toBe(1); });
  it("replays idempotently, heals a crash between Shipment and flip, and one failed row rolls back nothing", async () => {
    const a = readyRow("t::/a::existing_edit::missing_description"), b = readyRow("t::/b::existing_edit::missing_description", { status: "needs_review" });
    const rows = new Map([a, b].map((r) => [r.id, r] as const));
    const { markManyImplementedAction } = await wire(rows, []);
    const first = await markManyImplementedAction({ proposals: [a, b].map((p) => ({ id: p.id, expectedVersion: versionOf(p) })) });
    expect([first.done, first.failed.length, first.failed[0]?.id], "the review row fails alone; the ready row records").toEqual([1, 1, b.id]);
    const written = shipped.records.at(-1) as { proposalVersion: string }; // CRASH HEAL: the Shipment landed but the flip did not. The retry finds the SAME Shipment through the door's own (proposal, version) idempotency, writes nothing new, and completes the flip it owes.
    const healed = await wire(rows, [{ id: "rec-1", proposalId: a.id, proposalVersion: written.proposalVersion, componentsApplied: [{ id: null }], measurementState: "measuring" }]);
    const retry = await healed.markManyImplementedAction({ proposals: [{ id: a.id, expectedVersion: versionOf(a) }] });
    expect([retry.results[0]!.outcome, retry.results[0]!.shipmentId, shipped.records.length, healed.transition.mock.calls.length], "the retry heals the flip through the SAME Shipment, writes no duplicate, and flips once").toEqual(["recorded", "rec-1", 0, 1]); });
});
