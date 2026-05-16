/**
 * A.3.b1.alpha (2026-05-16) — GSC client cache tenant-isolation tests.
 *
 * Pins:
 *   - Tenant A's cache file lives at `.data/tenants/{slugA}/gsc-url-inspections.json`.
 *   - Tenant B's cache file lives at `.data/tenants/{slugB}/gsc-url-inspections.json`.
 *   - A request for tenant A NEVER reads tenant B's seeded cache (and
 *     vice versa) — even when both tenants seed the same inspection URL
 *     key with distinguishable payloads.
 *   - A fresh write by tenant A does NOT mutate tenant B's cache file.
 *   - The explicit `tenantId` argument is the ONLY thing that controls
 *     the cache file path (ambient env vars do not override).
 *
 * Mirrors the `profound-import-runs-explicit-tenant-scope` invariant
 * pattern: explicit tenantId, no ambient-slug fallback for non-bootstrap
 * tenants.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
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

vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async () => ({
    access_token: "refreshed",
    expires_in: 3600,
  })),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { gscUrlInspect, __testing } from "@/lib/connectors/gsc/client";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_A_ID = "tenant-alpha";
const TENANT_A_SLUG = "alpha";
const TENANT_B_ID = "tenant-bravo";
const TENANT_B_SLUG = "bravo";

const SITE_URL_A = "sc-domain:alpha.example.com";
const SITE_URL_B = "sc-domain:bravo.example.com";
const SHARED_INSPECTION_URL = "https://example.com/services/whole-home-remodel";
const NOW = new Date("2026-05-16T12:00:00Z");

function makeTenant(id: string, slug: string): BeaconTenant {
  return { id, slug } as unknown as BeaconTenant;
}

function makeGoogleToken(): GoogleConnectorToken {
  return {
    provider: "google",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW.getTime() + 3600 * 1000,
    connected_at: NOW.toISOString(),
    scopes: [
      "https://www.googleapis.com/auth/business.manage",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
  };
}

function seedCache(
  rootDir: string,
  slug: string,
  urlKey: string,
  payloadMarker: string,
): void {
  const dir = join(rootDir, ".data", "tenants", slug);
  mkdirSync(dir, { recursive: true });
  const cache = {
    [urlKey]: {
      url: urlKey,
      site_url: `sc-domain:${slug}.example.com`,
      indexing_state: "INDEXING_ALLOWED",
      coverage_state: payloadMarker,
      last_crawl_time: "2026-04-01T00:00:00.000Z",
      // Fresh (well within 24h) so it counts as a cache hit.
      last_checked_at: new Date(NOW.getTime() - 60 * 1000).toISOString(),
      raw: { tenant_marker: payloadMarker },
    },
  };
  writeFileSync(
    join(dir, "gsc-url-inspections.json"),
    JSON.stringify(cache),
    "utf-8",
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
  tmpDir = mkdtempSync(join(tmpdir(), "gsc-cache-iso-"));
  process.chdir(tmpDir);
  _tenantMap = new Map([
    [TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG)],
    [TENANT_B_ID, makeTenant(TENANT_B_ID, TENANT_B_SLUG)],
  ]);
  _googleToken = makeGoogleToken();
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

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("gsc client — cache tenant isolation", () => {
  it("cache file path uses the tenant slug", () => {
    const pathA = __testing.cacheFilePathForSlug(TENANT_A_SLUG);
    const pathB = __testing.cacheFilePathForSlug(TENANT_B_SLUG);
    expect(pathA).toContain(join(".data", "tenants", TENANT_A_SLUG));
    expect(pathA).toContain("gsc-url-inspections.json");
    expect(pathB).toContain(join(".data", "tenants", TENANT_B_SLUG));
    expect(pathA).not.toBe(pathB);
  });

  it("tenant A's request does NOT read tenant B's cache (and vice versa)", async () => {
    // Both tenants have seeded fresh cache entries at the SAME URL key
    // but with DIFFERENT payload markers. Each request must read only
    // its own tenant's cache.
    seedCache(tmpDir, TENANT_A_SLUG, SHARED_INSPECTION_URL, "ALPHA_PAYLOAD");
    seedCache(tmpDir, TENANT_B_SLUG, SHARED_INSPECTION_URL, "BRAVO_PAYLOAD");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outA = await gscUrlInspect({
      tenantId: TENANT_A_ID,
      siteUrl: SITE_URL_A,
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });
    const outB = await gscUrlInspect({
      tenantId: TENANT_B_ID,
      siteUrl: SITE_URL_B,
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outA).not.toBeNull();
    expect(outB).not.toBeNull();
    expect(outA!.coverage_state).toBe("ALPHA_PAYLOAD");
    expect(outB!.coverage_state).toBe("BRAVO_PAYLOAD");
    expect((outA!.raw as { tenant_marker: string }).tenant_marker).toBe(
      "ALPHA_PAYLOAD",
    );
    expect((outB!.raw as { tenant_marker: string }).tenant_marker).toBe(
      "BRAVO_PAYLOAD",
    );
  });

  it("a fresh write by tenant A does NOT mutate tenant B's cache file", async () => {
    // Seed tenant B with a known marker. Tenant A starts empty.
    seedCache(tmpDir, TENANT_B_SLUG, SHARED_INSPECTION_URL, "BRAVO_UNTOUCHED");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          inspectionResult: {
            indexStatusResult: {
              indexingState: "INDEXING_ALLOWED",
              coverageState: "ALPHA_FRESH_WRITE",
              lastCrawlTime: "2026-05-15T07:00:00.000Z",
            },
          },
        }),
      })),
    );

    await gscUrlInspect({
      tenantId: TENANT_A_ID,
      siteUrl: SITE_URL_A,
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });

    const fileA = join(
      tmpDir,
      ".data",
      "tenants",
      TENANT_A_SLUG,
      "gsc-url-inspections.json",
    );
    const fileB = join(
      tmpDir,
      ".data",
      "tenants",
      TENANT_B_SLUG,
      "gsc-url-inspections.json",
    );
    expect(existsSync(fileA)).toBe(true);
    expect(existsSync(fileB)).toBe(true);

    const cacheA = JSON.parse(readFileSync(fileA, "utf-8"));
    const cacheB = JSON.parse(readFileSync(fileB, "utf-8"));

    expect(cacheA[SHARED_INSPECTION_URL].coverage_state).toBe("ALPHA_FRESH_WRITE");
    // Tenant B's file is byte-for-byte untouched.
    expect(cacheB[SHARED_INSPECTION_URL].coverage_state).toBe("BRAVO_UNTOUCHED");
    expect((cacheB[SHARED_INSPECTION_URL].raw as { tenant_marker: string }).tenant_marker).toBe(
      "BRAVO_UNTOUCHED",
    );
  });

  it("explicit tenantId controls the cache path (ambient env does NOT override for non-bootstrap tenants)", async () => {
    // Set the operator-bootstrap env to tenant A's id+slug. The locked
    // resolver only fires the env fallback when the EXPLICIT tenantId
    // matches BEACON_TENANT_ID. If we pass tenant B's id, the resolver
    // must use B's registered slug (NOT A's env-supplied slug) — and
    // because B's slug is registered, the env never even fires.
    process.env.BEACON_TENANT_ID = TENANT_A_ID;
    process.env.BEACON_TENANT_SLUG = TENANT_A_SLUG;

    seedCache(tmpDir, TENANT_B_SLUG, SHARED_INSPECTION_URL, "BRAVO_VIA_REGISTRY");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const outB = await gscUrlInspect({
      tenantId: TENANT_B_ID,
      siteUrl: SITE_URL_B,
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outB).not.toBeNull();
    expect(outB!.coverage_state).toBe("BRAVO_VIA_REGISTRY");
  });

  it("operator-bootstrap env fallback fires ONLY for the matching tenantId", async () => {
    // Remove tenant C from the registry; provide bootstrap env that
    // matches C's id. Resolver should use the env-supplied slug for C.
    // For an UNRELATED unknown tenant id (D), resolver returns null
    // and gscUrlInspect returns null (no cache read, no fetch).
    const BOOTSTRAP_ID = "tenant-charlie";
    const BOOTSTRAP_SLUG = "charlie";
    process.env.BEACON_TENANT_ID = BOOTSTRAP_ID;
    process.env.BEACON_TENANT_SLUG = BOOTSTRAP_SLUG;

    seedCache(tmpDir, BOOTSTRAP_SLUG, SHARED_INSPECTION_URL, "CHARLIE_VIA_ENV");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Matching tenantId → env fallback fires, slug = "charlie".
    const outC = await gscUrlInspect({
      tenantId: BOOTSTRAP_ID,
      siteUrl: "sc-domain:charlie.example.com",
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });
    expect(outC).not.toBeNull();
    expect(outC!.coverage_state).toBe("CHARLIE_VIA_ENV");
    expect(fetchSpy).not.toHaveBeenCalled();

    // Non-matching, unregistered tenantId → resolver returns null →
    // gscUrlInspect returns null (no slug means no path means no read).
    const outD = await gscUrlInspect({
      tenantId: "tenant-delta-unknown",
      siteUrl: "sc-domain:delta.example.com",
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });
    expect(outD).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
