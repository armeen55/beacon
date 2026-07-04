import { describe, it, expect } from "vitest";

import {
  syncGscWeeklyDimensionsForTenant,
  type WeeklyDimensionsSyncDeps,
} from "./weekly-dimensions-sync";
import type { GscSearchAnalyticsRow } from "./search-analytics";
import type { GscWeeklyDimensionsSnapshot } from "@/domains/gsc/weekly-dimensions";

/** A fixed "now" whose Pacific date minus the 3-day lag lands on a clean week. */
const NOW = new Date("2026-07-04T20:00:00.000Z"); // Pacific 2026-07-04
// lastFinalDay = 2026-07-01, so weekEnd = 2026-07-01, weekStart = 2026-06-25.

/** Build deps with an in-memory store and a query stub keyed by dimension. */
function makeDeps(
  over: {
    initialRows?: GscWeeklyDimensionsSnapshot[];
    appearance?: GscSearchAnalyticsRow[] | null;
    device?: GscSearchAnalyticsRow[] | null;
    country?: GscSearchAnalyticsRow[] | null;
    token?: string | null;
    property?: string | null;
    onQuery?: (dims: string[]) => void;
  } = {},
): { deps: WeeklyDimensionsSyncDeps; written: () => GscWeeklyDimensionsSnapshot[] } {
  let store = over.initialRows ?? [];
  const deps: WeeklyDimensionsSyncDeps = {
    resolveTokenImpl: async () => (over.token === undefined ? "tok" : over.token),
    resolvePropertyImpl: async () =>
      over.property === undefined ? "https://example.com/" : over.property,
    queryImpl: async (args) => {
      over.onQuery?.(args.dimensions);
      if (args.dimensions.includes("searchAppearance")) {
        return over.appearance === undefined
          ? [{ keys: ["TPF_FAQ"], clicks: 10, impressions: 500, ctr: 0.02, position: 5 }]
          : over.appearance;
      }
      if (args.dimensions.includes("device")) {
        return over.device === undefined
          ? [{ keys: ["MOBILE"], clicks: 40, impressions: 2000, ctr: 0.02, position: 8 }]
          : over.device;
      }
      if (args.dimensions.includes("country")) {
        return over.country === undefined
          ? [{ keys: ["usa"], clicks: 30, impressions: 1500, ctr: 0.02, position: 8 }]
          : over.country;
      }
      return [];
    },
    readRows: async () => store,
    writeRows: async (rows) => {
      store = rows;
    },
  };
  return { deps, written: () => store };
}

describe("syncGscWeeklyDimensionsForTenant (the weekly GSC dimensions pass)", () => {
  it("first run pulls the current AND prior week and persists both snapshots", async () => {
    const dims: string[][] = [];
    const { deps, written } = makeDeps({ onQuery: (d) => dims.push(d) });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: true, property: "https://example.com/", weeksPulled: 2 });
    const rows = written().filter((x) => x.tenant_id === "t1");
    expect(rows).toHaveLength(2);
    const weekEnds = rows.map((x) => x.weekEnd).sort();
    expect(weekEnds).toEqual(["2026-06-24", "2026-07-01"]);
    // Two weeks * (searchAppearance + device + country) = 6 pulls, and each
    // dimension is ALWAYS requested alone (the API forbids combining
    // searchAppearance with anything).
    expect(dims).toHaveLength(6);
    for (const d of dims) expect(d).toHaveLength(1);
  });

  it("is empty-safe: a quiet property (no rows) still persists a valid snapshot", async () => {
    const { deps, written } = makeDeps({ appearance: [], device: [], country: [] });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r.ran).toBe(true);
    const rows = written().filter((x) => x.tenant_id === "t1");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.appearance).toEqual([]);
    expect(rows[0]!.devices).toEqual([]);
    expect(rows[0]!.countries).toEqual([]);
  });

  it("R17c item 428: the country pull is persisted as its own register (alpha-3, lowercased)", async () => {
    const { deps, written } = makeDeps({
      country: [
        { keys: ["USA"], clicks: 100, impressions: 5000, ctr: 0.02, position: 8 },
        { keys: ["IRN"], clicks: 20, impressions: 1000, ctr: 0.02, position: 9 },
      ],
    });
    await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    const rows = written().filter((x) => x.tenant_id === "t1");
    const newest = rows.sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1))[0]!;
    expect(newest.countries).toEqual([
      { code: "usa", clicks: 100, impressions: 5000 },
      { code: "irn", clicks: 20, impressions: 1000 },
    ]);
  });

  it("writes NOTHING when the country pull fails (a partial week must never persist)", async () => {
    const { deps, written } = makeDeps({ country: null });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: false, reason: "gsc_weekly_pull_failed" });
    expect(written().filter((x) => x.tenant_id === "t1")).toHaveLength(0);
  });

  it("skips (zero requests) when a fresh snapshot for the week already exists", async () => {
    let queries = 0;
    const existing: GscWeeklyDimensionsSnapshot = {
      tenant_id: "t1",
      property: "https://example.com/",
      weekStart: "2026-06-25",
      weekEnd: "2026-07-01",
      pulledAt: NOW.toISOString(),
      appearance: [],
      devices: [],
    };
    const { deps } = makeDeps({ initialRows: [existing], onQuery: () => queries++ });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: false, reason: "weekly_snapshot_current" });
    expect(queries).toBe(0);
  });

  it("a later run (no prior-week pull) appends a single new snapshot", async () => {
    // Existing snapshot ends a full week before this run's target week.
    const existing: GscWeeklyDimensionsSnapshot = {
      tenant_id: "t1",
      property: "https://example.com/",
      weekStart: "2026-06-18",
      weekEnd: "2026-06-24",
      pulledAt: "2026-06-27T00:00:00.000Z",
      appearance: [],
      devices: [],
    };
    const dims: string[][] = [];
    const { deps, written } = makeDeps({ initialRows: [existing], onQuery: (d) => dims.push(d) });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: true, property: "https://example.com/", weeksPulled: 1 });
    // Only the current week is pulled (3 requests); the prior-week backfill is
    // first-run only.
    expect(dims).toHaveLength(3);
    const rows = written().filter((x) => x.tenant_id === "t1");
    expect(rows.map((x) => x.weekEnd).sort()).toEqual(["2026-06-24", "2026-07-01"]);
  });

  it("skips cheaply when GSC is not connected (no token)", async () => {
    const { deps, written } = makeDeps({ token: null });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: false, reason: "no_usable_gsc_token" });
    expect(written().filter((x) => x.tenant_id === "t1")).toHaveLength(0);
  });

  it("skips when no property is derivable", async () => {
    const { deps, written } = makeDeps({ property: null });
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: false, reason: "no_property_derivable" });
    expect(written().filter((x) => x.tenant_id === "t1")).toHaveLength(0);
  });

  it("writes NOTHING on a failed pull (a partial week must never persist as a full one)", async () => {
    const { deps, written } = makeDeps({ appearance: null }); // searchAppearance pull fails
    const r = await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    expect(r).toEqual({ ran: false, reason: "gsc_weekly_pull_failed" });
    expect(written().filter((x) => x.tenant_id === "t1")).toHaveLength(0);
  });

  it("never disturbs another tenant's stored snapshots", async () => {
    const other: GscWeeklyDimensionsSnapshot = {
      tenant_id: "t2",
      property: "https://other.com/",
      weekStart: "2026-06-25",
      weekEnd: "2026-07-01",
      pulledAt: NOW.toISOString(),
      appearance: [],
      devices: [],
    };
    const { deps, written } = makeDeps({ initialRows: [other] });
    await syncGscWeeklyDimensionsForTenant({ tenantId: "t1", now: NOW, deps });
    const t2 = written().filter((x) => x.tenant_id === "t2");
    expect(t2).toEqual([other]);
  });
});
