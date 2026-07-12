/**
 * 2026-07-10 - Wave 2A - ga4-sitewide-rollup pins:
 *   - SOURCE PIN (one session across many pages counted once; duplicate page-path
 *     rows cannot inflate): the rollup reads ga4_daily_totals (GA4's OWN sitewide
 *     per-day count) and NEVER ga4_url_traffic and NEVER sums a pagePath.
 *   - rolls daily rows into calendar months; the CURRENT month is flagged partial.
 *   - two-tenant / two-property isolation: reads are eq-filtered by tenant (and
 *     property when given).
 *   - missing data / missing table -> null (card holds back; never a bare zero).
 *   - loadReconciledVisitsForTenant gates the visits number: pass+fresh -> visits;
 *     stale pass -> none; mismatch -> mismatch; no marker -> none.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A thenable query whose select/eq/order/limit all chain, resolving to a per-table
// configured { data, error }. eq() calls are captured for isolation assertions.
type TableResult = { data: unknown[] | null; error: { code?: string; message?: string } | null };
const _tables: Record<string, TableResult> = {};
const _eqCalls: Array<{ table: string; col: string; val: unknown }> = [];

function makeQuery(table: string) {
  const result = _tables[table] ?? { data: [], error: null };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => {
    _eqCalls.push({ table, col, val });
    return q;
  };
  q.order = () => q;
  q.limit = () => q;
  q.then = (res: (r: TableResult) => unknown) => res(result);
  return q;
}

let _adminThrows = false;
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_adminThrows) throw new Error("no admin");
    return { from: (table: string) => makeQuery(table) };
  },
}));

// The card gate resolves the tenant's CURRENTLY configured GA4 property so an old
// property's marker can never restore the card (item 5). Default: property "p1".
let _currentGa4Property: string | null = "p1";
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async () =>
    _currentGa4Property == null ? null : { ga4_property_id: _currentGa4Property },
  ),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  loadGa4MonthlyRollupForTenant,
  readGa4Reconciliation,
  loadReconciledVisitsForTenant,
} from "./ga4-sitewide-rollup";

beforeEach(() => {
  for (const k of Object.keys(_tables)) delete _tables[k];
  _eqCalls.length = 0;
  _adminThrows = false;
  _currentGa4Property = "p1";
});

const NOW = new Date("2026-07-10T12:00:00Z");

describe("loadGa4MonthlyRollupForTenant", () => {
  it("rolls daily rows into calendar months and flags the CURRENT month partial", async () => {
    _tables.ga4_daily_totals = {
      error: null,
      data: [
        { date: "2026-06-01", sessions: 500, engaged_sessions: 300, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-10T02:00:00Z" },
        { date: "2026-06-02", sessions: 40, engaged_sessions: 20, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-10T02:00:00Z" },
        { date: "2026-07-01", sessions: 12, engaged_sessions: 8, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-10T02:00:00Z" },
      ],
    };
    const rollup = await loadGa4MonthlyRollupForTenant("tenant-a", { now: NOW });
    expect(rollup).not.toBeNull();
    const june = rollup!.months.find((m) => m.month === "2026-06-01")!;
    const july = rollup!.months.find((m) => m.month === "2026-07-01")!;
    // Additive across DISTINCT days: 500 + 40 = 540 for June.
    expect(june.sessions).toBe(540);
    expect(june.partial).toBe(false);
    // July is the current month -> partial ("so far").
    expect(july.sessions).toBe(12);
    expect(july.partial).toBe(true);
    expect(rollup!.propertyTimezone).toBe("America/Los_Angeles");
    expect(rollup!.latestSyncAt).toBe("2026-07-10T02:00:00Z");
  });

  it("marks the partial month in the property timezone, not UTC", async () => {
    _tables.ga4_daily_totals = {
      error: null,
      data: [
        { date: "2026-06-30", sessions: 10, engaged_sessions: 5, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-01T01:00:00Z" },
        { date: "2026-07-01", sessions: 2, engaged_sessions: 1, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-01T08:00:00Z" },
      ],
    };
    const rollup = await loadGa4MonthlyRollupForTenant("tenant-a", {
      propertyId: "p1",
      now: new Date("2026-07-01T01:30:00.000Z"),
    });
    expect(rollup!.months.find((m) => m.month === "2026-06-01")?.partial).toBe(true);
    expect(rollup!.months.find((m) => m.month === "2026-07-01")?.partial).toBe(false);
  });

  it("fails closed when stored rows have missing or conflicting property timezones", async () => {
    _tables.ga4_daily_totals = {
      error: null,
      data: [
        { date: "2026-06-01", sessions: 10, engaged_sessions: 5, property_id: "p1", property_timezone: null, synced_at: "2026-07-01T01:00:00Z" },
      ],
    };
    expect(await loadGa4MonthlyRollupForTenant("tenant-a", { propertyId: "p1", now: NOW })).toBeNull();

    _tables.ga4_daily_totals = {
      error: null,
      data: [
        { date: "2026-06-01", sessions: 10, engaged_sessions: 5, property_id: "p1", property_timezone: "UTC", synced_at: "2026-07-01T01:00:00Z" },
        { date: "2026-06-02", sessions: 10, engaged_sessions: 5, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-01T01:00:00Z" },
      ],
    };
    expect(await loadGa4MonthlyRollupForTenant("tenant-a", { propertyId: "p1", now: NOW })).toBeNull();
  });

  it("two-tenant / two-property isolation: reads are eq-filtered by tenant and property", async () => {
    _tables.ga4_daily_totals = { error: null, data: [] };
    await loadGa4MonthlyRollupForTenant("tenant-a", { propertyId: "prop-A", now: NOW });
    const tenantFilter = _eqCalls.find((c) => c.table === "ga4_daily_totals" && c.col === "tenant_id");
    const propFilter = _eqCalls.find((c) => c.table === "ga4_daily_totals" && c.col === "property_id");
    expect(tenantFilter?.val).toBe("tenant-a");
    expect(propFilter?.val).toBe("prop-A");
  });

  it("returns null (card holds back) when there is no data - never a bare zero", async () => {
    _tables.ga4_daily_totals = { error: null, data: [] };
    expect(await loadGa4MonthlyRollupForTenant("tenant-a", { now: NOW })).toBeNull();
  });

  it("returns null when the table is not migrated yet (PGRST205)", async () => {
    _tables.ga4_daily_totals = { error: { code: "PGRST205", message: "missing" }, data: null };
    expect(await loadGa4MonthlyRollupForTenant("tenant-a", { now: NOW })).toBeNull();
  });
});

describe("SOURCE PIN - additive-safe by construction", () => {
  it("the rollup reads ga4_daily_totals and never ga4_url_traffic / pagePath", () => {
    const src = readFileSync(resolve(__dirname, "ga4-sitewide-rollup.ts"), "utf8");
    expect(src).toContain("ga4_daily_totals");
    // The whole point: one visit touching several pages is counted ONCE because we
    // never read the per-(url,date) table and never sum a pagePath.
    expect(src).not.toContain("ga4_url_traffic");
    expect(src).not.toContain("pagePath");
  });
});

describe("loadReconciledVisitsForTenant - the card gate", () => {
  const dailyFresh = {
    error: null,
    data: [
      { date: "2026-06-01", sessions: 12540, engaged_sessions: 9000, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-10T02:00:00Z" },
      { date: "2026-07-01", sessions: 3120, engaged_sessions: 2000, property_id: "p1", property_timezone: "America/Los_Angeles", synced_at: "2026-07-10T02:00:00Z" },
    ],
  };

  function reconRow(over: Record<string, unknown> = {}) {
    return {
      error: null,
      data: [
        {
          tenant_id: "tenant-a",
          property_id: "p1",
          checked_at: "2026-07-10T03:00:00Z",
          status: "pass",
          tolerance_pct: 1,
          latest_sync_at: "2026-07-10T02:00:00Z",
          reconciled_through: "2026-06-01",
          per_month: [],
          ...over,
        },
      ],
    };
  }

  it("PASS + fresh reconciliation -> returns reconciled visits", async () => {
    _tables.ga4_monthly_reconciliation = reconRow();
    _tables.ga4_daily_totals = dailyFresh;
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("pass");
    if (gate.status === "pass") {
      const june = gate.months.find((m) => m.month === "2026-06-01")!;
      expect(june.visits).toBe(12540);
      expect(june.partial).toBe(false);
      expect(gate.reconciledThrough).toBe("2026-06-01");
    }
  });

  it("STALE pass (a sync newer than the check) -> none, so the card holds back", async () => {
    // checked_at is OLDER than the rollup's latest sync -> the pass is stale.
    _tables.ga4_monthly_reconciliation = reconRow({ checked_at: "2026-07-09T00:00:00Z" });
    _tables.ga4_daily_totals = dailyFresh; // synced_at 2026-07-10T02:00:00Z is newer
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("none");
  });

  it("MISMATCH marker -> mismatch state (drives the honest alert, no number)", async () => {
    _tables.ga4_monthly_reconciliation = reconRow({ status: "mismatch" });
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("mismatch");
  });

  it("no marker -> none (shipped hold-back stays)", async () => {
    _tables.ga4_monthly_reconciliation = { error: null, data: [] };
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("none");
  });

  it("not_connected marker -> none (dead grant never shows a number)", async () => {
    _tables.ga4_monthly_reconciliation = reconRow({ status: "not_connected" });
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("none");
  });

  it("a DIFFERENT configured property cannot inherit an old passing reconciliation -> none", async () => {
    // A fresh PASS marker exists for property p1, but the tenant now reports on p2.
    // The old property's pass must NOT restore the card for the new property.
    _tables.ga4_monthly_reconciliation = reconRow(); // property_id "p1", pass, fresh
    _tables.ga4_daily_totals = dailyFresh;
    _currentGa4Property = "p2";
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("none");
  });

  it("no configured GA4 property -> none (nothing to match the marker against)", async () => {
    _tables.ga4_monthly_reconciliation = reconRow(); // a passing marker still on file
    _tables.ga4_daily_totals = dailyFresh;
    _currentGa4Property = null;
    const gate = await loadReconciledVisitsForTenant("tenant-a", NOW);
    expect(gate.status).toBe("none");
  });
});

describe("readGa4Reconciliation", () => {
  it("returns null when the reconciliation table is missing (PGRST205)", async () => {
    _tables.ga4_monthly_reconciliation = { error: { code: "PGRST205" }, data: null };
    expect(await readGa4Reconciliation("tenant-a")).toBeNull();
  });
});
