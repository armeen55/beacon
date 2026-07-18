/**
 * nightly-aggregate.test.ts (BEACON_500 item 66, 2026-07-02).
 *
 * Pins:
 *   - loadTenantMatureObservations only counts DECIDED (won/lost) outcomes,
 *     excludes operator-pinned "inconclusive" overrides, and derives the key
 *     from the SAME dimension helpers rr-pattern.test.ts pins directly.
 *   - writeGlobalPatternCells / readAllGlobalPatternCells degrade to a no-op
 *     ([]/false) when Supabase isn't configured or the table is missing,
 *     matching the pre-item-66 posture (never throws into a caller).
 *   - runGlobalPatternsNightlyAggregation's SEEDING HONESTY: with exactly one
 *     tenant contributing, every produced cell has distinctTenants === 1,
 *     which cellMeetsSurfaceFloor (and resolvePrior's own re-check) both
 *     reject, so nothing can surface from a single-tenant run.
 *   - buildGlobalCellLookup bridges actionType only, folds bands within a
 *     site category, and is a pure synchronous closure once cells are loaded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Supabase mock: two tables, shipped_change_proof (read) + global_patterns (read/write) ──
type Row = Record<string, unknown>;
let shippedRows: Row[] = [];
let globalRows: Row[] = [];
let shippedThrow: { code?: string; message?: string } | null = null;
let globalWriteThrow: { code?: string; message?: string } | null = null;
let supabaseConfigured = true;
let lastUpsertRows: Row[] | null = null;

function readResultFor(table: string): { data: Row[] | null; error: unknown } {
  if (table === "shipped_change_proof") {
    if (shippedThrow) return { data: null, error: shippedThrow };
    return { data: shippedRows, error: null };
  }
  if (table === "global_patterns") {
    return { data: globalRows, error: null };
  }
  return { data: [], error: null };
}

function chainFor(table: string) {
  // select("*") with no further filter (readAllGlobalPatternCells) resolves
  // directly; select("*").eq(...) (loadTenantMatureObservations) resolves
  // after the .eq() call. Both return the same fixture-backed result.
  const selectChain = {
    eq: vi.fn(() => Promise.resolve(readResultFor(table))),
    then: (
      resolve: (value: { data: Row[] | null; error: unknown }) => unknown,
    ) => resolve(readResultFor(table)),
  };
  return {
    select: vi.fn(() => selectChain),
    // upsert is called directly on .from(table), not chained off .select().
    upsert: vi.fn((rows: Row[]) => {
      lastUpsertRows = rows;
      if (globalWriteThrow) return Promise.resolve({ data: null, error: globalWriteThrow });
      globalRows = rows;
      return Promise.resolve({ data: rows, error: null });
    }),
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (!supabaseConfigured) throw new Error("no Supabase env");
    return { from: (table: string) => chainFor(table) };
  },
}));

// gateRecordsToOutcomes does real maturity-gate I/O (algorithm-weather store,
// json-store). Stub it directly so this test file stays focused on
// nightly-aggregate.ts's OWN bucketing/aggregation wiring — the gate itself
// is pinned by load-experiment-outcomes.test.ts.
let gateResults: Array<{ verdict: string; operatorVerdictOverride: string | null }> = [];
vi.mock("@/domains/learning/load-experiment-outcomes", () => ({
  gateRecordsToOutcomes: vi.fn(async () => gateResults),
}));

let tenantsFixture: Array<{ id: string; segment: string }> = [];
vi.mock("@/domains/tenants/store", () => ({
  listActiveTenants: async () => tenantsFixture,
}));

import {
  loadTenantMatureObservations,
  writeGlobalPatternCells,
  readAllGlobalPatternCells,
  runGlobalPatternsNightlyAggregation,
  buildGlobalCellLookup,
} from "./nightly-aggregate";
import { cellMeetsSurfaceFloor, type RrPatternCell } from "./rr-pattern";

function shippedRow(over: Partial<Row> = {}): Row {
  return {
    id: "p1::2026-05-01",
    page: "https://example.com/page",
    path: "/page",
    action_type: "edit_title",
    before_text: null,
    after_text: null,
    shipped_at: "2026-05-01T00:00:00.000Z",
    baseline: { clicks: 5, impressions: 1000, ctr: 0.005, position: 8, windowDays: 28 },
    target_queries: ["best widget"],
    control_pages: [],
    windows: [{ day: 28, ran: true, adjustedLift: 12 }],
    verdict: "won",
    confidence: "high",
    measured_at: "2026-05-29T00:00:00.000Z",
    notes: null,
    verified_live: true,
    live_source_url: null,
    recrawl_requested_at: null,
    operator_verdict_override: null,
    control_match_notes: null,
    control_match_weak: false,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-29T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  shippedRows = [];
  globalRows = [];
  shippedThrow = null;
  globalWriteThrow = null;
  supabaseConfigured = true;
  lastUpsertRows = null;
  gateResults = [];
  tenantsFixture = [];
});

describe("loadTenantMatureObservations", () => {
  it("returns [] when Supabase is not configured (no env)", async () => {
    supabaseConfigured = false;
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out).toEqual([]);
  });

  it("returns [] when the read errors (fail-soft, never throws)", async () => {
    shippedThrow = { code: "PGRST205", message: "missing table" };
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out).toEqual([]);
  });

  it("returns [] when there are no rows", async () => {
    shippedRows = [];
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out).toEqual([]);
  });

  it("counts a decided WON row into one observation with the correct key + lift", async () => {
    shippedRows = [shippedRow()];
    gateResults = [{ verdict: "won", operatorVerdictOverride: null }];
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out).toHaveLength(1);
    expect(out[0]!.won).toBe(true);
    expect(out[0]!.clicksLift).toBe(12);
    expect(out[0]!.key.siteCategory).toBe("content_publisher");
    expect(out[0]!.key.canonicalMoveType).toBe("edit_page");
    expect(out[0]!.key.positionBand).toBe("4-10");
  });

  it("excludes a MEASURING (non-mature) verdict entirely", async () => {
    shippedRows = [shippedRow()];
    gateResults = [{ verdict: "measuring", operatorVerdictOverride: null }];
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out).toEqual([]);
  });

  it("excludes an operator-pinned inconclusive override even if the raw verdict looks decided", async () => {
    shippedRows = [shippedRow()];
    gateResults = [{ verdict: "won", operatorVerdictOverride: "inconclusive" }];
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out).toEqual([]);
  });

  it("a LOST verdict is counted (won: false) with its own lift", async () => {
    shippedRows = [shippedRow({ verdict: "lost", windows: [{ day: 28, ran: true, adjustedLift: -4 }] })];
    gateResults = [{ verdict: "lost", operatorVerdictOverride: null }];
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out[0]!.won).toBe(false);
    expect(out[0]!.clicksLift).toBe(-4);
  });

  it("clicksLift is null when no ran 28-day window exists (still counted for winRate)", async () => {
    shippedRows = [shippedRow({ windows: [{ day: 7, ran: true, adjustedLift: 99 }] })];
    gateResults = [{ verdict: "won", operatorVerdictOverride: null }];
    const out = await loadTenantMatureObservations("t1", "content_publisher");
    expect(out[0]!.clicksLift).toBeNull();
  });
});

describe("writeGlobalPatternCells / readAllGlobalPatternCells", () => {
  const cell: RrPatternCell = {
    key: { siteCategory: "content_publisher", canonicalMoveType: "edit_page", intentBucket: "informational", positionBand: "4-10" },
    id: "content_publisher::edit_page::informational::4-10",
    n: 1,
    distinctTenants: 1,
    winRate: 1,
    liftP25: 12,
    liftP75: 12,
    updatedAt: "2026-07-02T00:00:00.000Z",
  };

  it("writing [] is a no-op success (nothing to write is not a failure)", async () => {
    expect(await writeGlobalPatternCells([])).toBe(true);
  });

  it("returns false when Supabase is not configured", async () => {
    supabaseConfigured = false;
    expect(await writeGlobalPatternCells([cell])).toBe(false);
  });

  it("returns false (fail-soft) when the table is missing (pre-migration)", async () => {
    globalWriteThrow = { code: "PGRST205", message: "missing table" };
    expect(await writeGlobalPatternCells([cell])).toBe(false);
  });

  it("writes rows through cellToRow shape and round-trips via readAllGlobalPatternCells", async () => {
    expect(await writeGlobalPatternCells([cell])).toBe(true);
    expect(lastUpsertRows).toEqual([
      {
        id: cell.id,
        site_category: "content_publisher",
        canonical_move_type: "edit_page",
        intent_bucket: "informational",
        position_band: "4-10",
        n: 1,
        distinct_tenants: 1,
        win_rate: 1,
        lift_p25: 12,
        lift_p75: 12,
        updated_at: cell.updatedAt,
      },
    ]);
    const read = await readAllGlobalPatternCells();
    expect(read).toEqual([cell]);
  });

  it("readAllGlobalPatternCells returns [] when Supabase is not configured", async () => {
    supabaseConfigured = false;
    expect(await readAllGlobalPatternCells()).toEqual([]);
  });
});

describe("runGlobalPatternsNightlyAggregation — seeding honesty (item 66 #4)", () => {
  it("with exactly ONE contributing tenant, every produced cell has distinctTenants=1 and fails the surface floor", async () => {
    tenantsFixture = [{ id: "tenant-only", segment: "content_publisher" }];
    shippedRows = [shippedRow()];
    gateResults = [{ verdict: "won", operatorVerdictOverride: null }];

    const result = await runGlobalPatternsNightlyAggregation();

    expect(result.tenantsScanned).toBe(1);
    expect(result.observationsAggregated).toBe(1);
    expect(result.cells.length).toBeGreaterThan(0);
    for (const cell of result.cells) {
      expect(cell.distinctTenants).toBe(1);
      expect(cellMeetsSurfaceFloor(cell)).toBe(false); // the honest silent state
    }
    // Rows ARE written (pipeline is provably live) even though nothing surfaces.
    expect(result.written).toBe(true);
    expect(globalRows.length).toBe(result.cells.length);
  });

  it("with zero tenants, produces zero cells and a successful no-op write", async () => {
    tenantsFixture = [];
    const result = await runGlobalPatternsNightlyAggregation();
    expect(result.tenantsScanned).toBe(0);
    expect(result.cells).toEqual([]);
    expect(result.written).toBe(true);
  });
});

describe("buildGlobalCellLookup", () => {
  function cell(over: Partial<RrPatternCell> = {}): RrPatternCell {
    return {
      key: { siteCategory: "content_publisher", canonicalMoveType: "edit_page", intentBucket: "informational", positionBand: "4-10" },
      id: "x",
      n: 4,
      distinctTenants: 4,
      winRate: 0.75,
      liftP25: 5,
      liftP75: 30,
      updatedAt: "2026-07-02T00:00:00.000Z",
      ...over,
    };
  }

  it("returns undefined for a dimension other than actionType (no false-precision guess)", () => {
    const lookup = buildGlobalCellLookup([cell()], "content_publisher");
    expect(lookup("pageType", "edit_page")).toBeUndefined();
    expect(lookup("queryCluster", "edit_page")).toBeUndefined();
  });

  it("returns undefined when no cell matches the requesting tenant's own site category", () => {
    const lookup = buildGlobalCellLookup([cell({ key: { ...cell().key, siteCategory: "local_service" } })], "content_publisher");
    expect(lookup("actionType", "edit_page")).toBeUndefined();
  });

  it("folds multiple intent/position bands within one site category + move type into one weighted cell", () => {
    const cells = [
      cell({ n: 4, winRate: 1, liftP25: 5, liftP75: 10, key: { ...cell().key, positionBand: "4-10" } }),
      cell({ n: 4, winRate: 0, liftP25: 1, liftP75: 2, key: { ...cell().key, positionBand: "11-20" } }),
    ];
    const lookup = buildGlobalCellLookup(cells, "content_publisher");
    const merged = lookup("actionType", "edit_title"); // canonicalMoveType collapses to edit_page
    expect(merged).toBeDefined();
    expect(merged!.n).toBe(8);
    expect(merged!.winRate).toBe(0.5); // n-weighted average of 1 and 0 over equal n
    expect(merged!.liftLow).toBe(1); // min of liftP25 across matches
    expect(merged!.liftHigh).toBe(10); // max of liftP75 across matches
    expect(merged!.distinctTenants).toBe(4); // max, not sum (same tenants may span bands)
  });

  it("is a pure synchronous closure (no I/O once cells are supplied)", () => {
    const lookup = buildGlobalCellLookup([cell()], "content_publisher");
    const a = lookup("actionType", "edit_page");
    const b = lookup("actionType", "edit_page");
    expect(a).toEqual(b);
  });
});
