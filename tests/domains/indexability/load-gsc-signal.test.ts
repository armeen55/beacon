/**
 * 2026-05-17 A.3.b1.beta — `loadGscSignal` adapter unit tests.
 *
 * Pins:
 *   • BEACON_GSC_SITE_URL unset → null signal, NO gscUrlInspect call.
 *   • empty tenantId / inspectionUrl → null, NO gscUrlInspect call.
 *   • allowFreshFetch=false + cache row present → signal from cache,
 *     NO gscUrlInspect call.
 *   • allowFreshFetch=false + no cache row → null signal.
 *   • allowFreshFetch=true + cache absent → gscUrlInspect called.
 *   • allowFreshFetch=true + gscUrlInspect returns null AND cache has
 *     stale row → fall back to cached signal (better than null).
 *   • Cache 42P01 soft-fail.
 *   • `deriveIndexedFlag` mapping rules (indexed-positive,
 *     not-indexed, blocked-state, ambiguous).
 *   • GSC_INSPECT_PER_RENDER_LIMIT constant locked at 5.
 *   • All tests mock fetch + Supabase admin + gscUrlInspect entirely.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks — Supabase admin + gscUrlInspect
// ─────────────────────────────────────────────────────────────────────

type StoredRow = {
  tenant_id: string;
  inspection_url: string;
  indexing_state: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  last_checked_at: string;
};

let _rows: StoredRow[] = [];
let _forceCacheError: { code?: string; message: string } | null = null;

function buildQueryBuilder(table: string) {
  const filters: Array<{ col: keyof StoredRow; val: string }> = [];
  const builder = {
    select(_cols: string) {
      return builder;
    },
    eq(col: keyof StoredRow, val: string) {
      filters.push({ col, val });
      return builder;
    },
    maybeSingle() {
      if (table !== "gsc_url_inspections") {
        return Promise.resolve({ data: null, error: null });
      }
      if (_forceCacheError) {
        return Promise.resolve({ data: null, error: _forceCacheError });
      }
      const hits = _rows.filter((r) =>
        filters.every((f) => (r[f.col] as unknown) === f.val),
      );
      return Promise.resolve({ data: hits[0] ?? null, error: null });
    },
  };
  return builder;
}

const mockAdmin = { from: (t: string) => buildQueryBuilder(t) };
let _adminThrows = false;
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_adminThrows) throw new Error("env unset");
    return mockAdmin;
  },
}));

const _gscUrlInspectSpy = vi.fn();
vi.mock("@/lib/connectors/gsc/client", () => ({
  gscUrlInspect: (args: unknown) => _gscUrlInspectSpy(args),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  loadGscSignal,
  GSC_INSPECT_PER_RENDER_LIMIT,
  __testing,
} from "@/domains/indexability/load-gsc-signal";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-alpha";
const INSPECTION_URL = "https://example.com/services/whole-home-remodel";
const NOW = new Date("2026-05-17T12:00:00Z");

function seedCache(args: Partial<StoredRow> & { tenant_id: string; inspection_url: string }): void {
  _rows.push({
    tenant_id: args.tenant_id,
    inspection_url: args.inspection_url,
    indexing_state: args.indexing_state ?? "INDEXING_ALLOWED",
    coverage_state: args.coverage_state ?? "Submitted and indexed",
    last_crawl_time: args.last_crawl_time ?? "2026-05-15T07:00:00.000Z",
    last_checked_at:
      args.last_checked_at ??
      new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
  });
}

beforeEach(() => {
  _rows = [];
  _forceCacheError = null;
  _adminThrows = false;
  _gscUrlInspectSpy.mockReset();
  vi.stubEnv("BEACON_GSC_SITE_URL", "sc-domain:example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────
// Tests — guard rails
// ─────────────────────────────────────────────────────────────────────

describe("loadGscSignal — guard rails", () => {
  it("returns null when BEACON_GSC_SITE_URL is unset", async () => {
    vi.stubEnv("BEACON_GSC_SITE_URL", "");
    seedCache({ tenant_id: TENANT_ID, inspection_url: INSPECTION_URL });
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: true,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });

  it("returns null when tenantId is empty", async () => {
    const out = await loadGscSignal({
      tenantId: "",
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: true,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });

  it("returns null when inspectionUrl is empty", async () => {
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: "",
      allowFreshFetch: true,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — cache-read-only path
// ─────────────────────────────────────────────────────────────────────

describe("loadGscSignal — allowFreshFetch=false (cache-read only)", () => {
  it("returns signal from cache when row present, no gscUrlInspect call", async () => {
    seedCache({
      tenant_id: TENANT_ID,
      inspection_url: INSPECTION_URL,
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: "Submitted and indexed",
    });
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: false,
      now: NOW,
    });
    expect(out).not.toBeNull();
    expect(out!.indexed).toBe(true);
    expect(out!.indexing_state).toBe("INDEXING_ALLOWED");
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });

  it("returns null when no cache row exists and allowFreshFetch=false", async () => {
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: false,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });

  it("soft-fails to null on Supabase 42P01 (undefined_table)", async () => {
    _forceCacheError = { code: "42P01", message: "relation does not exist" };
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: false,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });

  it("soft-fails to null on Supabase admin init failure", async () => {
    _adminThrows = true;
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: false,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_gscUrlInspectSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — fresh-fetch path
// ─────────────────────────────────────────────────────────────────────

describe("loadGscSignal — allowFreshFetch=true", () => {
  it("calls gscUrlInspect when cache is absent", async () => {
    _gscUrlInspectSpy.mockResolvedValue({
      url: INSPECTION_URL,
      site_url: "sc-domain:example.com",
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: "Submitted and indexed",
      last_crawl_time: "2026-05-16T00:00:00.000Z",
      last_checked_at: NOW.toISOString(),
      raw: {},
    });
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: true,
      now: NOW,
    });
    expect(_gscUrlInspectSpy).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out!.indexed).toBe(true);
  });

  it("falls back to cached signal when gscUrlInspect returns null", async () => {
    seedCache({
      tenant_id: TENANT_ID,
      inspection_url: INSPECTION_URL,
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: "Submitted and indexed",
      last_checked_at: new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    });
    _gscUrlInspectSpy.mockResolvedValue(null);
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: true,
      now: NOW,
    });
    expect(_gscUrlInspectSpy).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    // Fell back to the cached signal.
    expect(out!.indexing_state).toBe("INDEXING_ALLOWED");
  });

  it("returns null when no cache + gscUrlInspect returns null", async () => {
    _gscUrlInspectSpy.mockResolvedValue(null);
    const out = await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: true,
      now: NOW,
    });
    expect(out).toBeNull();
  });

  it("passes the BEACON_GSC_SITE_URL value as the siteUrl arg", async () => {
    vi.stubEnv("BEACON_GSC_SITE_URL", "sc-domain:custom.example.org");
    _gscUrlInspectSpy.mockResolvedValue({
      url: INSPECTION_URL,
      site_url: "sc-domain:custom.example.org",
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: "Submitted and indexed",
      last_crawl_time: null,
      last_checked_at: NOW.toISOString(),
      raw: {},
    });
    await loadGscSignal({
      tenantId: TENANT_ID,
      inspectionUrl: INSPECTION_URL,
      allowFreshFetch: true,
      now: NOW,
    });
    const callArgs = _gscUrlInspectSpy.mock.calls[0]![0] as { siteUrl: string };
    expect(callArgs.siteUrl).toBe("sc-domain:custom.example.org");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — deriveIndexedFlag
// ─────────────────────────────────────────────────────────────────────

describe("deriveIndexedFlag — mapping rules", () => {
  it("INDEXING_ALLOWED + 'Submitted and indexed' → true", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "INDEXING_ALLOWED",
        coverage_state: "Submitted and indexed",
      }),
    ).toBe(true);
  });

  it("INDEXING_ALLOWED + 'Indexed, not submitted in sitemap' → true", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "INDEXING_ALLOWED",
        coverage_state: "Indexed, not submitted in sitemap",
      }),
    ).toBe(true);
  });

  it("BLOCKED_BY_ROBOTS_TXT → false (state alone is enough)", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "BLOCKED_BY_ROBOTS_TXT",
        coverage_state: null,
      }),
    ).toBe(false);
  });

  it("BLOCKED_BY_NOINDEX → false", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "BLOCKED_BY_NOINDEX",
        coverage_state: "Excluded by 'noindex' tag",
      }),
    ).toBe(false);
  });

  it("INDEXING_ALLOWED + 'Discovered - currently not indexed' → false", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "INDEXING_ALLOWED",
        coverage_state: "Discovered - currently not indexed",
      }),
    ).toBe(false);
  });

  it("INDEXING_ALLOWED + 'Crawled - currently not indexed' → false", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "INDEXING_ALLOWED",
        coverage_state: "Crawled - currently not indexed",
      }),
    ).toBe(false);
  });

  it("unrecognized state + null coverage → null (ambiguous)", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: "SOME_UNKNOWN_STATE",
        coverage_state: null,
      }),
    ).toBeNull();
  });

  it("all-null → null (ambiguous)", () => {
    expect(
      __testing.deriveIndexedFlag({
        indexing_state: null,
        coverage_state: null,
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — constants
// ─────────────────────────────────────────────────────────────────────

describe("loadGscSignal — locked constants", () => {
  it("GSC_INSPECT_PER_RENDER_LIMIT is 5", () => {
    expect(GSC_INSPECT_PER_RENDER_LIMIT).toBe(5);
    expect(__testing.GSC_INSPECT_PER_RENDER_LIMIT).toBe(5);
  });

  it("CACHE_TABLE is gsc_url_inspections", () => {
    expect(__testing.CACHE_TABLE).toBe("gsc_url_inspections");
  });

  it("getGscSiteUrl returns trimmed env value", () => {
    vi.stubEnv("BEACON_GSC_SITE_URL", "  sc-domain:trimmed.example.com  ");
    expect(__testing.getGscSiteUrl()).toBe("sc-domain:trimmed.example.com");
  });

  it("getGscSiteUrl returns null on empty / whitespace env", () => {
    vi.stubEnv("BEACON_GSC_SITE_URL", "   ");
    expect(__testing.getGscSiteUrl()).toBeNull();
  });
});
