/**
 * 2026-06-26 — GA4 revenue report (`runGa4RevenueReport` + pure helpers) tests.
 *
 * Pins the revenue-specific paths added by the GA4 revenue migration:
 *   • buildRevenueReportBody: revenue metrics + deterministic order.
 *   • narrowRevenueRows: maps by metric-header NAME; float revenue; null when
 *     a metric is absent; defensive drops.
 *   • runGa4RevenueReport: present revenue + currency; observed-zero;
 *     revenue_unavailable on a 400 naming a revenue metric; generic api_error;
 *     no_token / disconnected fail-soft.
 *
 * All fetch + connector-store + google-auth refresh are mocked — NO live GA4.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GoogleConnectorToken } from "@/lib/connector-store";

let _ga4Token: GoogleConnectorToken | null = null;
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" | "ga4") =>
    kind === "ga4" ? _ga4Token : null,
  ),
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async () => ({ access_token: "refreshed", expires_in: 3600 })),
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runGa4RevenueReport,
  buildRevenueReportBody,
  narrowRevenueRows,
  GA4_REVENUE_METRICS,
} from "@/lib/connectors/ga4/data-api";

const NOW_MS = Date.UTC(2026, 5, 26, 12, 0, 0);
function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_ga4",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    // Relative to REAL wall-clock time: the implementation evaluates expiry against
    // new Date(), so a fixed-date fixture becomes a time bomb (this one detonated
    // 2026-07-03, exactly 7 days after its hardcoded mint date).
    expires_at: Date.now() + 30 * 60 * 1000,
    connected_at: new Date(Date.now() - 86_400_000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ga4_property_id: "123456789",
    ...over,
  } as GoogleConnectorToken;
}
const ARGS = { tenantId: "t1", propertyId: "123456789", startDate: "2026-06-01", endDate: "2026-06-26" };

function res(body: unknown, opts: { ok?: boolean; status?: number; text?: string } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => body,
    text: async () => opts.text ?? JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  _ga4Token = null;
  vi.restoreAllMocks();
});

describe("buildRevenueReportBody", () => {
  it("requests the revenue metrics with deterministic order", () => {
    const b = buildRevenueReportBody({ startDate: "a", endDate: "b" }) as Record<string, unknown>;
    expect(b.metrics).toEqual(GA4_REVENUE_METRICS.map((name) => ({ name })));
    expect(GA4_REVENUE_METRICS).toContain("purchaseRevenue");
    expect(b.orderBys).toBeTruthy();
    expect(b.offset).toBe(0);
  });
});

describe("narrowRevenueRows — maps by header NAME, not index", () => {
  it("assigns values correctly even when metric order differs", () => {
    const body = {
      metricHeaders: [{ name: "transactions" }, { name: "totalRevenue" }, { name: "purchaseRevenue" }],
      rows: [
        {
          dimensionValues: [{ value: "20260610" }, { value: "/p" }],
          metricValues: [{ value: "3" }, { value: "150.5" }, { value: "120.25" }],
        },
      ],
    };
    expect(narrowRevenueRows(body)).toEqual([
      { date: "2026-06-10", url: "/p", totalRevenue: 150.5, purchaseRevenue: 120.25, transactions: 3 },
    ]);
  });

  it("null for a metric absent from the headers; drops malformed dates", () => {
    const body = {
      metricHeaders: [{ name: "purchaseRevenue" }],
      rows: [
        { dimensionValues: [{ value: "20260610" }, { value: "/p" }], metricValues: [{ value: "10" }] },
        { dimensionValues: [{ value: "BAD" }, { value: "/x" }], metricValues: [{ value: "9" }] },
      ],
    };
    const out = narrowRevenueRows(body);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ date: "2026-06-10", url: "/p", totalRevenue: null, purchaseRevenue: 10, transactions: null });
  });
});

describe("runGa4RevenueReport — fail-soft + revenue paths", () => {
  it("no token → no_token (no fetch)", async () => {
    _ga4Token = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runGa4RevenueReport(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("disconnected token → disconnected (no fetch)", async () => {
    _ga4Token = makeToken({ disconnected_at: "2026-06-01T00:00:00Z" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runGa4RevenueReport(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disconnected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("present revenue → rows + currency from metadata", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({
        metadata: { currencyCode: "USD" },
        metricHeaders: [{ name: "totalRevenue" }, { name: "purchaseRevenue" }, { name: "transactions" }],
        rows: [
          {
            dimensionValues: [{ value: "20260610" }, { value: "/buy" }],
            metricValues: [{ value: "500" }, { value: "450" }, { value: "5" }],
          },
        ],
        rowCount: 1,
      }),
    );
    const r = await runGa4RevenueReport(ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.currency).toBe("USD");
      expect(r.rows[0]).toMatchObject({ url: "/buy", purchaseRevenue: 450, transactions: 5 });
    }
  });

  it("observed-zero revenue → ok with 0 values (NOT a failure)", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({
        metadata: { currencyCode: "USD" },
        metricHeaders: [{ name: "totalRevenue" }, { name: "purchaseRevenue" }, { name: "transactions" }],
        rows: [
          { dimensionValues: [{ value: "20260610" }, { value: "/blog" }], metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }] },
        ],
        rowCount: 1,
      }),
    );
    const r = await runGa4RevenueReport(ARGS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0]).toMatchObject({ totalRevenue: 0, purchaseRevenue: 0, transactions: 0 });
  });

  it("400 naming a revenue metric → revenue_unavailable (NOT generic api_error)", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      res({}, { ok: false, status: 400, text: 'Field purchaseRevenue is not a valid metric for this property.' }),
    );
    const r = await runGa4RevenueReport(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revenue_unavailable");
  });

  it("generic 500 → api_error (revenue stays unknown upstream)", async () => {
    _ga4Token = makeToken();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res({}, { ok: false, status: 500, text: "server error" }));
    const r = await runGa4RevenueReport(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("api_error");
  });
});
