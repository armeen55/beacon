/**
 * Empty-rebuild guard on the worklist SWR surface (FINISHED PRODUCT wave 2, 2026-07-02).
 *
 * Found live: during a Supabase 522 outage the fail-soft rebuild produced a 0-move
 * surface and persisted it over the real snapshot, so the operator's main list rendered
 * empty even after the outage passed. writeWorklistSurface must never let an empty
 * rebuild replace a non-empty snapshot; explicit resets use invalidateWorklistSurface.
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
} from "./worklist-surface-store";
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

  it("invalidateWorklistSurface stays the explicit reset path (writes empty rows)", async () => {
    await invalidateWorklistSurface();
    expect(writeStoreMock).toHaveBeenCalledWith("worklist-surface", []);
  });
});

describe("sibling ambient-tenant fix (2026-07-10 hygiene batch) - explicit tenantId threading", () => {
  it("readWorklistSurface threads the EXPLICIT tenantId into the json-store read, never ambient-only", async () => {
    readStoreMock.mockResolvedValue([]);
    await readWorklistSurface("tenant-a");
    expect(readStoreMock).toHaveBeenCalledWith("worklist-surface", [], { tenantId: "tenant-a" });
  });

  it("writeWorklistSurface threads the EXPLICIT tenantId into the json-store write, never ambient-only", async () => {
    await writeWorklistSurface(surface(7), "2026-07-02T05:00:00.000Z", "tenant-a");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [, , opts] = writeStoreMock.mock.calls[0] as unknown as [string, unknown, { tenantId?: string }];
    expect(opts).toEqual({ tenantId: "tenant-a" });
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
