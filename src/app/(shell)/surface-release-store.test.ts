import { beforeEach, describe, expect, it, vi } from "vitest";

const readStoreMock = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
const writeStoreMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...args),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "tenant-a" }));

const invalidateWorklistMock = vi.fn(async (_t?: string) => {});
vi.mock("./worklist-data", () => ({
  invalidateWorklistSurface: (t?: string) => invalidateWorklistMock(t),
}));

import {
  invalidateCoreSurfaces,
  CUSTOMER_SURFACE_FRESH_MS,
  invalidateCustomerSurface,
  isCustomerSurfaceStale,
  readCustomerSurface,
  writeCustomerSurface,
  type CustomerSurface,
} from "./surface-release";

function surface(over: Partial<CustomerSurface> = {}): CustomerSurface {
  return {
    schemaVersion: 1,
    releaseId: "tenant-a:release-1",
    computedAt: "2026-07-15T12:00:00.000Z",
    tenantId: "tenant-a",
    changes: { changes: [{ id: "change-1" }] } as never,
    today: { today: { cards: [] } as never, daily: null, hasChanges: true },
    newPages: null,
    ...over,
  };
}

beforeEach(() => {
  readStoreMock.mockReset();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
});

describe("atomic customer surface", () => {
  it("serves only a complete matching tenant release", async () => {
    readStoreMock.mockResolvedValue([surface()]);
    await expect(readCustomerSurface("tenant-a")).resolves.toMatchObject({ releaseId: "tenant-a:release-1" });
    await expect(readCustomerSurface("tenant-b")).resolves.toBeNull();
  });

  it("writes the complete release in one tenant-scoped blob", async () => {
    const row = surface();
    await writeCustomerSurface(row);
    expect(writeStoreMock).toHaveBeenCalledWith("customer-surface", [row], { tenantId: "tenant-a" });
  });

  it("soft-invalidates without deleting any visible section", async () => {
    readStoreMock.mockResolvedValue([surface()]);
    await invalidateCustomerSurface("tenant-a");
    const rows = writeStoreMock.mock.calls[0]?.[1] as CustomerSurface[];
    expect(rows[0]?.computedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(rows[0]?.changes.changes).toHaveLength(1);
    expect(rows[0]?.today.hasChanges).toBe(true);
  });

  it("uses a bounded freshness window", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z");
    expect(isCustomerSurfaceStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(isCustomerSurfaceStale(new Date(now - CUSTOMER_SURFACE_FRESH_MS - 1).toISOString(), now)).toBe(true);
  });
});

describe("invalidateCoreSurfaces - the ONE mutation invalidation entry", () => {
  beforeEach(() => {
    invalidateWorklistMock.mockClear();
  });

  it("age-stamps the worklist intermediate AND the customer release with the same explicit tenantId", async () => {
    readStoreMock.mockResolvedValue([surface()]);
    await invalidateCoreSurfaces("tenant-a");
    expect(invalidateWorklistMock).toHaveBeenCalledWith("tenant-a");
    // The customer release is age-stamped in place (epoch-0, sections intact).
    const rows = writeStoreMock.mock.calls[0]?.[1] as CustomerSurface[];
    expect(rows[0]?.computedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(rows[0]?.changes.changes).toHaveLength(1);
  });

  it("is fail-soft per store: a failing worklist invalidation never blocks the release stamp", async () => {
    invalidateWorklistMock.mockRejectedValueOnce(new Error("store down"));
    readStoreMock.mockResolvedValue([surface()]);
    await expect(invalidateCoreSurfaces("tenant-a")).resolves.toBeUndefined();
    expect(writeStoreMock).toHaveBeenCalledOnce();
  });
});
