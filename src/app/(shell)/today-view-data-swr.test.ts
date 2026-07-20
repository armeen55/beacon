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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

import { loadTodayViewWithSwr, ledgerCountsOf } from "./today-view-data";
import type { TodayComposite } from "./today-view-data";
import type { ChangesView } from "./changes-data";

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

describe("ledgerCountsOf - the blob writer's canonical mapping (defect A, 2026-07-20)", () => {
  // The production defect: the persisted today-surface blob carried measuring=7,
  // resultsAvailable=0 while the SAME customer-surface release carried
  // measuringCountCanonical=25. Root cause was a pre-fix status-derived count in the
  // then-live code; this pins the mapping the current composition threads into
  // buildTodayView so the divergence can never be reintroduced at this boundary.
  it("threads the canonical ledger pair, never a status-derived count", () => {
    const view = { measuringCountCanonical: 25, decidedCountCanonical: 3 } as unknown as ChangesView;
    expect(ledgerCountsOf(view)).toEqual({ measuring: 25, decided: 3 });
  });
  it("maps decided from decidedCountCanonical, not measuring (no field swap)", () => {
    const view = { measuringCountCanonical: 7, decidedCountCanonical: 0 } as unknown as ChangesView;
    expect(ledgerCountsOf(view)).toEqual({ measuring: 7, decided: 0 });
  });
  it("falls back to 0 on a null view or a pre-FP3 snapshot missing the canonical fields", () => {
    expect(ledgerCountsOf(null)).toEqual({ measuring: 0, decided: 0 });
    expect(ledgerCountsOf({} as unknown as ChangesView)).toEqual({ measuring: 0, decided: 0 });
  });
});

describe("today-view-data - no scheduled/overnight timing claims", () => {
  it("never claims tonight/last night/overnight/nightly timing (Beacon has no scheduler)", () => {
    const SRC = readFileSync(resolve(__dirname, "today-view-data.ts"), "utf8");
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});
