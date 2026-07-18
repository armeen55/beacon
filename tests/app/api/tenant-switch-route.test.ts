/**
 * 2026-06-11 (night shift, #118) — GET /api/tenant-switch deep links.
 * Pins: member → cookie set + redirect to next; non-member → redirect
 * with NO cookie (fail-closed); no session → /login with next;
 * open-redirect refusal (absolute/protocol-relative next collapses to /).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const authState = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  memberships: [{ tenant_id: "tenant-iranopedia" }] as Array<{ tenant_id: string }>,
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authState.user } }) },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: authState.memberships, error: null }),
      }),
    }),
  }),
}));

// 2026-07-18 tenant-safety: the route now requires the target tenant to be
// ACTIVE via the tenant store (a paused tenant, e.g. Ritz, is non-switchable).
const tenantStore = vi.hoisted(() => ({
  statuses: {} as Record<string, string>,
}));
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async (id: string) =>
    tenantStore.statuses[id] ? { id, status: tenantStore.statuses[id] } : null,
}));

import { GET } from "@/app/api/tenant-switch/route";

function req(qs: string): NextRequest {
  return new NextRequest(new URL(`/api/tenant-switch?${qs}`, "https://beacon-bice.vercel.app"));
}

beforeEach(() => {
  authState.user = { id: "user-1" };
  authState.memberships = [{ tenant_id: "tenant-iranopedia" }];
  tenantStore.statuses = { "tenant-iranopedia": "active" };
});

describe("GET /api/tenant-switch", () => {
  it("member → sets the cookie and redirects to next", async () => {
    const res = await GET(req("tenant=tenant-iranopedia&next=%2Frecommendations"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toBe("https://beacon-bice.vercel.app/recommendations");
    expect(res.headers.get("set-cookie")).toContain("beacon_tenant=tenant-iranopedia");
  });

  it("NON-member → redirect with NO cookie (fail-closed)", async () => {
    const res = await GET(req("tenant=tenant-attacker&next=%2Frecommendations"));
    expect(res.headers.get("location")).toBe("https://beacon-bice.vercel.app/recommendations");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("tenant-attacker");
  });

  // 2026-07-18 tenant-safety: even a valid member may only deep-link into an
  // ACTIVE tenant. A paused tenant (e.g. Ritz after the incident) is rejected.
  it("PAUSED member target → redirect with NO cookie (change nothing)", async () => {
    tenantStore.statuses["tenant-iranopedia"] = "paused";
    const res = await GET(req("tenant=tenant-iranopedia&next=%2Frecommendations"));
    expect(res.headers.get("location")).toBe("https://beacon-bice.vercel.app/recommendations");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("beacon_tenant");
  });

  it("no session → /login carrying next", async () => {
    authState.user = null;
    const res = await GET(req("tenant=tenant-iranopedia&next=%2Frecommendations"));
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/login");
    expect(loc).toContain("next=");
    expect(res.headers.get("set-cookie") ?? "").toBe("");
  });

  it("refuses open redirects (absolute + protocol-relative collapse to /)", async () => {
    const r1 = await GET(req("tenant=tenant-iranopedia&next=https%3A%2F%2Fevil.com"));
    expect(r1.headers.get("location")).toBe("https://beacon-bice.vercel.app/");
    const r2 = await GET(req("tenant=tenant-iranopedia&next=%2F%2Fevil.com"));
    expect(r2.headers.get("location")).toBe("https://beacon-bice.vercel.app/");
  });
});
