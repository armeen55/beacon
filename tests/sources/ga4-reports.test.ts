/**
 * SOURCES — GA4 client + report boundaries (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/ga4/{client, data-api,
 * sitewide-sessions-report, revenue-report, ai-referral-report, ai-sources}.
 *
 * Pinned boundaries:
 *   • ga4ApiFetch fail-soft ladder (no_token / missing scope / disconnected /
 *     token_expired) + 401 refresh-retry with the refreshed Bearer token.
 *   • runGa4UrlTrafficReport: locked report body, YYYYMMDD narrowing,
 *     pagination with exact offsets, MAX_PAGES truncation, partial-beats-zero
 *     on subsequent-page failure, page-0 failure fails the report.
 *   • Sitewide sessions report requests date-only (NO pagePath) so sessions
 *     are never double-counted (the non-additive bug pin).
 *   • Revenue report: header-name mapping, observed-zero is ok, 400 naming a
 *     revenue metric → revenue_unavailable (not generic api_error).
 *   • AI-referral report: filter terms cover every canonical assistant;
 *     no-token means NO fetch (fail-closed before the network).
 *   • classifyAiSource: exact tier + contains fallback + short-host guard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─── Shared mocks ────────────────────────────────────────────────────

let _ga4Token: GoogleConnectorToken | null = null;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" | "ga4") => {
    if (kind !== "ga4") return null;
    return _ga4Token;
  }),
  persistRefreshedGoogleToken: vi.fn(async () => {}),
}));

let _refreshShouldThrow = false;
let _refreshAccessToken = "refreshed-token";

vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async (_rt: string) => {
    if (_refreshShouldThrow) throw new Error("refresh failed");
    return { access_token: _refreshAccessToken, expires_in: 3600 };
  }),
}));

const { _warnSpy } = vi.hoisted(() => ({ _warnSpy: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: _warnSpy, error: vi.fn(), debug: vi.fn() },
}));

import { ga4ApiFetch } from "@/lib/connectors/ga4/client";
import {
  runGa4UrlTrafficReport,
  buildRunReportBody,
  narrowRunReportRows,
  GA4_PAGE_SIZE,
  GA4_MAX_PAGES,
  runGa4SitewideSessionsReport,
  buildSitewideSessionsReportBody,
  narrowSitewideDailyRows,
  narrowSitewideMonthlyRows,
  runGa4RevenueReport,
  narrowRevenueRows,
  runGa4AiReferralReport,
  buildAiReferralReportBody,
  narrowAiReferralRows,
} from "@/lib/connectors/ga4/data-api";
import {
  classifyAiSource,
  aiSourceLabel,
  AI_SOURCE_FILTER_TERMS,
} from "@/lib/connectors/ga4/ai-sources";

const NOW_MS = Date.UTC(2026, 4, 19, 12, 0, 0); // 2026-05-19T12:00:00Z

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_ga4",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW_MS + 30 * 60 * 1000,
    connected_at: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ga4_property_id: "123456789",
    ...over,
  } as GoogleConnectorToken;
}

const HAPPY_ARGS = {
  tenantId: "tenant-ritz-founder",
  propertyId: "123456789",
  startDate: "2026-05-01",
  endDate: "2026-05-19",
};

beforeEach(() => {
  _ga4Token = null;
  _refreshShouldThrow = false;
  _refreshAccessToken = "refreshed-token";
  _warnSpy.mockClear();
  vi.restoreAllMocks();
  // Pin the clock so the SUT's real-time expiry guard stays deterministic
  // (fixed-date token fixtures are date bombs otherwise). Fake ONLY Date.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────
// ga4ApiFetch — fail-soft ladder + refresh-on-401
// ─────────────────────────────────────────────────────────────────────

describe("ga4ApiFetch — fail-soft ladder", () => {
  it("returns no_token when no GA4 token exists", async () => {
    _ga4Token = null;
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({ ok: false, reason: "no_token" });
  });

  it("returns no_token (missing scope) when token lacks analytics.readonly", async () => {
    _ga4Token = makeToken({ scopes: ["https://example/wrong"] });
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({ ok: false, reason: "no_token", message: "missing scope" });
  });

  it("returns disconnected when token has disconnected_at set", async () => {
    _ga4Token = makeToken({ disconnected_at: "2026-05-10T08:00:00.000Z" });
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });

  it("returns token_expired when expires_at is > 7 days past", async () => {
    _ga4Token = makeToken({ expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000 });
    const r = await ga4ApiFetch({
      tenantId: "tenant-x",
      url: "https://example/x",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("token_expired");
  });

  it("returns ok:true + data on 200, sending the stored Bearer token", async () => {
    _ga4Token = makeToken();
    const stubFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ accountSummaries: [] }), { status: 200 }),
    );
    const r = await ga4ApiFetch<{ accountSummaries: unknown[] }>({
      tenantId: "tenant-x",
      url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      now: new Date(NOW_MS),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ accountSummaries: [] });
    const init = stubFetch.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-abc");
  });

  it("returns api_error with status on non-2xx non-401; api_error on fetch throw", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );
    const r = await ga4ApiFetch({ tenantId: "tenant-x", url: "https://example/x", now: new Date(NOW_MS) });
    expect(r).toMatchObject({ ok: false, reason: "api_error", status: 403 });

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));
    const r2 = await ga4ApiFetch({ tenantId: "tenant-x", url: "https://example/x", now: new Date(NOW_MS) });
    expect(r2).toMatchObject({ ok: false, reason: "api_error" });
  });

  it("refresh-on-401: retries with the refreshed Bearer and returns ok", async () => {
    _ga4Token = makeToken();
    _refreshAccessToken = "fresh-after-401";
    const stubFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accountSummaries: [] }), { status: 200 }),
      );
    const r = await ga4ApiFetch({ tenantId: "tenant-x", url: "https://example/x", now: new Date(NOW_MS) });
    expect(r.ok).toBe(true);
    const init = stubFetch.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fresh-after-401");
  });

  it("refresh-on-401 failure → token_expired", async () => {
    _ga4Token = makeToken();
    _refreshShouldThrow = true;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    const r = await ga4ApiFetch({ tenantId: "tenant-x", url: "https://example/x", now: new Date(NOW_MS) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token_expired");
  });
});

// ─────────────────────────────────────────────────────────────────────
// runGa4UrlTrafficReport — body shape, narrowing, pagination
// ─────────────────────────────────────────────────────────────────────

describe("runGa4UrlTrafficReport — body + narrowing", () => {
  it("buildRunReportBody locks the dimensions/metrics/order/limit shape", () => {
    const body = buildRunReportBody({ startDate: "2026-05-01", endDate: "2026-05-19" });
    expect(body).toEqual({
      dateRanges: [{ startDate: "2026-05-01", endDate: "2026-05-19" }],
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "conversions" }],
      orderBys: [
        { dimension: { dimensionName: "date" } },
        { dimension: { dimensionName: "pagePath" } },
      ],
      limit: GA4_PAGE_SIZE,
      offset: 0,
    });
  });

  it("narrowRunReportRows normalizes YYYYMMDD, drops malformed rows, defends junk metrics", () => {
    const rows = narrowRunReportRows({
      rows: [
        {
          dimensionValues: [{ value: "20260510" }, { value: "/a" }],
          metricValues: [{ value: "abc" }, { value: "5.5" }, { value: "" }],
        },
        { dimensionValues: [{ value: "bad-date" }, { value: "/b" }], metricValues: [{ value: "5" }] },
        { dimensionValues: [{ value: "20260510" }], metricValues: [] },
      ],
    });
    expect(rows).toEqual([
      { date: "2026-05-10", url: "/a", sessions: 0, engaged_sessions: 5, conversions: 0 },
    ]);
    expect(narrowRunReportRows(null)).toEqual([]);
  });

  it("returns no_token before any fetch when no token exists", async () => {
    _ga4Token = null;
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(r).toEqual({ ok: false, reason: "no_token" });
  });

  it("logs a bounded (≤500 char) warn body on non-2xx", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("X".repeat(2000), { status: 500 }),
    );
    await runGa4UrlTrafficReport(HAPPY_ARGS);
    const [, payload] = _warnSpy.mock.calls[0]!;
    expect(((payload as Record<string, unknown>).body as string).length).toBe(500);
  });
});

function makePageResponse(opts: { count: number; startIndex: number; rowCount?: number }): Response {
  const rows = Array.from({ length: opts.count }, (_, i) => {
    const idx = opts.startIndex + i;
    return {
      dimensionValues: [{ value: "20260510" }, { value: `/p/${idx}` }],
      metricValues: [{ value: "1" }, { value: "1" }, { value: "0" }],
    };
  });
  const body: Record<string, unknown> = { rows };
  if (opts.rowCount != null) body.rowCount = opts.rowCount;
  return new Response(JSON.stringify(body), { status: 200 });
}

function offsetOfCall(call: unknown[]): number {
  const init = call[1] as RequestInit;
  return (JSON.parse(init.body as string) as { offset?: number }).offset ?? -1;
}

describe("runGa4UrlTrafficReport — pagination", () => {
  it(">10k rows: pages with exact offsets, concatenated in order, not truncated", async () => {
    _ga4Token = makeToken();
    const stubFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makePageResponse({ count: 10000, startIndex: 0, rowCount: 25000 }))
      .mockResolvedValueOnce(makePageResponse({ count: 10000, startIndex: 10000, rowCount: 25000 }))
      .mockResolvedValueOnce(makePageResponse({ count: 5000, startIndex: 20000, rowCount: 25000 }));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(stubFetch).toHaveBeenCalledTimes(3);
    expect(offsetOfCall(stubFetch.mock.calls[0]!)).toBe(0);
    expect(offsetOfCall(stubFetch.mock.calls[1]!)).toBe(GA4_PAGE_SIZE);
    expect(offsetOfCall(stubFetch.mock.calls[2]!)).toBe(2 * GA4_PAGE_SIZE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(25000);
      expect(r.rows[0]!.url).toBe("/p/0");
      expect(r.rows[24999]!.url).toBe("/p/24999");
      expect(r.truncated).toBeFalsy();
    }
  });

  it("MAX_PAGES cap: stops at GA4_MAX_PAGES fetches, truncated:true, warn logged", async () => {
    _ga4Token = makeToken();
    const stubFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        makePageResponse({ count: 10000, startIndex: 0, rowCount: 9_000_000 }),
      );
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(stubFetch).toHaveBeenCalledTimes(GA4_MAX_PAGES);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).toBe(true);
      expect(r.rows).toHaveLength(GA4_MAX_PAGES * 10000);
    }
    expect(
      _warnSpy.mock.calls.some(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("GA4_MAX_PAGES"),
      ),
    ).toBe(true);
  });

  it("subsequent-page failure: returns partial rows + truncated:true (partial beats zero)", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makePageResponse({ count: 10000, startIndex: 0, rowCount: 25000 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(10000);
      expect(r.truncated).toBe(true);
    }
  });

  it("page-0 non-2xx fails the whole report (fail-soft does NOT apply to page 0)", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "api_error", status: 500 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sitewide sessions report — the non-additive counting pin
// ─────────────────────────────────────────────────────────────────────

describe("sitewide sessions report", () => {
  it("requests ONLY the date dimension — NO pagePath, so one visit counts once", () => {
    const body = buildSitewideSessionsReportBody({
      startDate: "2026-06-01",
      endDate: "2026-07-10",
    }) as { dimensions: { name: string }[]; metrics: { name: string }[] };
    expect(body.dimensions).toEqual([{ name: "date" }]);
    expect(JSON.stringify(body)).not.toContain("pagePath");
    expect(body.metrics.map((m) => m.name)).toEqual(["sessions", "engagedSessions"]);
  });

  it("narrowSitewideDailyRows maps by header name; narrowSitewideMonthlyRows maps YYYYMM", () => {
    expect(
      narrowSitewideDailyRows({
        metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }],
        rows: [
          { dimensionValues: [{ value: "20260601" }], metricValues: [{ value: "500" }, { value: "300" }] },
        ],
      }),
    ).toEqual([{ date: "2026-06-01", sessions: 500, engaged_sessions: 300 }]);
    expect(
      narrowSitewideMonthlyRows({
        rows: [{ dimensionValues: [{ value: "202606" }], metricValues: [{ value: "12540" }] }],
      }),
    ).toEqual([{ month: "2026-06-01", sessions: 12540 }]);
  });

  it("happy path returns narrowed rows + the property reporting timezone", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          metadata: { timeZone: "America/Los_Angeles" },
          metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }],
          rows: [
            { dimensionValues: [{ value: "20260501" }], metricValues: [{ value: "500" }, { value: "320" }] },
          ],
          rowCount: 1,
        }),
        { status: 200 },
      ),
    );
    const r = await runGa4SitewideSessionsReport(HAPPY_ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toEqual([{ date: "2026-05-01", sessions: 500, engaged_sessions: 320 }]);
      expect(r.propertyTimezone).toBe("America/Los_Angeles");
    }
  });

  it("dead grant (>7d past expiry) → token_expired", async () => {
    _ga4Token = makeToken({ expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000 });
    const r = await runGa4SitewideSessionsReport(HAPPY_ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token_expired");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Revenue report — header-name mapping + revenue_unavailable
// ─────────────────────────────────────────────────────────────────────

function jsonRes(body: unknown, opts: { ok?: boolean; status?: number; text?: string } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => body,
    text: async () => opts.text ?? JSON.stringify(body),
  } as unknown as Response;
}

describe("revenue report", () => {
  it("narrowRevenueRows maps by header NAME (not index) and nulls absent metrics", () => {
    expect(
      narrowRevenueRows({
        metricHeaders: [{ name: "transactions" }, { name: "totalRevenue" }, { name: "purchaseRevenue" }],
        rows: [
          {
            dimensionValues: [{ value: "20260610" }, { value: "/p" }],
            metricValues: [{ value: "3" }, { value: "150.5" }, { value: "120.25" }],
          },
        ],
      }),
    ).toEqual([
      { date: "2026-06-10", url: "/p", totalRevenue: 150.5, purchaseRevenue: 120.25, transactions: 3 },
    ]);
    const partial = narrowRevenueRows({
      metricHeaders: [{ name: "purchaseRevenue" }],
      rows: [
        { dimensionValues: [{ value: "20260610" }, { value: "/p" }], metricValues: [{ value: "10" }] },
      ],
    });
    expect(partial[0]).toEqual({
      date: "2026-06-10",
      url: "/p",
      totalRevenue: null,
      purchaseRevenue: 10,
      transactions: null,
    });
  });

  it("no token / disconnected → fail-closed BEFORE any fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    _ga4Token = null;
    expect((await runGa4RevenueReport(HAPPY_ARGS)).ok).toBe(false);
    _ga4Token = makeToken({ disconnected_at: "2026-05-01T00:00:00Z" });
    const r = await runGa4RevenueReport(HAPPY_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "disconnected" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("present revenue → rows + currency; observed-zero revenue is ok (NOT a failure)", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({
        metadata: { currencyCode: "USD" },
        metricHeaders: [{ name: "totalRevenue" }, { name: "purchaseRevenue" }, { name: "transactions" }],
        rows: [
          {
            dimensionValues: [{ value: "20260510" }, { value: "/buy" }],
            metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }],
          },
        ],
        rowCount: 1,
      }),
    );
    const r = await runGa4RevenueReport(HAPPY_ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.currency).toBe("USD");
      expect(r.rows[0]).toMatchObject({ totalRevenue: 0, purchaseRevenue: 0, transactions: 0 });
    }
  });

  it("400 naming a revenue metric → revenue_unavailable; generic 500 → api_error", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({}, { ok: false, status: 400, text: "Field purchaseRevenue is not a valid metric for this property." }),
    );
    const r = await runGa4RevenueReport(HAPPY_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "revenue_unavailable" });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({}, { ok: false, status: 500, text: "server error" }),
    );
    const r2 = await runGa4RevenueReport(HAPPY_ARGS);
    expect(r2).toMatchObject({ ok: false, reason: "api_error" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// AI-referral report — request filter + narrowing + auth ladder
// ─────────────────────────────────────────────────────────────────────

const AI_PAGE_BODY = {
  metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
  rows: [
    {
      dimensionValues: [{ value: "20260510" }, { value: "/iran-cheetah" }, { value: "chatgpt.com" }],
      metricValues: [{ value: "5" }, { value: "4" }, { value: "1.5" }],
    },
  ],
  rowCount: 1,
};

describe("AI-referral report", () => {
  it("filters sessionSource with one case-insensitive CONTAINS per broad term", () => {
    const b = buildAiReferralReportBody({ startDate: "2026-05-01", endDate: "2026-05-19" }) as {
      dimensions: Array<{ name: string }>;
      dimensionFilter: {
        orGroup: {
          expressions: Array<{
            filter: { fieldName: string; stringFilter: { matchType: string; value: string; caseSensitive: boolean } };
          }>;
        };
      };
    };
    expect(b.dimensions).toEqual([{ name: "date" }, { name: "pagePath" }, { name: "sessionSource" }]);
    const exprs = b.dimensionFilter.orGroup.expressions;
    expect(exprs.map((e) => e.filter.stringFilter.value)).toEqual([...AI_SOURCE_FILTER_TERMS]);
    for (const e of exprs) {
      expect(e.filter.fieldName).toBe("sessionSource");
      expect(e.filter.stringFilter.matchType).toBe("CONTAINS");
      expect(e.filter.stringFilter.caseSensitive).toBe(false);
    }
  });

  it("narrowAiReferralRows maps by header name, accepts `conversions` alias, drops junk", () => {
    const rows = narrowAiReferralRows({
      metricHeaders: [{ name: "keyEvents" }, { name: "sessions" }, { name: "engagedSessions" }],
      rows: [
        {
          dimensionValues: [{ value: "20260510" }, { value: "/a" }, { value: "chatgpt.com" }],
          metricValues: [{ value: "2.5" }, { value: "9" }, { value: "6" }],
        },
      ],
    });
    expect(rows[0]).toMatchObject({ sessions: 9, engaged_sessions: 6, key_events: 2.5 });
    const alias = narrowAiReferralRows({
      metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "conversions" }],
      rows: [
        {
          dimensionValues: [{ value: "20260510" }, { value: "/a" }, { value: "perplexity.ai" }],
          metricValues: [{ value: "3" }, { value: "2" }, { value: "1" }],
        },
      ],
    });
    expect(alias[0]).toMatchObject({ key_events: 1 });
    expect(narrowAiReferralRows(null)).toEqual([]);
  });

  it("happy path returns rows; 401 refresh-retries with the refreshed Bearer", async () => {
    _ga4Token = makeToken();
    _refreshAccessToken = "refreshed";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonRes(AI_PAGE_BODY));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runGa4AiReferralReport(HAPPY_ARGS);
    expect(r.ok).toBe(true);
    const retryAuth = (fetchMock.mock.calls[1]![1] as { headers: Record<string, string> }).headers
      .Authorization;
    expect(retryAuth).toBe("Bearer refreshed");
  });

  it("no token / missing scope → no_token BEFORE any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    _ga4Token = null;
    expect((await runGa4AiReferralReport(HAPPY_ARGS)).ok).toBe(false);
    _ga4Token = makeToken({ scopes: [] });
    expect(await runGa4AiReferralReport(HAPPY_ARGS)).toMatchObject({ ok: false, reason: "no_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// classifyAiSource — two-tier classification
// ─────────────────────────────────────────────────────────────────────

describe("classifyAiSource", () => {
  it("maps canonical hosts and collapses variants into one bucket", () => {
    expect(classifyAiSource("chatgpt.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("chat.openai.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("bard.google.com")?.domain).toBe("gemini.google.com");
    expect(classifyAiSource("  ChatGPT.com  ")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("www.perplexity.ai")?.domain).toBe("perplexity.ai");
  });

  it("contains fallback catches subdomains but NOT the short exact-only hosts", () => {
    expect(classifyAiSource("m.chatgpt.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("de.perplexity.ai")?.domain).toBe("perplexity.ai");
    // "you.com" inside "thankyou.com" must NOT match.
    expect(classifyAiSource("thankyou.com")).toBeNull();
    expect(classifyAiSource("zermeta.ai")).toBeNull();
  });

  it("returns null for ordinary referrers and never throws on junk", () => {
    expect(classifyAiSource("google.com")).toBeNull();
    expect(classifyAiSource("(direct)")).toBeNull();
    expect(classifyAiSource(null)).toBeNull();
    expect(classifyAiSource("")).toBeNull();
  });

  it("aiSourceLabel maps canonical domains and falls back honestly", () => {
    expect(aiSourceLabel("chatgpt.com")).toBe("ChatGPT");
    expect(aiSourceLabel("mystery.ai")).toBe("mystery.ai");
    expect(aiSourceLabel(null)).toBe("an AI assistant");
  });

  it("AI_SOURCE_FILTER_TERMS covers every canonical assistant (no under-fetch)", () => {
    const hosts = [
      "chatgpt.com",
      "chat.openai.com",
      "perplexity.ai",
      "gemini.google.com",
      "bard.google.com",
      "copilot.microsoft.com",
      "claude.ai",
      "you.com",
      "meta.ai",
    ];
    for (const host of hosts) {
      expect(
        AI_SOURCE_FILTER_TERMS.some((t) => host.includes(t)),
        `${host} must be covered by a filter term`,
      ).toBe(true);
    }
  });
});
