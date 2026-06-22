/**
 * Reconnect signal (2026-06-15) — syncGscSearchAnalyticsForTenant persists an
 * `auth_failed_at` marker on the google_gsc token row from its TERMINAL
 * branches, so getConnectorHealth can surface a "Reconnect Google" state from
 * a render (no live HTTP):
 *
 *   • access token cannot resolve + the token row exists (broken grant) →
 *     classifyMissingGscToken returns "gsc_token_expired" → STAMP auth_failed_at.
 *   • access token cannot resolve + NO token row (never connected) →
 *     "no_usable_gsc_token" → do NOT stamp (would fabricate a reconnect prompt).
 *   • a mid-sync 401/403 that survives the refresh-retry → STAMP auth_failed_at.
 *   • the access token resolves (grant alive) → CLEAR auth_failed_at (null),
 *     covering every synced:true return.
 *   • a token-write error is FAIL-SOFT: the sync's own return value is
 *     unchanged and nothing throws.
 *
 * All writes are tenant-scoped (RAILS: tenant isolation sacred).
 *
 * The sync's data collaborators (resolveGscAccessToken, pullDayRows,
 * gscListSites, pickGscPropertyForDomain, forceRefreshGscAccessToken) and
 * Supabase are mocked; we assert ONLY on updateConnectorToken calls + the
 * sync's return shape.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getGoogleConnectorToken: vi.fn(),
  updateConnectorToken: vi.fn(),
  resolveGscAccessToken: vi.fn(),
  forceRefreshGscAccessToken: vi.fn(),
  pullDayRows: vi.fn(),
  gscListSites: vi.fn(),
  pickGscPropertyForDomain: vi.fn(),
  getBusinessConfig: vi.fn(),
  getTenant: vi.fn(),
  supabaseUpsert: vi.fn(),
  supabaseSelect: vi.fn(),
}));

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: mocks.getGoogleConnectorToken,
  updateConnectorToken: mocks.updateConnectorToken,
}));

vi.mock("@/lib/connectors/gsc/search-analytics", () => ({
  resolveGscAccessToken: mocks.resolveGscAccessToken,
  forceRefreshGscAccessToken: mocks.forceRefreshGscAccessToken,
  pullDayRows: mocks.pullDayRows,
  gscListSites: mocks.gscListSites,
  pickGscPropertyForDomain: mocks.pickGscPropertyForDomain,
}));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: mocks.getBusinessConfig,
}));

vi.mock("@/domains/tenants/store", () => ({
  getTenant: mocks.getTenant,
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Minimal Supabase admin stub: readWatermark does .select().eq()...limit();
// the row upserts do .from().upsert(). We return no watermark + no-error
// upserts so the loop runs cleanly.
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        upsert: (...a: unknown[]) => mocks.supabaseUpsert(...a),
      };
      return builder;
    },
  }),
}));

import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const NOW = new Date("2026-06-15T12:00:00Z");

function gscTokenRow() {
  return {
    provider: "google_gsc",
    access_token: "tok",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600_000,
    connected_at: "2026-06-01T00:00:00Z",
    scopes: [SCOPE],
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.updateConnectorToken.mockResolvedValue(undefined);
  mocks.supabaseUpsert.mockResolvedValue({ error: null });
  mocks.getBusinessConfig.mockReturnValue({ domain: "iranopedia.com" });
  mocks.gscListSites.mockResolvedValue([]);
  mocks.pickGscPropertyForDomain.mockReturnValue("sc-domain:iranopedia.com");
});

describe("syncGscSearchAnalyticsForTenant — stamps auth_failed_at on a broken grant", () => {
  it("token row exists but access token can't resolve (gsc_token_expired) → STAMP", async () => {
    mocks.resolveGscAccessToken.mockResolvedValue(null);
    // classifyMissingGscToken reads the row → a present, in-scope token means
    // the grant broke → "gsc_token_expired". The token is GENUINELY dead here
    // (expired long ago): the race-safe stamp (2026-06-22) re-reads the row and
    // only stamps when the grant is truly unusable — a still-valid expires_at
    // would mean a concurrent run refreshed it, and we'd clear instead.
    mocks.getGoogleConnectorToken.mockResolvedValue({
      ...gscTokenRow(),
      expires_at: Date.now() - 10 * 86_400_000, // expired 10 days ago = dead grant
    });

    const r = await syncGscSearchAnalyticsForTenant({ tenantId: "t1", now: NOW });
    expect(r).toEqual({ synced: false, reason: "gsc_token_expired" });

    expect(mocks.updateConnectorToken).toHaveBeenCalledTimes(1);
    const [provider, patch, tenantId] = mocks.updateConnectorToken.mock.calls[0]!;
    expect(provider).toBe("google_gsc");
    expect(typeof (patch as { auth_failed_at: unknown }).auth_failed_at).toBe(
      "string",
    );
    expect(tenantId).toBe("t1");
  });

  it("NO token row (never connected, no_usable_gsc_token) → does NOT stamp", async () => {
    mocks.resolveGscAccessToken.mockResolvedValue(null);
    mocks.getGoogleConnectorToken.mockResolvedValue(null);

    const r = await syncGscSearchAnalyticsForTenant({ tenantId: "t1", now: NOW });
    expect(r).toEqual({ synced: false, reason: "no_usable_gsc_token" });
    expect(mocks.updateConnectorToken).not.toHaveBeenCalled();
  });

  it("mid-sync 401 that survives the retry → STAMP auth_failed_at", async () => {
    mocks.resolveGscAccessToken.mockResolvedValue("tok");
    // pullDayRows reports an auth failure via the onAuthFailure callback.
    mocks.pullDayRows.mockImplementation(
      async (args: { onAuthFailure?: (s: number) => void }) => {
        args.onAuthFailure?.(401);
        return null;
      },
    );

    const r = await syncGscSearchAnalyticsForTenant({ tenantId: "t1", now: NOW });
    expect(r).toEqual({ synced: false, reason: "gsc_auth_failed_401" });

    // The success-path CLEAR fires first (access token resolved), then the
    // mid-sync failure STAMPS — so the LAST write must be the stamp.
    const calls = mocks.updateConnectorToken.mock.calls;
    const last = calls[calls.length - 1]!;
    expect(last[0]).toBe("google_gsc");
    expect(typeof (last[1] as { auth_failed_at: unknown }).auth_failed_at).toBe(
      "string",
    );
    expect(last[2]).toBe("t1");
  });
});

describe("syncGscSearchAnalyticsForTenant — clears auth_failed_at on a live grant", () => {
  it("access token resolves + a clean day pulls → CLEAR (auth_failed_at: null), synced:true", async () => {
    mocks.resolveGscAccessToken.mockResolvedValue("tok");
    // Every pullDayRows call returns one row, no auth failure.
    mocks.pullDayRows.mockResolvedValue([
      { keys: ["/p", "q"], clicks: 1, impressions: 10, ctr: 0.1, position: 2 },
    ]);

    const r = await syncGscSearchAnalyticsForTenant({ tenantId: "t1", now: NOW });
    expect((r as { synced: boolean }).synced).toBe(true);

    // The clear fires once, right after the access token resolves.
    expect(mocks.updateConnectorToken).toHaveBeenCalled();
    const clearCall = mocks.updateConnectorToken.mock.calls[0]!;
    expect(clearCall[0]).toBe("google_gsc");
    expect((clearCall[1] as { auth_failed_at: unknown }).auth_failed_at).toBeNull();
    expect(clearCall[2]).toBe("t1");
  });
});

describe("syncGscSearchAnalyticsForTenant — token-write is fail-soft", () => {
  it("a stamp write error does NOT change the sync's return value or throw", async () => {
    mocks.resolveGscAccessToken.mockResolvedValue(null);
    mocks.getGoogleConnectorToken.mockResolvedValue(gscTokenRow());
    mocks.updateConnectorToken.mockRejectedValue(new Error("supabase down"));

    const r = await syncGscSearchAnalyticsForTenant({ tenantId: "t1", now: NOW });
    expect(r).toEqual({ synced: false, reason: "gsc_token_expired" });
  });

  it("a clear write error does NOT change a successful sync's return value or throw", async () => {
    mocks.resolveGscAccessToken.mockResolvedValue("tok");
    mocks.pullDayRows.mockResolvedValue([]);
    mocks.updateConnectorToken.mockRejectedValue(new Error("supabase down"));

    const r = await syncGscSearchAnalyticsForTenant({ tenantId: "t1", now: NOW });
    expect((r as { synced: boolean }).synced).toBe(true);
  });
});
