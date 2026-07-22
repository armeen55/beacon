/**
 * /changes SWR snapshot flow (W2-B, 2026-07-10; ONE-rebuild-body consolidation 2026-07-21).
 *
 * Pins the loadChangesViewWithSwr contract:
 *   - COLD (no customer release): NEVER blocks - serves the honest
 *     `surfaceBuilding` empty state and schedules ONE refreshCustomerSurface.
 *   - CUSTOMER release present: serves it instantly (releaseId + sanitized
 *     computedAt); stale schedules ONE refreshCustomerSurface; fresh schedules nothing.
 *   - The customer release is the ONLY snapshot (the changes-surface shadow blob is
 *     retired); the old private rebuild lane is gone - that dual lane could race TWO
 *     concurrent worklist/fuse builds, the documented Ready-zeroing load pattern.
 *   - Epoch-0 invalidation stamps are sanitized out of surfaceComputedAt.
 *   - A rebuild failure is recorded and swallowed (the next visit retries).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readCustomerSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const isCustomerStaleMock = vi.fn((_iso: string, _now: number): boolean => false);
const refreshCustomerSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const afterMock = vi.fn((cb: () => Promise<void>) => cb);
const recordAppErrorMock = vi.fn(async () => {});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterMock(cb) }));
vi.mock("./surface-release", () => ({
  readCustomerSurface: (...a: unknown[]) => readCustomerSurfaceMock(...a),
  isCustomerSurfaceStale: (iso: string, now: number) => isCustomerStaleMock(iso, now),
  refreshCustomerSurface: (...a: unknown[]) => refreshCustomerSurfaceMock(...a),
}));
vi.mock("@/lib/obs/error-ledger", () => ({
  recordAppError: (...a: unknown[]) => recordAppErrorMock(...(a as [])),
  errorFieldsFrom: () => ({}),
}));
// currentTenantId is only used by the react.cache wrapper (not exercised here).
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-test" }));

import { loadChangesViewWithSwr } from "./changes-data";
import type { ChangesView } from "./changes-data";

const view = (id: string): ChangesView =>
  ({
    changes: [{ id } as never],
    movesById: {},
    summary: { todo: 1, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false,
    planAccepted: false,
    readyZeroHint: null,
    measuringCountCanonical: 0,
    decidedCountCanonical: 0,
    suppressedRowsNote: null,
    expiredSubline: null,
    receiptLine: null,
    readyCount: 0,
    shippedThisWeekCount: 0,
    watching: [],
  }) as ChangesView;

const release = (id: string, computedAt: string) => ({
  schemaVersion: 1,
  releaseId: `tenant-a:${computedAt}`,
  computedAt,
  tenantId: "tenant-a",
  changes: view(id),
  today: { today: {}, daily: null, hasChanges: true },
  newPages: null,
});

beforeEach(() => {
  readCustomerSurfaceMock.mockReset();
  readCustomerSurfaceMock.mockResolvedValue(null);
  isCustomerStaleMock.mockReset();
  isCustomerStaleMock.mockReturnValue(false);
  refreshCustomerSurfaceMock.mockReset();
  refreshCustomerSurfaceMock.mockResolvedValue(null);
  afterMock.mockClear();
  recordAppErrorMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadChangesViewWithSwr", () => {
  it("COLD (no release): serves the honest building empty state and schedules the release rebuild - never blocks", async () => {
    const out = await loadChangesViewWithSwr("tenant-a");

    expect(out.changes).toEqual([]);
    expect(out.surfaceBuilding).toBe(true);
    expect(out.surfaceComputedAt).toBeNull();
    // Nothing heavy ran synchronously on the cold GET.
    expect(refreshCustomerSurfaceMock).not.toHaveBeenCalled();
    // Exactly one background rebuild scheduled; running it calls THE one body.
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(refreshCustomerSurfaceMock).toHaveBeenCalledExactlyOnceWith("tenant-a");
  });

  it("CUSTOMER release FRESH: serves it instantly with releaseId + computedAt, schedules NOTHING", async () => {
    const computedAt = "2026-07-21T00:00:00.000Z";
    readCustomerSurfaceMock.mockResolvedValue(release("rel", computedAt));

    const out = await loadChangesViewWithSwr("tenant-a");

    expect((out.changes[0] as { id: string }).id).toBe("rel");
    expect(out.surfaceComputedAt).toBe(computedAt);
    expect(out.surfaceBuilding).toBe(false);
    expect(out.surfaceVersion).toBe(`tenant-a:${computedAt}`);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("CUSTOMER release STALE: serves instantly and schedules ONE refreshCustomerSurface", async () => {
    readCustomerSurfaceMock.mockResolvedValue(release("rel", "2026-07-21T00:00:00.000Z"));
    isCustomerStaleMock.mockReturnValue(true);

    const out = await loadChangesViewWithSwr("tenant-a");

    expect((out.changes[0] as { id: string }).id).toBe("rel");
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(refreshCustomerSurfaceMock).toHaveBeenCalledExactlyOnceWith("tenant-a");
  });

  it("EPOCH-0 invalidation stamp on the release never leaks to the age line (sanitized to null)", async () => {
    readCustomerSurfaceMock.mockResolvedValue(release("rel", new Date(0).toISOString()));
    isCustomerStaleMock.mockReturnValue(true);

    const out = await loadChangesViewWithSwr("tenant-a");

    expect((out.changes[0] as { id: string }).id).toBe("rel");
    expect(out.surfaceComputedAt).toBeNull();
  });

  it("TWO-TENANT: each scheduled rebuild carries its EXACT tenantId (explicit threading, no bleed)", async () => {
    await loadChangesViewWithSwr("tenant-a");
    await loadChangesViewWithSwr("tenant-b");
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    await (afterMock.mock.calls[1][0] as () => Promise<void>)();

    expect(refreshCustomerSurfaceMock.mock.calls.map((c) => c[0])).toEqual(["tenant-a", "tenant-b"]);
  });

  it("a background rebuild failure is recorded and swallowed (the next visit retries)", async () => {
    refreshCustomerSurfaceMock.mockRejectedValue(new Error("fuse wedged"));
    await loadChangesViewWithSwr("tenant-a");
    const cb = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(cb()).resolves.toBeUndefined();
    expect(recordAppErrorMock).toHaveBeenCalledOnce();
  });
});

describe("ONE rebuild body (loader consolidation, 2026-07-21)", () => {
  it("changes-data.ts holds no private rebuild lane - the only single-flight key is the customer release's", () => {
    const changesSource = readFileSync(resolve(__dirname, "changes-data.ts"), "utf8");
    const refreshSource = readFileSync(resolve(__dirname, "surface-release.ts"), "utf8");

    // The dual-lane bug: a stale changes-surface used to schedule its own
    // "changes-surface:{t}" single-flight beside "customer-surface:{t}",
    // letting one request pair run two concurrent worklist/fuse builds.
    expect(changesSource).not.toContain("changes-surface:${");
    expect(changesSource).not.toContain("runSingleFlight");
    expect(refreshSource).toContain("customer-surface:${tenantId}");
  });
});

describe("Changes background rebuild tenant-source wiring", () => {
  it("passes the explicit tenant through every ambient-capable source", () => {
    const changesSource = readFileSync(resolve(__dirname, "changes-data.ts"), "utf8");
    const worklistSource = readFileSync(resolve(__dirname, "worklist-data.ts"), "utf8");

    expect(changesSource).toContain("loadSurfaceWithSwr(tenantId)");
    expect(changesSource).toContain("buildNewPagesData(tenantId)");
    expect(changesSource).not.toContain("loadMovesWorklist()");
    expect(changesSource).not.toContain("loadNewPagesData()");

    expect(worklistSource).toContain("buildTodayMovesData(tenantId, { limit: 60 })");
    expect(worklistSource).toContain("getCompetitorAuditsForTenantId(tenantId)");
    expect(worklistSource).not.toContain("loadTodayMovesHeroData({ limit: 60 })");
  });
});
