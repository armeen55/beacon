/**
 * Middleware account injection: one login -> one account, fail-closed on zero/ multiple/erroring/hung membership lookups, forged beacon_tenant cookies never honored (and actively expired), inbound tenant headers stripped, auth-disabled local mode uses only the explicit env account, and public paths stay reachable
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
  /** ONE table, one claim per row: which account a request is allowed to reach, and what happens when the
   *  answer cannot be trusted. A forged header, a forged cookie, two memberships, none at all, a query that errored, threw or hung, and local auth-disabled mode all resolve HERE, so a new bypass has to survive a row rather than a whole file nobody re-reads. `injected` is the account the request actually reaches. */
  it.each([
    { name: "strips a spoofed x-beacon-tenant header and injects the real account instead", rows: ["tenant-real"], headers: { "x-beacon-tenant": "tenant-attacker" }, injected: "tenant-real" },
    { name: "exactly one membership injects exactly that account, and retires the selection cookie", rows: ["tenant-mine"], status: 200, injected: "tenant-mine", expired: true },
    { name: "zero memberships fail closed to no_account", rows: [], location: "error=no_account" },
    { name: "two memberships fail closed rather than guessing the earliest", rows: ["tenant-earliest", "tenant-later"], location: "error=multiple_accounts_unsupported", not: "tenant-earliest" },
    { name: "a membership query that ERRORED fails closed, and a forged cookie buys nothing", rows: ["x"], state: { tenantMembersError: { message: "boom" } }, cookie: "tenant-forged", location: "error=account_unavailable", not: "tenant-forged", expired: true },
    { name: "a membership query that THREW fails closed, and a forged cookie buys nothing", state: { tenantQueryThrows: true }, cookie: "tenant-forged", location: "error=account_unavailable", not: "tenant-forged" },
    { name: "a membership query that HUNG fails closed with no 504 and no cookie honoured", state: { tenantHangs: true }, cookie: "tenant-forged", location: "error=account_unavailable", not: "tenant-forged" },
    { name: "a valid single membership ignores a cookie naming another account, so A can never reach B", rows: ["tenant-a"], cookie: "tenant-b", status: 200, injected: "tenant-a", expired: true },
    { name: "an auth lookup that HUNG degrades to the login redirect, never a 504", state: { authHangs: true }, noUser: true, location: "/login" },
    { name: "an unauthenticated private path redirects to login carrying where it was going", path: "/changes", noUser: true, location: "/login?next=%2Fchanges" },
    { name: "local auth-disabled mode takes the env account only: no spoofed header, no cookie choice", env: true, headers: { "x-beacon-tenant": "tenant-attacker", cookie: "beacon_tenant=tenant-cookie-choice" }, status: 200, not: "tenant-attacker", expired: true },
  ] as Array<{ name: string; rows?: string[]; state?: Partial<typeof supabaseState>; noUser?: boolean; env?: boolean; path?: string;
    headers?: Record<string, string>; cookie?: string; status?: number; location?: string; injected?: string; not?: string; expired?: boolean }>)("$name", async (c) => {
    if (c.env) process.env.BEACON_AUTH_DISABLED = "1";
    if (!c.noUser && !c.env) supabaseState.user = { id: "user-1" };
    if (c.rows) supabaseState.tenantMembersRows = c.rows.map((tenant_id) => ({ tenant_id }));
    Object.assign(supabaseState, c.state ?? {});
    const res = await updateSession(c.cookie ? makeCookieRequest(c.path ?? "/today", c.cookie) : makeRequest(c.path ?? "/today", { headers: c.headers ?? {} }));
    if (c.status != null) expect(res.status).toBe(c.status);
    if (c.location) { expect(res.status).toBeGreaterThanOrEqual(300); expect(res.headers.get("location")).toContain(c.location); }
    if (c.injected) expect(injectedTenant(res)).toBe(c.injected);
    if (c.not) expect(injectedTenant(res)).not.toBe(c.not);
    if (c.env) expect(injectedTenant(res)).not.toBe("tenant-cookie-choice");
    if (c.expired) expectRetiredCookieExpired(res);
  }, 15_000);
  it("never strands a session it refused: login, the error page and sign out all stay reachable, and only /api/cron is machine exempt", async () => {
    supabaseState.user = { id: "user-none" }; // signed in, no membership: the one state that can trap somebody
    for (const p of ["/login", "/login?error=no_account", "/auth/signout", "/api/cron/warm"]) {
      expect((await updateSession(makeRequest(p))).status, `${p} must not bounce`).toBe(200); }
    expect((await updateSession(makeRequest("/api/anything"))).status).toBeGreaterThanOrEqual(300); });
});
