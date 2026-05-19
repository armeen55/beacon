/**
 * 2026-05-19 — Slice 9.A2α — `runGa4UrlTrafficReport` + helpers
 * unit tests.
 *
 * Pins:
 *   • buildRunReportUrl: endpoint + property id encoded.
 *   • buildRunReportBody: locked dimensions/metrics/limit shape.
 *   • narrowRunReportRows: GA4 "YYYYMMDD" → "YYYY-MM-DD"; defensive
 *     drops on malformed rows; parses metric strings to ints.
 *   • Fail-soft contract: missing tenantId / propertyId / dates;
 *     no_token / missing_scope / disconnected / token_expired
 *     (stale_over_7d); 401 + refresh-retry happy + failure; non-2xx
 *     log.warn emitted with bounded body; fetch-throw fail-soft;
 *     json-parse fail-soft.
 *
 * All tests mock fetch + connector-store + google-auth refresh —
 * no real network calls, no real Supabase calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _ga4Token: GoogleConnectorToken | null = null;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" | "ga4") => {
    if (kind !== "ga4") return null;
    return _ga4Token;
  }),
}));

let _refreshShouldThrow = false;
let _refreshAccessToken = "refreshed-token";

vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async (_rt: string) => {
    if (_refreshShouldThrow) {
      throw new Error("refresh failed");
    }
    return { access_token: _refreshAccessToken, expires_in: 3600 };
  }),
}));

// vi.hoisted() because vi.mock() is hoisted to the top of the file
// by Vitest; without hoisted-binding the mock factory references a
// not-yet-initialized variable. The hoisted spy is shared across all
// tests; mockClear in beforeEach resets it.
const { _warnSpy } = vi.hoisted(() => ({ _warnSpy: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: _warnSpy,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  runGa4UrlTrafficReport,
  buildRunReportUrl,
  buildRunReportBody,
  narrowRunReportRows,
  __testing,
} from "@/lib/connectors/ga4/data-api";

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
    ga4_property_display_name: "Ritz Builders",
    ga4_account_display_name: "ArmeenAminzadeh",
    ...over,
  };
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
});

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe("buildRunReportUrl", () => {
  it("templates property id into the Data API endpoint", () => {
    expect(buildRunReportUrl("123456789")).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
    );
  });

  it("encodes special characters in property id (defensive)", () => {
    const u = buildRunReportUrl("abc/def");
    expect(u).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/abc%2Fdef:runReport",
    );
  });
});

describe("buildRunReportBody", () => {
  it("locks the dimensions/metrics/limit shape", () => {
    const body = buildRunReportBody({
      startDate: "2026-05-01",
      endDate: "2026-05-19",
    });
    expect(body).toEqual({
      dateRanges: [{ startDate: "2026-05-01", endDate: "2026-05-19" }],
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [
        { name: "sessions" },
        { name: "engagedSessions" },
        { name: "conversions" },
      ],
      limit: 10000,
    });
  });
});

describe("narrowRunReportRows", () => {
  it("flattens happy-path GA4 rows; normalizes YYYYMMDD → YYYY-MM-DD", () => {
    const body = {
      rows: [
        {
          dimensionValues: [{ value: "20260510" }, { value: "/services/whole-home-remodel" }],
          metricValues: [{ value: "42" }, { value: "30" }, { value: "1" }],
        },
        {
          dimensionValues: [{ value: "20260511" }, { value: "/services/whole-home-remodel" }],
          metricValues: [{ value: "55" }, { value: "40" }, { value: "2" }],
        },
      ],
    };
    expect(narrowRunReportRows(body)).toEqual([
      {
        date: "2026-05-10",
        url: "/services/whole-home-remodel",
        sessions: 42,
        engaged_sessions: 30,
        conversions: 1,
      },
      {
        date: "2026-05-11",
        url: "/services/whole-home-remodel",
        sessions: 55,
        engaged_sessions: 40,
        conversions: 2,
      },
    ]);
  });

  it("returns [] for null/undefined/non-object body", () => {
    expect(narrowRunReportRows(null)).toEqual([]);
    expect(narrowRunReportRows(undefined)).toEqual([]);
    expect(narrowRunReportRows({} as never)).toEqual([]);
  });

  it("drops rows missing date or url dimension", () => {
    const body = {
      rows: [
        { dimensionValues: [{ value: "20260510" }], metricValues: [] }, // missing url
        { dimensionValues: [{ value: "20260510" }, { value: "/a" }], metricValues: [] }, // missing metrics → defaults to 0
      ],
    };
    const result = narrowRunReportRows(body);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: "2026-05-10",
      url: "/a",
      sessions: 0,
      engaged_sessions: 0,
      conversions: 0,
    });
  });

  it("drops rows with malformed date (not YYYYMMDD)", () => {
    const body = {
      rows: [
        {
          dimensionValues: [{ value: "bad-date" }, { value: "/a" }],
          metricValues: [{ value: "5" }],
        },
      ],
    };
    expect(narrowRunReportRows(body)).toEqual([]);
  });

  it("parses non-numeric metric values to 0 (defensive)", () => {
    const body = {
      rows: [
        {
          dimensionValues: [{ value: "20260510" }, { value: "/a" }],
          metricValues: [{ value: "abc" }, { value: "5.5" }, { value: "" }],
        },
      ],
    };
    const r = narrowRunReportRows(body);
    expect(r[0]!.sessions).toBe(0); // "abc" → 0
    expect(r[0]!.engaged_sessions).toBe(5); // parseInt("5.5") → 5
    expect(r[0]!.conversions).toBe(0); // "" → 0
  });
});

// ─────────────────────────────────────────────────────────────────────
// runGa4UrlTrafficReport — fail-soft paths
// ─────────────────────────────────────────────────────────────────────

describe("runGa4UrlTrafficReport — fail-soft inputs", () => {
  it("returns no_token when tenantId is empty", async () => {
    const r = await runGa4UrlTrafficReport({ ...HAPPY_ARGS, tenantId: "" });
    expect(r).toEqual({
      ok: false,
      reason: "no_token",
      message: "missing tenantId",
    });
  });

  it("returns api_error when propertyId is empty", async () => {
    _ga4Token = makeToken();
    const r = await runGa4UrlTrafficReport({ ...HAPPY_ARGS, propertyId: "" });
    expect(r).toEqual({
      ok: false,
      reason: "api_error",
      message: "missing propertyId",
    });
  });

  it("returns api_error when startDate is empty", async () => {
    _ga4Token = makeToken();
    const r = await runGa4UrlTrafficReport({ ...HAPPY_ARGS, startDate: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("api_error");
  });

  it("returns no_token when no GA4 token exists", async () => {
    _ga4Token = null;
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(r).toEqual({ ok: false, reason: "no_token" });
  });

  it("returns no_token (missing scope) when token lacks analytics.readonly", async () => {
    _ga4Token = makeToken({ scopes: ["https://example.com/wrong"] });
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(r).toEqual({
      ok: false,
      reason: "no_token",
      message: "missing scope",
    });
  });

  it("returns disconnected when token has disconnected_at set", async () => {
    _ga4Token = makeToken({ disconnected_at: "2026-05-10T08:00:00.000Z" });
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });

  it("returns token_expired when expires_at is > 7 days past", async () => {
    _ga4Token = makeToken({
      expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token_expired");
  });
});

// ─────────────────────────────────────────────────────────────────────
// runGa4UrlTrafficReport — happy path + non-2xx logging
// ─────────────────────────────────────────────────────────────────────

describe("runGa4UrlTrafficReport — happy path", () => {
  it("returns ok:true + narrowed rows on 200 response", async () => {
    _ga4Token = makeToken();
    const stubFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rows: [
            {
              dimensionValues: [{ value: "20260510" }, { value: "/services/x" }],
              metricValues: [{ value: "10" }, { value: "8" }, { value: "1" }],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toEqual([
        {
          date: "2026-05-10",
          url: "/services/x",
          sessions: 10,
          engaged_sessions: 8,
          conversions: 1,
        },
      ]);
    }
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const call = stubFetch.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-abc",
    );
    expect(init.method).toBe("POST");
  });
});

describe("runGa4UrlTrafficReport — non-2xx logging", () => {
  it("logs log.warn with bounded body on 403 response (Admin API not enabled shape)", async () => {
    _ga4Token = makeToken();
    const errorBody = JSON.stringify({
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        message: "Google Analytics Data API has not been used in project XXX before or it is disabled.",
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(errorBody, { status: 403 }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("api_error");
      expect(r.status).toBe(403);
    }
    // Verify the log.warn was emitted with the structured payload.
    expect(_warnSpy).toHaveBeenCalledTimes(1);
    const [msg, payload] = _warnSpy.mock.calls[0]!;
    expect(msg).toContain("[ga4-data-api]");
    expect(msg).toContain("non-2xx");
    const p = payload as Record<string, unknown>;
    expect(p.tenantId).toBe("tenant-ritz-founder");
    expect(p.status).toBe(403);
    expect(typeof p.body).toBe("string");
    expect((p.body as string).length).toBeLessThanOrEqual(500);
    expect((p.body as string).includes("PERMISSION_DENIED")).toBe(true);
  });

  it("bounds body capture at 500 chars even when Google returns a longer error", async () => {
    _ga4Token = makeToken();
    const longBody = "X".repeat(2000);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(longBody, { status: 500 }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    const [, payload] = _warnSpy.mock.calls[0]!;
    const p = payload as Record<string, unknown>;
    expect((p.body as string).length).toBe(500);
  });

  it("returns api_error when fetch throws", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("api_error");
      expect(r.message).toBe("fetch threw");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// runGa4UrlTrafficReport — refresh-on-401 path
// ─────────────────────────────────────────────────────────────────────

describe("runGa4UrlTrafficReport — refresh-on-401", () => {
  it("returns ok:true after a successful refresh + retry", async () => {
    _ga4Token = makeToken();
    _refreshAccessToken = "fresh-after-401";
    const stubFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rows: [
              {
                dimensionValues: [{ value: "20260510" }, { value: "/x" }],
                metricValues: [{ value: "1" }, { value: "1" }, { value: "0" }],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    const secondCall = stubFetch.mock.calls[1]!;
    const init = secondCall[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fresh-after-401",
    );
  });

  it("returns token_expired when refresh-on-401 throws", async () => {
    _ga4Token = makeToken();
    _refreshShouldThrow = true;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4UrlTrafficReport(HAPPY_ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token_expired");
  });
});

describe("__testing exports", () => {
  it("exposes REQUIRED_SCOPE + DATA_API_HOST constants", () => {
    expect(__testing.REQUIRED_SCOPE).toBe(
      "https://www.googleapis.com/auth/analytics.readonly",
    );
    expect(__testing.DATA_API_HOST).toBe("https://analyticsdata.googleapis.com");
  });
});
