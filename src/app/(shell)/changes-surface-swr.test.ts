/**
 * /changes SWR snapshot flow (W2-B, 2026-07-10).
 *
 * Pins the loadChangesViewWithSwr contract with a cheap injected builder (never the
 * real ~14s fuse):
 *   - COLD (no snapshot): NEVER blocks - serves the honest `surfaceBuilding` empty
 *     state and schedules ONE background rebuild via after().
 *   - STALE snapshot: serves instantly with its computedAt (staleness label) and
 *     schedules ONE background rebuild.
 *   - FRESH snapshot: serves instantly, schedules nothing.
 *   - SINGLE-FLIGHT: two concurrent stale readers -> exactly ONE rebuild.
 *   - TWO-TENANT: the rebuild builds for the EXACT tenantId (explicit threading).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readChangesSurfaceMock = vi.fn(async (): Promise<unknown> => null);
const writeChangesSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<void> => {});
const isStaleMock = vi.fn((_iso: string, _now: number): boolean => false);
const afterMock = vi.fn((cb: () => Promise<void>) => cb);
const recordAppErrorMock = vi.fn(async () => {});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterMock(cb) }));
vi.mock("./changes-surface-store", () => ({
  readChangesSurface: () => readChangesSurfaceMock(),
  writeChangesSurface: (...a: unknown[]) => writeChangesSurfaceMock(...a),
  isChangesSurfaceStale: (iso: string, now: number) => isStaleMock(iso, now),
}));
vi.mock("@/lib/obs/error-ledger", () => ({
  recordAppError: (...a: unknown[]) => recordAppErrorMock(...(a as [])),
  errorFieldsFrom: () => ({}),
}));
// currentTenantId is only used by the react.cache wrapper (not exercised here).
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-test" }));

import { loadChangesViewWithSwr } from "./changes-data";
import type { ChangesView } from "./changes-data";
import { __resetSingleFlightForTests } from "@/lib/single-flight";

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

beforeEach(() => {
  readChangesSurfaceMock.mockReset();
  readChangesSurfaceMock.mockResolvedValue(null);
  writeChangesSurfaceMock.mockClear();
  isStaleMock.mockReset();
  isStaleMock.mockReturnValue(false);
  afterMock.mockClear();
  recordAppErrorMock.mockClear();
  __resetSingleFlightForTests();
});

afterEach(() => {
  __resetSingleFlightForTests();
});

describe("loadChangesViewWithSwr", () => {
  it("COLD (no snapshot): serves the honest building empty state and schedules a rebuild - never blocks", async () => {
    const build = vi.fn(async (t: string) => view(`built-${t}`));
    const out = await loadChangesViewWithSwr("tenant-a", { build });

    expect(out.changes).toEqual([]);
    expect(out.surfaceBuilding).toBe(true);
    expect(out.surfaceComputedAt).toBeNull();
    // The heavy build did NOT run synchronously on the cold GET.
    expect(build).not.toHaveBeenCalled();
    // Exactly one background rebuild scheduled; running it builds + persists.
    expect(afterMock).toHaveBeenCalledOnce();
    const cb = afterMock.mock.calls[0][0] as () => Promise<void>;
    await cb();
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeChangesSurfaceMock).toHaveBeenCalledOnce();
  });

  it("STALE snapshot: serves instantly with its computedAt and schedules ONE background rebuild", async () => {
    const computedAt = "2026-07-10T00:00:00.000Z";
    readChangesSurfaceMock.mockResolvedValue({ computedAt, view: view("snap") });
    isStaleMock.mockReturnValue(true);
    const build = vi.fn(async (t: string) => view(`built-${t}`));

    const out = await loadChangesViewWithSwr("tenant-a", { build });

    expect((out.changes[0] as { id: string }).id).toBe("snap");
    expect(out.surfaceComputedAt).toBe(computedAt);
    expect(out.surfaceBuilding).toBe(false);
    expect(build).not.toHaveBeenCalled(); // nothing synchronous
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeChangesSurfaceMock).toHaveBeenCalledOnce();
  });

  it("FRESH snapshot: serves instantly and schedules NOTHING", async () => {
    readChangesSurfaceMock.mockResolvedValue({ computedAt: "2026-07-10T00:00:00.000Z", view: view("snap") });
    isStaleMock.mockReturnValue(false);
    const build = vi.fn(async (t: string) => view(`built-${t}`));

    const out = await loadChangesViewWithSwr("tenant-a", { build });

    expect((out.changes[0] as { id: string }).id).toBe("snap");
    expect(afterMock).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("SINGLE-FLIGHT: two concurrent stale readers trigger exactly ONE rebuild", async () => {
    readChangesSurfaceMock.mockResolvedValue({ computedAt: "old", view: view("snap") });
    isStaleMock.mockReturnValue(true);
    let resolveBuild!: (v: ChangesView) => void;
    const build = vi.fn(
      (_t: string) =>
        new Promise<ChangesView>((res) => {
          resolveBuild = res;
        }),
    );

    await loadChangesViewWithSwr("tenant-a", { build });
    await loadChangesViewWithSwr("tenant-a", { build });
    const cb1 = afterMock.mock.calls[0][0] as () => Promise<void>;
    const cb2 = afterMock.mock.calls[1][0] as () => Promise<void>;

    // Fire both scheduled rebuilds concurrently: single-flight collapses them to one.
    const p = Promise.all([cb1(), cb2()]);
    expect(build).toHaveBeenCalledTimes(1);
    resolveBuild(view("built"));
    await p;
    expect(writeChangesSurfaceMock).toHaveBeenCalledTimes(1);
  });

  it("TWO-TENANT: the rebuild builds for the EXACT tenantId (explicit threading, no bleed)", async () => {
    const build = vi.fn(async (t: string) => view(`built-${t}`));
    await loadChangesViewWithSwr("tenant-a", { build });
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    __resetSingleFlightForTests();
    await loadChangesViewWithSwr("tenant-b", { build });
    await (afterMock.mock.calls[1][0] as () => Promise<void>)();

    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-b");
    // Each persisted view was built for its own tenant.
    const firstView = writeChangesSurfaceMock.mock.calls[0][0] as ChangesView;
    const secondView = writeChangesSurfaceMock.mock.calls[1][0] as ChangesView;
    expect((firstView.changes[0] as { id: string }).id).toBe("built-tenant-a");
    expect((secondView.changes[0] as { id: string }).id).toBe("built-tenant-b");
  });

  // P2-f (2026-07-10, visual audit) - the after() rebuild already threads tenantId
  // explicitly into build(tenantId); the write must carry the SAME explicit tenantId
  // (never fall back to json-store's ambient currentTenantSlug() resolution, which is
  // not guaranteed correct outside the render's request scope inside after()).
  it("P2-f: writeChangesSurface is called with the EXPLICIT tenantId as its third argument", async () => {
    const build = vi.fn(async (t: string) => view(`built-${t}`));
    await loadChangesViewWithSwr("tenant-a", { build });
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();

    expect(writeChangesSurfaceMock).toHaveBeenCalledOnce();
    const [, , tenantIdArg] = writeChangesSurfaceMock.mock.calls[0] as [ChangesView, string, string];
    expect(tenantIdArg).toBe("tenant-a");
  });

  it("a background rebuild failure is recorded and swallowed (the next visit retries)", async () => {
    const build = vi.fn(async () => {
      throw new Error("fuse wedged");
    });
    await loadChangesViewWithSwr("tenant-a", { build });
    const cb = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(cb()).resolves.toBeUndefined();
    expect(recordAppErrorMock).toHaveBeenCalledOnce();
    expect(writeChangesSurfaceMock).not.toHaveBeenCalled(); // build-then-write: no write on failure
  });
});
