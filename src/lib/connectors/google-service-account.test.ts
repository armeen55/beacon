/**
 * Service-account auth path (OAUTH_ROOT_CAUSE_2026-07-09).
 *
 * Pins:
 *   • buildServiceAccountJwtClaims — iss/scope/aud + iat/exp math.
 *   • normalizePrivateKey — literal "\n" → real newline (+ quote strip).
 *   • getServiceAccountAccessToken — per-scope cache (no re-fetch within
 *     expiry; re-fetch once past the skew window); fail-soft null on a
 *     token-endpoint error and when the env is absent.
 *   • Wire-in preference order, ONE test per provider: SA configured → the SA
 *     token is used and the OAuth store is never read; SA absent → the existing
 *     OAuth path is used and the token endpoint is never hit.
 *
 * Real service-account module (driven by env) + a real RSA key so the JWT is
 * genuinely signed; connector-store / google-auth / logger are mocked; fetch is
 * spied. No real network, no real Supabase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getGoogleConnectorToken: vi.fn(),
  updateConnectorToken: vi.fn(),
  persistRefreshedGoogleToken: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: mocks.getGoogleConnectorToken,
  updateConnectorToken: mocks.updateConnectorToken,
  persistRefreshedGoogleToken: mocks.persistRefreshedGoogleToken,
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: mocks.refreshGoogleAccessToken,
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  isServiceAccountConfigured,
  getServiceAccountAccessToken,
  buildServiceAccountJwtClaims,
  normalizePrivateKey,
  __testing,
} from "@/lib/connectors/google-service-account";
import { resolveGscAccessToken } from "@/lib/connectors/gsc/search-analytics";
import { ga4ApiFetch } from "@/lib/connectors/ga4/client";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GA4_ADMIN_URL =
  "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";

// One real RSA keypair for the whole suite — signing must actually succeed.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function tokenResponse(token: string, expiresIn = 3600): Response {
  return jsonResponse({ access_token: token, expires_in: expiresIn });
}

function configureServiceAccount(): void {
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "svc@proj.iam.gserviceaccount.com");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", privateKey);
}

function clearServiceAccountEnv(): void {
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "");
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  const maybe = input as { url?: string };
  return typeof maybe?.url === "string" ? maybe.url : String(input);
}

function freshGscToken() {
  return {
    provider: "google_gsc",
    access_token: "oauth-gsc-access",
    refresh_token: "gsc-refresh",
    expires_at: Date.now() + 60 * 60 * 1000,
    connected_at: "2026-07-01T00:00:00Z",
    scopes: [GSC_SCOPE],
  };
}

function freshGa4Token() {
  return {
    provider: "google_ga4",
    access_token: "oauth-ga4-access",
    refresh_token: "ga4-refresh",
    expires_at: Date.now() + 60 * 60 * 1000,
    connected_at: "2026-07-01T00:00:00Z",
    scopes: [GA4_SCOPE],
    ga4_property_id: "123456789",
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __testing.clearCache();
  mocks.getGoogleConnectorToken.mockReset();
  mocks.updateConnectorToken.mockReset().mockResolvedValue(undefined);
  mocks.persistRefreshedGoogleToken.mockReset().mockResolvedValue(undefined);
  mocks.refreshGoogleAccessToken.mockReset();
  mocks.warn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────
// buildServiceAccountJwtClaims
// ─────────────────────────────────────────────────────────────────────

describe("buildServiceAccountJwtClaims", () => {
  it("sets iss/scope/aud and computes iat/exp (exp = iat + 3600)", () => {
    const nowMs = 1_700_000_000_500; // .5s to prove flooring
    const claims = buildServiceAccountJwtClaims(
      "svc@proj.iam.gserviceaccount.com",
      GA4_SCOPE,
      nowMs,
    );
    expect(claims.iss).toBe("svc@proj.iam.gserviceaccount.com");
    expect(claims.scope).toBe(GA4_SCOPE);
    expect(claims.aud).toBe(TOKEN_ENDPOINT);
    expect(claims.iat).toBe(Math.floor(nowMs / 1000));
    expect(claims.exp).toBe(claims.iat + 3600);
  });
});

// ─────────────────────────────────────────────────────────────────────
// normalizePrivateKey
// ─────────────────────────────────────────────────────────────────────

describe("normalizePrivateKey", () => {
  it("converts literal \\n sequences into real newlines", () => {
    const raw = "-----BEGIN PRIVATE KEY-----\\nAAAA\\nBBBB\\n-----END PRIVATE KEY-----";
    const out = normalizePrivateKey(raw);
    expect(out).not.toContain("\\n");
    expect(out).toContain("\n");
    expect(out.split("\n")).toEqual([
      "-----BEGIN PRIVATE KEY-----",
      "AAAA",
      "BBBB",
      "-----END PRIVATE KEY-----",
    ]);
  });

  it("strips a surrounding pair of quotes before normalizing", () => {
    const raw = '"-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----"';
    const out = normalizePrivateKey(raw);
    expect(out.startsWith("-----BEGIN")).toBe(true);
    expect(out.endsWith("-----END PRIVATE KEY-----")).toBe(true);
    expect(out).toContain("\n");
  });
});

// ─────────────────────────────────────────────────────────────────────
// isServiceAccountConfigured
// ─────────────────────────────────────────────────────────────────────

describe("isServiceAccountConfigured", () => {
  it("is true only when both env vars are present and non-empty", () => {
    clearServiceAccountEnv();
    expect(isServiceAccountConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "a@b.com");
    expect(isServiceAccountConfigured()).toBe(false); // key still empty
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", privateKey);
    expect(isServiceAccountConfigured()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getServiceAccountAccessToken — cache + fail-soft
// ─────────────────────────────────────────────────────────────────────

describe("getServiceAccountAccessToken — cache", () => {
  it("a second call within expiry reuses the cache and does NOT re-fetch", async () => {
    configureServiceAccount();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(tokenResponse("sa-tok", 3600));

    const first = await getServiceAccountAccessToken(GA4_SCOPE);
    const second = await getServiceAccountAccessToken(GA4_SCOPE);

    expect(first).toBe("sa-tok");
    expect(second).toBe("sa-tok");
    expect(spy).toHaveBeenCalledTimes(1);
    // The token endpoint was hit with the JWT-bearer grant + a signed assertion.
    const [, init] = spy.mock.calls[0]!;
    const body = String((init as RequestInit).body);
    expect(body).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
    );
    expect(body).toContain("assertion=");
  });

  it("re-fetches once the cached token passes the 5-minute skew window", async () => {
    configureServiceAccount();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T00:00:00Z"));
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenResponse("sa-tok-1", 3600))
      .mockResolvedValueOnce(tokenResponse("sa-tok-2", 3600));

    const first = await getServiceAccountAccessToken(GA4_SCOPE);
    expect(first).toBe("sa-tok-1");
    // +56 min: past (expiry - 5 min skew = 55 min) → cache is stale.
    vi.setSystemTime(new Date("2026-07-09T00:56:00Z"));
    const second = await getServiceAccountAccessToken(GA4_SCOPE);

    expect(second).toBe("sa-tok-2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("caches per scope (GSC vs GA4 are independent)", async () => {
    configureServiceAccount();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenResponse("gsc-tok"))
      .mockResolvedValueOnce(tokenResponse("ga4-tok"));

    expect(await getServiceAccountAccessToken(GSC_SCOPE)).toBe("gsc-tok");
    expect(await getServiceAccountAccessToken(GA4_SCOPE)).toBe("ga4-tok");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("getServiceAccountAccessToken — fail-soft", () => {
  it("returns null (no fetch) when the env is absent", async () => {
    clearServiceAccountEnv();
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await getServiceAccountAccessToken(GA4_SCOPE);
    expect(r).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null with one warn when the token endpoint responds non-2xx", async () => {
    configureServiceAccount();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "invalid_grant" }, false, 400),
    );
    const r = await getServiceAccountAccessToken(GA4_SCOPE);
    expect(r).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null when the response omits access_token", async () => {
    configureServiceAccount();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ expires_in: 3600 }));
    const r = await getServiceAccountAccessToken(GA4_SCOPE);
    expect(r).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Wire-in preference order — GSC
// ─────────────────────────────────────────────────────────────────────

describe("wire-in: GSC resolveGscAccessToken preference order", () => {
  it("uses the service-account token when configured and never reads the OAuth store", async () => {
    configureServiceAccount();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenResponse("sa-gsc-token"));

    const r = await resolveGscAccessToken("tenant-x");

    expect(r).toBe("sa-gsc-token");
    expect(mocks.getGoogleConnectorToken).not.toHaveBeenCalled();
  });

  it("falls through to the existing OAuth token when the service account is absent", async () => {
    clearServiceAccountEnv();
    mocks.getGoogleConnectorToken.mockResolvedValue(freshGscToken());
    const spy = vi.spyOn(globalThis, "fetch");

    const r = await resolveGscAccessToken("tenant-x");

    expect(r).toBe("oauth-gsc-access");
    expect(mocks.getGoogleConnectorToken).toHaveBeenCalledTimes(1);
    // No service-account token endpoint call happened.
    expect(spy.mock.calls.some((c) => urlOf(c[0]).includes(TOKEN_ENDPOINT))).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Wire-in preference order — GA4
// ─────────────────────────────────────────────────────────────────────

describe("wire-in: GA4 ga4ApiFetch preference order", () => {
  it("uses the service-account token when configured and never reads the OAuth store", async () => {
    configureServiceAccount();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (urlOf(input).includes(TOKEN_ENDPOINT)) return tokenResponse("sa-ga4-token");
      return jsonResponse({ ok: true });
    });

    const r = await ga4ApiFetch({ tenantId: "tenant-x", url: GA4_ADMIN_URL });

    expect(r.ok).toBe(true);
    expect(mocks.getGoogleConnectorToken).not.toHaveBeenCalled();
    const apiCall = spy.mock.calls.find((c) => urlOf(c[0]).includes("analyticsadmin"));
    const headers = (apiCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sa-ga4-token");
  });

  it("falls through to the existing OAuth token when the service account is absent", async () => {
    clearServiceAccountEnv();
    mocks.getGoogleConnectorToken.mockResolvedValue(freshGa4Token());
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: true }));

    const r = await ga4ApiFetch({ tenantId: "tenant-x", url: GA4_ADMIN_URL });

    expect(r.ok).toBe(true);
    expect(mocks.getGoogleConnectorToken).toHaveBeenCalledTimes(1);
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer oauth-ga4-access");
    expect(spy.mock.calls.some((c) => urlOf(c[0]).includes(TOKEN_ENDPOINT))).toBe(
      false,
    );
  });
});
