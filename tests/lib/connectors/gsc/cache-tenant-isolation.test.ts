/**
 * 2026-05-17 A.3.b2 — GSC client cache tenant-isolation tests
 * against the Supabase cache backend.
 *
 * Pins:
 *   • Tenant A's cache and tenant B's cache are independent rows in
 *     the same Supabase `gsc_url_inspections` table — keyed by the
 *     composite PK (tenant_id, inspection_url).
 *   • A request for tenant A NEVER reads tenant B's row (and vice
 *     versa) — even when both tenants have entries for the same
 *     inspection URL with distinguishable payloads.
 *   • A fresh fetch by tenant A upserts ONLY the tenant-A row;
 *     tenant B's row stays byte-equal.
 *   • The explicit `tenantId` argument is the ONLY thing that selects
 *     the cache row.
 *
 * Mirrors the `profound-import-runs-explicit-tenant-scope` discipline
 * (explicit-tenant beats ambient) PLUS the storage-layer composite-PK
 * isolation that connector-tokens uses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// In-memory Supabase mock
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
      const hits = _rows.filter((r) =>
        filters.every((f) => (r[f.col] as unknown) === f.val),
      );
      if (hits.length === 0) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: hits[0]!, error: null });
    },
    upsert(row: StoredRow): Promise<{ error: null }> {
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
const TENANT_B_ID = "tenant-bravo";

const SITE_URL_A = "sc-domain:alpha.example.com";
const SITE_URL_B = "sc-domain:bravo.example.com";
const SHARED_INSPECTION_URL = "https://example.com/services/whole-home-remodel";
const NOW = new Date("2026-05-17T12:00:00Z");

function makeGoogleToken(): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW.getTime() + 3600 * 1000,
    connected_at: NOW.toISOString(),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  };
}

function seedCache(args: {
  tenantId: string;
  inspectionUrl: string;
  siteUrl: string;
  marker: string;
  lastCheckedAt?: string;
}): void {
  _rows.push({
    tenant_id: args.tenantId,
    inspection_url: args.inspectionUrl,
    site_url: args.siteUrl,
    indexing_state: "INDEXING_ALLOWED",
    coverage_state: args.marker,
    last_crawl_time: "2026-04-01T00:00:00.000Z",
    last_checked_at:
      args.lastCheckedAt ?? new Date(NOW.getTime() - 60 * 1000).toISOString(),
    raw: { tenant_marker: args.marker },
    updated_at: new Date(NOW.getTime() - 60 * 1000).toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _rows = [];
  _googleToken = makeGoogleToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("gsc client — cache tenant isolation (Supabase backend)", () => {
  it("CACHE_TABLE is gsc_url_inspections (composite PK contract)", () => {
    expect(__testing.CACHE_TABLE).toBe("gsc_url_inspections");
  });

  it("tenant A's request does NOT read tenant B's cache row (and vice versa)", async () => {
    // Both tenants have fresh entries at the SAME inspection URL but
    // DIFFERENT payload markers. Each request reads only its own row.
    seedCache({
      tenantId: TENANT_A_ID,
      inspectionUrl: SHARED_INSPECTION_URL,
      siteUrl: SITE_URL_A,
      marker: "ALPHA_PAYLOAD",
    });
    seedCache({
      tenantId: TENANT_B_ID,
      inspectionUrl: SHARED_INSPECTION_URL,
      siteUrl: SITE_URL_B,
      marker: "BRAVO_PAYLOAD",
    });

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

  it("a fresh fetch by tenant A does NOT mutate tenant B's row", async () => {
    seedCache({
      tenantId: TENANT_B_ID,
      inspectionUrl: SHARED_INSPECTION_URL,
      siteUrl: SITE_URL_B,
      marker: "BRAVO_UNTOUCHED",
    });

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

    // Tenant A's row is now present with the fresh write.
    const rowA = _rows.find(
      (r) => r.tenant_id === TENANT_A_ID && r.inspection_url === SHARED_INSPECTION_URL,
    );
    expect(rowA).toBeDefined();
    expect(rowA!.coverage_state).toBe("ALPHA_FRESH_WRITE");

    // Tenant B's row is byte-for-byte unchanged.
    const rowB = _rows.find(
      (r) => r.tenant_id === TENANT_B_ID && r.inspection_url === SHARED_INSPECTION_URL,
    );
    expect(rowB).toBeDefined();
    expect(rowB!.coverage_state).toBe("BRAVO_UNTOUCHED");
    expect((rowB!.raw as { tenant_marker: string }).tenant_marker).toBe(
      "BRAVO_UNTOUCHED",
    );
  });

  it("explicit tenantId controls the cache row (no ambient resolution)", async () => {
    // Seed tenant B's row only. Even if the caller's environment were
    // configured for tenant A, passing tenantId=B as the explicit arg
    // must select tenant B's row.
    seedCache({
      tenantId: TENANT_B_ID,
      inspectionUrl: SHARED_INSPECTION_URL,
      siteUrl: SITE_URL_B,
      marker: "BRAVO_VIA_EXPLICIT",
    });

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
    expect(outB!.coverage_state).toBe("BRAVO_VIA_EXPLICIT");
  });

  it("an unknown tenantId with no seeded row triggers fresh fetch — no cross-tenant leakage", async () => {
    // Seed only tenant A. Request for tenant B (no row) must NOT
    // bleed into tenant A's row via any ambient/fallback path; it
    // should issue a fresh fetch.
    seedCache({
      tenantId: TENANT_A_ID,
      inspectionUrl: SHARED_INSPECTION_URL,
      siteUrl: SITE_URL_A,
      marker: "ALPHA_PRESENT",
    });

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        inspectionResult: {
          indexStatusResult: {
            indexingState: "INDEXING_ALLOWED",
            coverageState: "BRAVO_FRESH",
            lastCrawlTime: "2026-05-15T07:00:00.000Z",
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const outB = await gscUrlInspect({
      tenantId: TENANT_B_ID,
      siteUrl: SITE_URL_B,
      inspectionUrl: SHARED_INSPECTION_URL,
      now: NOW,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(outB).not.toBeNull();
    expect(outB!.coverage_state).toBe("BRAVO_FRESH");
    // Critical: tenant B's response is NOT tenant A's data.
    expect(outB!.coverage_state).not.toBe("ALPHA_PRESENT");
  });
});
