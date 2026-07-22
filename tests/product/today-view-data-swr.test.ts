/**
 * loadTodayViewWithSwr pins (2026-07-10 hygiene batch; ONE-rebuild-body consolidation
 * 2026-07-21). Today schedules the SAME single release rebuild /changes schedules
 * (refreshCustomerSurface) on stale or cold - never a private today-surface write -
 * so the two routes can never race two concurrent worklist/fuse builds. The customer
 * release is the ONLY persisted Today snapshot (the today-surface shadow blob is
 * retired); a cold tenant composes synchronously once and warms from the release.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readCustomerSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const isCustomerStaleMock = vi.fn((_iso: string, _now: number): boolean => false);
const refreshCustomerSurfaceMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const afterMock = vi.fn((cb: () => Promise<void>) => cb);

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => afterMock(cb) }));
vi.mock("@/app/(shell)/surface-release", () => ({
  readCustomerSurface: (...a: unknown[]) => readCustomerSurfaceMock(...a),
  isCustomerSurfaceStale: (iso: string, now: number) => isCustomerStaleMock(iso, now),
  refreshCustomerSurface: (...a: unknown[]) => refreshCustomerSurfaceMock(...a),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-test" }));

import { loadTodayViewWithSwr, ledgerCountsOf } from "@/app/(shell)/today-view-data";
import type { TodayComposite } from "@/app/(shell)/today-view-data";
import type { ChangesView } from "@/app/(shell)/changes-data";

const composite = (id: string): TodayComposite =>
  ({ today: { id } as never, daily: null, hasChanges: false }) as unknown as TodayComposite;

beforeEach(() => {
  readCustomerSurfaceMock.mockReset();
  readCustomerSurfaceMock.mockResolvedValue(null);
  isCustomerStaleMock.mockReset();
  isCustomerStaleMock.mockReturnValue(false);
  refreshCustomerSurfaceMock.mockReset();
  refreshCustomerSurfaceMock.mockResolvedValue(null);
  afterMock.mockClear();
});

describe("loadTodayViewWithSwr", () => {
  it("COLD (no release): composes synchronously and schedules the release rebuild", async () => {
    const build = vi.fn(async (t: string) => composite(`built-${t}`));
    const out = await loadTodayViewWithSwr("tenant-a", { build });

    expect((out.today as unknown as { id: string }).id).toBe("built-tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(refreshCustomerSurfaceMock).toHaveBeenCalledExactlyOnceWith("tenant-a");
  });

  it("CUSTOMER release FRESH: serves it with releaseId + computedAt, schedules NOTHING", async () => {
    const computedAt = "2026-07-21T00:00:00.000Z";
    readCustomerSurfaceMock.mockResolvedValue({
      schemaVersion: 1,
      releaseId: `tenant-a:${computedAt}`,
      computedAt,
      tenantId: "tenant-a",
      changes: {},
      today: composite("release"),
      newPages: null,
    });
    const build = vi.fn(async (t: string) => composite(`built-${t}`));

    const out = await loadTodayViewWithSwr("tenant-a", { build });

    expect((out.today as unknown as { id: string }).id).toBe("release");
    expect(out.surfaceVersion).toBe(`tenant-a:${computedAt}`);
    expect(out.surfaceComputedAt).toBe(computedAt);
    expect(build).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("CUSTOMER release STALE: serves instantly and schedules ONE release rebuild", async () => {
    readCustomerSurfaceMock.mockResolvedValue({
      schemaVersion: 1,
      releaseId: "tenant-a:r1",
      computedAt: "2026-07-21T00:00:00.000Z",
      tenantId: "tenant-a",
      changes: {},
      today: composite("release"),
      newPages: null,
    });
    isCustomerStaleMock.mockReturnValue(true);
    const build = vi.fn(async (t: string) => composite(`built-${t}`));

    const out = await loadTodayViewWithSwr("tenant-a", { build });

    expect((out.today as unknown as { id: string }).id).toBe("release");
    expect(build).not.toHaveBeenCalled();
    expect(afterMock).toHaveBeenCalledOnce();
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    expect(refreshCustomerSurfaceMock).toHaveBeenCalledExactlyOnceWith("tenant-a");
  });

  it("CUSTOMER release with an epoch-0 invalidation stamp: the date bomb never rides into the composite", async () => {
    readCustomerSurfaceMock.mockResolvedValue({
      schemaVersion: 1,
      releaseId: "tenant-a:stale",
      computedAt: new Date(0).toISOString(),
      tenantId: "tenant-a",
      changes: {},
      today: composite("release"),
      newPages: null,
    });
    isCustomerStaleMock.mockReturnValue(true);

    const out = await loadTodayViewWithSwr("tenant-a");
    expect(out.surfaceComputedAt).toBeUndefined();
  });

  it("TWO-TENANT: each cold compose and scheduled rebuild carries its EXACT tenantId, no bleed", async () => {
    const build = vi.fn(async (t: string) => composite(`built-${t}`));
    await loadTodayViewWithSwr("tenant-a", { build });
    await loadTodayViewWithSwr("tenant-b", { build });
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    await (afterMock.mock.calls[1][0] as () => Promise<void>)();

    expect(build).toHaveBeenCalledWith("tenant-a");
    expect(build).toHaveBeenCalledWith("tenant-b");
    expect(readCustomerSurfaceMock).toHaveBeenCalledWith("tenant-a");
    expect(readCustomerSurfaceMock).toHaveBeenCalledWith("tenant-b");
    expect(refreshCustomerSurfaceMock.mock.calls.map((c) => c[0])).toEqual(["tenant-a", "tenant-b"]);
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
    const SRC = readFileSync(resolve(__dirname, "../../src/app/(shell)/today-view-data.ts"), "utf8");
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});
