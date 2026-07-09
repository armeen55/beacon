/**
 * Per-tenant OAuth hardening, the operator's regression suite (2026-07-09).
 *
 * Pins the callback contract that makes per-tenant Google OAuth safe:
 *   (a) Tenant A's callback write can never alter tenant B's token row.
 *   (b) Replacing tenant A's Google account leaves tenant B byte-identical.
 *   (c) A refresh-token-less token response can never erase a valid stored
 *       token: PROVABLY the same account -> the stored refresh token is
 *       retained; a soft-failed stored read -> NO write at all; nothing
 *       stored -> NO write at all.
 *   (d) A deliberate replacement that gets no refresh token for a DIFFERENT
 *       Google account is rejected: stored row untouched, ?error=account_mismatch.
 *   (+) The id_token's sub + email are persisted on the payload so the card
 *       can show "Connected as <email>" and future callbacks can prove
 *       same-account.
 *
 * HERMETIC: no real Supabase (connector-store fully mocked into an in-memory
 * per-tenant map), no real Google (fetch stubbed), no .env fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type StoredToken = Record<string, unknown> & { provider: string };

const _store = new Map<string, StoredToken>(); // `${tenantId}:${provider}`
const _saveCalls: Array<{ provider: string; tenantId?: string; payload: StoredToken }> = [];
let _readFails = false;

vi.mock("@/lib/connector-store", () => ({
  saveConnectorToken: vi.fn(async (token: StoredToken, tenantId?: string) => {
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

vi.mock("@/lib/auth/supabase-server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [{ tenant_id: "x" }], error: null }),
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/connectors/google/callback/route";
import { encodeOAuthState, type OAuthIntent } from "@/lib/connectors/google-auth";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

/** Unsigned-but-well-formed id_token; the callback decodes the payload only
 *  (the exchange channel is our own TLS POST to Google, see route docs). */
function fakeIdToken(sub: string, email?: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64({ sub, email, iss: "accounts.google.com", aud: CLIENT_ID })}.sig`;
}

let _exchangeBody: Record<string, unknown> = {};

function makeState(tenant: string, kind: "gsc" | "ga4" = "gsc", intent?: OAuthIntent): string {
  return encodeOAuthState({ k: kind, t: tenant, n: "nonce", i: Date.now(), ...(intent ? { x: intent } : {}) });
}

function makeRequest(state: string): Request {
  const url = new URL("http://localhost:3000/api/connectors/google/callback");
  url.searchParams.set("code", "auth-code");
  url.searchParams.set("state", state);
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
  vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "test-state-secret-hardening-32-chars");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(_exchangeBody), { status: 200, headers: { "Content-Type": "application/json" } })),
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

describe("operator regression (a)+(b): tenant isolation across connect/replace", () => {
  it("tenant A's connect writes ONLY tenant A's row; tenant B stays byte-identical", async () => {
    const b = seed("tenant-b", "google_gsc", { refresh_token: "b-refresh", google_account_sub: "sub-b" });
    const bBefore = JSON.stringify(_store.get("tenant-b:google_gsc"));
    const res = await GET(makeRequest(makeState("tenant-a")));
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
    const res = await GET(makeRequest(makeState("tenant-a", "gsc", "replace")));
    expect(locationOf(res).searchParams.get("connected")).toBe("google_gsc");
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.refresh_token).toBe("fresh-refresh");
    expect(a.google_account_sub).toBe("sub-new-a");
    // The replaced row must NOT silently retain the old account's refresh token.
    expect(a.refresh_token).not.toBe("old-a-refresh");
    expect(JSON.stringify(_store.get("tenant-b:google_gsc"))).toBe(bBefore);
  });
});

describe("operator regression (c): a refresh-token-less response can never erase a valid token", () => {
  it("same account proven by sub -> stored refresh token retained, original connected_at kept", async () => {
    seed("tenant-a", "google_gsc", { google_account_sub: "sub-same", refresh_token: "keep-me" });
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = fakeIdToken("sub-same", "same@account.example");
    const res = await GET(makeRequest(makeState("tenant-a")));
    expect(locationOf(res).searchParams.get("connected")).toBe("google_gsc");
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.refresh_token).toBe("keep-me");
    expect(a.connected_at).toBe("2026-07-01T00:00:00.000Z");
  });

  it("SOFT-FAILED stored read -> NO write of any kind, ?error=refresh_token_missing", async () => {
    seed("tenant-a", "google_gsc", { refresh_token: "healthy-do-not-touch" });
    _readFails = true; // the verified hole: a transient read failure must ABORT, not erase
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = fakeIdToken("sub-stored");
    const res = await GET(makeRequest(makeState("tenant-a")));
    expect(locationOf(res).searchParams.get("error")).toBe("refresh_token_missing");
    expect(_saveCalls).toHaveLength(0);
    expect(_store.get("tenant-a:google_gsc")!.refresh_token).toBe("healthy-do-not-touch");
  });

  it("nothing stored + no refresh token from Google -> NO write, ?error=refresh_token_missing", async () => {
    _exchangeBody.refresh_token = undefined;
    const res = await GET(makeRequest(makeState("tenant-a")));
    expect(locationOf(res).searchParams.get("error")).toBe("refresh_token_missing");
    expect(_saveCalls).toHaveLength(0);
    expect(_store.has("tenant-a:google_gsc")).toBe(false);
  });

  it("stored token exists but the account can NOT be proven the same (no identity) -> NO write", async () => {
    seed("tenant-a", "google_gsc", { refresh_token: "keep-me", google_account_sub: "sub-stored" });
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = undefined; // identity unknown -> retention would be a guess
    const res = await GET(makeRequest(makeState("tenant-a")));
    expect(locationOf(res).searchParams.get("error")).toBe("refresh_token_missing");
    expect(_saveCalls).toHaveLength(0);
    expect(_store.get("tenant-a:google_gsc")!.refresh_token).toBe("keep-me");
  });
});

describe("operator regression (d): a replacement can never accidentally retain the old account's token", () => {
  it("replace intent + DIFFERENT sub + no refresh token -> rejected, stored row untouched, ?error=account_mismatch", async () => {
    seed("tenant-a", "google_ga4", { provider: "google_ga4", google_account_sub: "sub-old", refresh_token: "old-refresh" });
    const before = JSON.stringify(_store.get("tenant-a:google_ga4"));
    _exchangeBody.refresh_token = undefined;
    _exchangeBody.id_token = fakeIdToken("sub-different", "different@account.example");
    const res = await GET(makeRequest(makeState("tenant-a", "ga4", "replace")));
    expect(locationOf(res).searchParams.get("error")).toBe("account_mismatch");
    expect(_saveCalls).toHaveLength(0);
    expect(JSON.stringify(_store.get("tenant-a:google_ga4"))).toBe(before);
  });
});

describe("account identity persistence", () => {
  it("sub + email from the id_token land on the payload (powers 'Connected as <email>')", async () => {
    _exchangeBody.id_token = fakeIdToken("sub-42", "owner@site.example");
    await GET(makeRequest(makeState("tenant-a")));
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.google_account_sub).toBe("sub-42");
    expect(a.google_account_email).toBe("owner@site.example");
  });

  it("an id_token with the WRONG audience is rejected as identity (grant still saved, no identity fields)", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    _exchangeBody.id_token = `${b64({ alg: "RS256" })}.${b64({ sub: "sub-evil", iss: "accounts.google.com", aud: "someone-else" })}.sig`;
    await GET(makeRequest(makeState("tenant-a")));
    const a = _store.get("tenant-a:google_gsc")!;
    expect(a.google_account_sub).toBeUndefined();
    expect(a.refresh_token).toBe("fresh-refresh");
  });
});
