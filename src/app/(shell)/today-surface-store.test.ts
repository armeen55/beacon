/**
 * Explicit-tenantId threading on the Today SWR surface (2026-07-10 hygiene batch,
 * sibling fix to changes-surface-store's P2-f). Before this fix, readTodaySurface/
 * writeTodaySurface took no tenant argument at all and resolved purely through
 * json-store's ambient currentTenantSlug() - unsafe for today-view-data.ts's after()
 * background rebuild (and the nightly refreshTodaySurface entry), which already know
 * the exact tenant they mean and must never let ambient resolution disagree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readStoreMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
const writeStoreMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...args),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));

import { readTodaySurface, writeTodaySurface, invalidateTodaySurface } from "./today-surface-store";
import type { TodayComposite } from "./today-view-data";

function composite(): TodayComposite {
  return { today: { cards: [] } as never, daily: null, hasChanges: false };
}

beforeEach(() => {
  readStoreMock.mockReset();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
});

describe("explicit tenantId threading", () => {
  it("readTodaySurface threads the EXPLICIT tenantId into the json-store read", async () => {
    await readTodaySurface("tenant-a");
    expect(readStoreMock).toHaveBeenCalledWith("today-surface", [], { tenantId: "tenant-a" });
  });

  it("writeTodaySurface threads the EXPLICIT tenantId into the json-store write", async () => {
    await writeTodaySurface(composite(), "2026-07-10T05:00:00.000Z", "tenant-a");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [store, , opts] = writeStoreMock.mock.calls[0] as unknown as [string, unknown, { tenantId?: string }];
    expect(store).toBe("today-surface");
    expect(opts).toEqual({ tenantId: "tenant-a" });
  });

  it("two tenants never bleed: each write carries its OWN tenantId", async () => {
    await writeTodaySurface(composite(), "t1", "tenant-a");
    await writeTodaySurface(composite(), "t2", "tenant-b");
    const optsA = writeStoreMock.mock.calls[0][2] as { tenantId?: string };
    const optsB = writeStoreMock.mock.calls[1][2] as { tenantId?: string };
    expect(optsA.tenantId).toBe("tenant-a");
    expect(optsB.tenantId).toBe("tenant-b");
  });

  it("invalidateTodaySurface stays the explicit reset path (writes empty rows)", async () => {
    await invalidateTodaySurface();
    expect(writeStoreMock).toHaveBeenCalledWith("today-surface", []);
  });
});
