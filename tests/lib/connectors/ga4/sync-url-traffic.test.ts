/**
 * 2026-06-13 — GA4 nightly URL-traffic sync wrapper unit tests.
 *
 * Pins the END-STATE "dormant-until-key" contract + the delegation:
 *   • no GA4 token            → { synced:false, reason:"no_token" }, persist NOT called
 *   • token but empty property → { synced:false, reason:"no_property" }, persist NOT called
 *   • token + property + persist ok → { synced:true, property, counts }, persist called
 *     with the computeRefreshDateRange-derived window
 *   • persist non-ok → { synced:false, reason } passthrough (never throws)
 *
 * Reconnect signal (2026-06-15): the sync also stamps/clears `auth_failed_at`
 * on the google_ga4 token row via updateConnectorToken so getConnectorHealth
 * can surface a "Reconnect Google" state:
 *   • persist token_expired → updateConnectorToken sets auth_failed_at = now ISO
 *   • persist ok            → updateConnectorToken clears auth_failed_at = null
 *   • other persist failures → NOT stamped (only token_expired is auth failure)
 *   • a token-write error is fail-soft (sync return value unchanged, no throw)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ─────────────────────────────────────────────────
const _getTokenMock = vi.fn();
const _updateTokenMock = vi.fn();
const _persistRefreshedMock = vi.fn();
const _getConnectorInfoMock = vi.fn();
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: (...a: unknown[]) => _getTokenMock(...a),
  updateConnectorToken: (...a: unknown[]) => _updateTokenMock(...a),
  persistRefreshedGoogleToken: (...a: unknown[]) => _persistRefreshedMock(...a),
  getConnectorInfo: (...a: unknown[]) => _getConnectorInfoMock(...a),
}));

// Keep deriveSyncFailureEscalation REAL (pure streak logic) — only stub the
// ledger read the escalation consults.
const _listRecentRefreshRunsMock = vi.fn();
vi.mock("@/domains/ops/refresh-runs-store", async (importActual) => {
  const actual =
    await importActual<typeof import("@/domains/ops/refresh-runs-store")>();
  return {
    ...actual,
    listRecentRefreshRuns: (...a: unknown[]) => _listRecentRefreshRunsMock(...a),
  };
});

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
  _updateTokenMock.mockReset();
  _persistRefreshedMock.mockReset();
  _getRecommendedEditsMock.mockReset();
  _persistMock.mockReset();
  _getConnectorInfoMock.mockReset();
  _listRecentRefreshRunsMock.mockReset();
  _getRecommendedEditsMock.mockResolvedValue([]);
  _updateTokenMock.mockResolvedValue(undefined);
  _persistRefreshedMock.mockResolvedValue(undefined);
  // Default: not connected, so the sync-failure escalation early-returns and
  // never stamps in the pre-existing suites. Escalation tests override this.
  _getConnectorInfoMock.mockResolvedValue({ status: "disconnected" });
  _listRecentRefreshRunsMock.mockResolvedValue([]);
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

describe("syncGa4UrlTrafficForTenant — reconnect signal (auth_failed_at)", () => {
  const okToken = {
    provider: "google_ga4" as const,
    ga4_property_id: "properties/123",
  };

  it("persist token_expired → stamps auth_failed_at on the google_ga4 token (tenant-scoped)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "token_expired" });
    expect(_updateTokenMock).toHaveBeenCalledTimes(1);
    const [provider, patch, tenantId] = _updateTokenMock.mock.calls[0]!;
    expect(provider).toBe("google_ga4");
    expect(typeof (patch as { auth_failed_at: unknown }).auth_failed_at).toBe(
      "string",
    );
    expect(tenantId).toBe("t1");
  });

  it("persist ok → clears auth_failed_at (sets null) on the google_ga4 token", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: true, rows_fetched: 3, rows_upserted: 3 });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r.synced).toBe(true);
    expect(_updateTokenMock).toHaveBeenCalledTimes(1);
    const [provider, patch, tenantId] = _updateTokenMock.mock.calls[0]!;
    expect(provider).toBe("google_ga4");
    expect((patch as { auth_failed_at: unknown }).auth_failed_at).toBeNull();
    expect(tenantId).toBe("t1");
  });

  it("non-auth persist failure (quota_exceeded) does NOT stamp", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "quota_exceeded" });
    await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(_updateTokenMock).not.toHaveBeenCalled();
  });

  it("a token-write error is fail-soft — the sync return value is unchanged, no throw", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    _updateTokenMock.mockRejectedValue(new Error("supabase down"));
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "token_expired" });
  });

  it("no token → never stamps (dormant-until-key, not a reconnect)", async () => {
    _getTokenMock.mockResolvedValue(null);
    await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(_updateTokenMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sync-failure escalation (2026-07-20) — 3+ consecutive failures flip the
// card from "I will try again on my own" to a needs-attention state. Uses
// persist_failed (NOT token_expired) so the only updateConnectorToken write
// in play is the escalation stamp itself.
// ─────────────────────────────────────────────────────────────────────
describe("syncGa4UrlTrafficForTenant — sync-failure escalation", () => {
  const okToken = {
    provider: "google_ga4" as const,
    ga4_property_id: "properties/123",
  };
  const connected = {
    status: "connected" as const,
    auth_failed_at: null,
    needs_attention_at: null,
    last_synced_at: "2026-07-15T09:00:00Z",
  };
  const now = new Date("2026-07-20T00:00:00Z");

  /** Find the updateConnectorToken call that stamped a needs_attention marker. */
  function needsAttentionStamp() {
    return _updateTokenMock.mock.calls.find(
      (c) => (c[1] as { needs_attention_at?: unknown }).needs_attention_at != null,
    );
  }

  it("3rd consecutive failure on a connected grant stamps needs_attention (kind=streak, since=last good)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue(connected);
    // Two PRIOR failures + this run = a streak of 3.
    _listRecentRefreshRunsMock.mockResolvedValue([
      { started_at: "2026-07-19T00:00:00Z", result: "failed" },
      { started_at: "2026-07-18T00:00:00Z", result: "failed" },
      { started_at: "2026-07-15T09:00:00Z", result: "ok" },
    ]);

    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r).toEqual({ synced: false, reason: "persist_failed" });

    const stamp = needsAttentionStamp();
    expect(stamp).toBeDefined();
    const [provider, patch, tenantId] = stamp!;
    expect(provider).toBe("google_ga4");
    expect(tenantId).toBe("t1");
    expect((patch as { needs_attention_kind: unknown }).needs_attention_kind).toBe("streak");
    // "since" = the last good pull before the streak.
    expect((patch as { needs_attention_since: unknown }).needs_attention_since).toBe(
      "2026-07-15T09:00:00Z",
    );
    expect(typeof (patch as { needs_attention_at: unknown }).needs_attention_at).toBe("string");
    expect(_listRecentRefreshRunsMock).toHaveBeenCalledWith("t1", { source: "ga4", limit: 12 });
  });

  it("only 2 consecutive failures (below threshold) does NOT stamp needs_attention", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue(connected);
    // One prior failure + this run = a streak of 2 (below the 3 threshold).
    _listRecentRefreshRunsMock.mockResolvedValue([
      { started_at: "2026-07-19T00:00:00Z", result: "failed" },
      { started_at: "2026-07-18T00:00:00Z", result: "ok" },
    ]);

    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r).toEqual({ synced: false, reason: "persist_failed" });
    expect(needsAttentionStamp()).toBeUndefined();
  });

  it("does NOT restamp when the marker is already set (keeps the original since date)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue({
      ...connected,
      needs_attention_at: "2026-07-18T00:00:00Z",
    });
    _listRecentRefreshRunsMock.mockResolvedValue([
      { started_at: "2026-07-19T00:00:00Z", result: "failed" },
      { started_at: "2026-07-18T00:00:00Z", result: "failed" },
      { started_at: "2026-07-17T00:00:00Z", result: "failed" },
    ]);

    await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(needsAttentionStamp()).toBeUndefined();
  });

  it("does NOT escalate a proven-dead grant (auth_failed_at set → Reconnect outranks)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue({
      ...connected,
      auth_failed_at: "2026-07-18T00:00:00Z",
    });
    _listRecentRefreshRunsMock.mockResolvedValue([
      { started_at: "2026-07-19T00:00:00Z", result: "failed" },
      { started_at: "2026-07-18T00:00:00Z", result: "failed" },
    ]);

    await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(needsAttentionStamp()).toBeUndefined();
  });

  it("does NOT escalate a disconnected grant", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue({ status: "disconnected" });
    _listRecentRefreshRunsMock.mockResolvedValue([
      { started_at: "2026-07-19T00:00:00Z", result: "failed" },
      { started_at: "2026-07-18T00:00:00Z", result: "failed" },
    ]);

    await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(needsAttentionStamp()).toBeUndefined();
  });

  it("a successful pull CLEARS needs_attention (self-heals from any path)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: true, rows_fetched: 3, rows_upserted: 3 });

    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r.synced).toBe(true);
    // The single success-path updateConnectorToken clears BOTH markers.
    expect(_updateTokenMock).toHaveBeenCalledTimes(1);
    const [, patch] = _updateTokenMock.mock.calls[0]!;
    expect((patch as { auth_failed_at: unknown }).auth_failed_at).toBeNull();
    expect((patch as { needs_attention_at: unknown }).needs_attention_at).toBeNull();
    expect((patch as { needs_attention_since: unknown }).needs_attention_since).toBeNull();
    expect((patch as { needs_attention_kind: unknown }).needs_attention_kind).toBeNull();
  });

  it("escalation is fail-soft — a getConnectorInfo throw never changes the sync outcome", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockRejectedValue(new Error("supabase down"));

    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r).toEqual({ synced: false, reason: "persist_failed" });
  });
});
