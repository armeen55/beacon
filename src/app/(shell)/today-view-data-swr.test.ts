/**
 * loadTodayViewWithSwr tenant-threading pins (2026-07-10 hygiene batch, sibling fix
 * to changes-surface-swr.test.ts). Before this fix, `loadTodayView()` took no tenant
 * argument at all, and its after() background rebuild wrote through
 * writeTodaySurface(fresh, iso) with NO tenantId - the write resolved its tenant via
 * json-store's ambient currentTenantSlug(), unreliable outside the render's request
 * scope inside after(). This pins the SAME cold/stale/two-tenant contract
 * loadChangesViewWithSwr already proves, with a cheap injected builder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readTodaySurfaceMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const writeTodaySurfaceMock = vi.fn(async (..._a: unknown[]): Promise<void> => {});
const isTodaySurfaceStaleMock = vi.fn((_iso: string, _now: number): boolean => false);
const afterMock = vi.fn((cb: () => Promise<void>) => cb);

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterMock(cb) }));
vi.mock("./today-surface-store", () => ({
  readTodaySurface: (...a: unknown[]) => readTodaySurfaceMock(...a),
  writeTodaySurface: (...a: unknown[]) => writeTodaySurfaceMock(...a),
  isTodaySurfaceStale: (iso: string, now: number) => isTodaySurfaceStaleMock(iso, now),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-test" }));

import { loadTodayViewWithSwr } from "./today-view-data";
import type { TodayComposite } from "./today-view-data";

const composite = (id: string): TodayComposite =>
  ({ today: { id } as never, daily: null, hasChanges: false }) as unknown as TodayComposite;

beforeEach(() => {
  readTodaySurfaceMock.mockReset();
  readTodaySurfaceMock.mockResolvedValue(null);
  writeTodaySurfaceMock.mockClear();
  isTodaySurfaceStaleMock.mockReset();
  isTodaySurfaceStaleMock.mockReturnValue(false);
  afterMock.mockClear();
});

describe("loadTodayViewWithSwr", () => {
  it("COLD (no snapshot): computes synchronously and persists with the EXPLICIT tenantId", async () => {
    const build = vi.fn(async (t: string) => composite(`built-${t}`));
    const out = await loadTodayViewWithSwr("tenant-a", { build });

    expect((out.today as unknown as { id: string }).id).toBe("built-tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeTodaySurfaceMock).toHaveBeenCalledOnce();
    const [, , tenantIdArg] = writeTodaySurfaceMock.mock.calls[0] as [TodayComposite, string, string];
    expect(tenantIdArg).toBe("tenant-a");
  });

  it("STALE snapshot: serves instantly and schedules ONE background rebuild via after()", async () => {
    const computedAt = "2026-07-10T00:00:00.000Z";
    readTodaySurfaceMock.mockResolvedValue({ computedAt, data: composite("snap") });
    isTodaySurfaceStaleMock.mockReturnValue(true);
    const build = vi.fn(async (t: string) => composite(`built-${t}`));

    const out = await loadTodayViewWithSwr("tenant-a", { build });

    expect((out.today as unknown as { id: string }).id).toBe("snap");
    expect(build).not.toHaveBeenCalled();
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(writeTodaySurfaceMock).toHaveBeenCalledOnce();
    const [, , tenantIdArg] = writeTodaySurfaceMock.mock.calls[0] as [TodayComposite, string, string];
    expect(tenantIdArg).toBe("tenant-a");
  });

  it("FRESH snapshot: serves instantly and schedules NOTHING", async () => {
    readTodaySurfaceMock.mockResolvedValue({ computedAt: "2026-07-10T00:00:00.000Z", data: composite("snap") });
    isTodaySurfaceStaleMock.mockReturnValue(false);
    const build = vi.fn(async (t: string) => composite(`built-${t}`));

    const out = await loadTodayViewWithSwr("tenant-a", { build });

    expect((out.today as unknown as { id: string }).id).toBe("snap");
    expect(afterMock).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("TWO-TENANT: the rebuild reads + builds + persists for the EXACT tenantId, no bleed", async () => {
    const build = vi.fn(async (t: string) => composite(`built-${t}`));
    await loadTodayViewWithSwr("tenant-a", { build });
    await loadTodayViewWithSwr("tenant-b", { build });

    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-b");
    expect(readTodaySurfaceMock).toHaveBeenCalledWith("tenant-a");
    expect(readTodaySurfaceMock).toHaveBeenCalledWith("tenant-b");
    const tenantArgs = writeTodaySurfaceMock.mock.calls.map((c) => c[2]);
    expect(tenantArgs).toEqual(["tenant-a", "tenant-b"]);
  });
});
