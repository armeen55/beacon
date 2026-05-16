/**
 * A.3.b1.alpha (2026-05-16) — `gscUrlInspect` unit tests.
 *
 * Pins:
 *   - Cache-hit path (fresh entry < 24h) returns the cached result
 *     without calling fetch.
 *   - Expired cache (> 24h) triggers a fresh fetch.
 *   - Successful fetch maps the response into the locked
 *     GscUrlInspectionResult shape (indexing_state / coverage_state
 *     / last_crawl_time extracted from inspectionResult.indexStatusResult).
 *   - Cache write happens after a successful fetch.
 *   - Cache key is the canonical inspection URL.
 *   - Fail-soft on missing token → null, no fetch.
 *   - Fail-soft on token lacking `webmasters.readonly` scope → null.
 *   - Fail-soft on non-2xx response → null.
 *   - Fail-soft on fetch throw → null.
 *   - Fail-soft on missing siteUrl / inspectionUrl → null.
 *   - All tests mock fetch — no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BeaconTenant } from "@/domains/tenants/types";
import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _tenantMap: Map<string, BeaconTenant> = new Map();
vi.mock("@/domains/tenants/store", () => ({
  getTenant: vi.fn(async (id: string) => _tenantMap.get(id) ?? null),
  getTenantOrThrow: vi.fn(),
  listTenants: vi.fn(async () => []),
}));

let _googleToken: GoogleConnectorToken | null = null;
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(() => _googleToken),
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

import { gscUrlInspect, __testing } from "@/lib/connectors/gsc/client";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-ritz-founder";
const TENANT_SLUG = "ritz-founder";
const SITE_URL = "sc-domain:ritzbuilders.com";
const INSPECTION_URL =
  "https://ritzbuilders.com/services/whole-home-remodel";
const NOW = new Date("2026-05-16T12:00:00Z");

function makeTenant(id: string, slug: string): BeaconTenant {
  return { id, slug } as unknown as BeaconTenant;
}

function makeGoogleToken(
  scopes: ReadonlyArray<string> = [
    "https://www.googleapis.com/auth/business.manage",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ],
): GoogleConnectorToken {
  return {
    provider: "google",
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
        lastCrawlTime: over.lastCrawlTime ?? "2026-05-15T07:00:00.000Z",
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

// ─────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────

let originalCwd: string;
let tmpDir: string;
let savedEnv: { id?: string; slug?: string; vercel?: string };

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), "gsc-client-test-"));
  process.chdir(tmpDir);
  _tenantMap = new Map();
  _googleToken = null;
  _refreshSpy.mockClear();
  savedEnv = {
    id: process.env.BEACON_TENANT_ID,
    slug: process.env.BEACON_TENANT_SLUG,
    vercel: process.env.VERCEL,
  };
  delete process.env.BEACON_TENANT_ID;
  delete process.env.BEACON_TENANT_SLUG;
  delete process.env.VERCEL;
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv.id !== undefined) process.env.BEACON_TENANT_ID = savedEnv.id;
  if (savedEnv.slug !== undefined) process.env.BEACON_TENANT_SLUG = savedEnv.slug;
  if (savedEnv.vercel !== undefined) process.env.VERCEL = savedEnv.vercel;
  vi.unstubAllGlobals();
});

function seedCache(slug: string, urlKey: string, lastCheckedAt: string): void {
  const dir = join(tmpDir, ".data", "tenants", slug);
  mkdirSync(dir, { recursive: true });
  const cache = {
    [urlKey]: {
      url: urlKey,
      site_url: SITE_URL,
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: "Submitted and indexed",
      last_crawl_time: "2026-04-01T00:00:00.000Z",
      last_checked_at: lastCheckedAt,
      raw: { cached: true },
    },
  };
  writeFileSync(
    join(dir, "gsc-url-inspections.json"),
    JSON.stringify(cache),
    "utf-8",
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — cache behavior", () => {
  it("returns cached entry without calling fetch when last_checked_at is within 24h", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    const fresh = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();
    seedCache(TENANT_SLUG, INSPECTION_URL, fresh);
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
    // Cached entry's raw field is preserved.
    expect((out!.raw as { cached: boolean }).cached).toBe(true);
  });

  it("triggers a fresh fetch when cache entry is older than 24h", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    const stale = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    seedCache(TENANT_SLUG, INSPECTION_URL, stale);
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

  it("writes the result back to the tenant cache after a successful fetch", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
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

    const cacheFile = join(
      tmpDir,
      ".data",
      "tenants",
      TENANT_SLUG,
      "gsc-url-inspections.json",
    );
    expect(existsSync(cacheFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(persisted[INSPECTION_URL]).toBeDefined();
    expect(persisted[INSPECTION_URL].indexing_state).toBe("PASS");
    expect(persisted[INSPECTION_URL].url).toBe(INSPECTION_URL);
    expect(persisted[INSPECTION_URL].site_url).toBe(SITE_URL);
  });

  it("cache key is the canonical inspection URL (different URLs do not collide)", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    const url1 = "https://ritzbuilders.com/services/whole-home-remodel";
    const url2 = "https://ritzbuilders.com/services/additions";
    seedCache(TENANT_SLUG, url1, new Date(NOW.getTime() - 1000).toISOString());
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

describe("gscUrlInspect — response mapping", () => {
  it("maps inspectionResult.indexStatusResult fields into the result shape", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeApiResponseBody({
          indexingState: "INDEXING_ALLOWED",
          coverageState: "Submitted and indexed",
          lastCrawlTime: "2026-05-10T08:30:00.000Z",
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
      last_crawl_time: "2026-05-10T08:30:00.000Z",
      last_checked_at: NOW.toISOString(),
      raw: expect.objectContaining({
        inspectionResult: expect.any(Object),
      }),
    });
  });

  it("missing indexStatusResult fields map to null defensively", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ inspectionResult: { indexStatusResult: {} } }),
    });

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).not.toBeNull();
    expect(out!.indexing_state).toBeNull();
    expect(out!.coverage_state).toBeNull();
    expect(out!.last_crawl_time).toBeNull();
  });
});

describe("gscUrlInspect — fail-soft skip reasons", () => {
  it("returns null when no Google token is connected, without calling fetch", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
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

  it("returns null when token lacks webmasters.readonly scope, without calling fetch", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
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

  it("returns null on non-2xx API response", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    stubFetchOnce({ ok: false, status: 403, json: async () => ({}) });
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = makeGoogleToken();
    stubFetchThrows();
    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).toBeNull();
  });

  it("returns null when siteUrl is empty", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
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
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
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

  it("returns null when tenant slug is unresolvable (no registry entry, no env fallback)", async () => {
    // _tenantMap intentionally empty; env vars cleared in beforeEach.
    _googleToken = makeGoogleToken();
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

describe("gscUrlInspect — token refresh path", () => {
  it("refreshes token when it has expired", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = {
      ...makeGoogleToken(),
      expires_at: NOW.getTime() - 1000, // already expired
    };
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody(),
    });

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(_refreshSpy).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
  });

  it("returns null when refresh throws", async () => {
    _tenantMap.set(TENANT_ID, makeTenant(TENANT_ID, TENANT_SLUG));
    _googleToken = {
      ...makeGoogleToken(),
      expires_at: NOW.getTime() - 1000,
    };
    _refreshSpy.mockImplementationOnce(async () => {
      throw new Error("refresh failed");
    });
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

describe("gscUrlInspect — operator-bootstrap slug fallback", () => {
  it("uses BEACON_TENANT_SLUG when tenant registry has no entry but env matches", async () => {
    process.env.BEACON_TENANT_ID = TENANT_ID;
    process.env.BEACON_TENANT_SLUG = TENANT_SLUG;
    // Registry intentionally empty — mirrors Vercel-without-bundled-data state.
    _googleToken = makeGoogleToken();
    stubFetchOnce({
      ok: true,
      status: 200,
      json: async () => makeApiResponseBody(),
    });

    const out = await gscUrlInspect({
      tenantId: TENANT_ID,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      now: NOW,
    });
    expect(out).not.toBeNull();
    const cacheFile = join(
      tmpDir,
      ".data",
      "tenants",
      TENANT_SLUG,
      "gsc-url-inspections.json",
    );
    expect(existsSync(cacheFile)).toBe(true);
  });

  it("env fallback does NOT fire for a different tenantId", async () => {
    process.env.BEACON_TENANT_ID = "tenant-some-other-id";
    process.env.BEACON_TENANT_SLUG = "other-slug";
    _googleToken = makeGoogleToken();
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

describe("gscUrlInspect — constants", () => {
  it("REQUIRED_SCOPE is the locked webmasters.readonly value", () => {
    expect(__testing.REQUIRED_SCOPE).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
  });

  it("CACHE_TTL_MS is 24 hours", () => {
    expect(__testing.CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
