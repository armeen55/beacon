/**
 * SOURCES — Google OAuth callback hardening (Core 100K lane S merge).
 * SECURITY BOUNDARY: kept near-intact per the Phase 6 risk register.
 *
 * Merged from tests/app/api/connectors/google/{callback-state,
 * callback-oauth-hardening} onto one in-memory per-tenant store mock.
 *
 * Pins:
 *   • State validation: signed state maps kind → provider; tampered / missing /
 *     expired state → ?error=invalid_state, NO token saved; membership gate
 *     fails closed (?error=not_authorized).
 *   • Failure modes: access_denied / no_code / exchange_failed /
 *     persistence_failed all save nothing.
 *   • Per-tenant hardening (a)-(d): tenant A's write never touches tenant B;
 *     a refresh-token-less response can NEVER erase a valid stored token
 *     (same-account proof retains, soft-failed read aborts, nothing-stored
 *     aborts); replace + different sub + no refresh token → account_mismatch.
 *   • id_token sub + email persist; wrong-audience id_token rejected as
 *     identity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type StoredToken = Record<string, unknown> & { provider: string };

const _store = new Map<string, StoredToken>(); // `${tenantId}:${provider}`
const _saveCalls: Array<{ provider: string; tenantId?: string; payload: StoredToken }> = [];
let _readFails = false;
let _saveError: Error | null = null;
let _isMember = true;

vi.mock("@/lib/connector-store", () => ({
  saveConnectorToken: vi.fn(async (token: StoredToken, tenantId?: string) => {
    if (_saveError) throw _saveError;
    _saveCalls.push({ provider: token.provider, tenantId, payload: token });
    _store.set(`${tenantId}:${token.provider}`, token);
  }),
  readConnectorToken: vi.fn(async (provider: string, tenantId?: string) => {
    if (_readFails) return { ok: false, reason: "read_error" };
    return { ok: true, token: _store.get(`${tenantId}:${provider}`) ?? null };
  }),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Membership gate before write (night-shift hardening 2026-06-11).
vi.mock("@/lib/auth/supabase-server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: _isMember ? [{ tenant_id: "x" }] : [], error: null }),
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/connectors/google/callback/route";
import { encodeOAuthState, type OAuthIntent } from "@/lib/connectors/google-auth";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

function fakeIdToken(sub: string, email?: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64({ sub, email, iss: "accounts.google.com", aud: CLIENT_ID })}.sig`;
}

let _exchangeOk = true;
let _exchangeBody: Record<string, unknown> = {};

function makeState(tenant: string, kind: "gsc" | "gbp" | "ga4" = "gsc", intent?: OAuthIntent): string {
  return encodeOAuthState({ k: kind, t: tenant, n: "nonce", i: Date.now(), ...(intent ? { x: intent } : {}) });
}

function makeRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost:3000/api/connectors/google/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function locationOf(res: Response): URL {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("expected redirect Location header");
  return new URL(loc);
}

beforeEach(() => {
  _store.clear();
  _saveCalls.length = 0;
  _readFails = false;
  _saveError = null;
  _isMember = true;
  _exchangeOk = true;
  _exchangeBody = {
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
    id_token: fakeIdToken("sub-new", "new@account.example"),
  };
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "test-state-secret-callback-test-32+");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(_exchangeBody), {
          status: _exchangeOk ? 200 : 400,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seed(tenant: string, provider: string, over: Record<string, unknown> = {}): StoredToken {
  const token: StoredToken = {
    provider,
    access_token: "stored-access",
    refresh_token: "stored-refresh",
    expires_at: Date.now() + 1000,
    connected_at: "2026-07-01T00:00:00.000Z",
    scopes: [],
    google_account_sub: "sub-stored",
    google_account_email: "stored@account.example",
    ...over,
  };
  _store.set(`${tenant}:${provider}`, token);
  return token;
}

// ─────────────────────────────────────────────────────────────────────
// State validation
// ─────────────────────────────────────────────────────────────────────

describe("callback — state validation", () => {
  it("valid gsc state → stores under google_gsc for the state's tenant; gbp → google_gbp", async () => {
    const res = await GET(makeRequest({ code: "auth-code-abc", state: makeState("tenant-alpha") }));
    expect(res.status).toBe(307);
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/settings/connectors");
    expect(loc.searchParams.get("connected")).toBe("google_gsc");
    expect(_saveCalls[0]!.provider).toBe("google_gsc");
    expect(_saveCalls[0]!.tenantId).toBe("tenant-alpha");

    const gbp = await GET(
      makeRequest({ code: "auth-code-abc", state: makeState("tenant-alpha", "gbp") }),
    );
    expect(locationOf(gbp).searchParams.get("connected")).toBe("google_gbp");
    expect(_saveCalls[1]!.provider).toBe("google_gbp");
  });

  it("non-member caller → ?error=not_authorized, NO token saved (fail-closed)", async () => {
    _isMember = false;
    const res = await GET(makeRequest({ code: "auth-code-abc", state: makeState("tenant-victim") }));
    expect(locationOf(res).searchParams.get("error")).toBe("not_authorized");
    expect(_saveCalls).toHaveLength(0);
  });

  it("missing / tampered / expired state → ?error=invalid_state, no token saved", async () => {
    const missing = await GET(makeRequest({ code: "auth-code-abc" }));
    expect(locationOf(missing).searchParams.get("error")).toBe("invalid_state");

    const valid = makeState("tenant-a");
    const [body, sig] = valid.split(".");
    const tampered = `${body}.${sig!.slice(0, -2)}00`;
    const t = await GET(makeRequest({ code: "abc", state: tampered }));
    expect(locationOf(t).searchParams.get("error")).toBe("invalid_state");

    const expired = encodeOAuthState({ k: "gsc", t: "tenant-a", n: "n", i: Date.now() - 11 * 60 * 1000 });
    const e = await GET(makeRequest({ code: "abc", state: expired }));
    expect(locationOf(e).searchParams.get("error")).toBe("invalid_state");

    expect(_saveCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Failure modes
// ─────────────────────────────────────────────────────────────────────

describe("callback — failure modes", () => {
  it("user-denied → access_denied; missing code → no_code; nothing saved", async () => {
    const denied = await GET(makeRequest({ error: "access_denied" }));
    expect(locationOf(denied).searchParams.get("error")).toBe("access_denied");

    const noCode = await GET(makeRequest({ state: makeState("tenant-a") }));
    expect(locationOf(noCode).searchParams.get("error")).toBe("no_code");
    expect(_saveCalls).toHaveLength(0);
  });

  it("token exchange failure → ?error=exchange_failed, no token saved", async () => {
    _exchangeOk = false;
    _exchangeBody = { error: "invalid_grant" };
    const res = await GET(makeRequest({ code: "bad-code", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("error")).toBe("exchange_failed");
    expect(_saveCalls).toHaveLength(0);
  });

  it("persistence failure → ?error=persistence_failed, no token persists", async () => {
    _saveError = new Error("connector-store: save failed");
    const res = await GET(makeRequest({ code: "abc", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("error")).toBe("persistence_failed");
    expect(_store.has("tenant-a:google_gsc")).toBe(false);
  });

  it("saved token carries scopes split from Google's response", async () => {
    _exchangeBody.scope =
      "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email";
    await GET(makeRequest({ code: "abc", state: makeState("tenant-a") }));
    const payload = _saveCalls[0]!.payload as unknown as { scopes: string[] };
    expect(payload.scopes).toContain("https://www.googleapis.com/auth/webmasters.readonly");
    expect(payload.scopes.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Operator regression (a)+(b): tenant isolation across connect/replace
// ─────────────────────────────────────────────────────────────────────

describe("callback — tenant isolation across connect/replace", () => {
  it("tenant A's connect writes ONLY tenant A's row; tenant B stays byte-identical", async () => {
    const b = seed("tenant-b", "google_gsc", { refresh_token: "b-refresh", google_account_sub: "sub-b" });
    const bBefore = JSON.stringify(_store.get("tenant-b:google_gsc"));
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("connected")).toBe("google_gsc");
    expect(_saveCalls).toHaveLength(1);
    expect(_saveCalls[0]!.tenantId).toBe("tenant-a");
    expect(JSON.stringify(_store.get("tenant-b:google_gsc"))).toBe(bBefore);
    expect(_store.get("tenant-b:google_gsc")).toEqual(b);
  });

  it("REPLACING tenant A's account (fresh refresh token, new sub) overwrites A only; B untouched", async () => {
    seed("tenant-a", "google_gsc", { google_account_sub: "sub-old-a", refresh_token: "old-a-refresh" });
    seed("tenant-b", "google_gsc", { google_account_sub: "sub-b", refresh_token: "b-refresh" });
    const bBefore = JSON.stringify(_store.get("tenant-b:google_gsc"));
    _exchangeBody.id_token = fakeIdToken("sub-new-a", "newa@account.example");
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a", "gsc", "replace") }));
    expect(locationOf(res).searchParams.get("connected")).toBe("google_gsc");
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.refresh_token).toBe("fresh-refresh");
    expect(a.google_account_sub).toBe("sub-new-a");
    expect(a.refresh_token).not.toBe("old-a-refresh");
    expect(JSON.stringify(_store.get("tenant-b:google_gsc"))).toBe(bBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Operator regression (c): refresh-token-less response can never erase
// ─────────────────────────────────────────────────────────────────────

describe("callback — a refresh-token-less response can never erase a valid token", () => {
  it("same account proven by sub → stored refresh token retained, original connected_at kept", async () => {
    seed("tenant-a", "google_gsc", { google_account_sub: "sub-same", refresh_token: "keep-me" });
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = fakeIdToken("sub-same", "same@account.example");
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("connected")).toBe("google_gsc");
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.refresh_token).toBe("keep-me");
    expect(a.connected_at).toBe("2026-07-01T00:00:00.000Z");
  });

  it("SOFT-FAILED stored read → NO write of any kind, ?error=refresh_token_missing", async () => {
    seed("tenant-a", "google_gsc", { refresh_token: "healthy-do-not-touch" });
    _readFails = true; // a transient read failure must ABORT, not erase
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = fakeIdToken("sub-stored");
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("error")).toBe("refresh_token_missing");
    expect(_saveCalls).toHaveLength(0);
    expect(_store.get("tenant-a:google_gsc")!.refresh_token).toBe("healthy-do-not-touch");
  });

  it("nothing stored + no refresh token from Google → NO write, ?error=refresh_token_missing", async () => {
    _exchangeBody.refresh_token = undefined;
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("error")).toBe("refresh_token_missing");
    expect(_saveCalls).toHaveLength(0);
    expect(_store.has("tenant-a:google_gsc")).toBe(false);
  });

  it("stored token exists but the account can NOT be proven the same (no identity) → NO write", async () => {
    seed("tenant-a", "google_gsc", { refresh_token: "keep-me", google_account_sub: "sub-stored" });
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = undefined; // identity unknown → retention would be a guess
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    expect(locationOf(res).searchParams.get("error")).toBe("refresh_token_missing");
    expect(_saveCalls).toHaveLength(0);
    expect(_store.get("tenant-a:google_gsc")!.refresh_token).toBe("keep-me");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Operator regression (d) + identity persistence
// ─────────────────────────────────────────────────────────────────────

describe("callback — replacement mismatch + identity persistence", () => {
  it("replace intent + DIFFERENT sub + no refresh token → rejected, stored row untouched, ?error=account_mismatch", async () => {
    seed("tenant-a", "google_ga4", {
      provider: "google_ga4",
      google_account_sub: "sub-old",
      refresh_token: "old-refresh",
    });
    const before = JSON.stringify(_store.get("tenant-a:google_ga4"));
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = fakeIdToken("sub-different", "different@account.example");
    const res = await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a", "ga4", "replace") }));
    expect(locationOf(res).searchParams.get("error")).toBe("account_mismatch");
    expect(_saveCalls).toHaveLength(0);
    expect(JSON.stringify(_store.get("tenant-a:google_ga4"))).toBe(before);
  });

  it("sub + email from the id_token land on the payload; wrong-audience id_token rejected as identity", async () => {
    _exchangeBody.id_token = fakeIdToken("sub-42", "owner@site.example");
    await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.google_account_sub).toBe("sub-42");
    expect(a.google_account_email).toBe("owner@site.example");

    _store.clear();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    _exchangeBody.id_token = `${b64({ alg: "RS256" })}.${b64({ sub: "sub-evil", iss: "accounts.google.com", aud: "someone-else" })}.sig`;
    await GET(makeRequest({ code: "auth-code", state: makeState("tenant-a") }));
    const c = _store.get("tenant-a:google_gsc")!;
    expect(c.google_account_sub).toBeUndefined();
    expect(c.refresh_token).toBe("fresh-refresh"); // grant still saved
  });
});
