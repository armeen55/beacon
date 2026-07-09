/**
 * 2026-05-17 A.3.b2 — `gscUrlInspect` unit tests against the Supabase
 * cache backend.
 *
 * Pins:
 *   • Cache-hit path (fresh entry < 24h) returns the cached result
 *     without calling fetch.
 *   • Expired cache (> 24h) triggers a fresh fetch.
 *   • Successful fetch maps the response into the locked
 *     GscUrlInspectionResult shape (indexing_state / coverage_state
 *     / last_crawl_time extracted from inspectionResult.indexStatusResult).
 *   • Cache UPSERT happens after a successful fetch.
 *   • Cache key is `(tenant_id, inspection_url)` composite PK — two
 *     different URLs do not collide.
 *   • Fail-soft on missing token → null, no fetch.
 *   • Fail-soft on token lacking `webmasters.readonly` scope → null.
 *   • Fail-soft on non-2xx response → null.
 *   • Fail-soft on fetch throw → null.
 *   • Fail-soft on missing tenantId / siteUrl / inspectionUrl → null.
 *   • Missing cache table (PostgREST 42P01) soft-fails READ to null,
 *     does NOT throw — code-first deploy safe.
 *   • All tests mock fetch — no real network calls.
 *   • All tests mock the Supabase admin client — no real DB calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

type StoredRow = {
  tenant_id: string;
  inspection_url: string;
  site_url: string;
  indexing_state: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  last_checked_at: string;
  raw: unknown;
  updated_at: string;
};

let _rows: StoredRow[] = [];
/** When set, every Supabase op returns this error and skips storage. */
let _forceError: { code?: string; message: string } | null = null;
/** Spy for the upsert call site. */
const _upsertSpy = vi.fn();

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
      if (_forceError) return Promise.resolve({ data: null, error: _forceError });
      const hits = _rows.filter((r) =>
        filters.every((f) => (r[f.col] as unknown) === f.val),
      );
      if (hits.length === 0) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: hits[0]!, error: null });
    },
    upsert(
      row: StoredRow,
      opts: { onConflict?: string },
    ): Promise<{ error: { code?: string; message: string } | null }> {
      _upsertSpy(row, opts);
      if (_forceError) return Promise.resolve({ error: _forceError });
      const idx = _rows.findIndex(
        (r) =>
          r.tenant_id === row.tenant_id &&
          r.inspection_url === row.inspection_url,
      );
      if (idx >= 0) _rows[idx] = row;
      else _rows.push(row);
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

const mockAdmin = { from: (t: string) => buildQueryBuilder(t) };

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

let _googleToken: GoogleConnectorToken | null = null;
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(
    async (_kind?: "gsc" | "gbp", _tenantId?: string) => _googleToken,
  ),
  // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): the client now persists rotated
  // refresh tokens best-effort. No-op in tests.
  persistRefreshedGoogleToken: vi.fn(async () => {}),
}));

const _refreshSpy = vi.fn(async (_refreshToken: string) => ({
  access_token: "refreshed-access-token",
  expires_in: 3600,
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: (refreshToken: string) => _refreshSpy(refreshToken),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { gscUrlInspect, mapInspectionResponse, __testing } from "@/lib/connectors/gsc/client";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-ritz-founder";
const SITE_URL = "sc-domain:ritzbuilders.com";
const INSPECTION_URL =
  "https://ritzbuilders.com/services/whole-home-remodel";
const NOW = new Date("2026-05-17T12:00:00Z");

function makeGoogleToken(
  scopes: ReadonlyArray<string> = [
    "https://www.googleapis.com/auth/webmasters.readonly",
  ],
): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW.getTime() + 3600 * 1000,
    connected_at: NOW.toISOString(),
    scopes: [...scopes],
  };
}

function makeApiResponseBody(over: Partial<{
  indexingState: string;
  coverageState: string;
  lastCrawlTime: string;
}> = {}): unknown {
  return {
    inspectionResult: {
      indexStatusResult: {
        indexingState: over.indexingState ?? "INDEXING_ALLOWED",
        coverageState: over.coverageState ?? "Submitted and indexed",
        lastCrawlTime: over.lastCrawlTime ?? "2026-05-16T07:00:00.000Z",
      },
    },
  };
}

function stubFetchOnce(response: { ok: boolean; status: number; json: () => Promise<unknown> }): void {
  vi.stubGlobal("fetch", vi.fn(async () => response as unknown as Response));
}

function stubFetchThrows(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("ECONNRESET");
    }),
  );
}

function seedCache(args: {
  tenantId: string;
  inspectionUrl: string;
  lastCheckedAt: string;
  marker?: string;
}): void {
  _rows.push({
    tenant_id: args.tenantId,
    inspection_url: args.inspectionUrl,
    site_url: SITE_URL,
    indexing_state: "INDEXING_ALLOWED",
    coverage_state: "Submitted and indexed",
    last_crawl_time: "2026-04-01T00:00:00.000Z",
    last_checked_at: args.lastCheckedAt,
    raw: { cached: true, marker: args.marker ?? "default" },
    updated_at: args.lastCheckedAt,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _rows = [];
  _forceError = null;
  _upsertSpy.mockClear();
  _googleToken = null;
  _refreshSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────
// Tests — cache behavior
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — cache behavior (Supabase backend)", () => {
  it("returns cached entry without calling fetch when last_checked_at is within 24h", async () => {
    _googleToken = makeGoogleToken();
    const fresh = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();
    seedCache({ tenantId: TENANT_ID, inspectionUrl: INSPECTION_URL, lastCheckedAt: fresh });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((out!.raw as { cached: boolean }).cached).toBe(true);
    // No upsert should have been issued either.
    expect(_upsertSpy).not.toHaveBeenCalled();
  });

  it("triggers a fresh fetch when cache entry is older than 24h", async () => {
    _googleToken = makeGoogleToken();
    const stale = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    seedCache({ tenantId: TENANT_ID, inspectionUrl: INSPECTION_URL, lastCheckedAt: stale });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody({ coverageState: "Fresh!" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out!.coverage_state).toBe("Fresh!");
  });

  it("triggers a fresh fetch when cache is empty (no row in Supabase)", async () => {
    _googleToken = makeGoogleToken();
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody(),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("upserts the result to Supabase after a successful fetch", async () => {
    _googleToken = makeGoogleToken();
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody({ indexingState: "PASS" }),
    });

    await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });

    expect(_upsertSpy).toHaveBeenCalledTimes(1);
    const [row, opts] = _upsertSpy.mock.calls[0] as [StoredRow, { onConflict?: string }];
    expect(opts.onConflict).toBe("tenant_id,inspection_url");
    expect(row.tenant_id).toBe(TENANT_ID);
    expect(row.inspection_url).toBe(INSPECTION_URL);
    expect(row.site_url).toBe(SITE_URL);
    expect(row.indexing_state).toBe("PASS");

    // Row persisted in the in-memory mock.
    expect(_rows).toHaveLength(1);
    expect(_rows[0]!.indexing_state).toBe("PASS");
  });

  it("cache key is composite (tenant_id, inspection_url) — different URLs do NOT collide", async () => {
    _googleToken = makeGoogleToken();
    const url1 = "https://ritzbuilders.com/services/whole-home-remodel";
    const url2 = "https://ritzbuilders.com/services/additions";
    seedCache({
      tenantId: TENANT_ID,
      inspectionUrl: url1,
      lastCheckedAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody(),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    // url1 → cache hit, no fetch.
    await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: url1,
      now: NOW,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // url2 → cache miss, one fetch.
    await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: url2,
      now: NOW,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — response mapping
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — response mapping", () => {
  it("maps inspectionResult.indexStatusResult into GscUrlInspectionResult shape", async () => {
    _googleToken = makeGoogleToken();
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeApiResponseBody({
          indexingState: "INDEXING_ALLOWED",
          coverageState: "Submitted and indexed",
          lastCrawlTime: "2026-05-15T07:00:00.000Z",
        }),
    });
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toEqual({
      url: INSPECTION_URL,
      site_url: SITE_URL,
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: "Submitted and indexed",
      last_crawl_time: "2026-05-15T07:00:00.000Z",
      // J4 (2026-05-18) — extracted from raw.inspectionResult.
      //   mobileUsabilityResult.verdict; the fixture body above
      //   omits the field so the derived value is null.
      mobile_usability: null,
      last_checked_at: NOW.toISOString(),
      raw: expect.anything(),
    });
  });

  it("mapInspectionResponse handles missing inspectionResult", () => {
    const out = mapInspectionResponse({
      body: {},
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      nowIso: NOW.toISOString(),
    });
    expect(out.indexing_state).toBeNull();
    expect(out.coverage_state).toBeNull();
    expect(out.last_crawl_time).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — fail-soft paths
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — fail-soft on missing inputs", () => {
  it("returns null when tenantId is empty", async () => {
    _googleToken = makeGoogleToken();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await gscUrlInspect({
      tenantId: "",
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when siteUrl is empty", async () => {
    _googleToken = makeGoogleToken();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: "",
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when inspectionUrl is empty", async () => {
    _googleToken = makeGoogleToken();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: "",
      now: NOW,
    });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("gscUrlInspect — fail-soft on token/scope", () => {
  it("returns null when no Google token is connected", async () => {
    _googleToken = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when token lacks webmasters.readonly scope", async () => {
    _googleToken = makeGoogleToken([
      "https://www.googleapis.com/auth/business.manage",
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("gscUrlInspect — fail-soft on transport / API errors", () => {
  it("returns null on non-2xx response", async () => {
    _googleToken = makeGoogleToken();
    stubFetchOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "quotaExceeded" }),
    });
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    // Failed fetch should NOT upsert anything.
    expect(_upsertSpy).not.toHaveBeenCalled();
  });

  it("returns null when fetch throws", async () => {
    _googleToken = makeGoogleToken();
    stubFetchThrows();
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(_upsertSpy).not.toHaveBeenCalled();
  });
});

describe("gscUrlInspect — fail-soft on Supabase undefined_table (42P01)", () => {
  it("returns null on cache READ undefined_table → falls through to fresh fetch path", async () => {
    _googleToken = makeGoogleToken();
    _forceError = { code: "42P01", message: "relation does not exist" };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody({ coverageState: "Submitted and indexed" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    // Cache READ soft-failed (42P01) → fresh fetch fired → result returned.
    // The subsequent UPSERT will ALSO 42P01 (still mocked); the client
    // logs + returns the in-memory result anyway. Quota burned regardless.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out!.coverage_state).toBe("Submitted and indexed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — token refresh
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — token refresh on near-expiry", () => {
  it("refreshes when expires_at is within 60s of now", async () => {
    _googleToken = makeGoogleToken();
    // Force near-expiry — 30s in future, within 60s threshold.
    _googleToken.expires_at = NOW.getTime() + 30_000;
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody(),
    });

    await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(_refreshSpy).toHaveBeenCalledTimes(1);
    expect(_refreshSpy).toHaveBeenCalledWith("refresh-xyz");
  });

  it("returns null when refresh throws", async () => {
    _googleToken = makeGoogleToken();
    _googleToken.expires_at = NOW.getTime() - 1000; // already expired
    _refreshSpy.mockRejectedValueOnce(new Error("invalid_grant"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tests — __testing surface
// ─────────────────────────────────────────────────────────────────────

describe("__testing constants", () => {
  it("REQUIRED_SCOPE matches the locked webmasters.readonly value", () => {
    expect(__testing.REQUIRED_SCOPE).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
  });

  it("CACHE_TTL_MS is 24 hours", () => {
    expect(__testing.CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("CACHE_TABLE is gsc_url_inspections", () => {
    expect(__testing.CACHE_TABLE).toBe("gsc_url_inspections");
  });
});
