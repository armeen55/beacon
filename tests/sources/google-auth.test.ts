import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// FIX 4 (OAUTH_ROOT_CAUSE_2026-07-09): refreshGoogleAccessToken now logs a
// refresh-token FINGERPRINT (never the token itself) at debug on success and
// one structured line on a dead grant. Spy on the logger to pin that contract.
const { logErrorSpy, logDebugSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(),
  logDebugSpy: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  log: {
    debug: logDebugSpy,
    info: vi.fn(),
    warn: vi.fn(),
    error: logErrorSpy,
  },
}));

import {
  buildGoogleAuthUrl,
  getRedirectUri,
  GOOGLE_CALLBACK_PATH,
  refreshGoogleAccessToken,
} from "@/lib/connectors/google-auth";

describe("google-auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getRedirectUri", () => {
    it("defaults to localhost:3000 when NEXT_PUBLIC_APP_URL is unset", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      expect(getRedirectUri()).toBe(`http://localhost:3000${GOOGLE_CALLBACK_PATH}`);
    });

    it("uses NEXT_PUBLIC_APP_URL when set", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
      expect(getRedirectUri()).toBe(
        `https://app.example.com${GOOGLE_CALLBACK_PATH}`,
      );
    });

    it("strips trailing slashes from base URL", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
      expect(getRedirectUri()).toBe(
        `https://app.example.com${GOOGLE_CALLBACK_PATH}`,
      );
    });
  });

  describe("buildGoogleAuthUrl", () => {
    it("throws if GOOGLE_CLIENT_ID is not set", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      expect(() => buildGoogleAuthUrl("gsc", "state-token")).toThrow("GOOGLE_CLIENT_ID");
    });

    it("throws if state is empty", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
      expect(() => buildGoogleAuthUrl("gsc", "")).toThrow(/state parameter is required/);
    });

    it("builds a valid auth URL with required params (gsc)", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

      const url = new URL(buildGoogleAuthUrl("gsc", "signed-state-token"));
      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(url.searchParams.get("client_id")).toBe(
        "test-client-id.apps.googleusercontent.com",
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("redirect_uri")).toContain(
        GOOGLE_CALLBACK_PATH,
      );
      expect(url.searchParams.get("state")).toBe("signed-state-token");
    });

    it("callback path is unchanged after scope split", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-id");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
      const url = new URL(buildGoogleAuthUrl("gsc", "state"));
      // Existing redirect URI shape preserved verbatim.
      expect(url.searchParams.get("redirect_uri")).toBe(
        `https://app.example.com${GOOGLE_CALLBACK_PATH}`,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// FIX 2 (OAUTH_ROOT_CAUSE_2026-07-09) — consent forced ONLY when the caller
// has no live refresh token to keep. Superseded by the per-tenant OAuth
// intent model (2026-07-09): every OAuth flow reachable through the product is
// a DELIBERATE (re)authorization (connect / replace / reauth), ordinary syncs
// never run OAuth, so every intent shows the account chooser AND forces a
// fresh consent (the chosen account mints its own refresh token). The intent
// decision (verified against the stored token) lives in getGoogleAuthUrl.
// ─────────────────────────────────────────────────────────────────────
describe("buildGoogleAuthUrl — per-tenant OAuth intent model", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to intent=connect: account chooser + consent, offline access, granted scopes carried", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "s"));
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    // Offline access preserved so a consent mints a refresh token; granted
    // scopes carried forward so a per-kind re-auth never narrows the grant.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("every deliberate intent (connect / replace / reauth) shows the chooser AND forces consent", () => {
    for (const intent of ["connect", "replace", "reauth"] as const) {
      const url = new URL(buildGoogleAuthUrl("gsc", "s", intent));
      expect(url.searchParams.get("prompt")).toBe("consent select_account");
      expect(url.searchParams.get("access_type")).toBe("offline");
    }
  });

  it("LEAST-PRIVILEGE SCOPES stay separate per kind; only identity scopes ride along", () => {
    // Operator regression (f): the GSC flow must never request the GA4 scope
    // and vice versa; openid + email are the only shared (identity) scopes.
    const gsc = new URL(buildGoogleAuthUrl("gsc", "s")).searchParams.get("scope") ?? "";
    const ga4 = new URL(buildGoogleAuthUrl("ga4", "s")).searchParams.get("scope") ?? "";
    expect(gsc).toContain("https://www.googleapis.com/auth/webmasters.readonly");
    expect(gsc).toContain("openid");
    expect(gsc).toContain("email");
    expect(gsc).not.toContain("analytics.readonly");
    expect(gsc).not.toContain("business.manage");
    expect(ga4).toContain("https://www.googleapis.com/auth/analytics.readonly");
    expect(ga4).toContain("openid");
    expect(ga4).toContain("email");
    expect(ga4).not.toContain("webmasters.readonly");
    expect(ga4).not.toContain("business.manage");
  });
});

// ─────────────────────────────────────────────────────────────────────
// FIX 3 (rotation persisted) + FIX 4 (traceable diagnostics)
// ─────────────────────────────────────────────────────────────────────
describe("refreshGoogleAccessToken — FIX 3 rotation + FIX 4 diagnostics", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    logErrorSpy.mockClear();
    logDebugSpy.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = realFetch;
  });

  function stubFetch(status: number, body: unknown): void {
    global.fetch = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
  }

  it("(b) returns a rotated refresh_token when Google sends one", async () => {
    stubFetch(200, {
      access_token: "at-new",
      expires_in: 3600,
      refresh_token: "rt-rotated",
    });
    const r = await refreshGoogleAccessToken("rt-old");
    expect(r.access_token).toBe("at-new");
    expect(r.refresh_token).toBe("rt-rotated");
  });

  it("omits refresh_token when Google returns none (a persist must never blank the stored token)", async () => {
    stubFetch(200, { access_token: "at-new", expires_in: 3600 });
    const r = await refreshGoogleAccessToken("rt-old");
    expect(r.access_token).toBe("at-new");
    expect("refresh_token" in r).toBe(false);
  });

  it("logs an 8-hex fingerprint (never the token) at debug on a successful refresh", async () => {
    stubFetch(200, { access_token: "at", expires_in: 3600 });
    await refreshGoogleAccessToken("rt-secret-value", {
      provider: "google_gsc",
      tenantId: "t1",
    });
    expect(logDebugSpy).toHaveBeenCalledTimes(1);
    const ctx = logDebugSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(typeof ctx.refreshFp).toBe("string");
    expect((ctx.refreshFp as string)).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(ctx.refreshFp as string)).toBe(true);
    // The raw token must NEVER appear anywhere in the logged context.
    expect(JSON.stringify(ctx)).not.toContain("rt-secret-value");
  });

  it("(c) invalid_grant logs ONE structured dead-grant line with the fingerprint, age, and error_description", async () => {
    stubFetch(400, {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    });
    const connectedAt = new Date(Date.now() - 7 * 86_400_000).toISOString();
    await expect(
      refreshGoogleAccessToken("rt-dead-token", {
        provider: "google_gsc",
        tenantId: "tenant-x",
        connectedAt,
      }),
    ).rejects.toThrow(/invalid_grant/);

    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    const [msg, ctxRaw] = logErrorSpy.mock.calls[0]!;
    const ctx = ctxRaw as Record<string, unknown>;
    expect(String(msg)).toMatch(/dead/i);
    expect(ctx.provider).toBe("google_gsc");
    expect(ctx.tenantId).toBe("tenant-x");
    expect((ctx.refreshFp as string)).toHaveLength(8);
    expect(ctx.googleError).toBe("invalid_grant");
    expect(String(ctx.googleErrorDescription)).toMatch(/expired or revoked/i);
    expect(Number(ctx.tokenAgeDays)).toBeGreaterThanOrEqual(6.9);
    // never logs the token
    expect(JSON.stringify(ctx)).not.toContain("rt-dead-token");
  });

  it("a transient 5xx logs the NON-dead-grant line (never false-alarms a reconnect)", async () => {
    stubFetch(503, { error: "backend_error" });
    await expect(refreshGoogleAccessToken("rt-live")).rejects.toThrow(/503/);
    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    const [msg] = logErrorSpy.mock.calls[0]!;
    expect(String(msg)).not.toMatch(/dead/i);
  });
});


// ─────────────────────────────────────────────────────────────────────
// Scope split + signed state (merged from google-auth-scope-split.test.ts)
// ─────────────────────────────────────────────────────────────────────

import {
  encodeOAuthState,
  decodeOAuthState,
  generateOAuthNonce,
} from "@/lib/connectors/google-auth";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

describe("google-auth scope split + signed state", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "test-state-secret-32-chars-minimum");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("each kind requests EXACTLY ONE data scope (plus openid+email identity scopes)", () => {
    const gscParts = (new URL(buildGoogleAuthUrl("gsc", "s")).searchParams.get("scope") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    expect(gscParts.filter((s) => s.includes("googleapis.com/auth/"))).toHaveLength(1);
    expect(gscParts.sort()).toEqual([GSC_SCOPE, "email", "openid"].sort());

    const gbpParts = (new URL(buildGoogleAuthUrl("gbp", "s")).searchParams.get("scope") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    expect(gbpParts.filter((s) => s.includes("googleapis.com/auth/"))).toHaveLength(1);
    expect(gbpParts.sort()).toEqual([GBP_SCOPE, "email", "openid"].sort());
  });

  it("encoded state decodes back to the original payload (k preserved for gsc and gbp)", () => {
    const payload = { k: "gsc" as const, t: "tenant-ritz-founder", n: generateOAuthNonce(), i: Date.now() };
    const decoded = decodeOAuthState(encodeOAuthState(payload));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload.t).toBe("tenant-ritz-founder");
    expect(decoded.payload.n).toBe(payload.n);

    const gbp = decodeOAuthState(encodeOAuthState({ k: "gbp", t: "a", n: "n", i: Date.now() }));
    expect(gbp.ok && gbp.payload.k).toBe("gbp");
  });

  it("tampered body fails verification", () => {
    const encoded = encodeOAuthState({ k: "gsc", t: "tenant-a", n: "nonce", i: Date.now() });
    // Flip the FIRST body char (always significant; last-char flips can be
    // byte-level no-ops in base64url).
    const [body, sig] = encoded.split(".");
    const tampered = `${body!.slice(0, 1) === "A" ? "B" : "A"}${body!.slice(1)}.${sig}`;
    const result = decodeOAuthState(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["bad_signature", "malformed"]).toContain(result.reason);
  });

  it("tampered signature fails verification", () => {
    const encoded = encodeOAuthState({ k: "gsc", t: "tenant-a", n: "nonce", i: Date.now() });
    const [body, sig] = encoded.split(".");
    // Hex is case-insensitive; flipping to a different hex NIBBLE is the only
    // guaranteed-different tamper.
    const lastNibble = sig!.slice(-1).toLowerCase();
    const flipped = lastNibble === "0" ? "1" : "0";
    const result = decodeOAuthState(`${body}.${sig!.slice(0, -1)}${flipped}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad_signature");
  });

  it("missing / malformed / expired states are refused with the precise reason", () => {
    expect(decodeOAuthState(null).ok).toBe(false);
    expect(decodeOAuthState("").ok).toBe(false);
    const malformed = decodeOAuthState("not-a-valid-encoded-state-no-dots");
    expect(!malformed.ok && malformed.reason).toBe("malformed");
    const expired = decodeOAuthState(
      encodeOAuthState({ k: "gsc", t: "tenant-a", n: "nonce", i: Date.now() - 11 * 60 * 1000 }),
    );
    expect(!expired.ok && expired.reason).toBe("expired");
  });

  it("a different secret fails verification; a missing secret returns secret_missing", () => {
    const encoded = encodeOAuthState({ k: "gsc", t: "tenant-a", n: "nonce", i: Date.now() });
    vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "a-completely-different-secret-32-chars");
    const bad = decodeOAuthState(encoded);
    expect(!bad.ok && bad.reason).toBe("bad_signature");
    vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "");
    const missing = decodeOAuthState("foo.bar");
    expect(!missing.ok && missing.reason).toBe("secret_missing");
  });
});
