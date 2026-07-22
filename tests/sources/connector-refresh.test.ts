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

// ── IndexNow wiring point mocks ──────────────────────────────────────
const indexnow = vi.hoisted(() => ({
  config: null as { key: string; host?: string; keyLocation?: string } | null,
  pingResult: { ok: true, status: 200 } as
    | { ok: true; status: number }
    | { ok: false; status: number | null; error: string },
  receipts: [] as unknown[],
  pingCalls: [] as unknown[],
}));

vi.mock("@/lib/connectors/indexnow/config-store", () => ({
  getIndexNowConfig: vi.fn(async () => indexnow.config),
}));
vi.mock("@/lib/connectors/indexnow/client", () => ({
  pingIndexNowForUrl: vi.fn(async (args: unknown) => {
    indexnow.pingCalls.push(args);
    return indexnow.pingResult;
  }),
}));
vi.mock("@/lib/connectors/indexnow/receipts-store", () => ({
  appendIndexNowReceipt: vi.fn(async (r: unknown) => {
    indexnow.receipts.push(r);
  }),
}));
vi.mock("@/domains/tenants/store", () => ({
  getTenant: vi.fn(async () => ({ domain: "example.com" })),
}));

import { syncSucceeded, autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
import { fetchClarityUrlMetrics } from "@/lib/connectors/clarity/client";
import { pingIndexNowOnVerifiedLive } from "@/lib/connectors/indexnow/ping-on-verify";

beforeEach(() => {
  state.connected = { google_gsc: true, google_ga4: true, clarity: true };
  state.clarityToken = {
    provider: "clarity",
    api_token: "tok",
    connected_at: "2026-06-12T00:00:00Z",
  };
  refreshGa4Sitewide.mockClear();
  indexnow.config = null;
  indexnow.pingResult = { ok: true, status: 200 };
  indexnow.receipts = [];
  indexnow.pingCalls = [];
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

describe("pingIndexNowOnVerifiedLive", () => {
  it("self-hides with no receipt when no key is configured", async () => {
    indexnow.config = null;
    await pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://example.com/a" });
    expect(indexnow.pingCalls).toHaveLength(0);
    expect(indexnow.receipts).toHaveLength(0);
  });

  it("pings with the configured key and records a receipt on success AND failure", async () => {
    indexnow.config = { key: "abc12345", host: "example.com" };
    indexnow.pingResult = { ok: true, status: 202 };
    await pingIndexNowOnVerifiedLive({
      tenantId: "t1",
      url: "https://example.com/a",
      now: new Date("2026-07-02T00:00:00Z"),
    });
    expect(indexnow.pingCalls).toEqual([
      { url: "https://example.com/a", key: "abc12345", keyLocation: undefined },
    ]);
    expect(indexnow.receipts[0]).toMatchObject({ ok: true, status: 202, detail: "accepted" });

    indexnow.pingResult = { ok: false, status: null, error: "network down" };
    await expect(
      pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://example.com/a" }),
    ).resolves.toBeUndefined();
    expect(indexnow.receipts[1]).toMatchObject({ ok: false, detail: "network down" });
  });

  it("never throws even if the config read itself throws", async () => {
    const { getIndexNowConfig } = await import("@/lib/connectors/indexnow/config-store");
    vi.mocked(getIndexNowConfig).mockRejectedValueOnce(new Error("boom"));
    await expect(
      pingIndexNowOnVerifiedLive({ tenantId: "t1", url: "https://example.com/a" }),
    ).resolves.toBeUndefined();
  });
});
