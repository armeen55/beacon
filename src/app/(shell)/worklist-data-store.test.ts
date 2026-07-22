/**
 * Empty-rebuild guard on the worklist SWR surface (FINISHED PRODUCT wave 2, 2026-07-02;
 * store merged into worklist-data.ts by the 2026-07-21 loader consolidation).
 *
 * Found live: during a Supabase 522 outage the fail-soft rebuild produced a 0-move
 * surface and persisted it over the real snapshot, so the operator's main list rendered
 * empty even after the outage passed. writeWorklistSurface must never let an empty
 * rebuild replace a non-empty snapshot; invalidateWorklistSurface age-stamps (epoch-0
 * computedAt, blob preserved) so the guard's comparison snapshot is never deleted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readStoreMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
const writeStoreMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...args),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));

import {
  readWorklistSurface,
  writeWorklistSurface,
  invalidateWorklistSurface,
} from "./worklist-data";
import type { TodayMovesHeroData } from "./today-moves-data";

function surface(moveCount: number): TodayMovesHeroData {
  return {
    moves: Array.from({ length: moveCount }, (_, i) => ({ id: `m${i}` })),
    stats: {},
    learning: { measuring: 0, won: 0, lost: 0, headline: null },
    cockpit: {},
  } as unknown as TodayMovesHeroData;
}

beforeEach(() => {
  readStoreMock.mockReset();
  writeStoreMock.mockClear();
});

describe("writeWorklistSurface empty-rebuild guard", () => {
  it("refuses to overwrite a non-empty snapshot with an empty rebuild", async () => {
    readStoreMock.mockResolvedValue([
      { computedAt: "2026-07-02T00:00:00.000Z", data: surface(42) },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeWorklistSurface(surface(0), "2026-07-02T05:00:00.000Z");
    expect(writeStoreMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("refusing to overwrite");
    warn.mockRestore();
  });

  it("allows an empty write when no snapshot exists (true cold start)", async () => {
    readStoreMock.mockResolvedValue([]);
    await writeWorklistSurface(surface(0), "2026-07-02T05:00:00.000Z");
    expect(writeStoreMock).toHaveBeenCalledOnce();
  });

  it("allows an empty write over an already-empty snapshot", async () => {
    readStoreMock.mockResolvedValue([
      { computedAt: "2026-07-02T00:00:00.000Z", data: surface(0) },
    ]);
    await writeWorklistSurface(surface(0), "2026-07-02T05:00:00.000Z");
    expect(writeStoreMock).toHaveBeenCalledOnce();
  });

  it("always persists a non-empty rebuild without reading the old snapshot", async () => {
    await writeWorklistSurface(surface(7), "2026-07-02T05:00:00.000Z");
    expect(readStoreMock).not.toHaveBeenCalled();
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [, rows] = writeStoreMock.mock.calls[0] as unknown as [string, Array<{ data: TodayMovesHeroData }>];
    expect(rows[0].data.moves).toHaveLength(7);
  });

  it("invalidateWorklistSurface preserves the last-known-good moves and marks them stale (epoch-0)", async () => {
    readStoreMock.mockResolvedValue([
      { computedAt: "2026-07-02T00:00:00.000Z", tenantId: "tenant-a", data: surface(42) },
    ]);
    await invalidateWorklistSurface("tenant-a");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [, rows, opts] = writeStoreMock.mock.calls[0] as unknown as [
      string,
      Array<{ computedAt: string; tenantId?: string; data: TodayMovesHeroData }>,
      { tenantId?: string },
    ];
    expect(rows[0]?.data.moves).toHaveLength(42);
    expect(rows[0]?.computedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(opts).toEqual({ tenantId: "tenant-a" });
  });

  it("invalidateWorklistSurface leaves a true cold tenant untouched (no write, no empty row)", async () => {
    readStoreMock.mockResolvedValue([]);
    await invalidateWorklistSurface("tenant-cold");
    expect(writeStoreMock).not.toHaveBeenCalled();
  });
});

describe("sibling ambient-tenant fix (2026-07-10 hygiene batch) - explicit tenantId threading", () => {
  it("readWorklistSurface threads the EXPLICIT tenantId into the json-store read, never ambient-only", async () => {
    readStoreMock.mockResolvedValue([]);
    await readWorklistSurface("tenant-a");
    expect(readStoreMock).toHaveBeenCalledWith("worklist-surface", [], { tenantId: "tenant-a" });
  });

  it("rejects legacy and mismatched snapshots for an explicit tenant", async () => {
    readStoreMock.mockResolvedValue([{ computedAt: "old", data: surface(7) }]);
    await expect(readWorklistSurface("tenant-a")).resolves.toBeNull();
    readStoreMock.mockResolvedValue([{ computedAt: "old", tenantId: "tenant-b", data: surface(7) }]);
    await expect(readWorklistSurface("tenant-a")).resolves.toBeNull();
  });

  it("serves only a snapshot carrying the requested tenant identity", async () => {
    readStoreMock.mockResolvedValue([{ computedAt: "fresh", tenantId: "tenant-a", data: surface(7) }]);
    await expect(readWorklistSurface("tenant-a")).resolves.toMatchObject({ tenantId: "tenant-a" });
  });

  it("writeWorklistSurface threads the EXPLICIT tenantId into the json-store write, never ambient-only", async () => {
    await writeWorklistSurface(surface(7), "2026-07-02T05:00:00.000Z", "tenant-a");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [, , opts] = writeStoreMock.mock.calls[0] as unknown as [string, unknown, { tenantId?: string }];
    expect(opts).toEqual({ tenantId: "tenant-a" });
    const rows = writeStoreMock.mock.calls[0][1] as Array<{ tenantId?: string }>;
    expect(rows[0]?.tenantId).toBe("tenant-a");
  });

  it("two tenants never bleed: each write carries its OWN tenantId", async () => {
    await writeWorklistSurface(surface(1), "t1", "tenant-a");
    await writeWorklistSurface(surface(1), "t2", "tenant-b");
    const optsA = writeStoreMock.mock.calls[0][2] as { tenantId?: string };
    const optsB = writeStoreMock.mock.calls[1][2] as { tenantId?: string };
    expect(optsA.tenantId).toBe("tenant-a");
    expect(optsB.tenantId).toBe("tenant-b");
  });
});
