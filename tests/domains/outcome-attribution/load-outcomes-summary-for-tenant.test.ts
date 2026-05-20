/**
 * 2026-05-19 — Section 9 Today tile — loadOutcomesSummaryForTenant
 * unit tests.
 *
 * Pins:
 *   • Tenant-scoped Supabase read: .eq("tenant_id", tenantId) +
 *     .in("url", urlCandidates). Mirrors the 9.A2β.1 URL-scoped
 *     SELECT discipline (no 1,000-row Supabase cap hit).
 *   • 30-day window filter on live_at (rolling, anchored to `now`).
 *   • Verified-live predicate (verified_live / verified_live_modified
 *     / partially_implemented).
 *   • URL candidate dedup + canonical + trailing-slash variants.
 *   • Skip Supabase entirely when the candidate set is empty.
 *   • Per-edit Mode A iteration + aggregate counts.
 *   • Soft-fail to status: "data_unavailable" on every documented
 *     failure path (repo throws / non-array edits / admin throws /
 *     read error / 42P01 / non-array data).
 *   • CallRail K2-deferred: qualifiedCallCount === 0 always; sum
 *     never accumulates calls from edits.
 *   • Cache key shape: namespace + tenantId + window + today-UTC-date.
 *   • Cache key + recommended_edits invalidation tag pinned.
 *   • Defensive: future-dated live_at excluded; null/unparseable
 *     live_at excluded; canonicalizer-null target_url counted as
 *     ineligible without consuming a URL candidate slot.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks (hoisted)
// ─────────────────────────────────────────────────────────────────────

let _editsToReturn: unknown[] = [];
let _repositoryThrows = false;
const _getRecommendedEditsCalls: string[] = [];
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => {
      _getRecommendedEditsCalls.push(tenantId);
      return {
        getRecommendedEdits: () => {
          if (_repositoryThrows) {
            return Promise.reject(new Error("repo failure"));
          }
          return Promise.resolve(_editsToReturn);
        },
      };
    },
  }),
}));

let _supabaseAdminThrows = false;
let _trafficData: unknown[] | null = [];
let _supabaseError: { code?: string; message?: string } | null = null;
let _eqCallArgs: Array<{ col: string; val: string }> = [];
let _inCallArgs: Array<{ col: string; vals: readonly string[] }> = [];
let _selectColumns: string = "";
let _fromTable: string = "";
let _adminFromCallCount = 0;

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_supabaseAdminThrows) {
      throw new Error("admin unavailable");
    }
    return {
      from: (table: string) => {
        _adminFromCallCount += 1;
        _fromTable = table;
        const terminator = () => ({
          eq: (col: string, val: string) => {
            _eqCallArgs.push({ col, val });
            return terminator();
          },
          in: (col: string, vals: readonly string[]) => {
            _inCallArgs.push({ col, vals });
            return terminator();
          },
          then: (
            onFulfilled: (
              value:
                | { data: unknown[] | null; error: typeof _supabaseError }
                | undefined,
            ) => unknown,
          ) =>
            Promise.resolve(
              _supabaseError != null
                ? { data: null, error: _supabaseError }
                : { data: _trafficData, error: null },
            ).then(onFulfilled),
        });
        return {
          select: (cols: string) => {
            _selectColumns = cols;
            return terminator();
          },
        };
      },
    };
  },
}));

let _cacheKey: unknown = null;
let _cacheOpts: unknown = null;
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    key: unknown,
    opts: unknown,
  ) => {
    _cacheKey = key;
    _cacheOpts = opts;
    return fn;
  },
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
  _editsToReturn = [];
  _repositoryThrows = false;
  _getRecommendedEditsCalls.length = 0;
  _supabaseAdminThrows = false;
  _trafficData = [];
  _supabaseError = null;
  _eqCallArgs = [];
  _inCallArgs = [];
  _selectColumns = "";
  _fromTable = "";
  _adminFromCallCount = 0;
  _cacheKey = null;
  _cacheOpts = null;
  _computeMock.mockReset();
});

// Re-import after mocks.
import {
  loadOutcomesSummaryForTenant,
  __testing,
} from "@/domains/outcome-attribution/load-outcomes-summary-for-tenant";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function makeEdit(overrides: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    action_type: "edit_title",
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    live_at: "2026-05-01T00:00:00Z",
    implementation_status: "verified_live",
    created_at: "2026-04-01T00:00:00Z",
    ...overrides,
  } as RecommendedEditRow;
}

const NOW = new Date("2026-05-19T12:00:00Z");

// ─────────────────────────────────────────────────────────────────────
// Cache key + invariants
// ─────────────────────────────────────────────────────────────────────

describe("loadOutcomesSummaryForTenant — cache shape", () => {
  it("namespace v1 + tenantId + window=30 + today-UTC-date", async () => {
    _editsToReturn = [];
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-ritz-founder",
      now: NOW,
    });
    expect(Array.isArray(_cacheKey)).toBe(true);
    const key = _cacheKey as readonly unknown[];
    expect(key[0]).toBe("outcomes-summary-tenant:v1");
    expect(key[1]).toBe("tenant-ritz-founder");
    expect(key[2]).toBe("30");
    expect(key[3]).toBe("2026-05-19"); // today UTC anchor
  });

  it("revalidate=21600s + tag recommended_edits:${tenantId}", async () => {
    _editsToReturn = [];
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    const opts = _cacheOpts as { revalidate: number; tags: string[] };
    expect(opts.revalidate).toBe(21_600);
    expect(opts.tags).toEqual(["recommended_edits:tenant-test"]);
  });

  it("exposes WINDOW_DAYS = 30 via __testing", () => {
    expect(__testing.WINDOW_DAYS).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Empty / no in-window edits → skip Supabase entirely
// ─────────────────────────────────────────────────────────────────────

describe("loadOutcomesSummaryForTenant — empty / no-window-edits", () => {
  it("returns ok empty summary when no edits exist", async () => {
    _editsToReturn = [];
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r).toMatchObject({
      status: "ok",
      total_recent_live_edits: 0,
      eligible_edits: 0,
      still_learning_edits: 0,
      ineligible_edits: 0,
      sum_post_live_sessions: 0,
      sum_post_live_qualified_calls: 0,
      window_days: 30,
    });
    // Supabase SELECT must be skipped entirely when there are no
    // candidates (perf + no needless round-trip).
    expect(_adminFromCallCount).toBe(0);
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("excludes edits with non-verified-live status (recommended / accepted / dismissed / wrong_page / not_found_after_7d / needs_review)", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-rec",
        implementation_status: "recommended",
        live_at: "2026-05-15T00:00:00Z",
      }),
      makeEdit({
        id: "e-acc",
        implementation_status: "accepted",
        live_at: "2026-05-15T00:00:00Z",
      }),
      makeEdit({
        id: "e-dis",
        implementation_status: "dismissed",
        live_at: "2026-05-15T00:00:00Z",
      }),
      makeEdit({
        id: "e-wp",
        implementation_status: "wrong_page",
        live_at: "2026-05-15T00:00:00Z",
      }),
      makeEdit({
        id: "e-nf",
        implementation_status: "not_found_after_7d",
        live_at: "2026-05-15T00:00:00Z",
      }),
      makeEdit({
        id: "e-nr",
        implementation_status: "needs_review",
        live_at: "2026-05-15T00:00:00Z",
      }),
    ];
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.total_recent_live_edits).toBe(0);
    expect(_adminFromCallCount).toBe(0);
  });

  it("includes verified_live / verified_live_modified / partially_implemented", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-vl",
        implementation_status: "verified_live",
        live_at: "2026-05-10T00:00:00Z",
      }),
      makeEdit({
        id: "e-vlm",
        implementation_status: "verified_live_modified",
        live_at: "2026-05-12T00:00:00Z",
        target_url: "https://ritzbuilders.com/about",
      }),
      makeEdit({
        id: "e-pi",
        implementation_status: "partially_implemented",
        live_at: "2026-05-15T00:00:00Z",
        target_url: "https://ritzbuilders.com/contact",
      }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.total_recent_live_edits).toBe(3);
  });

  it("excludes edits with live_at older than 30 days from now", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-old",
        live_at: "2026-04-01T00:00:00Z", // > 30 days before 2026-05-19
      }),
      makeEdit({
        id: "e-recent",
        live_at: "2026-05-15T00:00:00Z", // 4 days before now
        target_url: "https://ritzbuilders.com/about",
      }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.total_recent_live_edits).toBe(1);
  });

  it("excludes edits with null / empty / unparseable live_at", async () => {
    _editsToReturn = [
      makeEdit({ id: "e-null", live_at: null }),
      makeEdit({ id: "e-empty", live_at: "" }),
      makeEdit({ id: "e-bad", live_at: "not-a-date" }),
    ];
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.total_recent_live_edits).toBe(0);
  });

  it("excludes future-dated live_at (defensive)", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-future",
        live_at: "2027-01-01T00:00:00Z",
      }),
    ];
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.total_recent_live_edits).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Supabase URL-scoped SELECT
// ─────────────────────────────────────────────────────────────────────

describe("loadOutcomesSummaryForTenant — URL-scoped SELECT", () => {
  it("filters by .eq('tenant_id', tenantId) AND .in('url', urlCandidates)", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-1",
        live_at: "2026-05-15T00:00:00Z",
        target_url: "https://ritzbuilders.com/services/whole-home-remodel",
      }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-ritz-founder",
      now: NOW,
    });
    expect(_fromTable).toBe("ga4_url_traffic");
    expect(_eqCallArgs).toEqual([
      { col: "tenant_id", val: "tenant-ritz-founder" },
    ]);
    expect(_inCallArgs).toHaveLength(1);
    expect(_inCallArgs[0]!.col).toBe("url");
    expect(_inCallArgs[0]!.vals).toContain(
      "https://ritzbuilders.com/services/whole-home-remodel",
    );
    expect(_inCallArgs[0]!.vals).toContain(
      "https://ritzbuilders.com/services/whole-home-remodel/",
    );
  });

  it("dedupes URL candidates across edits sharing the same canonical URL", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-1",
        live_at: "2026-05-15T00:00:00Z",
        target_url: "https://ritzbuilders.com/services/whole-home-remodel",
      }),
      makeEdit({
        id: "e-2",
        live_at: "2026-05-16T00:00:00Z",
        target_url: "http://www.ritzbuilders.com/services/whole-home-remodel/",
      }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    // Both edits canonicalize to the same URL → only 2 candidates
    // (canonical + trailing-slash variant), not 4.
    expect(_inCallArgs[0]!.vals).toHaveLength(2);
    expect([...(_inCallArgs[0]!.vals)].sort()).toEqual([
      "https://ritzbuilders.com/services/whole-home-remodel",
      "https://ritzbuilders.com/services/whole-home-remodel/",
    ]);
  });

  it("includes the exact column projection (no over-select)", async () => {
    _editsToReturn = [
      makeEdit({ live_at: "2026-05-15T00:00:00Z" }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(_selectColumns).toBe(
      "url, date, sessions, engaged_sessions, conversions",
    );
  });

  it("counts canonicalizer-null edits (needs_new_page / path-only) as ineligible WITHOUT contributing URL candidates", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-sentinel",
        live_at: "2026-05-15T00:00:00Z",
        target_url: "needs_new_page",
      }),
      makeEdit({
        id: "e-path",
        live_at: "2026-05-15T00:00:00Z",
        target_url: "/services/foo",
      }),
      makeEdit({
        id: "e-ok",
        live_at: "2026-05-15T00:00:00Z",
        target_url: "https://ritzbuilders.com/services/whole-home-remodel",
      }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.total_recent_live_edits).toBe(3);
    // Only the OK edit contributes 2 URL candidates.
    expect(_inCallArgs[0]!.vals).toHaveLength(2);
    // The two canonicalizer-null edits are counted as ineligible at
    // the pre-filter step (without a Mode A call).
    expect(r.ineligible_edits).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Soft-fail variants
// ─────────────────────────────────────────────────────────────────────

describe("loadOutcomesSummaryForTenant — soft-fail", () => {
  it("returns data_unavailable when the repository throws", async () => {
    _repositoryThrows = true;
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.status).toBe("data_unavailable");
    expect(r.total_recent_live_edits).toBe(0);
    expect(_adminFromCallCount).toBe(0);
  });

  it("returns data_unavailable when edits is not an array", async () => {
    _editsToReturn = "not-an-array" as unknown as unknown[];
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.status).toBe("data_unavailable");
  });

  it("returns data_unavailable when admin throws", async () => {
    _editsToReturn = [
      makeEdit({ live_at: "2026-05-15T00:00:00Z" }),
    ];
    _supabaseAdminThrows = true;
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.status).toBe("data_unavailable");
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("returns data_unavailable on 42P01 (table missing)", async () => {
    _editsToReturn = [
      makeEdit({ live_at: "2026-05-15T00:00:00Z" }),
    ];
    _supabaseError = { code: "42P01", message: "undefined table" };
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.status).toBe("data_unavailable");
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("returns data_unavailable on generic read error", async () => {
    _editsToReturn = [
      makeEdit({ live_at: "2026-05-15T00:00:00Z" }),
    ];
    _supabaseError = { message: "connection refused" };
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.status).toBe("data_unavailable");
  });

  it("returns data_unavailable when data is not an array", async () => {
    _editsToReturn = [
      makeEdit({ live_at: "2026-05-15T00:00:00Z" }),
    ];
    _trafficData = null;
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r.status).toBe("data_unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Aggregation correctness
// ─────────────────────────────────────────────────────────────────────

describe("loadOutcomesSummaryForTenant — aggregation correctness", () => {
  it("aggregates eligible sessions across multiple eligible edits", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-1",
        live_at: "2026-05-01T00:00:00Z",
        target_url: "https://ritzbuilders.com/a",
      }),
      makeEdit({
        id: "e-2",
        live_at: "2026-05-05T00:00:00Z",
        target_url: "https://ritzbuilders.com/b",
      }),
    ];
    _trafficData = [];
    let callIndex = 0;
    _computeMock.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          kind: "eligible",
          days_since_live: 18,
          post_live_sessions: 10,
          post_live_engaged_sessions: 8,
          post_live_conversions: 1,
          post_live_qualified_calls: 0,
          canonical_target_url: "https://ritzbuilders.com/a",
          sample_window_start: "2026-05-01",
          sample_window_end: "2026-05-19",
        };
      }
      return {
        kind: "eligible",
        days_since_live: 14,
        post_live_sessions: 8,
        post_live_engaged_sessions: 5,
        post_live_conversions: 0,
        post_live_qualified_calls: 0,
        canonical_target_url: "https://ritzbuilders.com/b",
        sample_window_start: "2026-05-05",
        sample_window_end: "2026-05-19",
      };
    });
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r).toMatchObject({
      status: "ok",
      total_recent_live_edits: 2,
      eligible_edits: 2,
      still_learning_edits: 0,
      ineligible_edits: 0,
      sum_post_live_sessions: 18,
      sum_post_live_engaged_sessions: 13,
    });
  });

  it("classifies still_learning_outcome edits separately + does not include their sessions in the sum", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-eligible",
        live_at: "2026-05-01T00:00:00Z",
        target_url: "https://ritzbuilders.com/a",
      }),
      makeEdit({
        id: "e-still",
        live_at: "2026-05-10T00:00:00Z",
        target_url: "https://ritzbuilders.com/b",
      }),
    ];
    let callIndex = 0;
    _computeMock.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          kind: "eligible",
          days_since_live: 18,
          post_live_sessions: 12,
          post_live_engaged_sessions: 10,
          post_live_conversions: 0,
          post_live_qualified_calls: 0,
          canonical_target_url: "https://ritzbuilders.com/a",
          sample_window_start: "2026-05-01",
          sample_window_end: "2026-05-19",
        };
      }
      return {
        kind: "still_learning_outcome",
        reason: "insufficient_volume",
        days_since_live: 9,
        post_live_sessions: 3,
        post_live_qualified_calls: 0,
        canonical_target_url: "https://ritzbuilders.com/b",
        sample_window_start: "2026-05-10",
        sample_window_end: "2026-05-19",
      };
    });
    const r = await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(r).toMatchObject({
      total_recent_live_edits: 2,
      eligible_edits: 1,
      still_learning_edits: 1,
      ineligible_edits: 0,
      sum_post_live_sessions: 12, // only the eligible edit's sessions
    });
  });

  it("threads qualifiedCallCount=0 into every per-edit compute call (CallRail K2-deferred)", async () => {
    _editsToReturn = [
      makeEdit({
        id: "e-1",
        live_at: "2026-05-15T00:00:00Z",
      }),
    ];
    _computeMock.mockReturnValue({
      kind: "eligible",
      days_since_live: 4,
      post_live_sessions: 18,
      post_live_engaged_sessions: 15,
      post_live_conversions: 0,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://x",
      sample_window_start: "2026-05-15",
      sample_window_end: "2026-05-19",
    });
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-test",
      now: NOW,
    });
    expect(_computeMock).toHaveBeenCalled();
    const args = _computeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.qualifiedCallCount).toBe(0);
    expect(args.now).toBe(NOW);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tenant scope (sanity)
// ─────────────────────────────────────────────────────────────────────

describe("loadOutcomesSummaryForTenant — tenant scope", () => {
  it("threads tenantId through repo.forTenant AND Supabase .eq", async () => {
    _editsToReturn = [
      makeEdit({ live_at: "2026-05-15T00:00:00Z" }),
    ];
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x",
    });
    await loadOutcomesSummaryForTenant({
      tenantId: "tenant-from-ctx",
      now: NOW,
    });
    expect(_getRecommendedEditsCalls).toEqual(["tenant-from-ctx"]);
    expect(_eqCallArgs).toEqual([
      { col: "tenant_id", val: "tenant-from-ctx" },
    ]);
  });
});
