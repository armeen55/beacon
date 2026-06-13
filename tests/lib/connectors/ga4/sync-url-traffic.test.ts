/**
 * 2026-06-13 — GA4 nightly URL-traffic sync wrapper unit tests.
 *
 * Pins the END-STATE "dormant-until-key" contract + the delegation:
 *   • no GA4 token            → { synced:false, reason:"no_token" }, persist NOT called
 *   • token but empty property → { synced:false, reason:"no_property" }, persist NOT called
 *   • token + property + persist ok → { synced:true, property, counts }, persist called
 *     with the computeRefreshDateRange-derived window
 *   • persist non-ok → { synced:false, reason } passthrough (never throws)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ─────────────────────────────────────────────────
const _getTokenMock = vi.fn();
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: (...a: unknown[]) => _getTokenMock(...a),
}));

const _getRecommendedEditsMock = vi.fn();
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({
      getRecommendedEdits: () => _getRecommendedEditsMock(),
    }),
  }),
}));

const _persistMock = vi.fn();
// Keep computeRefreshDateRange REAL (pure date policy) — only stub the
// network-touching persistGa4UrlTraffic.
vi.mock("@/lib/connectors/ga4/persist-url-traffic", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/connectors/ga4/persist-url-traffic")>();
  return {
    ...actual,
    persistGa4UrlTraffic: (...a: unknown[]) => _persistMock(...a),
  };
});

import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { computeRefreshDateRange } from "@/lib/connectors/ga4/persist-url-traffic";

beforeEach(() => {
  _getTokenMock.mockReset();
  _getRecommendedEditsMock.mockReset();
  _persistMock.mockReset();
  _getRecommendedEditsMock.mockResolvedValue([]);
});

describe("syncGa4UrlTrafficForTenant — dormant until key", () => {
  it("no token → no_token, persist never called", async () => {
    _getTokenMock.mockResolvedValue(null);
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "no_token" });
    expect(_persistMock).not.toHaveBeenCalled();
  });

  it("token but empty property → no_property, persist never called", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "" });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "no_property" });
    expect(_persistMock).not.toHaveBeenCalled();
  });

  it("token missing property id (undefined) → no_property", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4" });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "no_property" });
    expect(_persistMock).not.toHaveBeenCalled();
  });
});

describe("syncGa4UrlTrafficForTenant — delegation", () => {
  it("token + property + persist ok → synced with counts; persist gets the date window", async () => {
    _getTokenMock.mockResolvedValue({
      provider: "google_ga4",
      ga4_property_id: "properties/123",
    });
    _persistMock.mockResolvedValue({
      ok: true,
      rows_fetched: 12,
      rows_upserted: 12,
    });
    const now = new Date("2026-06-13T00:00:00Z");
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r).toEqual({
      synced: true,
      property: "properties/123",
      rows_fetched: 12,
      rows_upserted: 12,
    });
    expect(_persistMock).toHaveBeenCalledTimes(1);
    const call = _persistMock.mock.calls[0]![0] as {
      tenantId: string;
      propertyId: string;
      startDate: string;
      endDate: string;
    };
    expect(call.tenantId).toBe("t1");
    expect(call.propertyId).toBe("properties/123");
    // The wrapper must hand persist the SAME window the pure date policy
    // computes (default lookback when there are no shipped edits).
    const expected = computeRefreshDateRange([], now);
    expect(call.startDate).toBe(expected.startDate);
    expect(call.endDate).toBe(expected.endDate);
  });

  it("persist non-ok → reason passthrough, never throws", async () => {
    _getTokenMock.mockResolvedValue({
      provider: "google_ga4",
      ga4_property_id: "properties/123",
    });
    _persistMock.mockResolvedValue({ ok: false, reason: "quota_exceeded" });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "quota_exceeded" });
  });
});
