/**
 * 2026-07-10 - Wave 2A - the on-USE auto refresh must ALSO populate the TRUE
 * sitewide GA4 series + reconciliation whenever GA4 refreshed, so the north-star
 * visits card can light up on an operator visit WITHOUT waiting for the nightly
 * cron. The READ_SOURCES GA4 entry pulls only the per-page traffic table, so this
 * pins the ride-along wiring in autoRefreshStaleConnectorsForTenant (cron-sync.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const refreshGa4Sitewide = vi.fn(async (_tenantId?: string) => {});
vi.mock("@/lib/connectors/ga4/refresh-ga4-sitewide", () => ({
  refreshGa4SitewideAndReconcile: (tenantId: string) => refreshGa4Sitewide(tenantId),
}));

let _connected: Record<string, boolean> = {
  google_gsc: true,
  google_ga4: true,
  clarity: true,
  profound: true,
};
vi.mock("@/lib/connector-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connector-store")>();
  return {
    ...actual,
    getConnectorInfo: async (provider: string) => ({
      status: _connected[provider] ? "connected" : "disconnected",
      last_synced_at: null, // never synced -> stale -> the on-use refresh runs it
      connected_at: null,
      expires_at: null,
    }),
    updateConnectorToken: async () => {},
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
vi.mock("@/lib/connectors/profound/sync-nightly", () => ({
  syncProfoundNightlyForTenant: async () => ({ synced: true }),
}));

import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/cron-sync";

beforeEach(() => {
  _connected = { google_gsc: true, google_ga4: true, clarity: true, profound: true };
  refreshGa4Sitewide.mockClear();
});

describe("autoRefreshStaleConnectorsForTenant - Wave 2A sitewide ride-along", () => {
  it("pulls the true sitewide series + reconciliation when GA4 refreshed on this visit", async () => {
    await autoRefreshStaleConnectorsForTenant("tenant-a");
    expect(refreshGa4Sitewide).toHaveBeenCalledTimes(1);
    expect(refreshGa4Sitewide).toHaveBeenCalledWith("tenant-a");
  });

  it("does NOT pull the sitewide series when GA4 is not connected", async () => {
    _connected = { google_gsc: true, google_ga4: false, clarity: true, profound: true };
    await autoRefreshStaleConnectorsForTenant("tenant-a");
    expect(refreshGa4Sitewide).not.toHaveBeenCalled();
  });
});
