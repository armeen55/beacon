/**
 * wave-9 (2026-06-14) — resolveGscAccessToken must PERSIST the refreshed
 * access_token back to the connector store, not just use it in-memory.
 *
 * Pre-fix: every nightly GSC sync re-read the same stale token and called
 * refreshGoogleAccessToken AGAIN — burning a Google OAuth refresh per tenant
 * per fire (~9/day across 3 tenants × 3 fires) for no reason, and masking
 * persistence health. Persisting the refreshed token lets the NEXT sync read
 * a fresh token. Persistence is best-effort: a write failure must NOT break
 * the current sync (the in-memory token is valid for this run).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getGoogleConnectorToken: vi.fn(),
  updateConnectorToken: vi.fn(),
  persistRefreshedGoogleToken: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
}));
const {
  getGoogleConnectorToken,
  persistRefreshedGoogleToken,
  refreshGoogleAccessToken,
} = mocks;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: mocks.getGoogleConnectorToken,
  updateConnectorToken: mocks.updateConnectorToken,
  persistRefreshedGoogleToken: mocks.persistRefreshedGoogleToken,
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: mocks.refreshGoogleAccessToken,
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { resolveGscAccessToken } from "@/lib/connectors/gsc/search-analytics";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** A grant whose access token JUST expired → evaluateExpiry = stale_under_7d. */
function staleToken() {
  return {
    provider: "google_gsc",
    access_token: "old-access",
    refresh_token: "refresh-abc",
    expires_at: Date.now() - 60_000, // 1 min in the past
    connected_at: "2026-06-01T00:00:00Z",
    scopes: [SCOPE],
  };
}

beforeEach(() => {
  getGoogleConnectorToken.mockReset();
  persistRefreshedGoogleToken.mockReset();
  persistRefreshedGoogleToken.mockResolvedValue(undefined);
  refreshGoogleAccessToken.mockReset();
});

describe("resolveGscAccessToken — persists the refreshed token via the CAS (wave-9)", () => {
  it("routes the refreshed access_token + expiry through persistRefreshedGoogleToken for the tenant", async () => {
    getGoogleConnectorToken.mockResolvedValue(staleToken());
    refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });

    const result = await resolveGscAccessToken("tenant-x");

    expect(result).toBe("new-access");
    // Review P1-1: token fields persist through the guarded compare-and-swap
    // (mode 'refresh'), NOT updateConnectorToken (whose patch path refuses them).
    expect(persistRefreshedGoogleToken).toHaveBeenCalledTimes(1);
    const [provider, refreshed, tenantId] = persistRefreshedGoogleToken.mock
      .calls[0] as unknown as [
      string,
      { access_token: string; expires_in: number; refresh_token?: string },
      string,
    ];
    expect(provider).toBe("google_gsc");
    expect(tenantId).toBe("tenant-x");
    expect(refreshed.access_token).toBe("new-access");
    expect(refreshed.expires_in).toBe(3600);
  });

  it("still returns the refreshed token when persistence fails (best-effort; sync not broken)", async () => {
    getGoogleConnectorToken.mockResolvedValue(staleToken());
    refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });
    persistRefreshedGoogleToken.mockRejectedValue(
      new Error("supabase write failed"),
    );

    const result = await resolveGscAccessToken("tenant-x");
    expect(result).toBe("new-access");
  });

  // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): a rotated refresh token must be
  // persisted, or the app keeps using an OLD token Google may have invalidated.
  it("(b) persists a ROTATED refresh_token when Google returns one", async () => {
    getGoogleConnectorToken.mockResolvedValue(staleToken());
    refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
      refresh_token: "rotated-refresh-xyz",
    });

    const result = await resolveGscAccessToken("tenant-x");

    expect(result).toBe("new-access");
    expect(persistRefreshedGoogleToken).toHaveBeenCalledTimes(1);
    const refreshed = persistRefreshedGoogleToken.mock.calls[0]![1] as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    expect(refreshed.access_token).toBe("new-access");
    expect(refreshed.refresh_token).toBe("rotated-refresh-xyz");
  });

  it("does NOT write refresh_token when Google rotates none (never blanks the stored token)", async () => {
    getGoogleConnectorToken.mockResolvedValue(staleToken());
    refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });

    await resolveGscAccessToken("tenant-x");

    const refreshed = persistRefreshedGoogleToken.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect("refresh_token" in refreshed).toBe(false);
  });
});
