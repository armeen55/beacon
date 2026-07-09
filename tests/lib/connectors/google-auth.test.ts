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
// has no live refresh token to keep. buildGoogleAuthUrl is the enforceable
// unit: `forceConsent` drives `prompt`. The store-read decision (only force
// consent when there is no live refresh token for the tenant+provider) lives
// in getGoogleAuthUrl and passes the flag here.
// ─────────────────────────────────────────────────────────────────────
describe("buildGoogleAuthUrl — FIX 2 conditional consent", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to prompt=consent (first connect / reconnect-after-death path)", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "s"));
    expect(url.searchParams.get("prompt")).toBe("consent");
    // Offline access preserved so a genuine first consent still mints a
    // refresh token; granted scopes carried forward so re-auth never narrows.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("forceConsent=true → prompt=consent", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "s", true));
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("forceConsent=false → prompt=select_account, never consent (mints NO new refresh token)", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "s", false));
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("prompt")).not.toBe("consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
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
