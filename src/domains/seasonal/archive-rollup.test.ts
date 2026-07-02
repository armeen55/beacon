/**
 * seasonal/archive-rollup tests (2026-07-02, master plan item 21).
 *
 * Pure month-range math (monthsBetween, wraps years correctly) plus the
 * idempotency SHAPE of the rollup: it reads gsc_daily_rows one bounded month
 * at a time and upserts on the (tenant_id, query, month) primary key so a
 * re-run replaces rather than duplicates. A mocked Supabase client stands in
 * for the real table so the test asserts the query/aggregate shape without a
 * live database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { monthsBetween } from "./archive-rollup";

describe("monthsBetween - pure month range math", () => {
  it("returns every month inclusive between two dates in the same year", () => {
    expect(monthsBetween("2026-01-15", "2026-04-02")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
  });

  it("wraps across a year boundary", () => {
    expect(monthsBetween("2025-11-01", "2026-02-01")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("returns exactly one month when start and end fall in the same month", () => {
    expect(monthsBetween("2026-05-02", "2026-05-28")).toEqual(["2026-05-01"]);
  });

  it("returns [] when the start is after the end", () => {
    expect(monthsBetween("2026-06-01", "2026-01-01")).toEqual([]);
  });
});

// ── mocked Supabase admin ───────────────────────────────────────────────
type DailyRow = { query: string; page: string; clicks: number; impressions: number };
let earliestDate: string | null = null;
let latestDate: string | null = null;
let dailyRowsByMonth: Record<string, DailyRow[]> = {};
let archivedMonths: string[] = [];
const upsertCalls: Array<{ rows: Array<{ tenant_id: string; query: string; month: string; impressions: number; clicks: number; top_page: string | null }>; onConflict: string }> = [];

function dailyRowsSelectBuilder() {
  let mode: "span-asc" | "span-desc" | "paged" = "paged";
  let since = "";
  let until = "";
  const chain = {
    eq() {
      return chain;
    },
    gte(_col: string, s: string) {
      since = s;
      return chain;
    },
    lt(_col: string, u: string) {
      until = u;
      return chain;
    },
    order(_col: string, opts?: { ascending?: boolean }) {
      // Only the span query (no gte/lt applied yet) calls order() before limit(1).
      mode = opts?.ascending === false ? "span-desc" : "span-asc";
      return chain;
    },
    limit(n: number) {
      if (n === 1 && mode === "span-asc") return Promise.resolve({ data: earliestDate ? [{ date: earliestDate }] : [], error: null });
      if (n === 1 && mode === "span-desc") return Promise.resolve({ data: latestDate ? [{ date: latestDate }] : [], error: null });
      return Promise.resolve({ data: [], error: null });
    },
    range(from: number) {
      const key = `${since}|${until}`;
      const rows = from === 0 ? dailyRowsByMonth[key] ?? [] : [];
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return chain;
}

function archiveSelectBuilder() {
  return {
    eq() {
      return {
        limit: () => Promise.resolve({ data: archivedMonths.map((m) => ({ month: m })), error: null }),
      };
    },
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "gsc_daily_rows") {
        return { select: () => dailyRowsSelectBuilder() };
      }
      if (table === "gsc_monthly_archive") {
        return {
          select: () => archiveSelectBuilder(),
          upsert: (rows: (typeof upsertCalls)[number]["rows"], opts: { onConflict: string }) => {
            upsertCalls.push({ rows, onConflict: opts.onConflict });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));

import { runMonthlyArchiveRollup } from "./archive-rollup";

describe("runMonthlyArchiveRollup", () => {
  beforeEach(() => {
    earliestDate = null;
    latestDate = null;
    dailyRowsByMonth = {};
    archivedMonths = [];
    upsertCalls.length = 0;
    vi.clearAllMocks();
  });

  it("is a no-op when the tenant has no gsc_daily_rows history", async () => {
    const result = await runMonthlyArchiveRollup("tenant-empty");
    expect(result.ran).toBe(false);
    expect(result.monthsRolled).toEqual([]);
    expect(upsertCalls).toHaveLength(0);
  });

  it("backfills every month of history on first run and aggregates per query with a top page", async () => {
    earliestDate = "2026-01-10";
    latestDate = "2026-02-20";
    dailyRowsByMonth["2026-01-01|2026-02-01"] = [
      { query: "nowruz table", page: "/nowruz", clicks: 10, impressions: 200 },
      { query: "nowruz table", page: "/other-page", clicks: 1, impressions: 50 },
    ];
    dailyRowsByMonth["2026-02-01|2026-03-01"] = [
      { query: "nowruz table", page: "/nowruz", clicks: 5, impressions: 100 },
      { query: "yalda gifts", page: "/yalda", clicks: 2, impressions: 40 },
    ];

    const result = await runMonthlyArchiveRollup("tenant-a", new Date("2026-07-02T00:00:00Z"));
    expect(result.ran).toBe(true);
    expect(result.isBackfill).toBe(true);
    expect(result.monthsRolled).toEqual(["2026-01-01", "2026-02-01"]);

    // One upsert call per month; each row keyed on the (tenant, query, month) PK.
    expect(upsertCalls).toHaveLength(2);
    for (const call of upsertCalls) expect(call.onConflict).toBe("tenant_id,query,month");

    const janRows = upsertCalls[0].rows;
    const nowruzJan = janRows.find((r) => r.query === "nowruz table")!;
    expect(nowruzJan.impressions).toBe(250); // 200 + 50 summed within the month
    expect(nowruzJan.clicks).toBe(11);
    expect(nowruzJan.top_page).toBe("/nowruz"); // higher-impression page wins
    expect(nowruzJan.month).toBe("2026-01-01");
    expect(nowruzJan.tenant_id).toBe("tenant-a");

    const febRows = upsertCalls[1].rows;
    expect(febRows.find((r) => r.query === "yalda gifts")?.impressions).toBe(40);
  });

  it("only re-rolls the current and prior month on subsequent runs (idempotent, not a full re-backfill)", async () => {
    earliestDate = "2025-11-01";
    latestDate = "2026-07-01";
    archivedMonths = ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"];
    dailyRowsByMonth["2026-06-01|2026-07-01"] = [{ query: "q", page: "/p", clicks: 1, impressions: 10 }];
    dailyRowsByMonth["2026-07-01|2026-08-01"] = [{ query: "q", page: "/p", clicks: 2, impressions: 20 }];

    const result = await runMonthlyArchiveRollup("tenant-b", new Date("2026-07-02T00:00:00Z"));
    expect(result.isBackfill).toBe(false);
    expect(result.monthsRolled).toEqual(["2026-06-01", "2026-07-01"]);
    expect(upsertCalls).toHaveLength(2);
  });

  it("re-running the same month converges to the same aggregate (idempotent upsert, no double count)", async () => {
    earliestDate = "2026-03-01";
    latestDate = "2026-03-28";
    dailyRowsByMonth["2026-03-01|2026-04-01"] = [
      { query: "nowruz table", page: "/nowruz", clicks: 10, impressions: 200 },
    ];

    const now = new Date("2026-04-05T00:00:00Z");
    const first = await runMonthlyArchiveRollup("tenant-c", now);
    const firstRow = upsertCalls[0].rows[0];
    upsertCalls.length = 0;
    const second = await runMonthlyArchiveRollup("tenant-c", now);
    const secondRow = upsertCalls[0].rows[0];

    expect(first.monthsRolled).toEqual(second.monthsRolled);
    expect(firstRow.impressions).toBe(secondRow.impressions);
    expect(firstRow.clicks).toBe(secondRow.clicks);
  });
});
