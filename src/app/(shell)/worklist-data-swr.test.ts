/**
 * loadSurfaceWithSwr tenant-threading pins (2026-07-10 hygiene batch; store merged
 * into worklist-data.ts by the 2026-07-21 loader consolidation). Before the hygiene
 * fix, the after() background rebuild wrote with NO tenantId, so the write resolved
 * its tenant via json-store's ambient currentTenantSlug() - unreliable outside the
 * render's request scope inside after(). The store functions live in the same module
 * as the loader now, so the pins observe reads/writes one level down at json-store,
 * driving staleness with real computedAt timestamps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readStoreMock = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const writeStoreMock = vi.fn(async (..._a: unknown[]): Promise<void> => {});
const afterMock = vi.fn((cb: () => Promise<void>) => cb);
const recordAppErrorMock = vi.fn(async () => {});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterMock(cb) }));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...a: unknown[]) => readStoreMock(...a),
  writeStore: (...a: unknown[]) => writeStoreMock(...a),
}));
vi.mock("@/lib/obs/error-ledger", () => ({
  recordAppError: (...a: unknown[]) => recordAppErrorMock(...(a as [])),
  errorFieldsFrom: () => ({}),
}));

import { loadSurfaceWithSwr, targetBelongsToTenantDomain, withReadyOverflow, SURFACE_FRESH_MS } from "./worklist-data";
import type { TodayMove, TodayMovesHeroData } from "./today-moves-data";

const surface = (id: string): TodayMovesHeroData =>
  ({
    moves: [{ id } as never],
    stats: {},
    learning: { measuring: 0, won: 0, lost: 0, headline: null },
    cockpit: {},
  }) as unknown as TodayMovesHeroData;

const FRESH_AT = new Date().toISOString();
const STALE_AT = new Date(Date.now() - SURFACE_FRESH_MS - 60_000).toISOString();

const row = (tenantId: string, computedAt: string, data: TodayMovesHeroData) => ({ computedAt, tenantId, data });

beforeEach(() => {
  readStoreMock.mockReset();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
  afterMock.mockClear();
  recordAppErrorMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadSurfaceWithSwr", () => {
  it("COLD (no snapshot): computes synchronously and persists with the EXPLICIT tenantId", async () => {
    const build = vi.fn(async (t: string) => surface(`built-${t}`));
    const out = await loadSurfaceWithSwr("tenant-a", { build });

    expect((out.moves[0] as { id: string }).id).toBe("built-tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [store, rows, opts] = writeStoreMock.mock.calls[0] as unknown as [
      string,
      Array<{ tenantId?: string; data: TodayMovesHeroData }>,
      { tenantId?: string },
    ];
    expect(store).toBe("worklist-surface");
    expect(rows[0]?.tenantId).toBe("tenant-a");
    expect(opts).toEqual({ tenantId: "tenant-a" });
  });

  it("STALE snapshot: serves instantly and schedules ONE background rebuild via after()", async () => {
    readStoreMock.mockResolvedValue([row("tenant-a", STALE_AT, surface("snap"))]);
    const build = vi.fn(async (t: string) => surface(`built-${t}`));

    const out = await loadSurfaceWithSwr("tenant-a", { build });

    expect((out.moves[0] as { id: string }).id).toBe("snap");
    expect(out.surfaceComputedAt).toBe(STALE_AT);
    expect(build).not.toHaveBeenCalled(); // nothing synchronous
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [, rows, opts] = writeStoreMock.mock.calls[0] as unknown as [
      string,
      Array<{ tenantId?: string }>,
      { tenantId?: string },
    ];
    expect(rows[0]?.tenantId).toBe("tenant-a");
    expect(opts).toEqual({ tenantId: "tenant-a" });
  });

  it("FRESH snapshot: serves instantly and schedules NOTHING", async () => {
    readStoreMock.mockResolvedValue([row("tenant-a", FRESH_AT, surface("snap"))]);
    const build = vi.fn(async (t: string) => surface(`built-${t}`));

    const out = await loadSurfaceWithSwr("tenant-a", { build });

    expect((out.moves[0] as { id: string }).id).toBe("snap");
    expect(afterMock).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("MISMATCHED tenant identity on the stored row fails closed and rebuilds", async () => {
    readStoreMock.mockResolvedValue([row("tenant-b", FRESH_AT, surface("wrong-tenant"))]);
    const build = vi.fn(async (t: string) => surface(`built-${t}`));

    const out = await loadSurfaceWithSwr("tenant-a", { build });

    expect((out.moves[0] as { id: string }).id).toBe("built-tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-a");
  });

  it("TWO-TENANT: the rebuild reads + builds + persists for the EXACT tenantId, no bleed", async () => {
    const build = vi.fn(async (t: string) => surface(`built-${t}`));
    await loadSurfaceWithSwr("tenant-a", { build });
    await loadSurfaceWithSwr("tenant-b", { build });

    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-b");
    expect(readStoreMock).toHaveBeenCalledWith("worklist-surface", [], { tenantId: "tenant-a" });
    expect(readStoreMock).toHaveBeenCalledWith("worklist-surface", [], { tenantId: "tenant-b" });
    const tenantArgs = writeStoreMock.mock.calls.map((c) => (c[2] as { tenantId?: string }).tenantId);
    expect(tenantArgs).toEqual(["tenant-a", "tenant-b"]);
  });

  it("a background rebuild failure is recorded and swallowed (the next visit retries)", async () => {
    readStoreMock.mockResolvedValue([row("tenant-a", STALE_AT, surface("snap"))]);
    const build = vi.fn(async () => {
      throw new Error("worklist build wedged");
    });
    await loadSurfaceWithSwr("tenant-a", { build });
    const cb = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(cb()).resolves.toBeUndefined();
    expect(recordAppErrorMock).toHaveBeenCalledOnce();
    expect(writeStoreMock).not.toHaveBeenCalled(); // build-then-write: no write on failure
  });
});

describe("targetBelongsToTenantDomain (P0 tenant-domain guard)", () => {
  it("accepts tenant-local paths, the create sentinel, and same-root URLs", () => {
    expect(targetBelongsToTenantDomain("/persian-recipes", "iranopedia.com")).toBe(true);
    expect(targetBelongsToTenantDomain("needs_new_page", "iranopedia.com")).toBe(true);
    expect(targetBelongsToTenantDomain("https://www.iranopedia.com/x", "iranopedia.com")).toBe(true);
  });
  it("rejects other domains, empty targets, and a missing tenant domain (fail closed)", () => {
    expect(targetBelongsToTenantDomain("https://ritzbuilders.com/x", "iranopedia.com")).toBe(false);
    expect(targetBelongsToTenantDomain("", "iranopedia.com")).toBe(false);
    expect(targetBelongsToTenantDomain("https://iranopedia.com/nowruz", "")).toBe(false);
  });
});

describe("withReadyOverflow (ready rows never fall to the cap)", () => {
  const move = (id: string, ready: boolean): TodayMove =>
    ({ id, preparedChecklist: ready ? { readyToReview: true } : null }) as unknown as TodayMove;

  it("caps to the strongest N and appends ready overflow rows", () => {
    const moves = [move("a", false), move("b", false), move("c", true), move("d", false)];
    const out = withReadyOverflow(moves, 2);
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate a ready row already inside the cap", () => {
    const moves = [move("ready", true), move("b", false), move("c", false)];
    expect(withReadyOverflow(moves, 2).map((m) => m.id)).toEqual(["ready", "b"]);
  });

  it("returns the list unchanged when it fits the cap", () => {
    const moves = [move("a", false), move("b", true)];
    expect(withReadyOverflow(moves, 5).map((m) => m.id)).toEqual(["a", "b"]);
  });
});
