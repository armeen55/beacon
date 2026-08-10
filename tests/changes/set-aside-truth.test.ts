/** A change I set aside stays set aside (truth convergence). The ranked queue is the ONLY source a direct link may render exact copy from, a stored release that predates
 *  my current evidence bar may not present its rows as work, and an empty queue reads as a decision on Changes and on Today alike. Every test name states the promise it
 *  pins. */
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
  loadChangeProposal: vi.fn(), resolveCurrentBasis: vi.fn(), markProposalImplemented: vi.fn(async () => true) }));
vi.mock("@/app/(shell)/changes-data", async () => ({ ...(await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data")),
  loadChangesView: vi.fn() }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));
const shipped = vi.hoisted(() => ({ records: [] as unknown[], held: [] as any[] }));
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  loadShippedChanges: async () => shipped.held, captureChangeMeta: async () => null, loadProofLedgerPersisted: async () => shipped.held,
  selectControlPages: async () => ["https://site.example/a", "https://site.example/b"], // fewer is refused; pinned in proof-actions-gating
  recordShippedChange: async (r: unknown) => r, upsertShippedChange: async (r: unknown) => { shipped.records.push(r); } }));

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
const emptyView = (demotedStaleBasis: number): ChangesView => ({ proposals: [], ready: [], toDo: [],
  summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 }, measuringCountCanonical: 0, demotedStaleBasis, decidedCountCanonical: 0,
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
    expect([live.includes(EXACT), live.includes("I made this change"), live.includes("I set this idea aside")]).toEqual([true, true, false]);
    const stale = await link(bundled("basis_old::d2")); // no exact copy, no before/after, no way to record it
    expect([stale.includes("I set this idea aside"), stale.includes("See what I am working on now")]).toEqual([true, true]);
    expect(stale).not.toMatch(new RegExp(`${EXACT}|Comedians</p>|I made this change`)); });
  // THE DOOR IS THE SAME DOOR. A direct link is not a side entrance: everything the ranked list refuses is refused here too, on the row's own evidence rather than on its
  // basis stamp alone.
  it("refuses at the link what the list refuses: a receipt that does not resolve, a merge filed as ready, evidence gone cold", async () => {
    const b = bundled(NOW).bundle!, cold = new Date(Date.now() - 120 * 86_400_000).toISOString();
    for (const bundle of [
      { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] },
      { ...b, components: [{ ...b.components[0]!, kind: "consolidation", label: "Merge the two pages", risk: "dangerous" }] },
      { ...b, receipt: { items: [{ ...b.receipt.items[0]!, observedAt: cold }], missing: [], freshestObservedAt: cold } },
    ]) {
      const html = await link({ ...bundled(NOW), bundle } as ChangeProposal);
      expect([html.includes(EXACT), html.includes("I made this change")], JSON.stringify(bundle.components[0])).toEqual([false, false]);
    }
  });
  /** P1-2. The picker pre-ticked EVERY piece with no memory of what is already recorded, so the obvious next press offered to record a component I am already measuring.
   *  It now opens on what is genuinely still theirs to do. */
  it("opens the picker on the pieces nobody has recorded yet", async () => {
    const b = bundled(NOW).bundle!;
    shipped.held = [{ proposalId: ID, componentsApplied: [{ id: "0:title", kind: "title", label: "Title" }] }];
    const html = await link({ ...bundled(NOW), bundle: { ...b, components: [b.components[0]!, { ...b.components[0]!, kind: "meta", label: "Description", after: "A description" }] } } as ChangeProposal);
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]); shipped.held = [];
    expect([boxes.length, boxes[0]!.includes("checked"), boxes[1]!.includes("checked")]).toEqual([2, false, true]); });
  /** FRESHNESS IS PER COMPONENT, because a receipt is mixed by design. One AI answer taken this morning used to keep a whole change alive beside a page reading and a
   *  results check nobody had taken in months. And an atomic change carried no receipt at all, so it could never go stale: it ages on the day it was drafted. */
  it("expires the change whose own component cites only cold readings, keeps the one whose readings are current, and ages a change with no receipt on its drafted date", () => {
    const cold = new Date(Date.now() - 40 * 86_400_000).toISOString(), ctx = { tenantId: "t", currentBasis: NOW };
    const b = bundled(NOW).bundle!, item = b.receipt.items[0]!;
    const mixed = { ...bundled(NOW), bundle: { ...b, components: [b.components[0]!, { ...b.components[0]!, kind: "meta" as const, label: "Description", after: "A description", evidenceKeys: ["k2"] }],
      receipt: { items: [item, { ...item, key: "k2", observedAt: cold }], missing: [], freshestObservedAt: SEEN } } } as ChangeProposal;
    const { bundle: _b, ...atomic } = bundled(NOW);
    // AND A BUNDLE WHOSE EVERY READING IS UNDATED still ages: real receipt keys (the page's own demand, the diagnosis, the winner pattern) carry no observation date at
    // all, so per-component freshness alone would have let such a change stand forever. With nothing dated to age, it ages on the day it was drafted, exactly as an
    // atomic change does.
    const undated = { ...bundled(NOW), createdAt: cold, bundle: { ...b, receipt: { items: [{ ...item, observedAt: null }], missing: [], freshestObservedAt: null } } } as ChangeProposal;
    expect([failures(mixed, ctx).length > 0, failures(bundled(NOW), ctx).length, failures({ ...atomic, createdAt: cold } as ChangeProposal, ctx).length > 0,
      failures(undated, ctx).length > 0, failures({ ...undated, createdAt: SEEN } as ChangeProposal, ctx).length]).toEqual([true, 0, true, true, 0]); });
  it("sends live work with nothing to unpack home to the list, and gives a put-aside change the put-aside screen", async () => {
    const { bundle: _b, ...flat } = bundled(NOW); // live, actionable, but nothing to unpack: its home is the list
    await expect(link(flat as ChangeProposal)).rejects.toThrow("NEXT_REDIRECT:/changes");
    expect(await link(null, bundled(NOW))).toContain("I set this idea aside"); // history, not a page that never was
  });
  // AND NOTHING LANDS IN THE LEDGER THAT THIS SCREEN WOULD NOT SHOW: the same verdict runs at the moment of the press, and a stale screen or a hand-made request cannot
  // merge a page on its own say-so.
  it("refuses a receipt that no longer resolves, and holds a page-mover until the operator confirms it here", async () => {
    shipped.records = [];
    const b = bundled(NOW).bundle!;
    const mark = async (p: ChangeProposal, args: Record<string, unknown> = {}) => {
      await link(p); // the same stored row this screen would be rendered from
      return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, ...args });
    };
    const broken = { ...bundled(NOW), bundle: { ...b, components: [{ ...b.components[0]!, evidenceKeys: ["nothing-holds-this"] }] } } as ChangeProposal;
    expect([(await mark(broken)).success, shipped.records.length]).toEqual([false, 0]);
    const merge = { ...bundled(NOW), status: "needs_review", riskLevel: "high", bundle: { ...b, risks: ["The old address stops answering."],
      components: [{ ...b.components[0]!, kind: "consolidation", label: "Merge the two pages", risk: "dangerous", redirectTo: "https://site.example/keep" }] } } as unknown as ChangeProposal;
    const refused = await mark(merge);
    expect([refused.success, refused.error?.includes("confirm"), shipped.records.length]).toEqual([false, true, 0]);
    expect([(await mark(merge, { destructiveConfirmed: true })).success, shipped.records.length]).toEqual([true, 1]); }); });

describe("an account that skipped the connectors still reaches its own Today", () => {
  // Connecting Google is worth doing and it is not the price of entry: an account with approved questions and research of its own must not be told to connect before it
  // may see anything at all.
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
    // A read I could not take is not proof the account is empty, so it may not send them to the connect prompt.
    const blind = await gate(() => { throw new Error("database unreachable"); });
    expect([blind.isDemoMode, blind.unreadable]).toEqual([false, true]);
    for (const m of ["@/lib/seed-data.server", "@/lib/connector-store", "@/lib/persistence/repositories"]) vi.doUnmock(m);
    vi.resetModules(); }); });

describe("an empty Changes queue reads as a decision, not an empty screen", () => {
  beforeEach(() => vi.clearAllMocks());
  it("says how many ideas I set aside, why, and what happens next", async () => {
    const html = await renderChanges(emptyView(21));
    for (const said of ["I set aside 21 earlier ideas that no longer clear it", "No change has cleared Ready yet", "the next one that earns it lands here"]) expect(html).toContain(said);
    expect(html).not.toMatch(/No changes yet|error|sorry|oops/i);
    // A bar I could not READ is not a bar I raised, so that case may not claim one.
    expect(await renderChanges({ ...emptyView(21), basisUnreadable: true })).not.toContain("I set aside 21"); });
  it("Changes and Today tell the same story when the decision has zero actionable candidates", async () => {
    const view = emptyView(21); const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data");
    const today = buildTodayViewFromChanges(view); const said = "I set aside 21 earlier ideas that no longer clear it";
    expect([today.headerSentence.includes(said), today.nextOpportunities.length, (await renderChanges(view)).includes(said)]).toEqual([true, 0, true]); });
  it("keeps everything this release actually knows when the bar moves under it", async () => {
    // The gated rebuild used to be handed NOTHING, so a basis shift silently erased the retry date, the pages under investigation, the ideas held back and the kernel's
    // own verdicts.
    const stored = { schemaVersion: 2, releaseId: "t:1", computedAt: new Date().toISOString(), tenantId: "t",
      changes: { ...emptyView(0), proposals: [bundled("basis_old::d2", "t::old")], ready: [bundled("basis_old::d2", "t::old")],
        summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView,
      today: { hasChanges: true, today: { headerSentence: "stale", nextOpportunities: [], waitingUntil: "2026-08-04T18:00:00.000Z",
        investigating: 2, heldForMeasurement: 3, producerOutcome: "investigating",
        declineNotes: [{ page: "/famous-iranian-comedians", note: "Its click-through is healthy, so I am watching it." }] } } };
    vi.resetModules();
    vi.doMock("@/lib/persistence/json-store", () => ({ readStore: async () => [stored], writeStore: async () => {} }));
    vi.doMock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
      resolveCurrentBasis: async () => NOW }));
    vi.doMock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")),
      countTrackedQuestions: async () => 30 }));
    const { loadTodayView } = await import("@/app/(shell)/today-view-data");
    const { today } = await loadTodayView(); // it really was rebuilt from what survived the bar
    expect([today.headerSentence === "stale", today.headerSentence.includes("waiting until August 4")]).toEqual([false, true]);
    expect([today.waitingUntil, today.investigating, today.heldForMeasurement]).toEqual(["2026-08-04T18:00:00.000Z", 2, 3]);
    expect(today.declineNotes).toEqual(stored.today.today.declineNotes);
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/decision"); vi.doUnmock("@/domains/runtime"); vi.resetModules(); });
  it("checks a stored release against the bar I hold NOW, not against itself", async () => {
    const { withCurrentBasisOnly, setAsideHint } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    // demotedStaleBasis 2 OVERLAPS the 3 listed rows in an old-rule release: 3, never 5.
    const mixed = { ...emptyView(2), proposals: [bundled("basis_old::d2", "t::old"), bundled(NOW, "t::now"), { ...bundled("", "t::none"), basis: undefined }],
      ready: [bundled("basis_old::d2", "t::old")], summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const held = withCurrentBasisOnly(mixed, { tenantId: "t", currentBasis: NOW }); // the current row survives; it was never set aside
    expect([held.proposals.map((p) => p.basis), held.ready.length, held.summary.ready, held.demotedStaleBasis]).toEqual([[NOW], 0, 0, 2]);
    const uniformlyStale = { ...emptyView(0), proposals: [bundled("basis_old::d3", "t::old")], ready: [bundled("basis_old::d3", "t::old")],
      summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const stale = withCurrentBasisOnly(uniformlyStale, { tenantId: "t", currentBasis: NOW }); // ONE bar, and it is not mine: consistency is not currency
    expect([stale.proposals.length, stale.ready.length, stale.summary.ready]).toEqual([0, 0, 0]);
    expect(stale.readyZeroHint).toBe(setAsideHint());
    const current = { ...emptyView(0), proposals: [bundled(NOW)], ready: [bundled(NOW)] } as ChangesView;
    expect(withCurrentBasisOnly(current, { tenantId: "t", currentBasis: NOW }).proposals).toHaveLength(1); // my own bar, untouched
    expect(withCurrentBasisOnly(current, { tenantId: "t", currentBasis: null }).proposals).toHaveLength(0); }); // a bar I cannot read shows nothing
});
