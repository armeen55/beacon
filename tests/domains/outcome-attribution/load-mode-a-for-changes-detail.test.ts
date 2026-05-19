/**
 * 2026-05-19 — Slice 9.A2β — loadModeAForChangesDetail unit tests.
 *
 * Pins:
 *   • Tenant-scoped Supabase read (.from("ga4_url_traffic").eq("tenant_id", tenantId)).
 *   • Soft-fail on admin throws → returns null.
 *   • Soft-fail on read error (any code, including 42P01) → returns null.
 *   • Soft-fail when data is not an array → returns null.
 *   • Happy path: loader calls compute with narrowed rows + tenant
 *     scope + threaded `now`.
 *   • Default qualifiedCallCount = 0 (CallRail K2-deferred).
 *   • Discriminator passthrough: compute result returned unchanged
 *     for eligible / still_learning / ineligible.
 *   • Row narrowing: skips rows with non-string url / non-string date;
 *     defaults numeric fields to 0 on bad inputs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks (hoisted)
// ─────────────────────────────────────────────────────────────────────

let _supabaseAdminThrows = false;
let _trafficData: unknown[] | null = [];
let _supabaseError: { code?: string; message?: string } | null = null;
let _eqCallArgs: Array<{ col: string; val: string }> = [];
let _selectColumns: string = "";
let _fromTable: string = "";

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_supabaseAdminThrows) {
      throw new Error("admin unavailable");
    }
    return {
      from: (table: string) => {
        _fromTable = table;
        return {
          select: (cols: string) => {
            _selectColumns = cols;
            return {
              eq: (col: string, val: string) => {
                _eqCallArgs.push({ col, val });
                return Promise.resolve(
                  _supabaseError != null
                    ? { data: null, error: _supabaseError }
                    : { data: _trafficData, error: null },
                );
              },
            };
          },
        };
      },
    };
  },
}));

// Inline unstable_cache so the cached function executes immediately
// (no real Next.js cache backend in this test env).
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    _key: unknown,
    _opts: unknown,
  ) => fn,
}));

const _computeMock = vi.fn();
vi.mock(
  "@/domains/outcome-attribution/mode-a-cited-here-traffic-here",
  async () => {
    const real = await vi.importActual<
      typeof import("@/domains/outcome-attribution/mode-a-cited-here-traffic-here")
    >("@/domains/outcome-attribution/mode-a-cited-here-traffic-here");
    return {
      ...real,
      computeModeATrafficAttribution: (args: unknown) => _computeMock(args),
    };
  },
);

beforeEach(() => {
  _supabaseAdminThrows = false;
  _trafficData = [];
  _supabaseError = null;
  _eqCallArgs = [];
  _selectColumns = "";
  _fromTable = "";
  _computeMock.mockReset();
});

// Re-import after mocks.
import { loadModeAForChangesDetail } from "@/domains/outcome-attribution/load-mode-a-for-changes-detail";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

// Minimal RecommendedEditRow fixture — the loader only reads `id`,
// `target_url`, `live_at`; the rest of the type is structural noise.
function makeEdit(overrides: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    action_type: "edit_title",
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    live_at: "2026-04-28T12:00:00Z",
    implementation_status: "verified_live",
    created_at: "2026-04-01T00:00:00Z",
    ...overrides,
  } as RecommendedEditRow;
}

const NOW = new Date("2026-05-19T12:00:00Z");

// ─────────────────────────────────────────────────────────────────────
// Tenant-scoped Supabase read
// ─────────────────────────────────────────────────────────────────────

describe("loadModeAForChangesDetail — tenant scope", () => {
  it("calls .from('ga4_url_traffic') exactly", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(_fromTable).toBe("ga4_url_traffic");
  });

  it("filters by tenant_id at the .eq() layer (NOT post-fetch)", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-test-xyz",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(_eqCallArgs).toEqual([
      { col: "tenant_id", val: "tenant-test-xyz" },
    ]);
  });

  it("requests the exact column projection (no over-select)", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    // Mode A compute needs url + date + sessions + engaged_sessions +
    // conversions. No `raw` / `last_synced_at` for the customer read
    // — operator diagnostic owns those columns separately.
    expect(_selectColumns).toBe(
      "url, date, sessions, engaged_sessions, conversions",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Soft-fail variants
// ─────────────────────────────────────────────────────────────────────

describe("loadModeAForChangesDetail — soft-fail", () => {
  it("returns null when getSupabaseAdmin throws", async () => {
    _supabaseAdminThrows = true;
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("returns null on 42P01 (undefined_table)", async () => {
    _supabaseError = { code: "42P01", message: "undefined table" };
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("returns null on generic read error", async () => {
    _supabaseError = { message: "connection refused" };
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("returns null when data is not an array", async () => {
    _trafficData = null;
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_computeMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────

describe("loadModeAForChangesDetail — happy path", () => {
  it("threads recommendedEdit + narrowed rows + qualifiedCallCount=0 + now into compute", async () => {
    _trafficData = [
      {
        url: "https://ritzbuilders.com/services/whole-home-remodel",
        date: "2026-05-01",
        sessions: 2,
        engaged_sessions: 1,
        conversions: 0,
      },
      {
        url: "https://ritzbuilders.com/services/whole-home-remodel",
        date: "2026-05-15",
        sessions: 1,
        engaged_sessions: 1,
        conversions: 0,
      },
    ];
    _computeMock.mockReturnValue({
      kind: "still_learning_outcome",
      reason: "insufficient_volume",
      days_since_live: 21,
      post_live_sessions: 3,
      post_live_qualified_calls: 0,
      canonical_target_url:
        "https://ritzbuilders.com/services/whole-home-remodel",
      sample_window_start: "2026-04-28",
      sample_window_end: "2026-05-19",
    });

    const edit = makeEdit();
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: edit,
      now: NOW,
    });

    expect(_computeMock).toHaveBeenCalledTimes(1);
    const args = _computeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.recommendedEdit).toBe(edit);
    expect(args.qualifiedCallCount).toBe(0);
    expect(args.now).toBe(NOW);
    const rows = args.ga4UrlTrafficRows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.url).toBe(
      "https://ritzbuilders.com/services/whole-home-remodel",
    );

    expect(r).toMatchObject({
      kind: "still_learning_outcome",
      reason: "insufficient_volume",
    });
  });

  it("narrows row shape (drops malformed entries)", async () => {
    _trafficData = [
      // valid
      {
        url: "https://x.com/a",
        date: "2026-05-01",
        sessions: 5,
        engaged_sessions: 4,
        conversions: 1,
      },
      // missing url
      { date: "2026-05-02", sessions: 1, engaged_sessions: 0, conversions: 0 },
      // missing date
      { url: "https://x.com/b", sessions: 1, engaged_sessions: 0, conversions: 0 },
      // non-numeric sessions → defaults to 0
      {
        url: "https://x.com/c",
        date: "2026-05-03",
        sessions: "bad",
        engaged_sessions: 2,
        conversions: 0,
      },
      // null row
      null,
      // non-object
      "not-an-object",
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: null,
    });

    await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });

    const rows = (_computeMock.mock.calls[0]![0] as Record<string, unknown>)
      .ga4UrlTrafficRows as Array<Record<string, unknown>>;
    // Only valid rows + the row with bad sessions (defaults to 0)
    // survive narrowing.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      url: "https://x.com/a",
      sessions: 5,
    });
    expect(rows[1]).toMatchObject({
      url: "https://x.com/c",
      sessions: 0, // defaulted
    });
  });

  it("returns the compute result unchanged (discriminator passthrough)", async () => {
    _computeMock.mockReturnValue({
      kind: "eligible",
      days_since_live: 30,
      post_live_sessions: 142,
      post_live_engaged_sessions: 120,
      post_live_conversions: 3,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://x.com/foo",
      sample_window_start: "2026-04-19",
      sample_window_end: "2026-05-19",
    });
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit(),
      now: NOW,
    });
    expect(r).toMatchObject({
      kind: "eligible",
      post_live_sessions: 142,
      post_live_qualified_calls: 0,
    });
  });

  it("defaults now to a fresh Date when not provided (does not throw)", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: null,
    });
    await expect(
      loadModeAForChangesDetail({
        tenantId: "tenant-test",
        recommendedEdit: makeEdit(),
      }),
    ).resolves.toBeDefined();
    const args = _computeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.now).toBeInstanceOf(Date);
  });
});
