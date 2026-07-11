/**
 * loadSurfaceWithSwr tenant-threading pins (2026-07-10 hygiene batch, sibling fix to
 * changes-surface-swr.test.ts). Before this fix, the after() background rebuild wrote
 * through writeWorklistSurface(fresh, iso) with NO tenantId, so the write resolved
 * its tenant via json-store's ambient currentTenantSlug() - unreliable outside the
 * render's request scope inside after(). This pins the SAME cold/stale/two-tenant
 * contract loadChangesViewWithSwr already proves, with a cheap injected builder
 * (never the real ~32s ActionPack/demand-graph compute).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readWorklistSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const writeWorklistSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<void> => {});
const isSurfaceStaleMock = vi.fn((_iso: string, _now: number): boolean => false);
const afterMock = vi.fn((cb: () => Promise<void>) => cb);
const recordAppErrorMock = vi.fn(async () => {});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterMock(cb) }));
vi.mock("../worklist-surface-store", () => ({
  readWorklistSurface: (...a: unknown[]) => readWorklistSurfaceMock(...a),
  writeWorklistSurface: (...a: unknown[]) => writeWorklistSurfaceMock(...a),
  isSurfaceStale: (iso: string, now: number) => isSurfaceStaleMock(iso, now),
}));
vi.mock("@/lib/obs/error-ledger", () => ({
  recordAppError: (...a: unknown[]) => recordAppErrorMock(...(a as [])),
  errorFieldsFrom: () => ({}),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-test" }));

import { loadSurfaceWithSwr } from "./moves-data";
import type { TodayMovesHeroData } from "../today-moves-data";

const surface = (id: string): TodayMovesHeroData =>
  ({
    moves: [{ id } as never],
    stats: {},
    learning: { measuring: 0, won: 0, lost: 0, headline: null },
    cockpit: {},
  }) as unknown as TodayMovesHeroData;

beforeEach(() => {
  readWorklistSurfaceMock.mockReset();
  readWorklistSurfaceMock.mockResolvedValue(null);
  writeWorklistSurfaceMock.mockClear();
  isSurfaceStaleMock.mockReset();
  isSurfaceStaleMock.mockReturnValue(false);
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
    expect(writeWorklistSurfaceMock).toHaveBeenCalledOnce();
    const [, , tenantIdArg] = writeWorklistSurfaceMock.mock.calls[0] as [TodayMovesHeroData, string, string];
    expect(tenantIdArg).toBe("tenant-a");
  });

  it("STALE snapshot: serves instantly and schedules ONE background rebuild via after()", async () => {
    const computedAt = "2026-07-10T00:00:00.000Z";
    readWorklistSurfaceMock.mockResolvedValue({ computedAt, data: surface("snap") });
    isSurfaceStaleMock.mockReturnValue(true);
    const build = vi.fn(async (t: string) => surface(`built-${t}`));

    const out = await loadSurfaceWithSwr("tenant-a", { build });

    expect((out.moves[0] as { id: string }).id).toBe("snap");
    expect(build).not.toHaveBeenCalled(); // nothing synchronous
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeWorklistSurfaceMock).toHaveBeenCalledOnce();
    const [, , tenantIdArg] = writeWorklistSurfaceMock.mock.calls[0] as [TodayMovesHeroData, string, string];
    expect(tenantIdArg).toBe("tenant-a");
  });

  it("FRESH snapshot: serves instantly and schedules NOTHING", async () => {
    readWorklistSurfaceMock.mockResolvedValue({ computedAt: "2026-07-10T00:00:00.000Z", data: surface("snap") });
    isSurfaceStaleMock.mockReturnValue(false);
    const build = vi.fn(async (t: string) => surface(`built-${t}`));

    const out = await loadSurfaceWithSwr("tenant-a", { build });

    expect((out.moves[0] as { id: string }).id).toBe("snap");
    expect(afterMock).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("TWO-TENANT: the rebuild reads + builds + persists for the EXACT tenantId, no bleed", async () => {
    const build = vi.fn(async (t: string) => surface(`built-${t}`));
    await loadSurfaceWithSwr("tenant-a", { build });
    await loadSurfaceWithSwr("tenant-b", { build });

    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-b");
    expect(readWorklistSurfaceMock).toHaveBeenCalledWith("tenant-a");
    expect(readWorklistSurfaceMock).toHaveBeenCalledWith("tenant-b");
    const tenantArgs = writeWorklistSurfaceMock.mock.calls.map((c) => c[2]);
    expect(tenantArgs).toEqual(["tenant-a", "tenant-b"]);
  });

  it("a background rebuild failure is recorded and swallowed (the next visit retries)", async () => {
    readWorklistSurfaceMock.mockResolvedValue({ computedAt: "old", data: surface("snap") });
    isSurfaceStaleMock.mockReturnValue(true);
    const build = vi.fn(async () => {
      throw new Error("worklist build wedged");
    });
    await loadSurfaceWithSwr("tenant-a", { build });
    const cb = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(cb()).resolves.toBeUndefined();
    expect(recordAppErrorMock).toHaveBeenCalledOnce();
    expect(writeWorklistSurfaceMock).not.toHaveBeenCalled(); // build-then-write: no write on failure
  });
});
