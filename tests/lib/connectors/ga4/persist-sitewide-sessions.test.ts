/**
 * 2026-07-10 - Wave 2A - persistGa4SitewideDailyTotals pins:
 *   - PROPERTY MISMATCH FAILS CLOSED: a report property that does not match the
 *     tenant's configured ga4_property_id is refused (no upsert).
 *   - IDEMPOTENT: upserts on (tenant_id, property_id, date) so repeated/overlapping
 *     syncs overwrite the same key and can never inflate a day.
 *   - stores property_timezone from the report (the tz GA4 bucketed dates in).
 *   - two tenants / two properties isolated: every row carries its own tenant_id +
 *     property_id.
 *   - SOURCE PIN: this module NEVER reads ga4_url_traffic and never sums pagePath
 *     (that is the non-additive bug Wave 1 withdrew).
 *   - empty rows -> ok with zero counts, NO upsert (never a fabricated zero).
 *   - fail-soft: admin throw -> admin_unavailable; upsert error -> persist_failed;
 *     never throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const _runSitewideMock = vi.fn();
vi.mock("@/lib/connectors/ga4/data-api", () => ({
  runGa4SitewideSessionsReport: (...a: unknown[]) => _runSitewideMock(...a),
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
    return { from: (_t: string) => ({ upsert: (rows: unknown, opts: unknown) => _upsertMock(rows, opts) }) };
  },
}));

const _logWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: { warn: (...a: unknown[]) => _logWarn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { persistGa4SitewideDailyTotals } from "@/lib/connectors/ga4/persist-sitewide-sessions";

const ARGS = {
  tenantId: "tenant-iranopedia",
  propertyId: "123456789",
  startDate: "2026-06-01",
  endDate: "2026-07-10",
  now: new Date("2026-07-10T00:00:00Z"),
};

beforeEach(() => {
  _runSitewideMock.mockReset();
  _upsertMock.mockReset();
  _adminThrows = false;
  _configuredProperty = "123456789";
  _logWarn.mockReset();
});

describe("persistGa4SitewideDailyTotals - property mismatch fails closed", () => {
  it("refuses to persist when the report property != the configured ga4_property_id", async () => {
    _configuredProperty = "999999999"; // configured property differs from ARGS.propertyId
    const r = await persistGa4SitewideDailyTotals(ARGS);
    expect(r).toMatchObject({ ok: false, reason: "property_mismatch" });
    expect(_runSitewideMock).not.toHaveBeenCalled();
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("no configured property -> no_token, no persist", async () => {
    _configuredProperty = "";
    const r = await persistGa4SitewideDailyTotals(ARGS);
    expect(r.ok).toBe(false);
    expect(_upsertMock).not.toHaveBeenCalled();
  });
});

describe("persistGa4SitewideDailyTotals - idempotent upsert + row shape", () => {
  it("upserts on (tenant_id, property_id, date); every row carries tenant + property + timezone", async () => {
    _runSitewideMock.mockResolvedValue({
      ok: true,
      propertyTimezone: "America/Los_Angeles",
      rows: [
        { date: "2026-06-01", sessions: 500, engaged_sessions: 320 },
        { date: "2026-06-02", sessions: 12, engaged_sessions: 9 },
      ],
    });
    _upsertMock.mockResolvedValue({ error: null });

    const r = await persistGa4SitewideDailyTotals(ARGS);
    expect(r).toMatchObject({ ok: true, rows_fetched: 2, rows_upserted: 2, propertyTimezone: "America/Los_Angeles" });

    const [rows, opts] = _upsertMock.mock.calls[0]!;
    // Idempotency: the composite key means a repeated sync overwrites, never appends.
    expect(opts).toEqual({ onConflict: "tenant_id,property_id,date" });
    const arr = rows as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toMatchObject({
      tenant_id: "tenant-iranopedia",
      property_id: "123456789",
      date: "2026-06-01",
      sessions: 500,
      engaged_sessions: 320,
      property_timezone: "America/Los_Angeles",
    });
  });

  it("two tenants / two properties isolated: rows carry each caller's own tenant + property", async () => {
    _runSitewideMock.mockResolvedValue({
      ok: true,
      propertyTimezone: null,
      rows: [{ date: "2026-06-01", sessions: 7, engaged_sessions: 3 }],
    });
    _upsertMock.mockResolvedValue({ error: null });

    _configuredProperty = "prop-A";
    await persistGa4SitewideDailyTotals({ ...ARGS, tenantId: "tenant-a", propertyId: "prop-A" });
    _configuredProperty = "prop-B";
    await persistGa4SitewideDailyTotals({ ...ARGS, tenantId: "tenant-b", propertyId: "prop-B" });

    const a = _upsertMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const b = _upsertMock.mock.calls[1]![0] as Array<Record<string, unknown>>;
    expect(a[0]).toMatchObject({ tenant_id: "tenant-a", property_id: "prop-A" });
    expect(b[0]).toMatchObject({ tenant_id: "tenant-b", property_id: "prop-B" });
  });

  it("empty report -> ok with zero counts and NO upsert (never a fabricated zero)", async () => {
    _runSitewideMock.mockResolvedValue({ ok: true, propertyTimezone: null, rows: [] });
    const r = await persistGa4SitewideDailyTotals(ARGS);
    expect(r).toMatchObject({ ok: true, rows_fetched: 0, rows_upserted: 0 });
    expect(_upsertMock).not.toHaveBeenCalled();
  });
});

describe("persistGa4SitewideDailyTotals - fail-soft + source pin", () => {
  it("passes through a dead-grant reason without persisting", async () => {
    _runSitewideMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await persistGa4SitewideDailyTotals(ARGS);
    expect(r).toMatchObject({ ok: false, reason: "token_expired" });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("admin throw -> admin_unavailable; upsert error -> persist_failed; never throws", async () => {
    _runSitewideMock.mockResolvedValue({
      ok: true,
      propertyTimezone: null,
      rows: [{ date: "2026-06-01", sessions: 1, engaged_sessions: 1 }],
    });
    _adminThrows = true;
    expect(await persistGa4SitewideDailyTotals(ARGS)).toMatchObject({ ok: false, reason: "admin_unavailable" });

    _adminThrows = false;
    _upsertMock.mockResolvedValue({ error: { message: "boom", code: "23505" } });
    await expect(persistGa4SitewideDailyTotals(ARGS)).resolves.toMatchObject({ ok: false, reason: "persist_failed" });
  });

  it("SOURCE PIN: the module never reads ga4_url_traffic and never sums a pagePath", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../src/lib/connectors/ga4/persist-sitewide-sessions.ts"),
      "utf8",
    );
    expect(src).not.toContain("ga4_url_traffic");
    expect(src).not.toContain("pagePath");
  });
});
