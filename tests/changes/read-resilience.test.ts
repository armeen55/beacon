/** A SLOW READ IS NOT AN OUTAGE, AND A RETRY IS NOT A SECOND CONNECTION. Two promises this screen makes when its sources are struggling: every lane read runs once per account per process no matter how many requests race into it (the retry that used to pile a second read onto a starved pool), and a release blob that will not answer serves the last list this process actually read, with its age, instead of a retry spinner over a list the operator already had. One good read to remember, then two failures in a row. ORDER MATTERS HERE: this case must run before anything remembers a release, because "nothing to fall back to" is exactly the state it pins. THE LEDGER AND DECAY LANES LEFT THIS SCREEN (operator, 2026-08-21): Results owns measurement and the watched pages, so a Changes visit no longer buys either read at all, which is the strongest form of the one-read promise the two deleted pins here used to hold. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
const calls = vi.hoisted(() => ({ ledger: 0, evidence: 0, surface: 0, failSurface: 0, hangQueue: false, basis: null as string | null, serveRows: false }));
const SURFACE = vi.hoisted(() => ({
  schemaVersion: 2 as const, releaseId: "t::r1", tenantId: "t",
  computedAt: new Date(Date.now() - 22 * 60_000).toISOString(),
  changes: { proposals: [], ready: [], toDo: [], research: [], summary: { todo: 0, ready: 0, research: 0, implemented: 0, measuring: 0, results: 0 },
    measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null },
  today: { today: {} },}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); },
  usePathname: () => "/changes", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/server", async () => ({ ...(await vi.importActual<typeof import("next/server")>("next/server")), after: (fn: () => unknown) => { void fn; } }));
vi.mock("@/lib/tenant-context", async () => ({ ...(await vi.importActual<typeof import("@/lib/tenant-context")>("@/lib/tenant-context")),
  currentTenantId: vi.fn(async () => "t") }));
vi.mock("@/domains/evidence", () => ({
  loadGscDecaySignalsForTenant: vi.fn(async () => { calls.evidence += 1; if (calls.evidence === 1) throw new Error("cold"); return new Map(); }),}));
vi.mock("@/domains/measurement", () => ({
  loadProofLedgerCached: vi.fn(async () => { calls.ledger += 1; await new Promise((r) => setTimeout(r, 80)); return []; }),}));
vi.mock("@/domains/decision", () => ({
  splitLedgerLifecycle: () => ({ measuring: [], promising: [], won: [], learned: [] }),
  resolveCurrentBasis: async () => calls.basis,
  actionableProposalFailures: () => [],
  openHold: () => ({ lane: "review", why: [], blocking: null, faulted: false, safetyHold: false }),
  unsettledCause: () => null,
  countLedgerLifecycle: () => ({ measuring: 0, decided: 0 }),
  loadProposalQueue: async () => ({ ranked: [], ready: [], toDo: [], research: [], implementedPendingVerification: 0, demotedStaleBasis: 0 }),
  readQueuePage: () => (calls.hangQueue ? new Promise(() => {}) : Promise.resolve({ rows: [], laneById: {}, total: 0, nextRank: 0, release: null, more: false, dropped: 0 })),
  publishCustomerRelease: async () => "rel",}));
const SAVED_ROW = vi.hoisted(() => ({ id: "t::/wolf::existing_edit::missing_description", tenantId: "t", kind: "existing_edit", pagePath: "/wolf", pageUrl: "https://iranopedia.com/wolf", pageLabel: "Wolf", primaryQuery: "persian wolf", opportunityType: "Capture clicks", changeFamily: "meta", status: "ready", basis: "b1", modeledOn: "backed",
  recommendedChange: { kind: "existing_edit", field: "meta", before: "Old.", after: "The saved, committed description from the last release." }, whyItMatters: "w", estimatedEffortMinutes: 3, riskLevel: "low", confidence: "high", limitations: [], evidence: { query: "persian wolf", hints: [], evidenceRefCount: 1 }, impactScore: 5, upsidePerMonth: null, publish: "manual", createdAt: new Date().toISOString() }));
vi.mock("@/app/(shell)/surface-release", () => ({
  readCustomerSurface: vi.fn(async () => {
    calls.surface += 1;
    if (calls.failSurface > 0) { calls.failSurface -= 1; throw new Error("release read failed"); }
    return calls.serveRows ? { ...SURFACE, changes: { ...SURFACE.changes, proposals: [SAVED_ROW], ready: [SAVED_ROW], summary: { ...SURFACE.changes.summary, ready: 1 } } } : SURFACE;}),
  isCustomerSurfaceStale: () => false,
  refreshCustomerSurface: async () => SURFACE,}));
vi.mock("@/app/(shell)/changes-data", async () => ({
  ...(await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data")),
  loadChangesView: vi.fn(async () => ({ proposals: [], ready: [], toDo: [], research: [],
    summary: { todo: 0, ready: 0, research: 0, implemented: 0, measuring: 0, results: 0 }, measuringCountCanonical: 0,
    demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null, surfaceBuilding: false })),}));
async function renderSection(): Promise<string> {
  const { ChangesSection } = await import("@/app/(shell)/changes/page");
  return renderToStaticMarkup((await ChangesSection()) as ReactElement);}
describe("a struggling source costs one read, and a list already in hand beats a spinner", () => {
  beforeEach(() => { calls.ledger = 0; calls.evidence = 0; calls.surface = 0; calls.failSurface = 0; });
  it("a Changes visit buys no ledger read and no decay read of its own", async () => {
    await Promise.all([renderSection(), renderSection()]); expect([calls.ledger, calls.evidence]).toEqual([0, 0]);});
  it("with nothing remembered yet, an unreadable release still refuses to claim a first-ever build", async () => {
    calls.failSurface = 2;
    const { loadChangesView } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data"); const view = await loadChangesView();
    expect([view.releaseUnreadable, view.surfaceBuilding, view.releaseFromMemory]).toEqual([true, false, undefined]);
  }, 15_000);
  it("a release that will not answer twice serves the last list this process read, labelled with its age", async () => {
    const { loadChangesView } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    await loadChangesView();
    calls.surface = 0;
    calls.failSurface = 2;
    const view = await loadChangesView(); expect(calls.surface, "memory beats a second attempt: one failed read, then the remembered list, never a second read while a copy is in hand").toBe(1);
    expect(view.releaseFromMemory, "a remembered list is not a first-ever load").toBe(true); expect(view.releaseUnreadable ?? false).toBe(false);
    expect(view.surfaceComputedAt).toBe(SURFACE.computedAt);
  }, 15_000);
  /** THE SAVED RELEASE IS THE FIRST PAINT (operator, 2026-09-01). A valid committed release existed while the live queue joins, slowed by post-batch research, exceeded the section's one deadline: the operator's own finished work timed out into "This section could not load". The joins now carry their own budget inside the section's; a join that never resolves paints the release's saved rows instead of the error. */
  it("paints the saved release rows inside the section budget while the live queue join hangs forever", async () => {
    calls.serveRows = true; calls.basis = "b1"; calls.hangQueue = true;
    const { loadChangesView } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    const t0 = Date.now();
    const view = await loadChangesView();
    expect([view.proposals.map((p) => p.pagePath), Date.now() - t0 < 6_000], "the saved rows paint, inside the budget, with the queue read still hanging").toEqual([["/wolf"], true]);
    expect((view.ready[0]?.recommendedChange as { after?: string })?.after, "the exact committed copy is what paints").toBe("The saved, committed description from the last release.");
    calls.hangQueue = false; calls.serveRows = false; calls.basis = null;
    expect((await renderSection()).includes('data-delay-reset="true"'), "success clears the path's escalation").toBe(true); // AND A SUCCESSFUL SECTION RENDER CARRIES THE RESET MARKER, so a prior HonestDelay escalation on this path cannot poison the next good render.
  }, 15_000);});
