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
  refreshGoogleAccessToken: vi.fn(),
}));
const { getGoogleConnectorToken, updateConnectorToken, refreshGoogleAccessToken } =
  mocks;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: mocks.getGoogleConnectorToken,
  updateConnectorToken: mocks.updateConnectorToken,
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
  updateConnectorToken.mockReset();
  updateConnectorToken.mockResolvedValue(undefined);
  refreshGoogleAccessToken.mockReset();
});

describe("resolveGscAccessToken — persists the refreshed token (wave-9)", () => {
  it("writes the refreshed access_token + new expires_at back to the store for the tenant", async () => {
    getGoogleConnectorToken.mockResolvedValue(staleToken());
    refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });

    const result = await resolveGscAccessToken("tenant-x");

    expect(result).toBe("new-access");
    expect(updateConnectorToken).toHaveBeenCalledTimes(1);
    const [provider, patch, tenantId] = updateConnectorToken.mock
      .calls[0] as unknown as [
      string,
      { access_token: string; expires_at: number },
      string,
    ];
    expect(provider).toBe("google_gsc");
    expect(tenantId).toBe("tenant-x");
    expect(patch.access_token).toBe("new-access");
    expect(typeof patch.expires_at).toBe("number");
    // ~ now + 3600s; must be in the future so the next sync reads it as fresh.
    expect(patch.expires_at).toBeGreaterThan(Date.now());
  });

  it("still returns the refreshed token when persistence fails (best-effort; sync not broken)", async () => {
    getGoogleConnectorToken.mockResolvedValue(staleToken());
    refreshGoogleAccessToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });
    updateConnectorToken.mockRejectedValue(new Error("supabase write failed"));

    const result = await resolveGscAccessToken("tenant-x");
    expect(result).toBe("new-access");
  });
});
