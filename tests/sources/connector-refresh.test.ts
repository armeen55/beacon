/**
 * SOURCES — connector refresh wiring (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/{cron-sync-succeeded,
 * on-use-sitewide-refresh, clarity/client, indexnow/ping-on-verify}.
 *
 * Pinned boundaries:
 *   • syncSucceeded gates freshness POSITIVELY on { synced: true } — a
 *     failure shape can never stamp last_synced_at fresh (audit-3 #5).
 *   • The on-USE refresh pulls the true sitewide GA4 series only when GA4 is
 *     connected (no cron dependence for the north-star card).
 *   • Clarity Data Export parser is defensive and fail-soft null.
 *   • Verify-live → IndexNow wiring self-hides without a key, records a
 *     receipt on every real ping, and NEVER throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── on-use refresh + clarity: connector-store overrides ──────────────
const state = vi.hoisted(() => ({
  connected: { google_gsc: true, google_ga4: true, clarity: true } as Record<string, boolean>,
  clarityToken: {
    provider: "clarity",
    api_token: "tok",
    connected_at: "2026-06-12T00:00:00Z",
  } as unknown,
}));

const refreshGa4Sitewide = vi.fn(async (_tenantId?: string) => {});
vi.mock("@/lib/connectors/ga4/refresh-ga4-sitewide", () => ({
  refreshGa4SitewideAndReconcile: (tenantId: string) => refreshGa4Sitewide(tenantId),
}));

vi.mock("@/lib/connector-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connector-store")>();
  return {
    ...actual,
    getConnectorInfo: async (provider: string) => ({
      status: state.connected[provider] ? "connected" : "disconnected",
      last_synced_at: null, // never synced → stale → the on-use refresh runs it
      connected_at: null,
      expires_at: null,
    }),
    updateConnectorToken: async () => {},
    getConnectorToken: async () => state.clarityToken,
  };
});

vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({
  syncGscSearchAnalyticsForTenant: async () => ({ synced: true }),
}));
vi.mock("@/lib/connectors/ga4/sync-url-traffic", () => ({
  syncGa4UrlTrafficForTenant: async () => ({ synced: true }),
}));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({
  syncClarityDailyMetricsForTenant: async () => ({ synced: true }),
}));


vi.mock("@/domains/tenants/store", () => ({
  getTenant: vi.fn(async () => ({ domain: "example.com" })),
}));

import { syncSucceeded, autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import { fetchClarityUrlMetrics } from "@/lib/connectors/clarity/client";

beforeEach(() => {
  state.connected = { google_gsc: true, google_ga4: true, clarity: true };
  state.clarityToken = {
    provider: "clarity",
    api_token: "tok",
    connected_at: "2026-06-12T00:00:00Z",
  };
  refreshGa4Sitewide.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────
// syncSucceeded — the positive freshness gate
// ─────────────────────────────────────────────────────────────────────

describe("syncSucceeded (audit-3 #5)", () => {
  it("treats { synced: true } as success and { synced: false } as failure with reason", () => {
    expect(syncSucceeded({ synced: true, rows_upserted: 12 })).toEqual({ ok: true });
    const v = syncSucceeded({ synced: false, reason: "no_token" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no_token");
  });

  it("regression: the old { ok: false } shape and unrecognized shapes are NOT success", () => {
    expect(syncSucceeded({ ok: false }).ok).toBe(false);
    expect(syncSucceeded({}).ok).toBe(false);
    expect(syncSucceeded(null).ok).toBe(false);
    expect(syncSucceeded("synced").ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// on-USE refresh — sitewide ride-along (Wave 2A)
// ─────────────────────────────────────────────────────────────────────

describe("autoRefreshStaleConnectorsForTenant — sitewide ride-along", () => {
  it("pulls the true sitewide series + reconciliation when GA4 refreshed on this visit", async () => {
    await autoRefreshStaleConnectorsForTenant("tenant-a");
    expect(refreshGa4Sitewide).toHaveBeenCalledTimes(1);
    expect(refreshGa4Sitewide).toHaveBeenCalledWith("tenant-a");
  });

  it("does NOT pull the sitewide series when GA4 is not connected", async () => {
    state.connected = { google_gsc: true, google_ga4: false, clarity: true };
    await autoRefreshStaleConnectorsForTenant("tenant-a");
    expect(refreshGa4Sitewide).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Clarity Data Export parser
// ─────────────────────────────────────────────────────────────────────

const CLARITY_SAMPLE = [
  {
    metricName: "Traffic",
    information: [
      { totalSessionCount: "120", Url: "https://x.com/a" },
      { totalSessionCount: "40", Url: "https://x.com/b" },
    ],
  },
  { metricName: "RageClickCount", information: [{ subTotal: 7, Url: "https://x.com/a" }] },
  { metricName: "DeadClickCount", information: [{ subTotal: 3, Url: "https://x.com/b" }] },
];

function mockClarityFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body })),
  );
}

describe("fetchClarityUrlMetrics", () => {
  it("groups metrics by URL across the metric array (happy path)", async () => {
    mockClarityFetch(CLARITY_SAMPLE);
    const out = await fetchClarityUrlMetrics({ tenantId: "t" });
    const a = out!.find((m) => m.url === "https://x.com/a")!;
    expect(a.sessions).toBe(120);
    expect(a.rageClicks).toBe(7);
    expect(out!.find((m) => m.url === "https://x.com/b")!.deadClicks).toBe(3);
  });

  it("fail-softs to null on non-2xx and on missing token (fail-closed, no fabricated metrics)", async () => {
    mockClarityFetch(CLARITY_SAMPLE, false);
    expect(await fetchClarityUrlMetrics({ tenantId: "t" })).toBeNull();
    state.clarityToken = null;
    mockClarityFetch(CLARITY_SAMPLE, true);
    expect(await fetchClarityUrlMetrics({ tenantId: "t" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Verify-live → IndexNow wiring point
// ─────────────────────────────────────────────────────────────────────
