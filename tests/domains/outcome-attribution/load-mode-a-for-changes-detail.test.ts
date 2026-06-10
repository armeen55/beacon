/**
 * 2026-05-19 — Slice 9.A2β + 9.A2β.1 — loadModeAForChangesDetail unit tests.
 *
 * Pins (9.A2β):
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
 *
 * Pins (9.A2β.1 — URL-scoped SELECT):
 *   • Loader canonicalizes target_url FIRST + early-outs to null
 *     when canonicalizer returns null (no Supabase round-trip).
 *   • Supabase SELECT chains `.in("url", [canonicalTargetUrl,
 *     canonicalTargetUrl + "/"])` AFTER `.eq("tenant_id", ...)`.
 *   • Cache key version bumped to `mode-a-changes-detail:v2`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks (hoisted)
// ─────────────────────────────────────────────────────────────────────

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
        // Inline terminator: every chain segment returns a Promise-
        // aware object that ALSO exposes further chain methods, so the
        // loader can call `.eq(...).in(...)` and the chain still
        // resolves to the data/error tuple.
        const makeTerminator = () => ({
          eq: (col: string, val: string) => {
            _eqCallArgs.push({ col, val });
            return makeTerminator();
          },
          in: (col: string, vals: readonly string[]) => {
            _inCallArgs.push({ col, vals });
            return makeTerminator();
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
            return makeTerminator();
          },
        };
      },
    };
  },
}));

// §9.B — mock the CallRail call-count collaborator (not under test here;
// its behavior is pinned in tests/lib/connectors/callrail/). Default 0 =
// "no CallRail connected" → the GA4 read shape stays exactly as before.
let _qualifiedCalls = 0;
vi.mock("@/lib/connectors/callrail/persist-url-calls", () => ({
  loadQualifiedCallCountForUrl: async () => _qualifiedCalls,
}));

// Inline unstable_cache so the cached function executes immediately
// (no real Next.js cache backend in this test env). Capture the cache
// key argument so tests can pin the 9.A2β.1 v1→v2 bump.
let _cacheKey: unknown = null;
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    key: unknown,
    _opts: unknown,
  ) => {
    _cacheKey = key;
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
  _supabaseAdminThrows = false;
  _trafficData = [];
  _supabaseError = null;
  _eqCallArgs = [];
  _inCallArgs = [];
  _selectColumns = "";
  _fromTable = "";
  _adminFromCallCount = 0;
  _cacheKey = null;
  _qualifiedCalls = 0;
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
// 9.A2β.1 — URL-scoped SELECT + canonical-first early-out + cache v2
// ─────────────────────────────────────────────────────────────────────

describe("loadModeAForChangesDetail — 9.A2β.1 URL-scoped SELECT", () => {
  it("filters the SELECT to .in('url', [canonicalTargetUrl, canonicalTargetUrl + '/'])", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: makeEdit({
        target_url: "https://ritzbuilders.com/services/whole-home-remodel",
      }),
      now: NOW,
    });
    expect(_inCallArgs).toEqual([
      {
        col: "url",
        vals: [
          "https://ritzbuilders.com/services/whole-home-remodel",
          "https://ritzbuilders.com/services/whole-home-remodel/",
        ],
      },
    ]);
  });

  it("preserves the tenant-scope .eq() call AND chains the .in() filter after it", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x.com/foo",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: makeEdit({ target_url: "https://x.com/foo" }),
      now: NOW,
    });
    // Both chain calls fired exactly once.
    expect(_eqCallArgs).toEqual([
      { col: "tenant_id", val: "tenant-ritz-founder" },
    ]);
    expect(_inCallArgs).toEqual([
      {
        col: "url",
        vals: ["https://x.com/foo", "https://x.com/foo/"],
      },
    ]);
  });

  it("canonicalizes input target_url before filtering (strips www, lowercases host, normalizes http→https)", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://example.com/path",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit({
        // Pre-canonical input — canonicalizer should normalize.
        target_url: "http://WWW.Example.com/path/?utm_source=x#frag",
      }),
      now: NOW,
    });
    expect(_inCallArgs).toEqual([
      {
        col: "url",
        vals: ["https://example.com/path", "https://example.com/path/"],
      },
    ]);
  });

  it("early-outs to null when target_url is the 'needs_new_page' sentinel — no Supabase round-trip", async () => {
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit({ target_url: "needs_new_page" }),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_adminFromCallCount).toBe(0);
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("early-outs to null when target_url is null — no Supabase round-trip", async () => {
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit({ target_url: null as unknown as string }),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_adminFromCallCount).toBe(0);
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("early-outs to null when target_url is empty string — no Supabase round-trip", async () => {
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit({ target_url: "" }),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_adminFromCallCount).toBe(0);
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("early-outs to null when target_url is a path-only string (canonicalizer returns null)", async () => {
    const r = await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit({ target_url: "/services/foo" }),
      now: NOW,
    });
    expect(r).toBeNull();
    expect(_adminFromCallCount).toBe(0);
    expect(_computeMock).not.toHaveBeenCalled();
  });

  it("uses cache key namespace 'mode-a-changes-detail:v2' (bumped from v1)", async () => {
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://x.com/foo",
    });
    await loadModeAForChangesDetail({
      tenantId: "tenant-test",
      recommendedEdit: makeEdit({ target_url: "https://x.com/foo" }),
      now: NOW,
    });
    expect(Array.isArray(_cacheKey)).toBe(true);
    const key = _cacheKey as readonly unknown[];
    expect(key[0]).toBe("mode-a-changes-detail:v2");
    // Defense in depth: the v1 namespace MUST NOT appear anywhere
    // in the key (catches a future refactor that splits the version
    // across multiple key elements).
    expect(key.some((k) => k === "mode-a-changes-detail:v1")).toBe(false);
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

  it("§9.B — threads the CallRail qualified-call count into Mode A compute", async () => {
    // CallRail connected: 3 qualified calls attributed to this URL since live.
    _qualifiedCalls = 3;
    _computeMock.mockReturnValue({
      kind: "eligible",
      days_since_live: 21,
      post_live_sessions: 12,
      post_live_engaged_sessions: 9,
      post_live_qualified_calls: 3,
      canonical_target_url:
        "https://ritzbuilders.com/services/whole-home-remodel",
      sample_window_start: "2026-04-28",
      sample_window_end: "2026-05-19",
    });

    await loadModeAForChangesDetail({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: makeEdit(),
      now: NOW,
    });

    expect(_computeMock).toHaveBeenCalledTimes(1);
    const args = _computeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.qualifiedCallCount).toBe(3);
  });

  it("§9.B — qualifiedCallCount stays 0 when the edit has no live_at (call-read skipped)", async () => {
    // Even with calls available, no live_at means no since-date → no read.
    _qualifiedCalls = 99;
    _computeMock.mockReturnValue({
      kind: "ineligible",
      reason: "no_live_at",
      canonical_target_url:
        "https://ritzbuilders.com/services/whole-home-remodel",
    });

    await loadModeAForChangesDetail({
      tenantId: "tenant-ritz-founder",
      recommendedEdit: makeEdit({ live_at: null as unknown as string }),
      now: NOW,
    });

    expect(_computeMock).toHaveBeenCalledTimes(1);
    const args = _computeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.qualifiedCallCount).toBe(0);
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
