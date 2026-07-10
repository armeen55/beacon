/**
 * load-ledger --- P0-B Wave 1 GET-GUARD pins.
 *
 * The proof ledger is the shared read that /results, /changes, and Today all funnel
 * through. These tests pin the hard rule that a page GET/render must never pay, hit a
 * live SERP, or run an unbounded full-ledger re-measure:
 *   1) loadProofLedger (the heavy engine used by the background rebuild) passes
 *      allowRankRecheck=false to measureRecord --- so NO paid live-SERP rank re-check
 *      fires from a ledger rebuild. (run-measurement.test.ts already proves false skips
 *      the SERP module; this proves the ledger passes false.)
 *   2) loadProofLedgerPersisted (the render-safe read) serves the stored verdicts with
 *      ZERO measureRecord / ZERO GSC re-read --- bounded to one store read.
 *   3) loadProofLedgerCached (THE render entry) serves the persisted SWR surface and
 *      never re-measures on the GET, passing the tenant through unchanged (two-tenant
 *      isolation at the seam this change touches).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadShippedChangesMock = vi.fn(async (): Promise<unknown[]> => []);
const measureRecordMock = vi.fn(async (...args: unknown[]): Promise<unknown> => args[1]);
const readLastFinalizedDateMock = vi.fn(async (_t: string): Promise<string | null> => "2026-07-01");
const loadDetectedChangepointsMock = vi.fn(async (): Promise<unknown[]> => []);
const activeTreatmentPathsMock = vi.fn((): Set<string> => new Set());
const loadLedgerWithSwrMock = vi.fn(async (tenantId: string): Promise<{ ledger: unknown[]; computedAt: string }> => ({
  ledger: [{ id: `snap-${tenantId}` }],
  computedAt: new Date().toISOString(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./shipped-change-store", () => ({
  loadShippedChanges: () => loadShippedChangesMock(),
}));
vi.mock("./run-measurement", () => ({
  measureRecord: (...args: unknown[]) => measureRecordMock(...args),
}));
vi.mock("./gsc-window", () => ({
  readLastFinalizedDate: (t: string) => readLastFinalizedDateMock(t),
}));
vi.mock("./algorithm-weather", () => ({
  buildShockWindows: () => [],
}));
vi.mock("./algorithm-weather-store", () => ({
  loadDetectedChangepoints: () => loadDetectedChangepointsMock(),
}));
vi.mock("./fdr-adjust", () => ({
  attachFdrToLedger: (rows: unknown[]) => rows,
}));
vi.mock("@/domains/experiments/experiment-eligibility", () => ({
  activeTreatmentPaths: () => activeTreatmentPathsMock(),
}));
// The render entry delegates to the /results SWR surface reader (last persisted state).
vi.mock("@/app/(shell)/results/results-ledger-data", () => ({
  loadLedgerWithSwr: (tenantId: string) => loadLedgerWithSwrMock(tenantId),
}));

import { loadProofLedger, loadProofLedgerPersisted, loadProofLedgerCached } from "./load-ledger";

const rec = (id: string) => ({ id, path: `/${id}`, page: `https://s.com/${id}`, controlPages: [], windows: [], verdict: "measuring", shippedAt: "2026-06-01", measuredAt: null });

beforeEach(() => {
  loadShippedChangesMock.mockReset();
  loadShippedChangesMock.mockResolvedValue([rec("a"), rec("b")]);
  measureRecordMock.mockReset();
  measureRecordMock.mockImplementation(async (...args: unknown[]) => args[1]);
  readLastFinalizedDateMock.mockClear();
  loadDetectedChangepointsMock.mockClear();
  activeTreatmentPathsMock.mockClear();
  loadLedgerWithSwrMock.mockClear();
});

describe("loadProofLedger --- heavy engine is paid-free", () => {
  it("passes allowRankRecheck=false to measureRecord (no paid live-SERP from a ledger rebuild)", async () => {
    await loadProofLedger("tenant-a");
    expect(measureRecordMock).toHaveBeenCalledTimes(2);
    for (const call of measureRecordMock.mock.calls) {
      // signature: measureRecord(tenantId, record, now, lastFinal, excludeControls, allowRankRecheck, shockWindows)
      expect(call[5]).toBe(false);
    }
  });

  it("returns [] without measuring when there are no shipped changes", async () => {
    loadShippedChangesMock.mockResolvedValue([]);
    const out = await loadProofLedger("tenant-a");
    expect(out).toEqual([]);
    expect(measureRecordMock).not.toHaveBeenCalled();
  });
});

describe("loadProofLedgerPersisted --- render-safe read never re-measures", () => {
  it("serves the stored records with ZERO measureRecord and ZERO GSC re-read", async () => {
    const out = await loadProofLedgerPersisted("tenant-a");
    expect((out as Array<{ id: string }>).map((r) => r.id)).toEqual(["a", "b"]);
    expect(measureRecordMock).not.toHaveBeenCalled();
    expect(readLastFinalizedDateMock).not.toHaveBeenCalled();
  });

  it("fails soft to [] when the store read throws", async () => {
    loadShippedChangesMock.mockRejectedValue(new Error("supabase wedged"));
    await expect(loadProofLedgerPersisted("tenant-a")).resolves.toEqual([]);
    expect(measureRecordMock).not.toHaveBeenCalled();
  });
});

describe("loadProofLedgerCached --- the render entry serves persisted state, no GET re-measure", () => {
  it("delegates to the persisted SWR surface and never calls measureRecord", async () => {
    const out = await loadProofLedgerCached("tenant-a");
    expect(loadLedgerWithSwrMock).toHaveBeenCalledWith("tenant-a");
    expect((out as Array<{ id: string }>).map((r) => r.id)).toEqual(["snap-tenant-a"]);
    expect(measureRecordMock).not.toHaveBeenCalled();
  });

  it("passes the tenant through unchanged for two tenants (no cross-tenant bleed at this seam)", async () => {
    const a = (await loadProofLedgerCached("tenant-a")) as Array<{ id: string }>;
    const b = (await loadProofLedgerCached("tenant-b")) as Array<{ id: string }>;
    expect(a.map((r) => r.id)).toEqual(["snap-tenant-a"]);
    expect(b.map((r) => r.id)).toEqual(["snap-tenant-b"]);
    expect(loadLedgerWithSwrMock).toHaveBeenNthCalledWith(1, "tenant-a");
    expect(loadLedgerWithSwrMock).toHaveBeenNthCalledWith(2, "tenant-b");
    expect(measureRecordMock).not.toHaveBeenCalled();
  });

  it("falls back to the stored verdicts (still no re-measure) if the surface reader throws", async () => {
    loadLedgerWithSwrMock.mockRejectedValueOnce(new Error("surface down"));
    const out = (await loadProofLedgerCached("tenant-a")) as Array<{ id: string }>;
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(measureRecordMock).not.toHaveBeenCalled();
  });
});
