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

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, get: () => undefined, getAll: () => [] }),
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

import { switchTenantFromForm, canSwitchToTenant, TENANT_COOKIE } from "@/app/(shell)/tenant-switch-action";

function form(tenantId: string): FormData {
  const f = new FormData();
  f.set("tenant_id", tenantId);
  return f;
}

describe("canSwitchToTenant", () => {
  it("true only for actual memberships, never empty targets", async () => {
    const m = [{ tenant_id: "tenant-a" }];
    expect(await canSwitchToTenant(m, "tenant-a")).toBe(true);
    expect(await canSwitchToTenant(m, "tenant-b")).toBe(false);
    expect(await canSwitchToTenant(m, "")).toBe(false);
  });
});

describe("switchTenantFromForm", () => {
  beforeEach(() => {
    cookieSet.mockReset();
    redirects.log = [];
    authState.user = { id: "user-1" };
    authState.memberships = [{ tenant_id: "tenant-a" }, { tenant_id: "tenant-b" }];
  });

  it("member target → sets the beacon_tenant cookie and redirects home", async () => {
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/");
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieSet.mock.calls[0]!;
    expect(name).toBe(TENANT_COOKIE);
    expect(value).toBe("tenant-b");
    expect((opts as { httpOnly: boolean }).httpOnly).toBe(true);
  });

  it("NON-member target → no cookie write (fail-closed)", async () => {
    await expect(switchTenantFromForm(form("tenant-attacker"))).rejects.toThrow("REDIRECT:/");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("no session → redirect to /login, no cookie", async () => {
    authState.user = null;
    await expect(switchTenantFromForm(form("tenant-b"))).rejects.toThrow("REDIRECT:/login");
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
