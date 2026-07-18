/**
 * 2026-06-13 — tenant registry reads Supabase on hosted.
 *
 * The `.data/global/tenants.json` registry file isn't deployed (gitignored +
 * read-only lambda FS), so on hosted (DATA_SOURCE=supabase) the file path
 * returned [] → getTenant() resolved null → the tenant switcher couldn't name
 * tenants AND executePush fell back to dev_note (no Wix push). These pin the
 * Supabase read path + the row→BeaconTenant mapping (esp. publish_target,
 * which decides whether Accept reaches Wix).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const _rows = { current: [] as unknown[], error: null as unknown };
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: _rows.current, error: _rows.error }),
    }),
  }),
}));

import { listTenants, mapRowToTenant } from "@/domains/tenants/store";

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

const ORIG = process.env.DATA_SOURCE;
beforeEach(() => {
  _rows.current = [];
  _rows.error = null;
});
afterEach(() => {
  process.env.DATA_SOURCE = ORIG;
});

describe("mapRowToTenant", () => {
  it("maps a missing or invalid segment to the fail-safe unknown bucket", () => {
    expect(mapRowToTenant(row({ segment: null })).segment).toBe("unknown");
    expect(mapRowToTenant(row({ segment: "garbage" })).segment).toBe("unknown");
  });
  it("preserves a valid publish_target (wix_cms → Accept can reach Wix)", () => {
    expect(mapRowToTenant(row()).publish_target).toBe("wix_cms");
  });

  it("maps a null/invalid publish_target to undefined (safe: routes dev_note)", () => {
    expect(mapRowToTenant(row({ publish_target: null })).publish_target).toBeUndefined();
    expect(mapRowToTenant(row({ publish_target: "garbage" })).publish_target).toBeUndefined();
  });

  it("defaults null array columns to [] and drops non-strings", () => {
    const t = mapRowToTenant(row({ project_mix: null, cities_served: null }));
    expect(t.project_mix).toEqual([]);
    expect(t.cities_served).toEqual([]);
    expect(t.discovered_competitors).toEqual(["a", "b"]); // 2 dropped
  });

  it("carries identity fields the switcher needs", () => {
    const t = mapRowToTenant(row());
    expect(t.id).toBe("tenant-iranopedia");
    expect(t.business_name).toBe("Iranopedia");
    expect(t.slug).toBe("iranopedia");
  });

  it("preserves a valid tier role", () => {
    expect(mapRowToTenant(row({ role: "founder" })).role).toBe("founder");
    expect(mapRowToTenant(row({ role: "beta_customer" })).role).toBe("beta_customer");
    expect(mapRowToTenant(row({ role: "paid_customer" })).role).toBe("paid_customer");
  });

  it("coerces a legacy/invalid role to paid_customer — NEVER founder", () => {
    // "owner" is a tenant_members membership role, not a tenant tier. A wrong
    // founder tag would attach legacy untagged data to the wrong tenant via
    // tenant-data.ts's founder fallback, so the safe default is the
    // least-privileged tier.
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
    const iran = tenants.find((t) => t.id === "tenant-iranopedia")!;
    expect(iran.publish_target).toBe("wix_cms");
  });
});
