import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 2026-07-18 tenant-safety incident regression tests.
 *
 * The incident: under Supabase load an authenticated request's tenant_members
 * lookup timed out, the middleware did nothing, and the resolver fell back to
 * BEACON_TENANT_ID (tenant-ritz-founder in prod) — silently rendering the WRONG
 * tenant. These tests pin that an authenticated request NEVER reaches the env
 * fallback: it honors the beacon_tenant cookie or takes a safe redirect, and a
 * stale cookie is scrubbed on the successful path.
 */

const getUserMock = vi.fn();
const orderMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: (...a: unknown[]) => getUserMock(...a) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (...a: unknown[]) => orderMock(...a),
        }),
      }),
    }),
  }),
}));

import { updateSession } from "./supabase-middleware";

const INJECTED = "x-middleware-request-x-beacon-tenant";

function req(path: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `https://beacon.test${path}`;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = {};
  if (cookieHeader) headers.cookie = cookieHeader;
  return new NextRequest(new Request(url, { headers }));
}

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ORIGINAL_ENV_TENANT = process.env.BEACON_TENANT_ID;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  // The env fallback that leaked in the incident. If any test's response injects
  // THIS value, the fix regressed.
  process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
  delete process.env.BEACON_AUTH_DISABLED;
  getUserMock.mockReset();
  orderMock.mockReset();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_ANON;
  process.env.BEACON_TENANT_ID = ORIGINAL_ENV_TENANT;
  vi.useRealTimers();
});

describe("updateSession — authenticated + tenant lookup TIMES OUT", () => {
  it("honors the beacon_tenant cookie, never the env fallback", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    // A lookup that never resolves → withMwTimeout resolves to its timeout value.
    orderMock.mockReturnValue(new Promise(() => {}));

    vi.useFakeTimers();
    const p = updateSession(req("/today", { beacon_tenant: "tenant-iranopedia" }));
    await vi.advanceTimersByTimeAsync(5001);
    const res = await p;

    // Cookie honored, injected as the tenant header.
    expect(res.headers.get(INJECTED)).toBe("tenant-iranopedia");
    // NEVER the env fallback, and NOT a redirect.
    expect(res.headers.get(INJECTED)).not.toBe("tenant-ritz-founder");
    expect(res.status).not.toBe(307);
  });

  it("with NO cookie, takes a safe login redirect, never the env fallback", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    orderMock.mockReturnValue(new Promise(() => {}));

    vi.useFakeTimers();
    const p = updateSession(req("/today"));
    await vi.advanceTimersByTimeAsync(5001);
    const res = await p;

    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("tenant_unavailable");
    // The env fallback tenant was never injected.
    expect(res.headers.get(INJECTED)).not.toBe("tenant-ritz-founder");
  });
});

describe("updateSession — authenticated + lookup query ERRORS", () => {
  it("with a cookie, honors it and does not fall through to env", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    orderMock.mockResolvedValue({ data: null, error: { message: "db down" } });

    const res = await updateSession(
      req("/today", { beacon_tenant: "tenant-iranopedia" }),
    );
    expect(res.headers.get(INJECTED)).toBe("tenant-iranopedia");
    expect(res.status).not.toBe(307);
  });
});

describe("updateSession — successful lookup with a STALE cookie", () => {
  it("injects the earliest membership and overwrites the stale cookie", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    // The user is a member of iranopedia ONLY; the browser still carries the
    // pre-multi-tenant ritz cookie.
    orderMock.mockResolvedValue({
      data: [{ tenant_id: "tenant-iranopedia", created_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });

    const res = await updateSession(
      req("/today", { beacon_tenant: "tenant-ritz-founder" }),
    );

    // The non-member tenant is NOT injected; the earliest membership is.
    expect(res.headers.get(INJECTED)).toBe("tenant-iranopedia");

    // The stale cookie is overwritten to the resolved tenant so it can never
    // linger and be honored during a later Supabase blip.
    const setCookies = res.headers.getSetCookie();
    const beaconCookie = setCookies.find((c) => c.startsWith("beacon_tenant="));
    expect(beaconCookie).toBeDefined();
    expect(beaconCookie).toContain("beacon_tenant=tenant-iranopedia");
  });

  it("leaves a valid-member cookie untouched (no overwrite)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    orderMock.mockResolvedValue({
      data: [{ tenant_id: "tenant-iranopedia", created_at: "2026-01-01T00:00:00Z" }],
      error: null,
    });

    const res = await updateSession(
      req("/today", { beacon_tenant: "tenant-iranopedia" }),
    );
    expect(res.headers.get(INJECTED)).toBe("tenant-iranopedia");
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.find((c) => c.startsWith("beacon_tenant="))).toBeUndefined();
  });
});
