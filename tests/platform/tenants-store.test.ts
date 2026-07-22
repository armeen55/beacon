/**
 * PLATFORM — tenant registry store (Core 100K terminal suite; merged from
 * src/domains/tenants/store.test.ts and tests/domains/tenants/
 * store-supabase-read.test.ts).
 *
 * Pins: listActiveTenants is the only work-fan-out enumerator (a paused
 * tenant consumes zero background/paid work but still resolves), the hosted
 * Supabase read path, and the row→BeaconTenant mapping (publish_target
 * decides whether Accept reaches Wix; a bad role NEVER coerces to founder).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const readStoreMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...a: unknown[]) => readStoreMock(...a),
  writeStore: vi.fn(),
}));

const _rows = { current: [] as unknown[], error: null as unknown };
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: _rows.current, error: _rows.error }),
    }),
  }),
}));

import { listActiveTenants, listTenants, mapRowToTenant } from "@/domains/tenants/store";

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "tenant-iranopedia",
    slug: "iranopedia",
    business_name: "Iranopedia",
    domain: "iranopedia.com",
    segment: "local_service",
    project_mix: null,
    cities_served: null,
    budget_range: "mixed",
    publish_target: "wix_cms",
    signup_date: "2026-05-01",
    role: "paid_customer",
    tos_accepted_at: null,
    discovered_competitors: ["a", 2, "b"],
    daily_budget_usd: 3,
    status: "active",
    email_frequency: "weekly",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...over,
  };
}

const ORIGINAL_DATA_SOURCE = process.env.DATA_SOURCE;

beforeEach(() => {
  delete process.env.DATA_SOURCE; // file path → readStore mock
  readStoreMock.mockReset();
  _rows.current = [];
  _rows.error = null;
});

afterEach(() => {
  if (ORIGINAL_DATA_SOURCE === undefined) delete process.env.DATA_SOURCE;
  else process.env.DATA_SOURCE = ORIGINAL_DATA_SOURCE;
});

describe("listActiveTenants — the work fan-out contract", () => {
  it("returns only status==='active' tenants; a paused tenant is never enumerated for work", async () => {
    readStoreMock.mockResolvedValue([
      { id: "tenant-iranopedia", status: "active" },
      { id: "tenant-ritz-founder", status: "paused" },
      { id: "t-cancelled", status: "cancelled" },
      { id: "t-pending", status: "pending_onboarding" },
    ]);
    expect((await listActiveTenants()).map((t) => t.id)).toEqual(["tenant-iranopedia"]);
  });

  it("listTenants (identity/resolution) still sees a paused tenant so its data is not orphaned", async () => {
    readStoreMock.mockResolvedValue([{ id: "tenant-ritz-founder", status: "paused" }]);
    expect((await listTenants()).map((t) => t.id)).toContain("tenant-ritz-founder");
  });
});

describe("mapRowToTenant", () => {
  it("preserves a valid publish_target and maps null/invalid to undefined (safe: routes dev_note)", () => {
    expect(mapRowToTenant(row()).publish_target).toBe("wix_cms");
    expect(mapRowToTenant(row({ publish_target: null })).publish_target).toBeUndefined();
    expect(mapRowToTenant(row({ publish_target: "garbage" })).publish_target).toBeUndefined();
  });

  it("maps a missing/invalid segment to the fail-safe unknown bucket and defaults array columns", () => {
    expect(mapRowToTenant(row({ segment: null })).segment).toBe("unknown");
    const t = mapRowToTenant(row({ project_mix: null, cities_served: null }));
    expect(t.project_mix).toEqual([]);
    expect(t.cities_served).toEqual([]);
    expect(t.discovered_competitors).toEqual(["a", "b"]);
  });

  it("coerces a legacy/invalid role to paid_customer — NEVER founder (config-leak safety)", () => {
    expect(mapRowToTenant(row({ role: "founder" })).role).toBe("founder");
    for (const bad of ["owner", "admin", "member", "", null, undefined, 7]) {
      expect(mapRowToTenant(row({ role: bad })).role).toBe("paid_customer");
    }
  });
});

describe("listTenants — hosted Supabase read", () => {
  it("reads the registry from Supabase when DATA_SOURCE=supabase", async () => {
    process.env.DATA_SOURCE = "supabase";
    _rows.current = [row(), row({ id: "tenant-ritz-founder", slug: "ritz", business_name: "Ritz", publish_target: "dev_note" })];
    const tenants = await listTenants();
    expect(tenants.map((t) => t.id).sort()).toEqual(["tenant-iranopedia", "tenant-ritz-founder"]);
    expect(tenants.find((t) => t.id === "tenant-iranopedia")!.publish_target).toBe("wix_cms");
  });
});
