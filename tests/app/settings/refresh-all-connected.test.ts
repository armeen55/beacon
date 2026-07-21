/**
 * 2026-06-15 — one-click "Refresh my data" (Today surface) action tests.
 *
 * Pins `refreshAllConnectedDataNow()` in settings/connectors/actions.ts:
 *   (a) ONLY connected read sources run (Wix is publish-only — never in the set).
 *   (b) a thrown engine → ok:false with a plain-English reason; never throws.
 *   (c) labels are the plain-English customer ones, and NEVER contain "Profound".
 *   (d) zero connected → empty results.
 *
 * 2026-07-20 — Profound removed (full account disconnect); three read sources
 * remain (GSC, GA4, Clarity).
 *
 * Style matches the existing connectors-action tests: no jsdom, plain function
 * calls + vi.mock for the connector store + the three sync engines.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));
vi.mock("@/lib/logger", () => ({
  log: { info: () => {}, warn: () => {}, error: () => {} },
}));

// Per-provider connected flag + per-engine result, mutated per test.
let _connected: Record<string, boolean> = {
  google_gsc: true,
  google_ga4: true,
  clarity: true,
};
let _gsc: unknown = { synced: true, rows_upserted: 100, days: 5 };
let _ga4: unknown = { synced: true, rows_upserted: 12 };
let _clarity: unknown = { synced: true, rows_upserted: 4 };

const syncGsc = vi.fn(async () => {
  if (_gsc instanceof Error) throw _gsc;
  return _gsc;
});
const syncGa4 = vi.fn(async () => {
  if (_ga4 instanceof Error) throw _ga4;
  return _ga4;
});
const syncClarity = vi.fn(async () => {
  if (_clarity instanceof Error) throw _clarity;
  return _clarity;
});

const updateConnectorToken = vi.fn(async () => {});

vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async (provider: string) => ({
    status: _connected[provider] ? "connected" : "disconnected",
    connected_at: null,
    expires_at: null,
    last_synced_at: null,
  }),
  updateConnectorToken: () => updateConnectorToken(),
  // unused-by-this-action exports the module also re-exports:
  deleteConnectorToken: async () => {},
  saveConnectorToken: async () => {},
}));
vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({
  syncGscSearchAnalyticsForTenant: () => syncGsc(),
}));
vi.mock("@/lib/connectors/ga4/sync-url-traffic", () => ({
  syncGa4UrlTrafficForTenant: () => syncGa4(),
}));
// Wave 2A: the manual refresh must ALSO pull the true sitewide series + reconcile
// it when GA4 is connected, so the north-star card can light up without the cron.
const refreshGa4Sitewide = vi.fn(async (_tenantId?: string) => {});
vi.mock("@/lib/connectors/ga4/refresh-ga4-sitewide", () => ({
  refreshGa4SitewideAndReconcile: (tenantId: string) => refreshGa4Sitewide(tenantId),
}));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({
  syncClarityDailyMetricsForTenant: () => syncClarity(),
}));

// Stub the other imports the actions module pulls in (not exercised here).
vi.mock("@/lib/connectors/gsc/disconnect-flow", () => ({ softDisconnectGsc: async () => {} }));
vi.mock("@/lib/connectors/ga4/property-selection", () => ({ listGa4PropertiesForTenant: async () => ({ ok: true, properties: [] }) }));
vi.mock("@/lib/connectors/google-auth", () => ({
  buildGoogleAuthUrl: () => "",
  encodeOAuthState: () => "",
  generateOAuthNonce: () => "",
}));
vi.mock("@/lib/connectors/google-reviews-sync", () => ({
  runGoogleReviewsSync: async () => ({ ok: true }),
  fetchGoogleLocations: async () => ({ ok: true, locations: [] }),
}));
vi.mock("@/lib/connectors/yelp-reviews-sync", () => ({ runYelpReviewsSync: async () => ({ ok: true }) }));
vi.mock("@/lib/business-config", () => ({ getBusinessConfigForCurrentTenant: async () => ({ yelpBusinessId: "" }) }));
vi.mock("@/lib/actions", () => ({ now: () => "2026-06-15T00:00:00.000Z" }));

import { refreshAllConnectedDataNow } from "@/app/(shell)/settings/connectors/actions";

beforeEach(() => {
  _connected = {
    google_gsc: true,
    google_ga4: true,
    clarity: true,
  };
  _gsc = { synced: true, rows_upserted: 100, days: 5 };
  _ga4 = { synced: true, rows_upserted: 12 };
  _clarity = { synced: true, rows_upserted: 4 };
  syncGsc.mockClear();
  syncGa4.mockClear();
  syncClarity.mockClear();
  updateConnectorToken.mockClear();
  refreshGa4Sitewide.mockClear();
});

describe("refreshAllConnectedDataNow — only connected sources run", () => {
  it("runs all three when all three are connected", async () => {
    const r = await refreshAllConnectedDataNow();
    expect(syncGsc).toHaveBeenCalledTimes(1);
    expect(syncGa4).toHaveBeenCalledTimes(1);
    expect(syncClarity).toHaveBeenCalledTimes(1);
    expect(r.results).toHaveLength(3);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(typeof r.ranAt).toBe("string");
    expect(Number.isFinite(Date.parse(r.ranAt))).toBe(true);
  });

  it("skips sources that are not connected (only the connected engines fire)", async () => {
    _connected = {
      google_gsc: true,
      google_ga4: false,
      clarity: false,
    };
    const r = await refreshAllConnectedDataNow();
    expect(syncGsc).toHaveBeenCalledTimes(1);
    expect(syncGa4).not.toHaveBeenCalled();
    expect(syncClarity).not.toHaveBeenCalled();
    expect(r.results.map((x) => x.provider).sort()).toEqual([
      "google_gsc",
    ]);
  });

  it("never includes Wix (publish-only) — there's no wix engine wired", async () => {
    const r = await refreshAllConnectedDataNow();
    expect(r.results.some((x) => x.provider === "wix")).toBe(false);
  });

  it("never includes a Profound source (fully disconnected)", async () => {
    const r = await refreshAllConnectedDataNow();
    expect(r.results.some((x) => x.provider === "profound")).toBe(false);
  });
});

describe("refreshAllConnectedDataNow — fail-soft", () => {
  it("a thrown engine → ok:false with a plain-English reason, never throws", async () => {
    _gsc = new Error("ECONNRESET socket hang up at internal:net:1234");
    const r = await refreshAllConnectedDataNow();
    const gsc = r.results.find((x) => x.provider === "google_gsc")!;
    expect(gsc.ok).toBe(false);
    // Plain-English — must NOT leak the raw error text.
    expect(gsc.detail).not.toContain("ECONNRESET");
    expect(gsc.detail).toMatch(/try again/i);
    // The other sources still succeeded — one failure didn't block them.
    expect(r.results.find((x) => x.provider === "ga4")?.ok ?? true).toBe(true);
    expect(r.results.filter((x) => x.ok)).toHaveLength(2);
  });

  it("a reason-coded engine failure → ok:false (e.g. expired Google grant)", async () => {
    _gsc = { synced: false, reason: "gsc_token_expired" };
    const r = await refreshAllConnectedDataNow();
    const gsc = r.results.find((x) => x.provider === "google_gsc")!;
    expect(gsc.ok).toBe(false);
    expect(gsc.detail).toMatch(/reconnect/i);
  });
});

describe("refreshAllConnectedDataNow — labels", () => {
  it("uses plain-English customer labels and NEVER contains 'Profound'", async () => {
    const r = await refreshAllConnectedDataNow();
    const byProvider = Object.fromEntries(
      r.results.map((x) => [x.provider, x.label]),
    );
    expect(byProvider["google_gsc"]).toBe("Search (Google)");
    expect(byProvider["google_ga4"]).toBe("Visitors (Google Analytics)");
    expect(byProvider["clarity"]).toBe("Visitor experience");
    // White-label invariant: the vendor name must never appear anywhere.
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("Profound");
  });
});

describe("refreshAllConnectedDataNow - Wave 2A sitewide visits", () => {
  it("pulls the true sitewide series + reconciliation when GA4 is connected", async () => {
    await refreshAllConnectedDataNow();
    expect(refreshGa4Sitewide).toHaveBeenCalledTimes(1);
    expect(refreshGa4Sitewide).toHaveBeenCalledWith("tenant-test");
  });

  it("does NOT pull the sitewide series when GA4 is not connected", async () => {
    _connected = { google_gsc: true, google_ga4: false, clarity: true };
    await refreshAllConnectedDataNow();
    expect(refreshGa4Sitewide).not.toHaveBeenCalled();
  });
});

describe("refreshAllConnectedDataNow — nothing connected", () => {
  it("zero connected → empty results, no engine fires", async () => {
    _connected = {
      google_gsc: false,
      google_ga4: false,
      clarity: false,
    };
    const r = await refreshAllConnectedDataNow();
    expect(r.results).toEqual([]);
    expect(typeof r.ranAt).toBe("string");
    expect(syncGsc).not.toHaveBeenCalled();
  });
});
