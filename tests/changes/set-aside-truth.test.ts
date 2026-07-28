/**
 * A change I set aside stays set aside (truth convergence). The ranked queue is the ONLY
 * source a direct link may render exact copy from, a stored release that predates my current
 * evidence bar may not present its rows as work, and an empty queue reads as a decision on
 * Changes and on Today alike. Every test name states the promise it pins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server"; import type { ReactElement } from "react";
import type { ChangeProposal, RankedProposalQueue } from "@/domains/decision";
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
  loadProposalQueue: vi.fn(), loadChangeProposal: vi.fn() }));
vi.mock("@/app/(shell)/changes-data", async () => ({ ...(await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data")),
  loadChangesView: vi.fn() }));

const EXACT = "Iranian Comedians: the 12 names people actually search for";
const ID = "t::/famous-iranian-comedians::existing_edit::bundle";
const bundled = (basis: string, id = ID): ChangeProposal => ({
  id, kind: "existing_edit", pagePath: "/famous-iranian-comedians", pageLabel: "Famous Iranian comedians", primaryQuery: "iranian comedians",
  whyItMatters: "This page lost 163 clicks last month.", opportunityType: "Answer the exact search", estimatedEffortMinutes: 6, upsidePerMonth: 163,
  confidence: "high", riskLevel: "low", status: "proposed", basis, limitations: [],
  recommendedChange: { kind: "existing_edit", field: "title", before: "Comedians", after: EXACT },
  bundle: { objective: "Answer the exact question people search", metric: "clicks from that search", measurementPlan: "I compare the next 28 days with the last 28.",
    scope: { queries: ["iranian comedians"], prompts: [] }, confidenceReasons: ["163 clicks lost in 4 weeks"], alternatives: [], risks: [],
    components: [{ kind: "title", label: "Title", risk: "safe", before: "Comedians", after: EXACT, evidenceKeys: [] }],
    receipt: { items: [], missing: [] } },
} as unknown as ChangeProposal);
// The queue CONTRACT this surface is written against: every lane holds current-basis
// work only, and demotedStaleBasis carries how many rows were withheld.
const queueOf = (rows: ChangeProposal[], demotedStaleBasis = 0) =>
  ({ ranked: rows, ready: rows, toDo: [], newPageBriefs: [], demotedStaleBasis } as unknown as RankedProposalQueue);
const emptyView = (demotedStaleBasis: number): ChangesView => ({ proposals: [], ready: [], toDo: [], newPageBriefs: [],
  summary: { todo: 0, ready: 0, measuring: 0, results: 0 }, measuringCountCanonical: 0, demotedStaleBasis, decidedCountCanonical: 0,
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

describe("a set-aside change never comes back through a direct link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a stale-basis bundle link renders no exact copy and no way to record the work", async () => {
    const { loadProposalQueue, loadChangeProposal } = await import("@/domains/decision");
    vi.mocked(loadProposalQueue).mockResolvedValue(queueOf([], 1)); // current-basis queue: this id is not in it
    vi.mocked(loadChangeProposal).mockResolvedValue(bundled("basis_old::d2")); // but the stored row still exists
    const html = await renderDetail();
    expect(html).toContain("I set this idea aside");
    expect(html).not.toContain(EXACT);
    expect(html).not.toContain("Comedians</p>"); // no before/after either
    expect(html).not.toContain("I made this change");
    expect(html).toContain("See what I am working on now");
  });

  it("a current-basis bundle link still renders its exact edits", async () => {
    const { loadProposalQueue, loadChangeProposal } = await import("@/domains/decision");
    vi.mocked(loadProposalQueue).mockResolvedValue(queueOf([bundled("basis_now::d4")]));
    vi.mocked(loadChangeProposal).mockResolvedValue(null);
    const html = await renderDetail();
    expect(html).toContain(EXACT);
    expect(html).toContain("I made this change");
    expect(html).not.toContain("I set this idea aside");
  });
});

describe("an empty Changes queue reads as a decision, not an empty screen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says how many ideas I set aside, why, and what happens next", async () => {
    const html = await renderChanges(emptyView(21));
    expect(html).toContain("I set aside 21 earlier ideas that no longer clear it");
    expect(html).toContain("I am still checking your pages");
    expect(html).toContain("I will rank your next change here as soon as one earns it");
    expect(html).not.toContain("No changes yet");
    expect(html).not.toMatch(/error|sorry|oops/i);
    // A bar I could not READ is not a bar I raised, so that case may not claim one.
    expect(await renderChanges({ ...emptyView(21), basisUnreadable: true })).not.toContain("I set aside 21");
  });

  it("Changes and Today tell the same story when the decision has zero actionable candidates", async () => {
    const view = emptyView(21);
    const { buildTodayViewFromChanges } = await import("@/app/(shell)/today-view-data");
    const today = buildTodayViewFromChanges(view);
    expect(today.headerSentence).toContain("I set aside 21 earlier ideas that no longer clear it");
    expect(today.nextOpportunities).toHaveLength(0);
    expect(await renderChanges(view)).toContain("I set aside 21 earlier ideas that no longer clear it");
  });

  it("checks a stored release against the bar I hold NOW, not against itself", async () => {
    const { withCurrentBasisOnly, setAsideHint } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    const NOW = "basis_now::d4";
    // demotedStaleBasis 2 OVERLAPS the 3 listed rows in an old-rule release: 3, never 5.
    const mixed = { ...emptyView(2), proposals: [bundled("basis_old::d2", "old"), bundled(NOW, "now"), { ...bundled("", "none"), basis: undefined }],
      ready: [bundled("basis_old::d2", "old")], summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const held = withCurrentBasisOnly(mixed, NOW);
    expect(held.proposals.map((p) => p.basis)).toEqual([NOW]); // the current row survives; it was never set aside
    expect(held.ready).toHaveLength(0); expect(held.summary.ready).toBe(0); expect(held.demotedStaleBasis).toBe(2);
    const uniformlyStale = { ...emptyView(0), proposals: [bundled("basis_old::d3", "old")], ready: [bundled("basis_old::d3", "old")],
      summary: { todo: 0, ready: 1, measuring: 0, results: 0 } } as ChangesView;
    const stale = withCurrentBasisOnly(uniformlyStale, NOW); // ONE bar, and it is not mine: consistency is not currency
    expect([stale.proposals.length, stale.ready.length, stale.summary.ready]).toEqual([0, 0, 0]);
    expect(stale.readyZeroHint).toBe(setAsideHint(1));
    const current = { ...emptyView(0), proposals: [bundled(NOW)], ready: [bundled(NOW)] } as ChangesView;
    expect(withCurrentBasisOnly(current, NOW).proposals).toHaveLength(1); // my own bar, untouched
    expect(withCurrentBasisOnly(current, null).proposals).toHaveLength(0); }); // a bar I cannot read shows nothing
});
