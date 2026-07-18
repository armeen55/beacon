/**
 * 2026-06-11 (night shift, #119) — tenant switcher action.
 * Pins: fail-closed membership check (the pure helper), the cookie
 * write happening ONLY for members, and the non-member no-op.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const cookieSet = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  memberships: [{ tenant_id: "tenant-a" }, { tenant_id: "tenant-b" }] as Array<{ tenant_id: string }>,
}));
const redirects = vi.hoisted(() => ({ log: [] as string[] }));
// #263 — request headers the action reads to decide the post-switch
// redirect target. Tests override `referer`/`host` per case.
const reqHeaders = vi.hoisted(() => ({
  referer: null as string | null,
  host: "app.beacon.test" as string | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, get: () => undefined, getAll: () => [] }),
  headers: async () => ({
    get: (name: string) => {
      const k = name.toLowerCase();
      if (k === "referer") return reqHeaders.referer;
      if (k === "host") return reqHeaders.host;
      return null;
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.log.push(to);
    throw new Error(`REDIRECT:${to}`);
  },
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

// 2026-07-18 tenant-safety: the action now requires the target tenant to be
// ACTIVE in the tenant store (a paused tenant, e.g. Ritz, is non-switchable).
// Tests control each tenant's status here; unknown ids resolve to null.
const tenantStore = vi.hoisted(() => ({
  statuses: {} as Record<string, string>,
}));
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async (id: string) =>
    tenantStore.statuses[id] ? { id, status: tenantStore.statuses[id] } : null,
}));

import { switchTenantFromForm } from "@/app/(shell)/tenant-switch-action";
import { canSwitchToTenant, TENANT_COOKIE } from "@/lib/tenant-cookie";

function form(tenantId: string): FormData {
  const f = new FormData();
  f.set("tenant_id", tenantId);
  return f;
}

describe("canSwitchToTenant", () => {
  it("true only for actual memberships, never empty targets", () => {
    const m = [{ tenant_id: "tenant-a" }];
    expect(canSwitchToTenant(m, "tenant-a")).toBe(true);
    expect(canSwitchToTenant(m, "tenant-b")).toBe(false);
    expect(canSwitchToTenant(m, "")).toBe(false);
  });
});

describe("switchTenantFromForm", () => {
  beforeEach(() => {
    cookieSet.mockReset();
    redirects.log = [];
    authState.user = { id: "user-1" };
    authState.memberships = [{ tenant_id: "tenant-a" }, { tenant_id: "tenant-b" }];
    tenantStore.statuses = { "tenant-a": "active", "tenant-b": "active" };
    reqHeaders.referer = null;
    reqHeaders.host = "app.beacon.test";
  });

  it("member target → sets the beacon_tenant cookie and redirects home (no referer)", async () => {
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/");
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieSet.mock.calls[0]!;
    expect(name).toBe(TENANT_COOKIE);
    expect(value).toBe("tenant-b");
    expect((opts as { httpOnly: boolean }).httpOnly).toBe(true);
  });

  // #263 — redirect-back is same-origin-only.
  it("same-origin referer → redirects back to that in-app path (preserving query)", async () => {
    reqHeaders.referer = "https://app.beacon.test/changes?tab=needs_review";
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow(
      "REDIRECT:/changes?tab=needs_review",
    );
    expect(cookieSet).toHaveBeenCalledTimes(1);
  });

  it("cross-origin (attacker) referer → falls back to / , never the external URL", async () => {
    reqHeaders.referer = "https://evil.example.com/phish";
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/");
    expect(redirects.log).toEqual(["/"]);
  });

  it("malformed / non-absolute referer → falls back to /", async () => {
    reqHeaders.referer = "/not-an-absolute-url";
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/");
    expect(redirects.log).toEqual(["/"]);
  });

  it("same-origin /login referer → falls back to / (don't bounce into auth)", async () => {
    reqHeaders.referer = "https://app.beacon.test/login";
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/");
    expect(redirects.log).toEqual(["/"]);
  });

  it("NON-member target → no cookie write (fail-closed)", async () => {
    await expect(switchTenantFromForm(form("tenant-attacker"))).rejects.toThrow("REDIRECT:/");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  // 2026-07-18 tenant-safety: even a valid member may only switch to an ACTIVE
  // tenant. A paused tenant (e.g. Ritz after the incident) is non-switchable.
  it("PAUSED member target → no cookie write (redirects home, change nothing)", async () => {
    tenantStore.statuses["tenant-b"] = "paused";
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("no session → redirect to /login, no cookie", async () => {
    authState.user = null;
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/login");
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
