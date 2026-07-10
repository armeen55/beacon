/**
 * 2026-07-10 - Wave 2A - syncGa4SitewideSessionsForTenant pins:
 *   - DORMANT-UNTIL-KEY: no token -> no_token; token but no property -> no_property.
 *   - delegates to the sitewide persist with the tenant's configured property.
 *   - passes through the persist result; NEVER throws.
 *   - computeSitewideDateRange caps the window at MAX_DAYS.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let _token: { ga4_property_id?: string } | null = null;
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async () => _token),
}));

const _persistMock = vi.fn();
vi.mock("@/lib/connectors/ga4/persist-sitewide-sessions", () => ({
  persistGa4SitewideDailyTotals: (...a: unknown[]) => _persistMock(...a),
}));

import {
  syncGa4SitewideSessionsForTenant,
  computeSitewideDateRange,
  __testing,
} from "@/lib/connectors/ga4/sync-sitewide-sessions";

beforeEach(() => {
  _token = null;
  _persistMock.mockReset();
});

describe("syncGa4SitewideSessionsForTenant - dormant until key", () => {
  it("no token -> { synced:false, reason:'no_token' } and no persist call", async () => {
    _token = null;
    const r = await syncGa4SitewideSessionsForTenant({ tenantId: "tenant-a" });
    expect(r).toEqual({ synced: false, reason: "no_token" });
    expect(_persistMock).not.toHaveBeenCalled();
  });

  it("token without a property -> { synced:false, reason:'no_property' }", async () => {
    _token = { ga4_property_id: "" };
    const r = await syncGa4SitewideSessionsForTenant({ tenantId: "tenant-a" });
    expect(r).toEqual({ synced: false, reason: "no_property" });
    expect(_persistMock).not.toHaveBeenCalled();
  });
});

describe("syncGa4SitewideSessionsForTenant - happy path + passthrough", () => {
  it("delegates to the sitewide persist with the configured property and returns its counts", async () => {
    _token = { ga4_property_id: "123456789" };
    _persistMock.mockResolvedValue({
      ok: true,
      rows_fetched: 40,
      rows_upserted: 40,
      propertyTimezone: "America/Los_Angeles",
    });
    const r = await syncGa4SitewideSessionsForTenant({
      tenantId: "tenant-iranopedia",
      now: new Date("2026-07-10T00:00:00Z"),
    });
    expect(r).toMatchObject({
      synced: true,
      property: "123456789",
      rows_fetched: 40,
      rows_upserted: 40,
      propertyTimezone: "America/Los_Angeles",
    });
    const callArg = _persistMock.mock.calls[0]![0] as { tenantId: string; propertyId: string };
    expect(callArg.tenantId).toBe("tenant-iranopedia");
    expect(callArg.propertyId).toBe("123456789");
  });

  it("passes a persist failure through as { synced:false, reason }", async () => {
    _token = { ga4_property_id: "123456789" };
    _persistMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await syncGa4SitewideSessionsForTenant({ tenantId: "tenant-a" });
    expect(r).toEqual({ synced: false, reason: "token_expired" });
  });
});

describe("computeSitewideDateRange", () => {
  it("caps the window at MAX_DAYS back from today UTC", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const r = computeSitewideDateRange(100000, now);
    expect(r.endDate).toBe("2026-07-10");
    const expectedStart = new Date(Date.UTC(2026, 6, 10) - __testing.MAX_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(r.startDate).toBe(expectedStart);
  });

  it("the re-pull window includes the GA4 ~48h data-shift horizon (today + the previous 2 days)", () => {
    // GA4 revises the current day and the previous ~2 days as late hits arrive. The
    // sync window must re-pull that horizon every run so the idempotent upsert
    // OVERWRITES those days with fresher data (never insert-ignores them stale).
    const now = new Date("2026-07-10T12:00:00Z");
    const r = computeSitewideDateRange(__testing.DEFAULT_DAYS, now);
    expect(r.endDate).toBe("2026-07-10"); // today is re-pulled
    const twoDaysAgo = new Date(Date.UTC(2026, 6, 10) - 2 * 86_400_000).toISOString().slice(0, 10);
    // startDate is at/behind two days ago, so today + the previous 2 days are inside the window.
    expect(r.startDate <= twoDaysAgo).toBe(true);
    expect(r.startDate < r.endDate).toBe(true);
  });
});
