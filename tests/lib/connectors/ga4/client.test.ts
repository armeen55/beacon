/**
 * 2026-05-18 — Slice 9.A1 — `ga4ApiFetch` unit tests.
 *
 * Pins the structured fail-soft contract:
 *   • Missing token → { ok: false, reason: "no_token" }.
 *   • Token without analytics.readonly scope → { ok: false,
 *     reason: "no_token", message: "missing scope" }.
 *   • Token with disconnected_at set → { ok: false, reason:
 *     "disconnected" } (no fetch).
 *   • Expiry-handler stale_over_7d → { ok: false, reason:
 *     "token_expired" }.
 *   • Happy path (fresh token + 200 response) → { ok: true, data }.
 *   • Non-2xx response → { ok: false, reason: "api_error",
 *     status }.
 *   • 401 with successful refresh-and-retry → { ok: true, data }.
 *   • Missing tenantId → { ok: false, reason: "no_token", message:
 *     "missing tenantId" }.
 *   • Missing url → { ok: false, reason: "api_error", message:
 *     "missing url" }.
 *
 * All tests mock fetch + connector-store + google-auth refresh — no
 * real network calls, no real Supabase calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _ga4Token: GoogleConnectorToken | null = null;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" | "ga4") => {
    if (kind !== "ga4") return null;
    return _ga4Token;
  }),
  // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): rotated-refresh-token persist. No-op.
  persistRefreshedGoogleToken: vi.fn(async () => {}),
}));

let _refreshShouldThrow = false;
let _refreshAccessToken = "refreshed-token";

vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async (_rt: string) => {
    if (_refreshShouldThrow) {
      throw new Error("refresh failed");
    }
    return { access_token: _refreshAccessToken, expires_in: 3600 };
  }),
}));

// Re-import after mocking.
import { ga4ApiFetch } from "@/lib/connectors/ga4/client";

const NOW_MS = Date.UTC(2026, 4, 18, 12, 0, 0); // 2026-05-18T12:00:00Z

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_ga4",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW_MS + 30 * 60 * 1000, // fresh: 30 min from "now"
    connected_at: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ...over,
  };
}

beforeEach(() => {
  _ga4Token = null;
  _refreshShouldThrow = false;
  _refreshAccessToken = "refreshed-token";
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("ga4ApiFetch — fail-soft paths", () => {
  it("returns no_token when tenantId is empty", async () => {
    const r = await ga4ApiFetch({
      tenantId: "",
      url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({
      ok: false,
      reason: "no_token",
      message: "missing tenantId",
    });
  });

  it("returns api_error when url is empty", async () => {
    _ga4Token = makeToken();
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({
      ok: false,
      reason: "api_error",
      message: "missing url",
    });
  });

  it("returns no_token when no GA4 token exists", async () => {
    _ga4Token = null;
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({ ok: false, reason: "no_token" });
  });

  it("returns no_token when token lacks analytics.readonly scope", async () => {
    _ga4Token = makeToken({ scopes: ["https://example/wrong"] });
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({
      ok: false,
      reason: "no_token",
      message: "missing scope",
    });
  });

  it("returns disconnected when token has disconnected_at set", async () => {
    _ga4Token = makeToken({ disconnected_at: "2026-05-10T08:00:00.000Z" });
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });

  it("returns token_expired when expires_at is > 7 days past", async () => {
    _ga4Token = makeToken({
      expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000, // 30d past
    });
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("token_expired");
  });
});

describe("ga4ApiFetch — happy path", () => {
  it("returns ok:true + data on 200 response", async () => {
    _ga4Token = makeToken();
    const stubFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ accountSummaries: [] }), { status: 200 }),
    );
    const r = await ga4ApiFetch<{ accountSummaries: unknown[] }>({
      tenantId: "tenant-x",
      url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ accountSummaries: [] });
    }
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const call = stubFetch.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-abc",
    );
  });

  it("returns api_error on non-2xx non-401 response", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("api_error");
      expect(r.status).toBe(403);
    }
  });

  it("returns api_error when fetch throws", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("api_error");
    }
  });
});

describe("ga4ApiFetch — refresh-on-401 path", () => {
  it("returns ok:true after a successful refresh + retry", async () => {
    _ga4Token = makeToken();
    _refreshAccessToken = "fresh-after-401";
    const stubFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accountSummaries: [] }), { status: 200 }),
      );
    const r = await ga4ApiFetch<{ accountSummaries: unknown[] }>({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(true);
    // Second fetch carries the refreshed token.
    const secondCall = stubFetch.mock.calls[1]!;
    const init = secondCall[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fresh-after-401",
    );
  });

  it("returns token_expired when refresh-on-401 throws", async () => {
    _ga4Token = makeToken();
    _refreshShouldThrow = true;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("token_expired");
    }
  });
});
