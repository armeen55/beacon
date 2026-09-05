/** Middleware account injection: one login -> one account, fail-closed on zero/ multiple/erroring/hung membership lookups, forged beacon_tenant cookies never honored (and actively expired), inbound tenant headers stripped, auth-disabled local mode uses only the explicit env account, and public paths stay reachable for a session with zero memberships (no /login redirect loop). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
const supabaseState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tenantMembersRows: [] as Array<{ tenant_id: string }>,
  tenantMembersError: null as { message: string } | null,
  tenantQueryThrows: false,
  authHangs: false,
  authError: null as { status: number } | null,
  tenantHangs: false,}));
const NEVER = new Promise<never>(() => {});
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () =>
        supabaseState.authHangs
          ? NEVER
          : Promise.resolve({ data: { user: supabaseState.user }, error: supabaseState.authError }),},
    from: (_table: string) => ({
      select: (_cols: string) => {
        const result = () => {
          if (supabaseState.tenantQueryThrows) {
            throw new Error("simulated edge-runtime fetch failure");}
          return {
            data: supabaseState.tenantMembersRows,
            error: supabaseState.tenantMembersError,};};
        const eq = (_col: string, _val: string) => ({
          then: (onF: (v: unknown) => unknown) =>
            (supabaseState.tenantHangs ? NEVER : Promise.resolve(result())).then(onF),});
        return { eq };},}),}),}));
import { updateSession } from "@/lib/auth/supabase-middleware";
function makeRequest(
  url: string,
  init: { headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(new URL(url, "https://beacon-bice.vercel.app"), {
    headers: init.headers,});}
/** A request carrying a forged/stale account-selection cookie. */
function makeCookieRequest(url: string, cookieTenant: string): NextRequest {
  return makeRequest(url, { headers: { cookie: `beacon_tenant=${cookieTenant}` } });}
function injectedTenant(res: Response): string | null {
  return res.headers.get("x-middleware-request-x-beacon-tenant");}
function cookieValue(res: Response, name: string): string | null {
  const row = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().find((c) => c.startsWith(`${name}=`));
  const v = row?.slice(name.length + 1).split(";")[0] ?? "";
  return v.length > 0 ? v : null;}
/** The retired cookie must be actively expired on the response. */
function expectRetiredCookieExpired(res: Response): void {
  const setCookies = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
  const retired = setCookies.find((c) => c.startsWith("beacon_tenant="));
  expect(retired, "beacon_tenant must be actively expired").toBeTruthy();
  expect(retired).toMatch(/Max-Age=0/i);}
const REQUIRED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-stub",};
describe("middleware account injection: one login, one account, fail-closed", () => {
  beforeEach(() => {
    Object.assign(supabaseState, { user: null, tenantMembersRows: [], tenantMembersError: null, tenantQueryThrows: false, authHangs: false, authError: null, tenantHangs: false });
    process.env.NEXT_PUBLIC_SUPABASE_URL = REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.BEACON_AUTH_DISABLED;
    for (const k of ["BEACON_OAUTH_STATE_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]) delete process.env[k];}); // No signing secret means no cached account: every row below resolves purely from the database, which is what these rows are about. The cached-account contract has its own cases underneath.
  afterEach(() => {
    delete process.env.BEACON_AUTH_DISABLED;
    vi.restoreAllMocks();});
  /** ONE table, one claim per row: which account a request is allowed to reach, and what happens when the answer cannot be trusted. A forged header, a forged cookie, two memberships, none at all, a query that errored, threw or hung, and local auth-disabled mode all resolve HERE, so a new bypass has to survive a row rather than a whole file nobody re-reads. `injected` is the account the request actually reaches. */
  it.each([
    { name: "strips a spoofed x-beacon-tenant header and injects the real account instead", rows: ["tenant-real"], headers: { "x-beacon-tenant": "tenant-attacker" }, injected: "tenant-real" },
    { name: "exactly one membership injects exactly that account, and retires the selection cookie", rows: ["tenant-mine"], status: 200, injected: "tenant-mine", expired: true },
    { name: "zero memberships fail closed to no_account", rows: [], location: "error=no_account" },
    { name: "two memberships fail closed rather than guessing the earliest", rows: ["tenant-earliest", "tenant-later"], location: "error=multiple_accounts_unsupported", not: "tenant-earliest" },
    { name: "a membership query that ERRORED says busy rather than verdicting the account", rows: ["x"], state: { tenantMembersError: { message: "boom" } }, cookie: "tenant-forged", status: 503, noLocation: true, not: "tenant-forged" }, // A read that did not ANSWER is not an account verdict. With no signed account to fall back on, a request that is not a document (a server action POST, an RSC fetch) is told the check is busy and can retry; it is never bounced to /login, which is what ate a Mark done press. A forged cookie still buys nothing.
    { name: "a membership query that THREW says busy rather than verdicting the account", state: { tenantQueryThrows: true }, cookie: "tenant-forged", status: 503, noLocation: true, not: "tenant-forged" },
    { name: "a membership query that HUNG says busy with no 504, no login bounce and no cookie honoured", state: { tenantHangs: true }, cookie: "tenant-forged", status: 503, noLocation: true, not: "tenant-forged" },
    { name: "a valid single membership ignores a cookie naming another account, so A can never reach B", rows: ["tenant-a"], cookie: "tenant-b", status: 200, injected: "tenant-a", expired: true },
    { name: "an auth read that HUNG with no session cookie is a plain signed-out login redirect, never a 504", state: { authHangs: true }, noUser: true, location: "/login" }, // AN AUTH READ THAT DID NOT ANSWER IS NOT A SIGNED-OUT USER: with no session cookie it is a plain signed-out visitor, and with one in hand signing them out over a slow provider IS the bug, so it reconnects like the account check.
    { name: "an auth read that HUNG with a session cookie present says busy, never signing a valid session out", state: { authHangs: true }, noUser: true, headers: { cookie: "sb-projectref-auth-token.0=session-value" }, status: 503, noLocation: true },
    { name: "a 4xx from the auth provider IS a verdict: an expired session with its stale cookie still present gets the clean login redirect, never the retry ladder", state: { authError: { status: 400 } }, noUser: true, headers: { cookie: "sb-projectref-auth-token.0=stale-value" }, location: "/login" },
    { name: "an unauthenticated private path redirects to login carrying where it was going", path: "/changes", noUser: true, location: "/login?next=%2Fchanges" },
    { name: "local auth-disabled mode takes the env account only: no spoofed header, no cookie choice", env: true, headers: { "x-beacon-tenant": "tenant-attacker", cookie: "beacon_tenant=tenant-cookie-choice" }, status: 200, not: "tenant-attacker", expired: true },
  ] as Array<{ name: string; rows?: string[]; state?: Partial<typeof supabaseState>; noUser?: boolean; env?: boolean; path?: string;
    headers?: Record<string, string>; cookie?: string; status?: number; location?: string; injected?: string; not?: string; expired?: boolean;
    noLocation?: boolean }>)("$name", async (c) => {
    if (c.env) process.env.BEACON_AUTH_DISABLED = "1";
    if (!c.noUser && !c.env) supabaseState.user = { id: "user-1" };
    if (c.rows) supabaseState.tenantMembersRows = c.rows.map((tenant_id) => ({ tenant_id }));
    Object.assign(supabaseState, c.state ?? {});
    const res = await updateSession(c.cookie ? makeCookieRequest(c.path ?? "/today", c.cookie) : makeRequest(c.path ?? "/today", { headers: c.headers ?? {} }));
    if (c.status != null) expect(res.status).toBe(c.status);
    if (c.location) { expect(res.status).toBeGreaterThanOrEqual(300); expect(res.headers.get("location")).toContain(c.location); }
    if (c.noLocation) expect(res.headers.get("location")).toBeNull();
    if (c.injected) expect(injectedTenant(res)).toBe(c.injected);
    if (c.not) expect(injectedTenant(res)).not.toBe(c.not);
    if (c.env) expect(injectedTenant(res)).not.toBe("tenant-cookie-choice");
    if (c.expired) expectRetiredCookieExpired(res);
  }, 15_000);
  /** THE LOGIN BOUNCE THIS FILE USED TO GUARANTEE. One slow tenant_members read threw a perfectly valid session back to /login and invited a fresh magic link. The signed account cookie is what makes a transient read a non-event: the fast path never queries at all, and a POST carrying it still lands. */
  it("a signed account answers without a query, so a starved pool never bounces a page or eats a server action POST", async () => {
    process.env.BEACON_OAUTH_STATE_SECRET = "test-signing-secret";
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantMembersRows = [{ tenant_id: "tenant-mine" }];
    const first = await updateSession(makeRequest("/changes")); const signed = cookieValue(first, "beacon_acct");
    expect(signed, "a resolved account must be signed onto the session").toBeTruthy();
    supabaseState.tenantHangs = true; // the pool is starved from here on
    const headers = { cookie: `beacon_acct=${signed}` }; const warm = await updateSession(makeRequest("/changes", { headers }));
    expect(warm.status).toBe(200); expect(injectedTenant(warm)).toBe("tenant-mine");
    const post = new NextRequest(new URL("/changes", "https://beacon-bice.vercel.app"), { method: "POST", headers }); const acted = await updateSession(post);
    expect(acted.status).toBe(200); expect(acted.headers.get("location"), "a Mark done POST must never be redirected to /login").toBeNull();
    expect(injectedTenant(acted)).toBe("tenant-mine");
    supabaseState.user = { id: "user-2" }; // A cookie signed for somebody else is not an account: it falls through to the database like any miss.
    supabaseState.tenantHangs = false;
    supabaseState.tenantMembersRows = [{ tenant_id: "tenant-theirs" }];
    expect(injectedTenant(await updateSession(makeRequest("/changes", { headers })))).toBe("tenant-theirs");
  }, 15_000);
  it("with no signed account, a page reloads itself once and only the second failure reaches login, carrying where they were going", async () => {
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantQueryThrows = true;
    const first = await updateSession(makeRequest("/changes", { headers: { accept: "text/html" } })); expect(first.status).toBe(200);
    expect(first.headers.get("location"), "the first failure must not verdict the account").toBeNull(); expect(await first.text()).toContain("reloads by itself");
    expect(cookieValue(first, "beacon_acct_retry")).toBe("account_check_failed");
    const second = await updateSession(makeRequest("/changes", { headers: { accept: "text/html", cookie: "beacon_acct_retry=account_check_failed" } })); expect(second.status).toBeGreaterThanOrEqual(300);
    const location = second.headers.get("location") ?? ""; expect(location).toContain("error=account_check_failed");
    expect(location, "re-login must not also cost them the page they wanted").toContain("next=%2Fchanges");
  }, 15_000);
  it("never strands a session it refused: login, the error page and sign out all stay reachable, and only /api/cron is machine exempt", async () => {
    supabaseState.user = { id: "user-none" }; // signed in, no membership: the one state that can trap somebody
    for (const p of ["/login", "/login?error=no_account", "/auth/signout", "/api/cron/warm"]) {
      expect((await updateSession(makeRequest(p))).status, `${p} must not bounce`).toBe(200); }
    expect((await updateSession(makeRequest("/api/anything"))).status).toBeGreaterThanOrEqual(300); });});
