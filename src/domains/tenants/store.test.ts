import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * 2026-07-18 tenant-safety: listActiveTenants is the enumerator every work
 * fan-out (cron routes, precompute/warm, nightly aggregates, cross-tenant brain)
 * now iterates, so a paused tenant consumes ZERO background/paid work. A paused
 * tenant must still RESOLVE via listTenants so its stored data is not orphaned.
 */

const readStoreMock = vi.fn();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...a: unknown[]) => readStoreMock(...a),
  writeStore: vi.fn(),
}));

import { listActiveTenants, listTenants } from "./store";

const ORIGINAL_DATA_SOURCE = process.env.DATA_SOURCE;

beforeEach(() => {
  delete process.env.DATA_SOURCE; // force the file path → readStore mock
  readStoreMock.mockReset();
});

afterEach(() => {
  process.env.DATA_SOURCE = ORIGINAL_DATA_SOURCE;
});

describe("listActiveTenants", () => {
  it("returns only status==='active' tenants, filtering paused/cancelled/pending", async () => {
    readStoreMock.mockResolvedValue([
      { id: "tenant-iranopedia", status: "active" },
      { id: "tenant-ritz-founder", status: "paused" },
      { id: "t-cancelled", status: "cancelled" },
      { id: "t-pending", status: "pending_onboarding" },
    ]);
    const active = await listActiveTenants();
    expect(active.map((t) => t.id)).toEqual(["tenant-iranopedia"]);
  });

  it("represents the fan-out contract: a paused tenant is never enumerated for work", async () => {
    readStoreMock.mockResolvedValue([
      { id: "tenant-iranopedia", status: "active" },
      { id: "tenant-ritz-founder", status: "paused" },
    ]);
    const workTargets = (await listActiveTenants()).map((t) => t.id);
    expect(workTargets).not.toContain("tenant-ritz-founder");
  });
});

describe("listTenants (identity/resolution) still sees a paused tenant", () => {
  it("returns the paused tenant so its stored data is not orphaned", async () => {
    readStoreMock.mockResolvedValue([
      { id: "tenant-ritz-founder", status: "paused" },
    ]);
    const all = await listTenants();
    expect(all.map((t) => t.id)).toContain("tenant-ritz-founder");
  });
});
