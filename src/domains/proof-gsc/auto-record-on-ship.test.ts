/**
 * auto-record-on-ship.test.ts (BEACON_500 items 33 + 36, 2026-07-02).
 *
 * Pins:
 *   - paging discipline on the two new I/O readers: loadBaselineDailySeries
 *     (gsc_daily_page_totals) and loadQueryOverlap (gsc_daily_rows) both page
 *     via .range() in PAGE_SIZE (1000) chunks until a short page, per this
 *     project's PostgREST 1000-row response cap.
 *   - query-overlap math: impression-weighted share of the CANDIDATE's own
 *     demand that is shared with the treated page.
 *   - integration: autoRecordShippedChangeForRec runs new ships through the
 *     matcher (not the old top-3-by-demand slice), records controlMatchNotes,
 *     and still enforces the MIN_CONTROLS floor / never drops below it when
 *     candidates exist (min-2 fallback).
 *   - the existing pre-item-33 idempotency / no-url / unresolved-url behavior
 *     is untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Chainable supabase mock with .range() paging + call tracking ───────────

type Row = Record<string, unknown>;
const dailyTotalsPages: Row[][] = [];
const dailyRowsPages: Row[][] = [];
const rangeCalls: Array<{ table: string; from: number; to: number }> = [];
let dailyTotalsThrow: Error | null = null;
let dailyRowsThrow: Error | null = null;

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "order"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push({ table, from, to });
    if (table === "gsc_daily_page_totals") {
      if (dailyTotalsThrow) return Promise.resolve({ data: null, error: { message: dailyTotalsThrow.message } });
      const pageIndex = Math.floor(from / 1000);
      return Promise.resolve({ data: dailyTotalsPages[pageIndex] ?? [], error: null });
    }
    if (table === "gsc_daily_rows") {
      if (dailyRowsThrow) return Promise.resolve({ data: null, error: { message: dailyRowsThrow.message } });
      const pageIndex = Math.floor(from / 1000);
      return Promise.resolve({ data: dailyRowsPages[pageIndex] ?? [], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => chainFor(table) }),
}));

import {
  loadBaselineDailySeries,
  loadQueryOverlap,
  matchControlsForShip,
  buildControlMatchNotes,
  autoRecordShippedChangeForRec,
  type AutoRecordDeps,
} from "./auto-record-on-ship";
import type { ShippedChangeRecord } from "./shipped-change-store";

beforeEach(() => {
  dailyTotalsPages.length = 0;
  dailyRowsPages.length = 0;
  rangeCalls.length = 0;
  dailyTotalsThrow = null;
  dailyRowsThrow = null;
});

describe("loadBaselineDailySeries - paging discipline", () => {
  it("pages gsc_daily_page_totals with .range() in 1000-row chunks until a short page", async () => {
    dailyTotalsPages[0] = Array.from({ length: 1000 }, (_, i) => ({
      page: "https://site.com/a",
      date: `2026-05-${String((i % 28) + 1).padStart(2, "0")}`,
      clicks: 1,
    }));
    dailyTotalsPages[1] = [{ page: "https://site.com/a", date: "2026-06-01", clicks: 5 }];

    const out = await loadBaselineDailySeries("tenant-x", ["https://site.com/a"], "2026-05-01", "2026-06-02");
    const calls = rangeCalls.filter((c) => c.table === "gsc_daily_page_totals");
    expect(calls).toEqual([
      { table: "gsc_daily_page_totals", from: 0, to: 999 },
      { table: "gsc_daily_page_totals", from: 1000, to: 1999 },
    ]);
    expect(out.get("https://site.com/a")?.get("2026-06-01")).toBe(5);
  });

  it("fails soft to an empty map when the read errors", async () => {
    dailyTotalsThrow = new Error("boom");
    const out = await loadBaselineDailySeries("tenant-x", ["https://site.com/a"], "2026-05-01", "2026-06-01");
    expect(out.size).toBe(0);
  });

  it("returns empty for an empty page set (no read attempted)", async () => {
    const out = await loadBaselineDailySeries("tenant-x", [], "2026-05-01", "2026-06-01");
    expect(out.size).toBe(0);
    expect(rangeCalls.length).toBe(0);
  });

  it("matches rows stored under the www. host when the caller's page is canonicalized (bare host) - ground-truth Iranopedia gap", async () => {
    // gsc_daily_page_totals stores the raw GSC property host (www.iranopedia.com)
    // while every matcher input arrives canonicalized (iranopedia.com, no www).
    dailyTotalsPages[0] = [{ page: "https://www.site.com/a", date: "2026-05-15", clicks: 7 }];
    const out = await loadBaselineDailySeries("tenant-x", ["https://site.com/a"], "2026-05-01", "2026-06-01");
    expect(out.get("https://site.com/a")?.get("2026-05-15")).toBe(7);
  });
});

describe("loadQueryOverlap - paging discipline + math", () => {
  it("pages gsc_daily_rows with .range() in 1000-row chunks until a short page", async () => {
    dailyRowsPages[0] = Array.from({ length: 1000 }, (_, i) => ({
      page: "https://site.com/treated",
      query: `q${i}`,
      impressions: 1,
    }));
    dailyRowsPages[1] = [{ page: "https://site.com/candidate", query: "q0", impressions: 10 }];

    await loadQueryOverlap("tenant-x", "https://site.com/treated", ["https://site.com/candidate"], "2026-05-01", "2026-06-01");
    const calls = rangeCalls.filter((c) => c.table === "gsc_daily_rows");
    expect(calls).toEqual([
      { table: "gsc_daily_rows", from: 0, to: 999 },
      { table: "gsc_daily_rows", from: 1000, to: 1999 },
    ]);
  });

  it("computes the impression-weighted share of the CANDIDATE's demand shared with the treated page", async () => {
    dailyRowsPages[0] = [
      { page: "https://site.com/treated", query: "shared-query", impressions: 100 },
      { page: "https://site.com/treated", query: "treated-only", impressions: 50 },
      { page: "https://site.com/candidate", query: "shared-query", impressions: 30 },
      { page: "https://site.com/candidate", query: "candidate-only", impressions: 70 },
    ];
    const out = await loadQueryOverlap(
      "tenant-x",
      "https://site.com/treated",
      ["https://site.com/candidate"],
      "2026-05-01",
      "2026-06-01",
    );
    // candidate total impressions = 30 + 70 = 100; shared = 30 -> overlap 0.3
    expect(out.get("https://site.com/candidate")).toBeCloseTo(0.3);
  });

  it("leaves a candidate with no rows out of the map entirely (fail-soft null, never a fabricated 0)", async () => {
    dailyRowsPages[0] = [{ page: "https://site.com/treated", query: "q", impressions: 10 }];
    const out = await loadQueryOverlap(
      "tenant-x",
      "https://site.com/treated",
      ["https://site.com/no-data-candidate"],
      "2026-05-01",
      "2026-06-01",
    );
    expect(out.has("https://site.com/no-data-candidate")).toBe(false);
  });

  it("fails soft to an empty map when the read errors", async () => {
    dailyRowsThrow = new Error("boom");
    const out = await loadQueryOverlap("tenant-x", "https://site.com/treated", ["https://site.com/candidate"], "2026-05-01", "2026-06-01");
    expect(out.size).toBe(0);
  });

  it("matches rows stored under the www. host when the caller's pages are canonicalized (bare host) - ground-truth Iranopedia gap", async () => {
    dailyRowsPages[0] = [
      { page: "https://www.site.com/treated", query: "shared", impressions: 50 },
      { page: "https://www.site.com/candidate", query: "shared", impressions: 20 },
      { page: "https://www.site.com/candidate", query: "own", impressions: 80 },
    ];
    const out = await loadQueryOverlap("tenant-x", "https://site.com/treated", ["https://site.com/candidate"], "2026-05-01", "2026-06-01");
    expect(out.get("https://site.com/candidate")).toBeCloseTo(0.2); // 20 / (20+80)
  });
});

describe("matchControlsForShip - end-to-end pure-math wiring", () => {
  it("reads daily series + overlap once and ranks candidates accordingly", async () => {
    const start = "2026-05-01";
    dailyTotalsPages[0] = [
      ...Array.from({ length: 28 }, (_, i) => ({ page: "https://site.com/treated", date: addDay(start, i), clicks: 10 })),
      ...Array.from({ length: 28 }, (_, i) => ({ page: "https://site.com/similar", date: addDay(start, i), clicks: 11 })),
      ...Array.from({ length: 28 }, (_, i) => ({ page: "https://site.com/huge", date: addDay(start, i), clicks: 900 })),
    ];
    dailyRowsPages[0] = [
      { page: "https://site.com/treated", query: "q1", impressions: 100 },
      { page: "https://site.com/similar", query: "q2", impressions: 100 },
      { page: "https://site.com/huge", query: "q1", impressions: 100 }, // 100% overlap
    ];

    const result = await matchControlsForShip({
      tenantId: "tenant-x",
      treatedPage: "https://site.com/treated",
      candidates: ["https://site.com/similar", "https://site.com/huge"],
      shipDate: "2026-05-29",
    });

    expect(result.kept).toEqual(["https://site.com/similar"]);
    const huge = result.matched.find((m) => m.url === "https://site.com/huge")!;
    expect(huge.verdict).toBe("excluded");
  });
});

function addDay(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z") + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

describe("buildControlMatchNotes", () => {
  it("only emits a note for excluded candidates, in first-person plain language, no dashes", () => {
    const notes = buildControlMatchNotes([
      { url: "https://site.com/a", similarityRatio: 1, slopeDivergence: 0, queryOverlap: 0, verdict: "kept", reason: "fine" },
      { url: "https://site.com/b", similarityRatio: 10, slopeDivergence: 0, queryOverlap: 0, verdict: "excluded", reason: "its traffic level is far above this page's" },
    ]);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/^Left out https:\/\/site\.com\/b as a comparison page/);
    expect(notes[0]).not.toMatch(/[–—]/);
  });
});

// ── autoRecordShippedChangeForRec integration ───────────────────────────────

function baseRecord(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "id-1",
    page: "https://site.com/treated",
    path: "/treated",
    actionType: "edit_title",
    before: null,
    after: null,
    shippedAt: "2026-06-01",
    baseline: { clicks: 10, impressions: 100, ctr: 0.1, position: 5, windowDays: 28 },
    targetQueries: [],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

function makeDeps(over: Partial<AutoRecordDeps> = {}): AutoRecordDeps {
  return {
    captureChangeMeta: vi.fn(async () => ({
      canonPage: "https://site.com/treated",
      path: "/treated",
      before: "old",
      after: "new",
      targetQueries: ["q1"],
      headlineAction: "edit_title",
    })),
    recordShippedChange: vi.fn(async (args: Parameters<AutoRecordDeps["recordShippedChange"]>[0]) =>
      baseRecord({ page: args.page, path: args.path, actionType: args.actionType, controlPages: args.controlPages }),
    ),
    loadShippedChanges: vi.fn(async () => []),
    upsertShippedChange: vi.fn(async () => {}),
    loadControlCandidates: vi.fn(async () => [
      "https://site.com/a",
      "https://site.com/b",
      "https://site.com/c",
    ]),
    matchControls: vi.fn(async () => ({
      kept: ["https://site.com/a", "https://site.com/b"],
      matched: [
        { url: "https://site.com/a", similarityRatio: 1, slopeDivergence: 0, queryOverlap: 0, verdict: "kept" as const, reason: "fine" },
        { url: "https://site.com/b", similarityRatio: 1, slopeDivergence: 0, queryOverlap: 0, verdict: "kept" as const, reason: "fine" },
        { url: "https://site.com/c", similarityRatio: 50, slopeDivergence: 0, queryOverlap: 0, verdict: "excluded" as const, reason: "its traffic level is far above this page's" },
      ],
      usedFallback: false,
    })),
    shipDate: () => "2026-06-01",
    ...over,
  };
}

describe("autoRecordShippedChangeForRec - new ships use the matcher", () => {
  it("calls matchControls (not a raw top-3 slice) and records its kept set as controlPages", async () => {
    const deps = makeDeps();
    const result = await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "https://site.com/treated" }, deps);
    expect(result.recorded).toBe(true);
    expect(deps.matchControls).toHaveBeenCalledTimes(1);
    const recordArgs = vi.mocked(deps.recordShippedChange).mock.calls[0][0];
    expect(recordArgs.controlPages).toEqual(["https://site.com/a", "https://site.com/b"]);
  });

  it("stamps controlMatchNotes with the excluded candidate's reason on the upserted record", async () => {
    const deps = makeDeps();
    await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "https://site.com/treated" }, deps);
    const stamped = vi.mocked(deps.upsertShippedChange).mock.calls[0][0];
    expect(stamped.controlMatchNotes).toEqual(
      expect.arrayContaining([expect.stringContaining("https://site.com/c")]),
    );
    expect(stamped.controlMatchWeak).toBe(false);
  });

  it("sets controlMatchWeak and appends an honesty note when the matcher used its fallback", async () => {
    const deps = makeDeps({
      matchControls: vi.fn(async () => ({
        kept: ["https://site.com/a", "https://site.com/b"],
        matched: [
          { url: "https://site.com/a", similarityRatio: 5, slopeDivergence: 1, queryOverlap: 0, verdict: "kept" as const, reason: "kept anyway - not enough closely matched comparison pages were available" },
          { url: "https://site.com/b", similarityRatio: 5, slopeDivergence: 1, queryOverlap: 0, verdict: "kept" as const, reason: "kept anyway - not enough closely matched comparison pages were available" },
        ],
        usedFallback: true,
      })),
    });
    await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "https://site.com/treated" }, deps);
    const stamped = vi.mocked(deps.upsertShippedChange).mock.calls[0][0];
    expect(stamped.controlMatchWeak).toBe(true);
    expect(stamped.controlMatchNotes?.some((n: string) => /cautiously|closest available/.test(n))).toBe(true);
  });

  it("never drops below MIN_CONTROLS (2) via the matcher when raw candidates exist - min-2 fallback", async () => {
    // matchControls itself is responsible for the min-2 floor (via its own
    // fallback); this pins that auto-record-on-ship trusts and forwards
    // whatever the matcher returns, and still gates on the >= 2 floor.
    const deps = makeDeps({
      matchControls: vi.fn(async () => ({
        kept: ["https://site.com/a"], // only 1 -> below MIN_CONTROLS
        matched: [
          { url: "https://site.com/a", similarityRatio: 1, slopeDivergence: 0, queryOverlap: 0, verdict: "kept" as const, reason: "fine" },
        ],
        usedFallback: true,
      })),
    });
    const result = await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "https://site.com/treated" }, deps);
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("insufficient-controls");
  });

  it("falls back to the raw top-3 pool (never zero controls) when the matcher itself throws", async () => {
    const deps = makeDeps({
      matchControls: vi.fn(async () => {
        throw new Error("matcher exploded");
      }),
    });
    const result = await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "https://site.com/treated" }, deps);
    expect(result.recorded).toBe(true);
    const recordArgs = vi.mocked(deps.recordShippedChange).mock.calls[0][0];
    expect(recordArgs.controlPages).toEqual(["https://site.com/a", "https://site.com/b", "https://site.com/c"]);
    const stamped = vi.mocked(deps.upsertShippedChange).mock.calls[0][0];
    expect(stamped.controlMatchNotes?.some((n: string) => /could not run/.test(n))).toBe(true);
  });
});

describe("autoRecordShippedChangeForRec - pre-existing behavior untouched", () => {
  it("no-url short-circuits before the matcher is ever called", async () => {
    const deps = makeDeps();
    const result = await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "" }, deps);
    expect(result).toEqual({ recorded: false, reason: "no-url" });
    expect(deps.matchControls).not.toHaveBeenCalled();
  });

  it("unresolved (non-absolute) URL short-circuits before the matcher runs", async () => {
    const deps = makeDeps({
      captureChangeMeta: vi.fn(async () => ({
        canonPage: "/bare-path",
        path: "/bare-path",
        before: null,
        after: null,
        targetQueries: [],
        headlineAction: null,
      })),
    });
    const result = await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "/bare-path" }, deps);
    expect(result).toEqual({ recorded: false, reason: "unresolved-url" });
    expect(deps.matchControls).not.toHaveBeenCalled();
  });

  it("idempotent: already-recorded for this page+ship-date skips before the matcher runs", async () => {
    const deps = makeDeps({
      loadShippedChanges: vi.fn(async () => [baseRecord({ path: "/treated", shippedAt: "2026-06-01" })]),
    });
    const result = await autoRecordShippedChangeForRec({ tenantId: "tenant-x", pageUrl: "https://site.com/treated" }, deps);
    expect(result).toEqual({ recorded: false, reason: "already-recorded" });
    expect(deps.matchControls).not.toHaveBeenCalled();
  });
});
