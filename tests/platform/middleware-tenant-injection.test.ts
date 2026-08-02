/**
 * Middleware account injection: one login -> one account, fail-closed on zero/
 * multiple/erroring/hung membership lookups, forged beacon_tenant cookies never
 * honored (and actively expired), inbound tenant headers stripped, auth-disabled
 * local mode uses only the explicit env account, and public paths stay reachable
 * for a session with zero memberships (no /login redirect loop).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const supabaseState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tenantMembersRows: [] as Array<{ tenant_id: string }>,
  tenantMembersError: null as { message: string } | null,
  tenantQueryThrows: false,
  authHangs: false,
  tenantHangs: false,
}));

const NEVER = new Promise<never>(() => {});

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () =>
        supabaseState.authHangs
          ? NEVER
          : Promise.resolve({ data: { user: supabaseState.user }, error: null }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => {
        const result = () => {
          if (supabaseState.tenantQueryThrows) {
            throw new Error("simulated edge-runtime fetch failure");
          }
          return {
            data: supabaseState.tenantMembersRows,
            error: supabaseState.tenantMembersError,
          };
        };
        const eq = (_col: string, _val: string) => ({
          then: (onF: (v: unknown) => unknown) =>
            (supabaseState.tenantHangs ? NEVER : Promise.resolve(result())).then(onF),
        });
        return { eq };
      },
    }),
  }),
}));

import { updateSession } from "@/lib/auth/supabase-middleware";

function makeRequest(
  url: string,
  init: { headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(new URL(url, "https://beacon-bice.vercel.app"), {
    headers: init.headers,
  });
}

/** A request carrying a forged/stale account-selection cookie. */
function makeCookieRequest(url: string, cookieTenant: string): NextRequest {
  return makeRequest(url, { headers: { cookie: `beacon_tenant=${cookieTenant}` } });
}

function injectedTenant(res: Response): string | null {
  return res.headers.get("x-middleware-request-x-beacon-tenant");
}

/** The retired cookie must be actively expired on the response. */
function expectRetiredCookieExpired(res: Response): void {
  const setCookies = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
  const retired = setCookies.find((c) => c.startsWith("beacon_tenant="));
  expect(retired, "beacon_tenant must be actively expired").toBeTruthy();
  expect(retired).toMatch(/Max-Age=0/i);
}

const REQUIRED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-stub",
};

describe("middleware account injection — one login, one account, fail-closed", () => {
  beforeEach(() => {
    supabaseState.user = null;
    supabaseState.tenantMembersRows = [];
    supabaseState.tenantMembersError = null;
    supabaseState.tenantQueryThrows = false;
    supabaseState.authHangs = false;
    supabaseState.tenantHangs = false;
    process.env.NEXT_PUBLIC_SUPABASE_URL = REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.BEACON_AUTH_DISABLED;
  });
  afterEach(() => {
    delete process.env.BEACON_AUTH_DISABLED;
    vi.restoreAllMocks();
  });
  it("strips the inbound x-beacon-tenant header on every path (client spoof defense)", async () => {
    supabaseState.user = { id: "user-1" }; supabaseState.tenantMembersRows = [{ tenant_id: "tenant-real" }];
    const res = await updateSession(
      makeRequest("/today", { headers: { "x-beacon-tenant": "tenant-attacker" } }),
    );
    expect(injectedTenant(res)).toBe("tenant-real");
  });
  it("exactly one membership injects exactly that account", async () => {
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantMembersRows = [{ tenant_id: "tenant-mine" }];
    const res = await updateSession(makeRequest("/today"));
    expect(res.status).toBe(200);
    expect(injectedTenant(res)).toBe("tenant-mine");
    expectRetiredCookieExpired(res);
  });
  it("zero memberships fail closed to /login?error=no_account", async () => {
    supabaseState.user = { id: "user-none" };
    supabaseState.tenantMembersRows = [];
    const res = await updateSession(makeRequest("/today"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("error=no_account");
  });
  it("a stranded session (zero memberships) still reaches /login and /auth/signout", async () => {
    supabaseState.user = { id: "user-none" };
    for (const p of ["/login", "/login?error=no_account", "/auth/signout"]) {
      const res = await updateSession(makeRequest(p));
      expect(res.status, `${p} must not bounce for a stranded session`).toBe(200);
    }
  });
  it("multiple memberships fail closed — never earliest-membership guessing", async () => {
    supabaseState.user = { id: "user-multi" };
    supabaseState.tenantMembersRows = [{ tenant_id: "tenant-earliest" }, { tenant_id: "tenant-later" }];
    const res = await updateSession(makeRequest("/today"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("error=multiple_accounts_unsupported");
    expect(injectedTenant(res)).not.toBe("tenant-earliest");
  });
  it("a query error fails closed even with a forged beacon_tenant cookie", async () => {
    supabaseState.user = { id: "user-1" }; supabaseState.tenantMembersError = { message: "boom" };
    const res = await updateSession(makeCookieRequest("/today", "tenant-forged"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("error=account_unavailable");
    expect(injectedTenant(res)).not.toBe("tenant-forged");
    expectRetiredCookieExpired(res);
  });
  it("a lookup throw fails closed even with a forged cookie", async () => {
    supabaseState.user = { id: "user-1" }; supabaseState.tenantQueryThrows = true;
    const res = await updateSession(makeCookieRequest("/today", "tenant-forged"));
    expect(res.headers.get("location")).toContain("error=account_unavailable");
    expect(injectedTenant(res)).not.toBe("tenant-forged");
  });
  it("a hung membership lookup fails closed (no 504, no cookie honor)", async () => {
    supabaseState.user = { id: "user-1" }; supabaseState.tenantHangs = true;
    const res = await updateSession(makeCookieRequest("/today", "tenant-forged"));
    expect(res.headers.get("location")).toContain("error=account_unavailable");
    expect(injectedTenant(res)).not.toBe("tenant-forged");
  }, 15000);
  it("a valid single membership ignores any cookie naming another account (A cannot reach B)", async () => {
    supabaseState.user = { id: "user-a" };
    supabaseState.tenantMembersRows = [{ tenant_id: "tenant-a" }];
    const res = await updateSession(makeCookieRequest("/today", "tenant-b"));
    expect(res.status).toBe(200);
    expect(injectedTenant(res)).toBe("tenant-a");
    expectRetiredCookieExpired(res);
  });
  it("a hung auth.getUser degrades to the login redirect (never a 504)", async () => {
    supabaseState.authHangs = true;
    const res = await updateSession(makeRequest("/today"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login");
  }, 15000);
  it("unauthenticated private-path requests redirect to /login?next=...", async () => {
    const res = await updateSession(makeRequest("/changes"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login?next=%2Fchanges");
  });
  it("only /api/cron is machine-auth-exempt; other /api/* paths still redirect", async () => {
    const cron = await updateSession(makeRequest("/api/cron/warm"));
    expect(cron.status).toBe(200);
    const other = await updateSession(makeRequest("/api/anything"));
    expect(other.status).toBeGreaterThanOrEqual(300);
  });
  it("auth-disabled local mode ignores the cookie and strips spoofed headers (env account only)", async () => {
    process.env.BEACON_AUTH_DISABLED = "1";
    const res = await updateSession(
      makeRequest("/today", {
        headers: {
          "x-beacon-tenant": "tenant-attacker",
          cookie: "beacon_tenant=tenant-cookie-choice",
        },
      }),
    );
    expect(res.status).toBe(200);
    // No header injection at all: the resolver falls through to the explicit
    // BEACON_TENANT_ID env config; the cookie contributes nothing.
    expect(injectedTenant(res)).not.toBe("tenant-attacker");
    expect(injectedTenant(res)).not.toBe("tenant-cookie-choice");
    expectRetiredCookieExpired(res);
  });
});
