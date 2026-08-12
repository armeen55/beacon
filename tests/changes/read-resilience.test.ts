/** A SLOW READ IS NOT AN OUTAGE, AND A RETRY IS NOT A SECOND CONNECTION. Two promises this screen makes when its
 *  sources are struggling: every lane read runs once per account per process no matter how many requests race
 *  into it (the retry that used to pile a second read onto a starved pool), and a release blob that will not
 *  answer serves the last list this process actually read, with its age, instead of a retry spinner over a list
 *  the operator already had. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const calls = vi.hoisted(() => ({ ledger: 0, evidence: 0, surface: 0, failSurface: 0 }));
const SURFACE = vi.hoisted(() => ({
  schemaVersion: 2 as const, releaseId: "t::r1", tenantId: "t",
  computedAt: new Date(Date.now() - 22 * 60_000).toISOString(),
  changes: { proposals: [], ready: [], toDo: [], summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 },
    measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null },
  today: { today: {} },
}));

vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); },
  usePathname: () => "/changes", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/server", async () => ({ ...(await vi.importActual<typeof import("next/server")>("next/server")), after: (fn: () => unknown) => { void fn; } }));
vi.mock("@/lib/tenant-context", async () => ({ ...(await vi.importActual<typeof import("@/lib/tenant-context")>("@/lib/tenant-context")),
  currentTenantId: vi.fn(async () => "t") }));
vi.mock("@/domains/evidence", () => ({
  loadEvidenceSnapshot: vi.fn(async () => { calls.evidence += 1; if (calls.evidence === 1) throw new Error("cold"); return {}; }),
  buildTopicInvestigations: () => [],
  loadGscDecaySignalsForTenant: async () => new Map(),
}));
vi.mock("@/domains/measurement", () => ({
  loadProofLedgerCached: vi.fn(async () => { calls.ledger += 1; await new Promise((r) => setTimeout(r, 80)); return []; }),
}));
vi.mock("@/domains/decision", () => ({
  splitLedgerLifecycle: () => ({ measuring: [], promising: [], won: [], learned: [] }),
  resolveCurrentBasis: async () => null,
  actionableProposalFailures: () => [],
  countLedgerLifecycle: () => ({ measuring: 0, decided: 0 }),
  loadProposalQueue: async () => ({ ranked: [], ready: [], toDo: [], implementedPendingVerification: 0, demotedStaleBasis: 0 }),
  readQueuePage: async () => ({ rows: [], total: 0, nextRank: 0, release: null, more: false, dropped: 0 }),
  stampQueueRanking: async () => true,
}));
vi.mock("@/app/(shell)/surface-release", () => ({
  readCustomerSurface: vi.fn(async () => {
    calls.surface += 1;
    if (calls.failSurface > 0) { calls.failSurface -= 1; throw new Error("release read failed"); }
    return SURFACE;
  }),
  isCustomerSurfaceStale: () => false,
  refreshCustomerSurface: async () => SURFACE,
}));
vi.mock("@/app/(shell)/changes-data", async () => ({
  ...(await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data")),
  loadChangesView: vi.fn(async () => ({ proposals: [], ready: [], toDo: [],
    summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 }, measuringCountCanonical: 0,
    demotedStaleBasis: 0, decidedCountCanonical: 0, readyZeroHint: null, receiptLine: null, surfaceBuilding: false })),
}));

async function renderSection(): Promise<string> {
  const { ChangesSection } = await import("@/app/(shell)/changes/page");
  return renderToStaticMarkup((await ChangesSection()) as ReactElement);
}

describe("a struggling source costs one read, and a list already in hand beats a spinner", () => {
  beforeEach(() => { calls.ledger = 0; calls.evidence = 0; calls.surface = 0; calls.failSurface = 0; });

  it("two requests racing into the same lane read it ONCE, so a deadline can never leave two copies holding the pool", async () => {
    await Promise.all([renderSection(), renderSection()]);
    expect(calls.ledger, "one ledger read per account per process, however many requests race").toBe(1);
  });

  it("the warm second attempt only runs after the first has COMPLETED with a failure, and then it answers", async () => {
    await renderSection();
    expect(calls.evidence, "one failure, then exactly one retry: never a third").toBe(2);
  }, 15_000);

  // ORDER MATTERS HERE: this case must run before anything remembers a release, because "nothing to fall
  // back to" is exactly the state it pins.
  it("with nothing remembered yet, an unreadable release still refuses to claim a first-ever build", async () => {
    calls.failSurface = 2;
    const { loadChangesView } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    const view = await loadChangesView();
    expect([view.releaseUnreadable, view.surfaceBuilding, view.releaseFromMemory]).toEqual([true, false, undefined]);
  }, 15_000);

  it("a release that will not answer twice serves the last list this process read, labelled with its age", async () => {
    const { loadChangesView } = await vi.importActual<typeof import("@/app/(shell)/changes-data")>("@/app/(shell)/changes-data");
    // One good read to remember, then two failures in a row.
    await loadChangesView();
    calls.surface = 0;
    calls.failSurface = 2;
    const view = await loadChangesView();
    expect(calls.surface, "the blob read gets its own deadline and exactly one retry").toBe(2);
    expect(view.releaseFromMemory, "a remembered list is not a first-ever load").toBe(true);
    expect(view.releaseUnreadable ?? false).toBe(false);
    expect(view.surfaceComputedAt).toBe(SURFACE.computedAt);
  }, 15_000);
});
