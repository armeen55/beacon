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
 *   6. BEACON_AUTH_DISABLED=1 still bypasses everything (no tenant lookup).
 *   7. Resolver reads injected header in preference to env (smoke that the
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
  tenantMembersRows: [] as Array<{ tenant_id: string; created_at?: string }>,
  tenantMembersError: null as { message: string } | null,
  tenantQueryThrows: false,
  // 2026-07-08: simulate a slow/cold Supabase that never resolves within the
  // middleware's per-call deadline (the MIDDLEWARE_INVOCATION_TIMEOUT class).
  authHangs: false,
  tenantHangs: false,
}));

const NEVER = new Promise<never>(() => {}); // resolves never - drives the timeout path

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
        // Chain supports both `.eq()` terminal and `.eq().order()` (the
        // 2026-06-10 multi-membership default-resolution adds .order()).
        const eq = (_col: string, _val: string) => {
          const thenable = {
            order: () => (supabaseState.tenantHangs ? NEVER : Promise.resolve(result())),
            then: (onF: (v: unknown) => unknown) =>
              (supabaseState.tenantHangs ? NEVER : Promise.resolve(result())).then(onF),
          };
          return thenable;
        };
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

  it("strips inbound x-beacon-tenant header on the AUTH-DISABLED bypass (audit #7)", async () => {
    process.env.BEACON_AUTH_DISABLED = "1";
    const req = makeRequest("/today", {
      headers: { "x-beacon-tenant": "tenant-attacker" },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(200);
    // audit #7: the bypass MUST strip the inbound spoof too — currentTenantId()
    // reads x-beacon-tenant before the env fallback, so an un-stripped header
    // is tenant impersonation. The forwarded request header must NOT be the
    // attacker value.
    const forwarded = res.headers.get("x-middleware-request-x-beacon-tenant");
    expect(forwarded).not.toBe("tenant-attacker");
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

  // Audit #13 (2026-06-10): multi-membership is NO LONGER a lockout. The
  // user is admitted with a DEFAULT tenant injected (earliest membership,
  // or the `beacon_tenant` cookie if they're a member of it).
  it("authenticated user with multiple tenant_members rows is admitted with the earliest as default", async () => {
    supabaseState.user = { id: "user-multi" };
    supabaseState.tenantMembersRows = [
      { tenant_id: "tenant-a", created_at: "2026-01-01T00:00:00Z" },
      { tenant_id: "tenant-b", created_at: "2026-02-01T00:00:00Z" },
    ];
    const req = makeRequest("/today");
    const res = await updateSession(req);
    expect(res.status).not.toBe(307); // NOT locked out
    expect(res.headers.get("x-middleware-request-x-beacon-tenant")).toBe("tenant-a"); // earliest (query ordered asc)
  });

  it("multi-membership honors the beacon_tenant cookie when the user is a member of it", async () => {
    supabaseState.user = { id: "user-multi" };
    supabaseState.tenantMembersRows = [
      { tenant_id: "tenant-a", created_at: "2026-01-01T00:00:00Z" },
      { tenant_id: "tenant-b", created_at: "2026-02-01T00:00:00Z" },
    ];
    const req = makeRequest("/today");
    req.cookies.set("beacon_tenant", "tenant-b");
    const res = await updateSession(req);
    expect(res.headers.get("x-middleware-request-x-beacon-tenant")).toBe("tenant-b");
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

  // 2026-06-19: a single, narrow machine-auth exemption was re-introduced for
  // the nightly data-sync cron (/api/cron/*). A Vercel Cron request carries no
  // Supabase session, so the session gate must let it through; the cron route
  // authenticates itself via `Authorization: Bearer $CRON_SECRET`. This pins
  // that ONLY /api/cron is exempt — every OTHER /api/* path still follows the
  // standard auth gate (no broad machine allowlist creeps back in).
  it("only /api/cron is machine-auth-exempt; other /api/* paths still redirect to /login", async () => {
    supabaseState.user = null;

    // /api/cron/* — middleware lets it through (route does its own secret check).
    const cron = await updateSession(makeRequest("/api/cron/sync-connectors"));
    expect(cron.status).not.toBe(307);
    expect(cron.headers.get("location")).toBeNull();

    // any non-cron /api/* path is still gated by the session redirect.
    const other = await updateSession(makeRequest("/api/some-route"));
    expect(other.status).toBe(307);
    expect(other.headers.get("location") ?? "").toContain("/login");
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

  // 2026-07-08: the MIDDLEWARE_INVOCATION_TIMEOUT class. A slow/cold Supabase must
  // NEVER hang the whole middleware to a 504 - each call is deadline-guarded and
  // degrades gracefully. Fake timers advance past the 5s per-call ceiling.
  it("a hung auth.getUser degrades to the login redirect (never a 504) on a protected path", async () => {
    vi.useFakeTimers();
    try {
      supabaseState.authHangs = true;
      const p = updateSession(makeRequest("/today"));
      await vi.advanceTimersByTimeAsync(5001);
      const res = await p;
      // Timed out -> treated as no user -> the existing protected-path redirect fires,
      // fast, instead of the middleware hanging to a gateway timeout.
      expect(res.status).toBe(307);
      expect(res.headers.get("location") ?? "").toContain("/login");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a hung tenant lookup degrades to the env-fallback (no redirect, no 504)", async () => {
    vi.useFakeTimers();
    try {
      supabaseState.user = { id: "user-1" };
      supabaseState.tenantHangs = true;
      const p = updateSession(makeRequest("/today"));
      await vi.advanceTimersByTimeAsync(5001);
      const res = await p;
      // Timed out -> error fallback -> falls through to the resolver's env tenant,
      // request proceeds (200), no header injected. The app stays up.
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-request-x-beacon-tenant")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
