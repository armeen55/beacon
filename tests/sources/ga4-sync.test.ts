/**
 * SOURCES — GA4 sync wrappers + property selection (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/ga4/{sync-sitewide-sessions,
 * sync-ai-referrals, sync-url-traffic, property-selection}.
 *
 * Pinned boundaries:
 *   • Dormant-until-key: no token → no_token, no property → no_property,
 *     the persist/report layer is NEVER invoked.
 *   • Reconnect signal: token_expired stamps auth_failed_at (tenant-scoped),
 *     success clears it; non-auth failures never stamp; token writes fail-soft.
 *   • Sync-failure escalation: 3+ consecutive failures on a connected grant
 *     stamp needs_attention; success clears every marker.
 *   • AI-referral rollup: variants collapse to canonical rows on the 4-column
 *     conflict key; zero AI rows is an honest zero (no upsert).
 *   • Property selection: flatten + cap + fail-soft passthrough.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────

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

const _listRecentRefreshRunsMock = vi.fn();
vi.mock("@/domains/ops/refresh-runs-store", async (importActual) => {
  const actual = await importActual<typeof import("@/domains/ops/refresh-runs-store")>();
  return {
    ...actual,
    listRecentRefreshRuns: (...a: unknown[]) => _listRecentRefreshRunsMock(...a),
  };
});

const _getRecommendedEditsMock = vi.fn();
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({ getRecommendedEdits: () => _getRecommendedEditsMock() }),
  }),
}));

const _persistUrlMock = vi.fn();
vi.mock("@/lib/connectors/ga4/persist-url-traffic", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/connectors/ga4/persist-url-traffic")>();
  return {
    ...actual,
    persistGa4UrlTraffic: (...a: unknown[]) => _persistUrlMock(...a),
  };
});

const _persistSitewideMock = vi.fn();
vi.mock("@/lib/connectors/ga4/persist-sitewide-sessions", () => ({
  persistGa4SitewideDailyTotals: (...a: unknown[]) => _persistSitewideMock(...a),
}));

const _reportMock = vi.fn();
vi.mock("@/lib/connectors/ga4/data-api", () => ({
  runGa4AiReferralReport: (...a: unknown[]) => _reportMock(...a),
}));

const _upsertMock = vi.fn();
const _fromMock = vi.fn(() => ({ upsert: _upsertMock }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: _fromMock }),
}));

let _fetchResult: unknown = { ok: true, data: { accountSummaries: [] } };
let _fetchCalls: Array<{ tenantId: string; url: string }> = [];
vi.mock("@/lib/connectors/ga4/client", () => ({
  ga4ApiFetch: vi.fn(async (args: { tenantId: string; url: string }) => {
    _fetchCalls.push({ tenantId: args.tenantId, url: args.url });
    return _fetchResult;
  }),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { computeRefreshDateRange } from "@/lib/connectors/ga4/persist-url-traffic";
import {
  syncGa4SitewideSessionsForTenant,
  computeSitewideDateRange,
  __testing as sitewideTesting,
} from "@/lib/connectors/ga4/sync-sitewide-sessions";
import {
  aggregateAiReferralRows,
  computeAiReferralDateRange,
  pullGa4AiReferralsForTenant,
} from "@/lib/connectors/ga4/sync-ai-referrals";
import {
  listGa4PropertiesForTenant,
  flattenAccountSummaries,
  __testing as propTesting,
} from "@/lib/connectors/ga4/property-selection";
import type { Ga4AiReferralRow } from "@/lib/connectors/ga4/types";

beforeEach(() => {
  _getTokenMock.mockReset();
  _updateTokenMock.mockReset();
  _persistRefreshedMock.mockReset();
  _getConnectorInfoMock.mockReset();
  _listRecentRefreshRunsMock.mockReset();
  _getRecommendedEditsMock.mockReset();
  _persistUrlMock.mockReset();
  _persistSitewideMock.mockReset();
  _reportMock.mockReset();
  _upsertMock.mockReset();
  _fromMock.mockClear();
  _fetchResult = { ok: true, data: { accountSummaries: [] } };
  _fetchCalls = [];
  _getRecommendedEditsMock.mockResolvedValue([]);
  _updateTokenMock.mockResolvedValue(undefined);
  _persistRefreshedMock.mockResolvedValue(undefined);
  _getConnectorInfoMock.mockResolvedValue({ status: "disconnected" });
  _listRecentRefreshRunsMock.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────
// syncGa4UrlTrafficForTenant — dormant / delegation / reconnect signal
// ─────────────────────────────────────────────────────────────────────

describe("syncGa4UrlTrafficForTenant — dormant until key + delegation", () => {
  it("no token → no_token; empty property → no_property; persist never called", async () => {
    _getTokenMock.mockResolvedValue(null);
    expect(await syncGa4UrlTrafficForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "no_token",
    });
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "" });
    expect(await syncGa4UrlTrafficForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "no_property",
    });
    expect(_persistUrlMock).not.toHaveBeenCalled();
    // dormant is NOT a reconnect: never stamps.
    expect(_updateTokenMock).not.toHaveBeenCalled();
  });

  it("token + property + persist ok → synced with counts; persist gets the computed date window", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
    _persistUrlMock.mockResolvedValue({ ok: true, rows_fetched: 12, rows_upserted: 12 });
    const now = new Date("2026-06-13T00:00:00Z");
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r).toEqual({
      synced: true,
      property: "properties/123",
      rows_fetched: 12,
      rows_upserted: 12,
    });
    const call = _persistUrlMock.mock.calls[0]![0] as {
      tenantId: string;
      propertyId: string;
      startDate: string;
      endDate: string;
    };
    const expected = computeRefreshDateRange([], now);
    expect(call.startDate).toBe(expected.startDate);
    expect(call.endDate).toBe(expected.endDate);
  });

  it("persist non-ok → reason passthrough, never throws", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "quota_exceeded" });
    expect(await syncGa4UrlTrafficForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "quota_exceeded",
    });
  });
});

describe("syncGa4UrlTrafficForTenant — reconnect signal (auth_failed_at)", () => {
  const okToken = { provider: "google_ga4" as const, ga4_property_id: "properties/123" };

  it("persist token_expired → stamps auth_failed_at on the google_ga4 token (tenant-scoped)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "token_expired" });
    expect(_updateTokenMock).toHaveBeenCalledTimes(1);
    const [provider, patch, tenantId] = _updateTokenMock.mock.calls[0]!;
    expect(provider).toBe("google_ga4");
    expect(typeof (patch as { auth_failed_at: unknown }).auth_failed_at).toBe("string");
    expect(tenantId).toBe("t1");
  });

  it("persist ok → clears auth_failed_at (null); non-auth failure does NOT stamp", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: true, rows_fetched: 3, rows_upserted: 3 });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(r.synced).toBe(true);
    expect((_updateTokenMock.mock.calls[0]![1] as { auth_failed_at: unknown }).auth_failed_at).toBeNull();

    _updateTokenMock.mockClear();
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "quota_exceeded" });
    await syncGa4UrlTrafficForTenant({ tenantId: "t1" });
    expect(_updateTokenMock).not.toHaveBeenCalled();
  });

  it("a token-write error is fail-soft — the sync return value is unchanged, no throw", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    _updateTokenMock.mockRejectedValue(new Error("supabase down"));
    expect(await syncGa4UrlTrafficForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "token_expired",
    });
  });
});

describe("syncGa4UrlTrafficForTenant — sync-failure escalation", () => {
  const okToken = { provider: "google_ga4" as const, ga4_property_id: "properties/123" };
  const connected = {
    status: "connected" as const,
    auth_failed_at: null,
    needs_attention_at: null,
    last_synced_at: "2026-07-15T09:00:00Z",
  };
  const now = new Date("2026-07-20T00:00:00Z");

  function needsAttentionStamp() {
    return _updateTokenMock.mock.calls.find(
      (c) => (c[1] as { needs_attention_at?: unknown }).needs_attention_at != null,
    );
  }

  it("3rd consecutive failure on a connected grant stamps needs_attention (kind=streak, since=last good)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue(connected);
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
    expect((patch as { needs_attention_since: unknown }).needs_attention_since).toBe(
      "2026-07-15T09:00:00Z",
    );
  });

  it("only 2 consecutive failures (below threshold) does NOT stamp", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockResolvedValue(connected);
    _listRecentRefreshRunsMock.mockResolvedValue([
      { started_at: "2026-07-19T00:00:00Z", result: "failed" },
      { started_at: "2026-07-18T00:00:00Z", result: "ok" },
    ]);
    await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(needsAttentionStamp()).toBeUndefined();
  });

  it("a successful pull CLEARS every marker (self-heals from any path)", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: true, rows_fetched: 3, rows_upserted: 3 });
    const r = await syncGa4UrlTrafficForTenant({ tenantId: "t1", now });
    expect(r.synced).toBe(true);
    expect(_updateTokenMock).toHaveBeenCalledTimes(1);
    const [, patch] = _updateTokenMock.mock.calls[0]!;
    expect((patch as { auth_failed_at: unknown }).auth_failed_at).toBeNull();
    expect((patch as { needs_attention_at: unknown }).needs_attention_at).toBeNull();
    expect((patch as { needs_attention_since: unknown }).needs_attention_since).toBeNull();
    expect((patch as { needs_attention_kind: unknown }).needs_attention_kind).toBeNull();
  });

  it("escalation is fail-soft — a getConnectorInfo throw never changes the sync outcome", async () => {
    _getTokenMock.mockResolvedValue(okToken);
    _persistUrlMock.mockResolvedValue({ ok: false, reason: "persist_failed" });
    _getConnectorInfoMock.mockRejectedValue(new Error("supabase down"));
    expect(await syncGa4UrlTrafficForTenant({ tenantId: "t1", now })).toEqual({
      synced: false,
      reason: "persist_failed",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// syncGa4SitewideSessionsForTenant
// ─────────────────────────────────────────────────────────────────────

describe("syncGa4SitewideSessionsForTenant", () => {
  it("dormant until key: no token → no_token; no property → no_property; persist never runs", async () => {
    _getTokenMock.mockResolvedValue(null);
    expect(await syncGa4SitewideSessionsForTenant({ tenantId: "tenant-a" })).toEqual({
      synced: false,
      reason: "no_token",
    });
    _getTokenMock.mockResolvedValue({ ga4_property_id: "" });
    expect(await syncGa4SitewideSessionsForTenant({ tenantId: "tenant-a" })).toEqual({
      synced: false,
      reason: "no_property",
    });
    expect(_persistSitewideMock).not.toHaveBeenCalled();
  });

  it("delegates to the sitewide persist with the configured property; passes failures through", async () => {
    _getTokenMock.mockResolvedValue({ ga4_property_id: "123456789" });
    _persistSitewideMock.mockResolvedValue({
      ok: true,
      rows_fetched: 40,
      rows_upserted: 40,
      propertyTimezone: "America/Los_Angeles",
    });
    const r = await syncGa4SitewideSessionsForTenant({
      tenantId: "tenant-iranopedia",
      now: new Date("2026-07-10T00:00:00Z"),
    });
    expect(r).toMatchObject({ synced: true, property: "123456789", rows_fetched: 40 });
    expect((_persistSitewideMock.mock.calls[0]![0] as { propertyId: string }).propertyId).toBe(
      "123456789",
    );

    _persistSitewideMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    expect(await syncGa4SitewideSessionsForTenant({ tenantId: "tenant-a" })).toEqual({
      synced: false,
      reason: "token_expired",
    });
  });

  it("computeSitewideDateRange caps at MAX_DAYS and re-pulls the GA4 ~48h data-shift horizon", async () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const capped = computeSitewideDateRange(100000, now);
    expect(capped.endDate).toBe("2026-07-10");
    const expectedStart = new Date(Date.UTC(2026, 6, 10) - sitewideTesting.MAX_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(capped.startDate).toBe(expectedStart);

    const r = computeSitewideDateRange(sitewideTesting.DEFAULT_DAYS, now);
    const twoDaysAgo = new Date(Date.UTC(2026, 6, 10) - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(r.endDate).toBe("2026-07-10"); // today is re-pulled
    expect(r.startDate <= twoDaysAgo).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// pullGa4AiReferralsForTenant
// ─────────────────────────────────────────────────────────────────────

const rawAiRow = (over: Partial<Ga4AiReferralRow>): Ga4AiReferralRow => ({
  date: "2026-06-30",
  pagePath: "/iran-cheetah",
  sessionSource: "chatgpt.com",
  sessions: 1,
  engaged_sessions: 1,
  key_events: 0,
  ...over,
});

describe("pullGa4AiReferralsForTenant", () => {
  it("dormant until key: no token / no property → the report never runs", async () => {
    _getTokenMock.mockResolvedValue(null);
    expect(await pullGa4AiReferralsForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "no_token",
    });
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "" });
    expect(await pullGa4AiReferralsForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "no_property",
    });
    expect(_reportMock).not.toHaveBeenCalled();
  });

  it("report failure → reason passthrough; Supabase never touched", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
    _reportMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    expect(await pullGa4AiReferralsForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "token_expired",
    });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("zero AI rows → honest zero: synced true, 0 upserts, upsert NOT called", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
    _reportMock.mockResolvedValue({
      ok: true,
      rows: [rawAiRow({ sessionSource: "google" }), rawAiRow({ sessionSource: "thankyou.com" })],
    });
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toEqual({
      synced: true,
      property: "properties/123",
      rows_fetched: 2,
      rows_upserted: 0,
      sessions: 0,
      sources: [],
    });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("collapses variants and upserts canonical rows on the 4-column conflict key", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
    _reportMock.mockResolvedValue({
      ok: true,
      rows: [
        rawAiRow({ sessionSource: "chatgpt.com", sessions: 3, engaged_sessions: 2, key_events: 1 }),
        rawAiRow({ sessionSource: "chat.openai.com", sessions: 2, engaged_sessions: 1, key_events: 0.5 }),
        rawAiRow({ sessionSource: "perplexity.ai", pagePath: "/farsi-numbers", sessions: 4 }),
        rawAiRow({ sessionSource: "bing" }), // dropped
      ],
    });
    _upsertMock.mockResolvedValue({ error: null });
    const now = new Date("2026-07-01T12:00:00Z");
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1", now });
    expect(r).toMatchObject({
      synced: true,
      rows_fetched: 4,
      rows_upserted: 2,
      sessions: 9,
      sources: ["chatgpt.com", "perplexity.ai"],
    });
    expect(_fromMock).toHaveBeenCalledWith("ga4_ai_referral_daily");
    const [rows, opts] = _upsertMock.mock.calls[0]!;
    expect(opts).toEqual({ onConflict: "tenant_id,page_path,day,source_domain" });
    expect((rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      tenant_id: "t1",
      page_path: "/iran-cheetah",
      source_domain: "chatgpt.com",
      sessions: 5,
      engaged_sessions: 3,
      key_events: 1.5,
    });
  });

  it("upsert error → persist_failed, never throws; truncated flag propagates", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
    _reportMock.mockResolvedValue({ ok: true, rows: [rawAiRow({})] });
    _upsertMock.mockResolvedValue({ error: { message: "boom", code: "XX000" } });
    expect(await pullGa4AiReferralsForTenant({ tenantId: "t1" })).toEqual({
      synced: false,
      reason: "persist_failed",
    });

    _reportMock.mockResolvedValue({ ok: true, rows: [rawAiRow({ sessions: 7 })], truncated: true });
    _upsertMock.mockResolvedValue({ error: null });
    expect(await pullGa4AiReferralsForTenant({ tenantId: "t1" })).toMatchObject({
      synced: true,
      sessions: 7,
      truncated: true,
    });
  });


  it("computeAiReferralDateRange goes days back from today UTC, capped at 420, floored at 1", () => {
    const now = new Date("2026-07-01T15:30:00Z");
    expect(computeAiReferralDateRange(30, now)).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-07-01",
    });
    expect(computeAiReferralDateRange(9999, now).startDate).toBe("2025-05-07");
    expect(computeAiReferralDateRange(0, now).startDate).toBe("2026-06-30");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Property selection
// ─────────────────────────────────────────────────────────────────────

describe("property selection", () => {

  it("is defensive: [] on junk bodies, skips entries missing display names, caps at MAX_PROPERTIES", () => {
    expect(flattenAccountSummaries(null)).toEqual([]);
    expect(flattenAccountSummaries({} as never)).toEqual([]);
    expect(
      flattenAccountSummaries({
        accountSummaries: [
          { account: "accounts/100", propertySummaries: [{ property: "properties/1", displayName: "P" }] },
        ],
      }),
    ).toEqual([]);
    const many = Array.from({ length: 150 }, (_, i) => ({
      property: `properties/${i}`,
      displayName: `P-${i}`,
    }));
    expect(
      flattenAccountSummaries({
        accountSummaries: [{ account: "accounts/100", displayName: "A", propertySummaries: many }],
      }),
    ).toHaveLength(propTesting.MAX_PROPERTIES);
  });

  it("listGa4PropertiesForTenant calls the account-summaries endpoint and surfaces fail-soft reasons verbatim", async () => {
    await listGa4PropertiesForTenant("tenant-x");
    expect(_fetchCalls).toEqual([{ tenantId: "tenant-x", url: propTesting.ACCOUNT_SUMMARIES_URL }]);

    _fetchResult = { ok: false, reason: "token_expired" };
    expect(await listGa4PropertiesForTenant("tenant-x")).toEqual({
      ok: false,
      reason: "token_expired",
    });
  });
});
