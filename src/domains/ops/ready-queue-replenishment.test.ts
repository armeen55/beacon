import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/single-flight", () => ({ runSingleFlight: async (_key: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: async (_id: string, fn: () => Promise<unknown>) => fn() }));

const prepare = vi.fn();
const readSurface = vi.fn();
const refreshSurface = vi.fn();

vi.mock("@/app/(shell)/surface-release", () => ({
  readCustomerSurface: (...args: unknown[]) => readSurface(...args),
  refreshCustomerSurface: (...args: unknown[]) => refreshSurface(...args),
}));
vi.mock("@/domains/demand-graph/prepare-today-moves", () => ({ prepareTodayMovesForTenant: (...args: unknown[]) => prepare(...args) }));

import { READY_QUEUE_MAX_USD, READY_QUEUE_TARGET, replenishReadyQueueForTenant } from "./ready-queue-replenishment";

function surface(ready: number, rankedPreparationEntries: unknown[] = [{ id: "ranked-1" }]) {
  return { changes: { summary: { ready }, rankedPreparationEntries } };
}

describe("replenishReadyQueueForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepare.mockResolvedValue({ prepared: 2, cached: 3 });
  });

  it("does nothing when five quality-ready changes already exist", async () => {
    readSurface.mockResolvedValue(surface(5));
    const result = await replenishReadyQueueForTenant("tenant-a");
    expect(result).toEqual({ readyBefore: 5, readyAfter: 5, prepared: 0, cached: 0, skipped: true });
    expect(refreshSurface).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reranks, prepares against the exact customer order, and atomically republishes", async () => {
    const ranked = [{ id: "ranked-2" }];
    readSurface.mockResolvedValue(surface(2));
    refreshSurface.mockResolvedValueOnce(surface(2, ranked)).mockResolvedValueOnce(surface(5, ranked));
    const result = await replenishReadyQueueForTenant("tenant-a");
    expect(refreshSurface).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledWith("tenant-a", {
      maxN: READY_QUEUE_TARGET,
      maxUsd: READY_QUEUE_MAX_USD,
      maxNewDrafts: 3,
      regenerateRejected: false,
      checkWinnability: false,
      rankedEntries: ranked,
    });
    expect(result).toEqual({ readyBefore: 2, readyAfter: 5, prepared: 2, cached: 3, skipped: false });
  });

  it("recovers a cold customer surface before calculating the refill", async () => {
    readSurface.mockResolvedValue(null);
    refreshSurface.mockResolvedValueOnce(surface(1)).mockResolvedValueOnce(surface(4));
    const result = await replenishReadyQueueForTenant("tenant-cold");
    expect(result.readyBefore).toBe(1);
    expect(result.readyAfter).toBe(4);
  });

  it("scans past a long held prefix instead of capping maintenance to the first few rows", async () => {
    const ranked = Array.from({ length: 42 }, (_, index) => ({ id: `ranked-${index}` }));
    readSurface.mockResolvedValue(surface(4));
    refreshSurface.mockResolvedValueOnce(surface(4, ranked)).mockResolvedValueOnce(surface(5, ranked));

    await replenishReadyQueueForTenant("tenant-long-queue");

    expect(prepare).toHaveBeenCalledWith("tenant-long-queue", expect.objectContaining({
      maxN: 42,
      maxNewDrafts: 1,
      rankedEntries: ranked,
    }));
  });
});
