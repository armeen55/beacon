/**
 * 2026-07-10 - Wave 2A - GA4 sitewide sessions report (date-only) + the DIRECT
 * monthly reconciliation report (yearMonth). Pins:
 *   - buildSitewideSessionsReportBody: ONE `date` dimension, NO pagePath (this is
 *     WHY the sitewide total is trustworthy - GA4 aggregates across pages itself,
 *     so one visit touching several pages is counted once by construction).
 *   - buildSitewideMonthlyReportBody: ONE `yearMonth` dimension.
 *   - narrowSitewideDailyRows / narrowSitewideMonthlyRows: date/yearMonth
 *     normalization; header-name metric mapping; malformed-row drops.
 *   - TIMEZONE: the property's reporting timezone is read from response metadata
 *     (GA4 buckets `date`/`yearMonth` in that timezone by default).
 *   - fail-soft contract mirrors the sibling reports (no_token / token_expired).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

let _ga4Token: GoogleConnectorToken | null = null;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" | "ga4") =>
    kind === "ga4" ? _ga4Token : null,
  ),
  persistRefreshedGoogleToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async () => ({ access_token: "refreshed", expires_in: 3600 })),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runGa4SitewideSessionsReport,
  runGa4SitewideMonthlyReport,
  buildSitewideSessionsReportBody,
  buildSitewideMonthlyReportBody,
  narrowSitewideDailyRows,
  narrowSitewideMonthlyRows,
} from "@/lib/connectors/ga4/data-api";

const NOW_MS = Date.UTC(2026, 6, 10, 12, 0, 0);

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_ga4",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW_MS + 30 * 60 * 1000,
    connected_at: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ga4_property_id: "123456789",
    ga4_property_display_name: "Iranopedia",
    ga4_account_display_name: "Owner",
    ...over,
  } as GoogleConnectorToken;
}

const ARGS = {
  tenantId: "tenant-iranopedia",
  propertyId: "123456789",
  startDate: "2026-06-01",
  endDate: "2026-07-10",
};

beforeEach(() => {
  _ga4Token = null;
  vi.restoreAllMocks();
});

describe("buildSitewideSessionsReportBody - date dimension ONLY (no pagePath)", () => {
  it("requests ONLY the date dimension so GA4 aggregates sessions sitewide", () => {
    const body = buildSitewideSessionsReportBody({ startDate: "2026-06-01", endDate: "2026-07-10" }) as {
      dimensions: { name: string }[];
      metrics: { name: string }[];
    };
    expect(body.dimensions).toEqual([{ name: "date" }]);
    // The bug this whole wave fixes: NO pagePath dimension means no per-page rows to
    // sum, so one visit across several pages is counted exactly once.
    expect(JSON.stringify(body)).not.toContain("pagePath");
    expect(body.metrics.map((m) => m.name)).toEqual(["sessions", "engagedSessions"]);
  });
});

describe("buildSitewideMonthlyReportBody - yearMonth dimension (reconciliation truth)", () => {
  it("requests the yearMonth dimension + sessions", () => {
    const body = buildSitewideMonthlyReportBody({ startDate: "2026-01-01", endDate: "2026-07-10" }) as {
      dimensions: { name: string }[];
      metrics: { name: string }[];
    };
    expect(body.dimensions).toEqual([{ name: "yearMonth" }]);
    expect(JSON.stringify(body)).not.toContain("pagePath");
    expect(body.metrics.map((m) => m.name)).toEqual(["sessions"]);
  });
});

describe("narrowSitewideDailyRows", () => {
  it("normalizes YYYYMMDD to YYYY-MM-DD and maps metrics by header name", () => {
    const rows = narrowSitewideDailyRows({
      metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }],
      rows: [
        { dimensionValues: [{ value: "20260601" }], metricValues: [{ value: "500" }, { value: "300" }] },
        { dimensionValues: [{ value: "20260602" }], metricValues: [{ value: "12" }, { value: "9" }] },
      ],
    });
    expect(rows).toEqual([
      { date: "2026-06-01", sessions: 500, engaged_sessions: 300 },
      { date: "2026-06-02", sessions: 12, engaged_sessions: 9 },
    ]);
  });

  it("drops malformed date rows and returns [] for empty body", () => {
    expect(narrowSitewideDailyRows(null)).toEqual([]);
    expect(
      narrowSitewideDailyRows({ rows: [{ dimensionValues: [{ value: "bad" }], metricValues: [] }] }),
    ).toEqual([]);
  });
});

describe("narrowSitewideMonthlyRows", () => {
  it("normalizes YYYYMM to YYYY-MM-01", () => {
    const rows = narrowSitewideMonthlyRows({
      rows: [
        { dimensionValues: [{ value: "202606" }], metricValues: [{ value: "12540" }] },
        { dimensionValues: [{ value: "202607" }], metricValues: [{ value: "3120" }] },
      ],
    });
    expect(rows).toEqual([
      { month: "2026-06-01", sessions: 12540 },
      { month: "2026-07-01", sessions: 3120 },
    ]);
  });
});

describe("runGa4SitewideSessionsReport - fail-soft", () => {
  it("returns no_token when no GA4 token exists", async () => {
    _ga4Token = null;
    expect(await runGa4SitewideSessionsReport(ARGS)).toEqual({ ok: false, reason: "no_token" });
  });

  it("returns token_expired when the token is > 7 days past expiry (dead grant today)", async () => {
    _ga4Token = makeToken({ expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4SitewideSessionsReport(ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token_expired");
  });
});

describe("runGa4SitewideSessionsReport - happy path + property timezone", () => {
  it("returns narrowed daily rows and the property timezone from response metadata", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          metadata: { timeZone: "America/Los_Angeles" },
          metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }],
          rows: [
            { dimensionValues: [{ value: "20260601" }], metricValues: [{ value: "500" }, { value: "320" }] },
          ],
          rowCount: 1,
        }),
        { status: 200 },
      ),
    );
    const r = await runGa4SitewideSessionsReport(ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toEqual([{ date: "2026-06-01", sessions: 500, engaged_sessions: 320 }]);
      // The property's reporting timezone (GA4 buckets `date` in this tz by default).
      expect(r.propertyTimezone).toBe("America/Los_Angeles");
    }
  });
});

describe("runGa4SitewideMonthlyReport - happy path", () => {
  it("returns narrowed monthly rows for the reconciliation compare", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          metadata: { timeZone: "America/Los_Angeles" },
          rows: [{ dimensionValues: [{ value: "202606" }], metricValues: [{ value: "12540" }] }],
          rowCount: 1,
        }),
        { status: 200 },
      ),
    );
    const r = await runGa4SitewideMonthlyReport(ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([{ month: "2026-06-01", sessions: 12540 }]);
  });

  it("returns token_expired (not_connected upstream) on a dead grant", async () => {
    _ga4Token = makeToken({ expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    const r = await runGa4SitewideMonthlyReport(ARGS);
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token_expired");
  });
});
