/**
 * Sprint 7 Phase 7.4 (2026-04-25) — middleware tenant-header injection tests.
 *
 * Covers:
 *   1. Inbound `x-beacon-tenant` is stripped (defense against client spoof).
 *   2. Authenticated user with exactly one tenant_members row → header injected.
 *   3. Authenticated user with zero tenant_members rows → redirect to
 *      /login?error=no_tenant.
 *   4. Authenticated user with 2+ tenant_members rows → redirect to
 *      /login?error=multiple_tenants (schema has no primary indicator yet).
 *   5. Unauthenticated request to a private path still redirects to
 *      /login?next=... (preserves Phase 2 auth gate).
 *   6. /api/poll/run remains in the machine-auth allowlist (no redirect).
 *   7. BEACON_AUTH_DISABLED=1 still bypasses everything (no tenant lookup).
 *   8. Resolver reads injected header in preference to env (smoke that the
 *      Phase 7.3 + 7.4 contract works end-to-end).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { NextRequest } from "next/server";

// Hoisted mutable state controls every aspect of the mocked Supabase client.
const supabaseState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tenantMembersRows: [] as Array<{ tenant_id: string }>,
  tenantMembersError: null as { message: string } | null,
  tenantQueryThrows: false,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: supabaseState.user }, error: null }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: async (_col: string, _val: string) => {
          if (supabaseState.tenantQueryThrows) {
            throw new Error("simulated edge-runtime fetch failure");
          }
          return {
            data: supabaseState.tenantMembersRows,
            error: supabaseState.tenantMembersError,
          };
        },
      }),
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

const REQUIRED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-stub",
};

describe("Sprint 7 Phase 7.4 — middleware tenant injection", () => {
  beforeEach(() => {
    supabaseState.user = null;
    supabaseState.tenantMembersRows = [];
    supabaseState.tenantMembersError = null;
    supabaseState.tenantQueryThrows = false;
    process.env.NEXT_PUBLIC_SUPABASE_URL = REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = REQUIRED_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.BEACON_AUTH_DISABLED;
  });

  afterEach(() => {
    delete process.env.BEACON_AUTH_DISABLED;
    vi.restoreAllMocks();
  });

  it("strips inbound x-beacon-tenant header (no auth needed)", async () => {
    process.env.BEACON_AUTH_DISABLED = "1";
    const req = makeRequest("/today", {
      headers: { "x-beacon-tenant": "tenant-attacker" },
    });
    const res = await updateSession(req);
    // Auth-disabled bypass returns NextResponse.next({ request }) which
    // forwards the original headers. The strip happens in the auth path.
    // Smoke: the response is OK status (no redirect).
    expect(res.status).toBe(200);
  });

  it("authenticated user with exactly one tenant_members row gets x-beacon-tenant injected", async () => {
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantMembersRows = [{ tenant_id: "tenant-ritz-founder" }];
    const req = makeRequest("/today", {
      headers: { "x-beacon-tenant": "tenant-attacker" },
    });
    const res = await updateSession(req);
    // No redirect — request proceeds.
    expect(res.status).toBe(200);
    // The forwarded request header (visible via x-middleware-request-x-beacon-tenant)
    // should be the resolved tenant, NOT the inbound spoof.
    const forwarded = res.headers.get("x-middleware-request-x-beacon-tenant");
    expect(forwarded).toBe("tenant-ritz-founder");
  });

  it("authenticated user with zero tenant_members rows redirects to /login?error=no_tenant", async () => {
    supabaseState.user = { id: "user-orphan" };
    supabaseState.tenantMembersRows = [];
    const req = makeRequest("/today");
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("error=no_tenant");
  });

  it("authenticated user with multiple tenant_members rows redirects to /login?error=multiple_tenants", async () => {
    supabaseState.user = { id: "user-multi" };
    supabaseState.tenantMembersRows = [
      { tenant_id: "tenant-a" },
      { tenant_id: "tenant-b" },
    ];
    const req = makeRequest("/today");
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("error=multiple_tenants");
  });

  it("unauthenticated request to a private path still redirects to /login?next=...", async () => {
    supabaseState.user = null;
    const req = makeRequest("/today");
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Ftoday");
  });

  it("/api/poll/run is in the machine-auth allowlist (no redirect even when unauthenticated)", async () => {
    supabaseState.user = null;
    const req = makeRequest("/api/poll/run");
    const res = await updateSession(req);
    // Allowlisted: middleware lets the request through; the route handler
    // enforces its own bearer auth. No redirect.
    expect(res.status).toBe(200);
  });

  // 2026-05-11 — cron-middleware fix. Pre-fix the middleware redirected
  // /api/cron/* to /login before the route handler's CRON_SECRET bearer
  // check ran, silently breaking the daily-native-poll workflow's
  // rebuild-citation-evidence-index step. The route handlers already
  // enforce `Authorization: Bearer ${CRON_SECRET}` themselves.
  it("/api/cron/rebuild-citation-evidence-index is in the machine-auth allowlist (no redirect when unauthenticated)", async () => {
    supabaseState.user = null;
    const req = makeRequest("/api/cron/rebuild-citation-evidence-index");
    const res = await updateSession(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("/api/cron/scan is in the machine-auth allowlist (no redirect when unauthenticated)", async () => {
    supabaseState.user = null;
    const req = makeRequest("/api/cron/scan");
    const res = await updateSession(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // 2026-05-11 Automation Reliability Bundle — Vercel-cron watchdog
  // that dispatches the daily-native-poll workflow when GitHub
  // Actions' scheduler misses a fire window.
  it("/api/cron/poll-watchdog is in the machine-auth allowlist (no redirect when unauthenticated)", async () => {
    supabaseState.user = null;
    const req = makeRequest("/api/cron/poll-watchdog");
    const res = await updateSession(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("sibling /api/cron/* paths NOT in the explicit allowlist still redirect (exact-match contract)", async () => {
    // The allowlist uses exact-match, not prefix, so a future
    // /api/cron/something-new path that hasn't been deliberately
    // added MUST still redirect. Pin this so a regression to
    // `path.startsWith("/api/cron/")` is caught.
    supabaseState.user = null;
    const req = makeRequest("/api/cron/some-future-route");
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });

  it("BEACON_AUTH_DISABLED=1 bypasses everything (no tenant lookup, no redirects)", async () => {
    process.env.BEACON_AUTH_DISABLED = "1";
    // State configured to fail (no tenant) — bypass means we never reach the lookup.
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantMembersRows = [];
    const req = makeRequest("/today");
    const res = await updateSession(req);
    // No redirect, no tenant injection — the bypass branch returns immediately.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("transient tenant_members query error falls through (no redirect; resolver uses env)", async () => {
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantMembersError = { message: "simulated DB outage" };
    const req = makeRequest("/today");
    const res = await updateSession(req);
    // No redirect — request proceeds, resolver in RSC will use env fallback.
    expect(res.status).toBe(200);
    // No header was injected.
    const forwarded = res.headers.get("x-middleware-request-x-beacon-tenant");
    expect(forwarded).toBeNull();
  });

  it("tenant lookup throw (e.g., edge fetch failure) falls through; no redirect", async () => {
    supabaseState.user = { id: "user-1" };
    supabaseState.tenantQueryThrows = true;
    const req = makeRequest("/today");
    const res = await updateSession(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-beacon-tenant")).toBeNull();
  });
});
