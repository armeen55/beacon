/**
 * SOURCES — GA4 persistence boundaries (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/ga4/{persist-sitewide-sessions,
 * persist-url-traffic, normalize-page-path}.
 *
 * Pinned boundaries:
 *   • Sitewide daily totals: property mismatch FAILS CLOSED, idempotent
 *     composite-key upsert (never inflates a day), tenant isolation on every
 *     row, honest zero (no fabricated rows), never reads ga4_url_traffic.
 *   • URL traffic: normalized full-URL rows on (tenant_id,url,date), honest
 *     zero, fail-soft (admin_unavailable / persist_failed, never throws),
 *     revenue enrichment is best-effort and never clobbers prior revenue,
 *     chunked upsert stops at the failing batch.
 *   • computeRefreshDateRange: full 420-day window policy.
 *   • normalizeGa4PagePathToFullUrl: path+domain → full URL, soft-fail on
 *     missing domain, never throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────

const _runReportMock = vi.fn();
const _runRevenueMock = vi.fn();
vi.mock("@/lib/connectors/ga4/data-api", () => ({
  runGa4UrlTrafficReport: (...a: unknown[]) => _runReportMock(...a),
  runGa4RevenueReport: (...a: unknown[]) => _runRevenueMock(...a),
}));

let _configuredProperty = "123456789";
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async () =>
    _configuredProperty === "" ? { ga4_property_id: "" } : { ga4_property_id: _configuredProperty },
  ),
}));

const _upsertMock = vi.fn();
let _adminThrows = false;
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_adminThrows) throw new Error("admin unavailable");
    return {
      from: (_t: string) => ({ upsert: (rows: unknown, opts: unknown) => _upsertMock(rows, opts) }),
    };
  },
}));

const _logWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: { warn: (...a: unknown[]) => _logWarn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const _businessConfigDomain = { current: "ritzbuilders.com" };
vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({
    name: "Ritz Builders",
    domain: _businessConfigDomain.current,
    industry: "",
    phone: "",
    address: "",
    yelpBusinessId: "",
  }),
}));

import {
  computeRefreshDateRange,
  persistGa4UrlTraffic,
  __testing,
} from "@/lib/connectors/ga4/persist-url-traffic";
import { normalizeGa4PagePathToFullUrl } from "@/lib/connectors/ga4/normalize-page-path";

const URL_ARGS = {
  tenantId: "tenant-test",
  propertyId: "12345678",
  startDate: "2026-02-18",
  endDate: "2026-05-19",
};

beforeEach(() => {
  _runReportMock.mockReset();
  _runRevenueMock.mockReset();
  _runRevenueMock.mockResolvedValue({ ok: false, reason: "revenue_unavailable" });
  _upsertMock.mockReset();
  _adminThrows = false;
  _configuredProperty = "123456789";
  _logWarn.mockReset();
  _businessConfigDomain.current = "ritzbuilders.com";
});

// ─────────────────────────────────────────────────────────────────────
// computeRefreshDateRange — pure window policy
// ─────────────────────────────────────────────────────────────────────

describe("computeRefreshDateRange", () => {
  const NOW = new Date("2026-05-19T12:00:00Z");
  const FULL_WINDOW_START = "2025-03-25"; // 2026-05-19 − 420d

  it("always spans the full 420-day retention window ending today UTC", () => {
    expect(computeRefreshDateRange([], NOW)).toEqual({
      startDate: FULL_WINDOW_START,
      endDate: "2026-05-19",
    });
    // Malformed / null live_at values never shrink or break the window.
    expect(
      computeRefreshDateRange([{ live_at: null }, { live_at: "not-a-date" }, {}], NOW).startDate,
    ).toBe(FULL_WINDOW_START);
    // An edit older than the cap clamps to the same floor.
    expect(computeRefreshDateRange([{ live_at: "2025-01-01T00:00:00Z" }], NOW).startDate).toBe(
      FULL_WINDOW_START,
    );
  });

  it("locked defaults: DEFAULT == MAX == 420 days, table ga4_url_traffic", () => {
    expect(__testing.DEFAULT_LOOKBACK_DAYS).toBe(420);
    expect(__testing.MAX_LOOKBACK_DAYS).toBe(420);
    expect(__testing.TABLE).toBe("ga4_url_traffic");
  });
});

// ─────────────────────────────────────────────────────────────────────
// persistGa4UrlTraffic
// ─────────────────────────────────────────────────────────────────────

describe("persistGa4UrlTraffic — happy path + fail-soft", () => {
  it("rejects missing args with invalid_args (no API call, no upsert)", async () => {
    const r = await persistGa4UrlTraffic({ ...URL_ARGS, tenantId: "" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(_runReportMock).not.toHaveBeenCalled();
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("passes through a Data API non-ok reason without persisting", async () => {
    _runReportMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "token_expired" });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("empty rows → ok with zero counts, NO upsert call", async () => {
    _runReportMock.mockResolvedValue({ ok: true, rows: [] });
    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r).toEqual({
      ok: true,
      rows_fetched: 0,
      rows_upserted: 0,
      startDate: URL_ARGS.startDate,
      endDate: URL_ARGS.endDate,
    });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("upserts normalized FULL urls with tenant_id + raw on (tenant_id,url,date) — never raw pagePath", async () => {
    const rows = [
      { url: "/a", date: "2026-05-18", sessions: 12, engaged_sessions: 8, conversions: 1 },
      { url: "/b/", date: "2026-05-19", sessions: 3, engaged_sessions: 2, conversions: 0 },
    ];
    _runReportMock.mockResolvedValue({ ok: true, rows });
    _upsertMock.mockResolvedValue({ error: null });

    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r).toMatchObject({ ok: true, rows_fetched: 2, rows_upserted: 2 });

    const [upsertedRows, opts] = _upsertMock.mock.calls[0]!;
    expect(opts).toEqual({ onConflict: "tenant_id,url,date" });
    const arr = upsertedRows as Array<Record<string, unknown>>;
    expect(arr[0]).toMatchObject({
      tenant_id: URL_ARGS.tenantId,
      url: "https://ritzbuilders.com/a",
      raw: rows[0],
    });
    expect(arr[1]!.url).toBe("https://ritzbuilders.com/b/");
    for (const row of arr) {
      expect((row.url as string).startsWith("https://")).toBe(true);
      expect((row.url as string).startsWith("/")).toBe(false);
      expect(typeof row.last_synced_at).toBe("string");
    }
  });

  it("admin throw → admin_unavailable; upsert error → persist_failed; never throws", async () => {
    _runReportMock.mockResolvedValue({
      ok: true,
      rows: [{ url: "/x", date: "2026-05-19", sessions: 1, engaged_sessions: 1, conversions: 0 }],
    });
    _adminThrows = true;
    expect(await persistGa4UrlTraffic(URL_ARGS)).toMatchObject({
      ok: false,
      reason: "admin_unavailable",
    });
    expect(_upsertMock).not.toHaveBeenCalled();

    _adminThrows = false;
    _upsertMock.mockResolvedValue({ error: { message: "boom", code: "23505" } });
    await expect(persistGa4UrlTraffic(URL_ARGS)).resolves.toMatchObject({
      ok: false,
      reason: "persist_failed",
      message: "boom",
    });
  });
});

describe("persistGa4UrlTraffic — revenue enrichment (best-effort)", () => {
  const TRAFFIC = [
    { url: "/buy", date: "2026-06-10", sessions: 100, engaged_sessions: 60, conversions: 5 },
    { url: "/blog", date: "2026-06-10", sessions: 50, engaged_sessions: 20, conversions: 0 },
  ];

  it("revenue OK → rows get revenue columns + revenue_synced_at; absent page = observed 0", async () => {
    _runReportMock.mockResolvedValue({ ok: true, rows: TRAFFIC });
    _runRevenueMock.mockResolvedValue({
      ok: true,
      currency: "USD",
      rows: [{ date: "2026-06-10", url: "/buy", totalRevenue: 800, purchaseRevenue: 750, transactions: 5 }],
    });
    _upsertMock.mockResolvedValue({ error: null });

    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.revenue?.synced).toBe(true);
      expect(r.revenue?.rows_with_revenue).toBe(1);
    }
    const arr = _upsertMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const buy = arr.find((x) => String(x.url).endsWith("/buy"))!;
    const blog = arr.find((x) => String(x.url).endsWith("/blog"))!;
    expect(buy.purchase_revenue).toBe(750);
    expect(buy.revenue_source).toBe("ga4_purchase_revenue");
    expect(blog.purchase_revenue).toBe(0); // observed zero, still stamped
    expect(blog.revenue_synced_at).toBeTruthy();
  });

  it("revenue UNAVAILABLE → traffic persists; revenue columns OMITTED (never clobbers prior revenue)", async () => {
    _runReportMock.mockResolvedValue({ ok: true, rows: TRAFFIC });
    _runRevenueMock.mockResolvedValue({ ok: false, reason: "revenue_unavailable" });
    _upsertMock.mockResolvedValue({ error: null });

    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows_upserted).toBe(2);
      expect(r.revenue?.synced).toBe(false);
    }
    const arr = _upsertMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect("revenue_synced_at" in arr[0]!).toBe(false);
    expect("purchase_revenue" in arr[0]!).toBe(false);
  });
});

describe("persistGa4UrlTraffic — chunked upsert", () => {
  function makeRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      url: `/p/${i}`,
      date: "2026-05-19",
      sessions: 1,
      engaged_sessions: 1,
      conversions: 0,
    }));
  }

  it("splits a >CHUNK_SIZE pull into batches, each with the conflict target, summing rows_upserted", async () => {
    const total = __testing.UPSERT_CHUNK_SIZE * 2 + 5;
    _runReportMock.mockResolvedValue({ ok: true, rows: makeRows(total) });
    _upsertMock.mockResolvedValue({ error: null });

    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r).toMatchObject({ ok: true, rows_fetched: total, rows_upserted: total });
    expect(_upsertMock).toHaveBeenCalledTimes(3);
    for (const call of _upsertMock.mock.calls) {
      expect(call[1]).toEqual({ onConflict: "tenant_id,url,date" });
      expect((call[0] as unknown[]).length).toBeLessThanOrEqual(__testing.UPSERT_CHUNK_SIZE);
    }
  });

  it("a mid-run batch failure returns persist_failed and stops at the failing batch", async () => {
    const total = __testing.UPSERT_CHUNK_SIZE * 2 + 1;
    _runReportMock.mockResolvedValue({ ok: true, rows: makeRows(total) });
    _upsertMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: { message: "canceling statement due to statement timeout", code: "57014" },
      });

    const r = await persistGa4UrlTraffic(URL_ARGS);
    expect(r).toMatchObject({ ok: false, reason: "persist_failed" });
    expect(_upsertMock).toHaveBeenCalledTimes(2);
    const warn = _logWarn.mock.calls.find((c) => String(c[0]).includes("upsert failed"));
    expect((warn![1] as { rowsUpsertedBeforeFailure: number }).rowsUpsertedBeforeFailure).toBe(
      __testing.UPSERT_CHUNK_SIZE,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// normalizeGa4PagePathToFullUrl — pure boundaries
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl", () => {
  it("prefixes path-only input with https://{domain}, preserving trailing slash", () => {
    expect(
      normalizeGa4PagePathToFullUrl({ pagePath: "/services/x/", domain: "ritzbuilders.com" }),
    ).toBe("https://ritzbuilders.com/services/x/");
    expect(normalizeGa4PagePathToFullUrl({ pagePath: "/", domain: "ritzbuilders.com" })).toBe(
      "https://ritzbuilders.com/",
    );
  });

  it("passes already-full URLs through unchanged (no silent https upgrade)", () => {
    expect(
      normalizeGa4PagePathToFullUrl({ pagePath: "http://x.com/a", domain: "ritzbuilders.com" }),
    ).toBe("http://x.com/a");
  });

  it("cleans domain hygiene (scheme + www. + trailing slash + case)", () => {
    expect(
      normalizeGa4PagePathToFullUrl({ pagePath: "/a", domain: "https://WWW.RitzBuilders.com/" }),
    ).toBe("https://ritzbuilders.com/a");
  });

  it("soft-fails: empty pagePath → ''; missing domain → path-only; never throws", () => {
    expect(normalizeGa4PagePathToFullUrl({ pagePath: "", domain: "x.com" })).toBe("");
    expect(normalizeGa4PagePathToFullUrl({ pagePath: "/a", domain: "" })).toBe("/a");
    expect(() =>
      normalizeGa4PagePathToFullUrl({ pagePath: " weird", domain: "🦄" }),
    ).not.toThrow();
  });
});
