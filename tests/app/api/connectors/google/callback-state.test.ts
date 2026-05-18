/**
 * 2026-05-16 — connector-tokens-supabase-and-gsc-scope-split.
 *
 * Pins the OAuth callback state-validation contract:
 *   • Valid signed state with kind="gsc" stores under provider="google_gsc".
 *   • Valid signed state with kind="gbp" stores under provider="google_gbp".
 *   • Tampered/missing state redirects with ?error=invalid_state and
 *     does NOT save a token.
 *   • Expired state same.
 *   • Token-exchange failure redirects with ?error=exchange_failed.
 *   • Persistence failure redirects with ?error=persistence_failed.
 *   • Real Google API is NEVER called — fetch is fully mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const _savedTokens: Array<{
  provider: string;
  payload: unknown;
  tenantId: string | undefined;
}> = [];
let _saveError: Error | null = null;

vi.mock("@/lib/connector-store", () => ({
  saveConnectorToken: vi.fn(async (token: unknown, tenantId?: string) => {
    if (_saveError) throw _saveError;
    _savedTokens.push({
      provider: (token as { provider: string }).provider,
      payload: token,
      tenantId,
    });
  }),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

let _exchangeOk = true;
let _exchangeBody: Record<string, unknown> = {};

import { GET } from "@/app/api/connectors/google/callback/route";
import { encodeOAuthState } from "@/lib/connectors/google-auth";

beforeEach(() => {
  _savedTokens.length = 0;
  _saveError = null;
  _exchangeOk = true;
  _exchangeBody = {
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  };
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "test-state-secret-callback-test-32+");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string) => {
      return new Response(JSON.stringify(_exchangeBody), {
        status: _exchangeOk ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

describe("callback — state validation", () => {
  it("valid gsc state → stores token under google_gsc and redirects ?connected=google_gsc", async () => {
    const state = encodeOAuthState({
      k: "gsc",
      t: "tenant-alpha",
      n: "nonce",
      i: Date.now(),
    });
    const res = await GET(makeRequest({ code: "auth-code-abc", state }));
    expect(res.status).toBe(307);
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/settings/connectors");
    expect(loc.searchParams.get("connected")).toBe("google_gsc");
    expect(_savedTokens).toHaveLength(1);
    expect(_savedTokens[0]!.provider).toBe("google_gsc");
    expect(_savedTokens[0]!.tenantId).toBe("tenant-alpha");
  });

  it("valid gbp state → stores token under google_gbp and redirects ?connected=google_gbp", async () => {
    const state = encodeOAuthState({
      k: "gbp",
      t: "tenant-alpha",
      n: "nonce",
      i: Date.now(),
    });
    const res = await GET(makeRequest({ code: "auth-code-abc", state }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("connected")).toBe("google_gbp");
    expect(_savedTokens[0]!.provider).toBe("google_gbp");
  });

  it("missing state → redirects ?error=invalid_state, no token saved", async () => {
    const res = await GET(makeRequest({ code: "auth-code-abc" }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("invalid_state");
    expect(_savedTokens).toHaveLength(0);
  });

  it("tampered state → redirects ?error=invalid_state, no token saved", async () => {
    const valid = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "n",
      i: Date.now(),
    });
    const [body, sig] = valid.split(".");
    const tampered = `${body}.${sig!.slice(0, -2)}00`;
    const res = await GET(makeRequest({ code: "abc", state: tampered }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("invalid_state");
    expect(_savedTokens).toHaveLength(0);
  });

  it("expired state → redirects ?error=invalid_state, no token saved", async () => {
    const expired = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "n",
      i: Date.now() - 11 * 60 * 1000,
    });
    const res = await GET(makeRequest({ code: "abc", state: expired }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("invalid_state");
    expect(_savedTokens).toHaveLength(0);
  });
});

describe("callback — failure modes", () => {
  it("user-denied error param → ?error=access_denied", async () => {
    const res = await GET(makeRequest({ error: "access_denied" }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(_savedTokens).toHaveLength(0);
  });

  it("missing code → ?error=no_code", async () => {
    const state = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "n",
      i: Date.now(),
    });
    const res = await GET(makeRequest({ state }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("no_code");
    expect(_savedTokens).toHaveLength(0);
  });

  it("token exchange failure → ?error=exchange_failed, no token saved", async () => {
    _exchangeOk = false;
    _exchangeBody = { error: "invalid_grant" };
    const state = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "n",
      i: Date.now(),
    });
    const res = await GET(makeRequest({ code: "bad-code", state }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("exchange_failed");
    expect(_savedTokens).toHaveLength(0);
  });

  it("persistence failure → ?error=persistence_failed, exchange happened but no token persists", async () => {
    _saveError = new Error("connector-store: save failed");
    const state = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "n",
      i: Date.now(),
    });
    const res = await GET(makeRequest({ code: "abc", state }));
    const loc = locationOf(res);
    expect(loc.searchParams.get("error")).toBe("persistence_failed");
    expect(_savedTokens).toHaveLength(0);
  });
});

describe("callback — token shape", () => {
  it("saved token carries scopes split from Google's response", async () => {
    _exchangeBody = {
      access_token: "scope-token",
      refresh_token: "scope-refresh",
      expires_in: 1800,
      token_type: "Bearer",
      scope:
        "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/userinfo.email",
    };
    const state = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "n",
      i: Date.now(),
    });
    await GET(makeRequest({ code: "abc", state }));
    expect(_savedTokens).toHaveLength(1);
    const payload = _savedTokens[0]!.payload as {
      scopes: string[];
      provider: string;
    };
    expect(payload.provider).toBe("google_gsc");
    expect(payload.scopes).toContain(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    expect(payload.scopes.length).toBe(2);
  });
});
