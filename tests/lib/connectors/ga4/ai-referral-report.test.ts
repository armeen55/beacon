/**
 * 2026-07-01 - GA4 AI-referral report tests (BEACON_500 item 6).
 *
 * Pins the request/response mapping in src/lib/connectors/ga4/data-api.ts:
 *   - buildAiReferralReportBody: [date, pagePath, sessionSource] dimensions,
 *     session metrics, an orGroup CONTAINS filter per AI_SOURCE_FILTER_TERMS,
 *     deterministic orderBys for exact offset pagination
 *   - narrowAiReferralRows: metric values map BY HEADER NAME (reorder-safe),
 *     `conversions` accepted as a `keyEvents` alias, YYYYMMDD -> YYYY-MM-DD,
 *     malformed rows dropped
 *   - runGa4AiReferralReport auth ladder (mocked fetch): happy path,
 *     401 refresh-once then success, non-2xx -> api_error (never throws)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GoogleConnectorToken } from "@/lib/connector-store";

let _ga4Token: GoogleConnectorToken | null = null;
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" | "ga4") =>
    kind === "ga4" ? _ga4Token : null,
  ),
  // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): rotated-refresh-token persist. No-op.
  persistRefreshedGoogleToken: vi.fn(async () => {}),
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async () => ({ access_token: "refreshed", expires_in: 3600 })),
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runGa4AiReferralReport,
  buildAiReferralReportBody,
  narrowAiReferralRows,
  GA4_AI_REFERRAL_METRICS,
} from "@/lib/connectors/ga4/data-api";
import { AI_SOURCE_FILTER_TERMS } from "@/lib/connectors/ga4/ai-sources";

const NOW_MS = Date.UTC(2026, 6, 1, 12, 0, 0);
function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_ga4",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW_MS + 30 * 60 * 1000,
    connected_at: new Date(NOW_MS - 86_400_000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ga4_property_id: "123456789",
    ...over,
  } as GoogleConnectorToken;
}
const ARGS = { tenantId: "t1", propertyId: "123456789", startDate: "2026-06-01", endDate: "2026-07-01" };

function res(body: unknown, opts: { ok?: boolean; status?: number; text?: string } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => body,
    text: async () => opts.text ?? JSON.stringify(body),
  } as unknown as Response;
}

const PAGE_BODY = {
  metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
  rows: [
    {
      dimensionValues: [{ value: "20260630" }, { value: "/iran-cheetah" }, { value: "chatgpt.com" }],
      metricValues: [{ value: "5" }, { value: "4" }, { value: "1.5" }],
    },
  ],
  rowCount: 1,
};

beforeEach(() => {
  _ga4Token = null;
  vi.restoreAllMocks();
  // Pin the clock to the fixture's NOW so the SUT's real-time expiry guard
  // (data-api.ts: ">7d past expiry" via `new Date()`) stays deterministic. Without
  // this the fixed-date token (expires 2026-07-01) reads as >7 days stale once the
  // real calendar passes 2026-07-08, flipping happy-path results to token_expired.
  // Fake ONLY Date (leave setTimeout real so any backoff still runs).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildAiReferralReportBody", () => {
  const b = buildAiReferralReportBody({ startDate: "2026-06-01", endDate: "2026-07-01" }) as {
    dimensions: Array<{ name: string }>;
    metrics: Array<{ name: string }>;
    dimensionFilter: { orGroup: { expressions: Array<{ filter: { fieldName: string; stringFilter: { matchType: string; value: string; caseSensitive: boolean } } }> } };
    orderBys: unknown[];
    limit: number;
    offset: number;
  };

  it("asks for [date, pagePath, sessionSource] and the session metrics", () => {
    expect(b.dimensions).toEqual([{ name: "date" }, { name: "pagePath" }, { name: "sessionSource" }]);
    expect(b.metrics).toEqual(GA4_AI_REFERRAL_METRICS.map((name) => ({ name })));
  });

  it("filters sessionSource with one case-insensitive CONTAINS per broad term", () => {
    const exprs = b.dimensionFilter.orGroup.expressions;
    expect(exprs.map((e) => e.filter.stringFilter.value)).toEqual([...AI_SOURCE_FILTER_TERMS]);
    for (const e of exprs) {
      expect(e.filter.fieldName).toBe("sessionSource");
      expect(e.filter.stringFilter.matchType).toBe("CONTAINS");
      expect(e.filter.stringFilter.caseSensitive).toBe(false);
    }
  });

  it("orders deterministically and paginates by offset", () => {
    expect(b.orderBys).toEqual([
      { dimension: { dimensionName: "date" } },
      { dimension: { dimensionName: "pagePath" } },
      { dimension: { dimensionName: "sessionSource" } },
    ]);
    expect(b.offset).toBe(0);
    expect(
      (buildAiReferralReportBody({ startDate: "a", endDate: "b", offset: 20 }) as { offset: number })
        .offset,
    ).toBe(20);
  });
});

describe("narrowAiReferralRows", () => {
  it("maps metrics by header NAME so a reordered metric set cannot misassign", () => {
    const rows = narrowAiReferralRows({
      metricHeaders: [{ name: "keyEvents" }, { name: "sessions" }, { name: "engagedSessions" }],
      rows: [
        {
          dimensionValues: [{ value: "20260630" }, { value: "/a" }, { value: "chatgpt.com" }],
          metricValues: [{ value: "2.5" }, { value: "9" }, { value: "6" }],
        },
      ],
    });
    expect(rows).toEqual([
      {
        date: "2026-06-30",
        pagePath: "/a",
        sessionSource: "chatgpt.com",
        sessions: 9,
        engaged_sessions: 6,
        key_events: 2.5,
      },
    ]);
  });

  it("accepts `conversions` as a keyEvents alias for older properties", () => {
    const rows = narrowAiReferralRows({
      metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "conversions" }],
      rows: [
        {
          dimensionValues: [{ value: "20260630" }, { value: "/a" }, { value: "perplexity.ai" }],
          metricValues: [{ value: "3" }, { value: "2" }, { value: "1" }],
        },
      ],
    });
    expect(rows[0]).toMatchObject({ key_events: 1 });
  });

  it("drops malformed rows and junk dates; never throws on junk bodies", () => {
    const rows = narrowAiReferralRows({
      metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
      rows: [
        { dimensionValues: [{ value: "notadate" }, { value: "/a" }, { value: "chatgpt.com" }], metricValues: [] },
        { dimensionValues: [{ value: "20260630" }, { value: "/ok" }, { value: "claude.ai" }], metricValues: [] },
        { dimensionValues: [{ value: "20260630" }], metricValues: [] },
        null as never,
      ],
    });
    expect(rows).toEqual([
      { date: "2026-06-30", pagePath: "/ok", sessionSource: "claude.ai", sessions: 0, engaged_sessions: 0, key_events: 0 },
    ]);
    expect(narrowAiReferralRows(null)).toEqual([]);
    expect(narrowAiReferralRows({} as never)).toEqual([]);
  });
});

describe("runGa4AiReferralReport - auth ladder with mocked fetch", () => {
  it("happy path: one page of rows, no truncation", async () => {
    _ga4Token = makeToken();
    const fetchMock = vi.fn(async () => res(PAGE_BODY));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runGa4AiReferralReport(ARGS);
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          date: "2026-06-30",
          pagePath: "/iran-cheetah",
          sessionSource: "chatgpt.com",
          sessions: 5,
          engaged_sessions: 4,
          key_events: 1.5,
        },
      ],
      rowCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 once -> refresh -> retry succeeds", async () => {
    _ga4Token = makeToken();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(res(PAGE_BODY));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runGa4AiReferralReport(ARGS);
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryAuth = (fetchMock.mock.calls[1]![1] as { headers: Record<string, string> }).headers
      .Authorization;
    expect(retryAuth).toBe("Bearer refreshed");
  });

  it("non-2xx (403) -> api_error with status; never throws", async () => {
    _ga4Token = makeToken();
    vi.stubGlobal("fetch", vi.fn(async () => res({}, { ok: false, status: 403, text: "denied" })));
    const r = await runGa4AiReferralReport(ARGS);
    expect(r).toMatchObject({ ok: false, reason: "api_error", status: 403 });
  });

  it("no token / missing scope -> no_token before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    _ga4Token = null;
    expect((await runGa4AiReferralReport(ARGS)).ok).toBe(false);
    _ga4Token = makeToken({ scopes: [] });
    const r = await runGa4AiReferralReport(ARGS);
    expect(r).toMatchObject({ ok: false, reason: "no_token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
