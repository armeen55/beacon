/**
 * 2026-05-18 — Section 8 J-block client wiring tests.
 *
 * Companion to `client.test.ts` covering the J2 / J4 / J5 surface
 * additions:
 *   • J4 — `extractMobileUsability(raw)` truth table across the
 *     GSC API verdict tokens + cache-read path mirrors the
 *     fresh-fetch result.
 *   • J2 — `gscUrlInspect` returns cached entry (surfaces stale
 *     state) when token is `stale_over_7d`; never calls fetch.
 *   • J5 — `gscUrlInspect` returns cached entry when token's
 *     `disconnected_at` is set; never calls fetch.
 *
 * Reuses the mock pattern from the existing client.test.ts (mocks
 * Supabase admin + getGoogleConnectorToken + refreshGoogleAccessToken
 * + fetch).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _gscToken: GoogleConnectorToken | null = null;
let _cachedEntryRow: Record<string, unknown> | null = null;
let _fetchCalls = 0;
let _upsertCalls = 0;

vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: vi.fn(async () => _gscToken),
  // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): rotated-refresh-token persist. No-op.
  persistRefreshedGoogleToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: vi.fn(async () => ({
    access_token: "refreshed-access",
    expires_at: Date.now() + 3600_000,
  })),
}));

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: _cachedEntryRow,
              error: null,
            }),
          }),
        }),
      }),
      upsert: async () => {
        _upsertCalls++;
        return { error: null };
      },
    }),
  }),
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    _fetchCalls++;
    return new Response(
      JSON.stringify({
        inspectionResult: {
          indexStatusResult: {
            indexingState: "INDEXING_ALLOWED",
            coverageState: "Submitted and indexed",
            lastCrawlTime: "2026-05-15T08:00:00.000Z",
          },
          mobileUsabilityResult: {
            verdict: "MOBILE_FRIENDLY",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
);

import {
  gscUrlInspect,
  mapInspectionResponse,
  extractMobileUsability,
} from "@/lib/connectors/gsc/client";

// ─────────────────────────────────────────────────────────────────────
// Fixtures + reset
// ─────────────────────────────────────────────────────────────────────

const TENANT = "tenant-test";
const SITE_URL = "sc-domain:example.com";
const INSPECTION_URL = "https://example.com/page";

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: Date.now() + 60 * 60 * 1000, // fresh
    connected_at: new Date().toISOString(),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    ...over,
  };
}

function cachedRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: TENANT,
    inspection_url: INSPECTION_URL,
    site_url: SITE_URL,
    indexing_state: "INDEXING_ALLOWED",
    coverage_state: "Submitted and indexed",
    last_crawl_time: "2026-05-15T08:00:00.000Z",
    last_checked_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // stale (>24h)
    raw: {
      inspectionResult: {
        mobileUsabilityResult: { verdict: "MOBILE_FRIENDLY" },
      },
    },
    ...over,
  };
}

beforeEach(() => {
  _gscToken = null;
  _cachedEntryRow = null;
  _fetchCalls = 0;
  _upsertCalls = 0;
});

// ─────────────────────────────────────────────────────────────────────
// J4 — extractMobileUsability truth table
// ─────────────────────────────────────────────────────────────────────

describe("extractMobileUsability — J4 truth table", () => {
  it("returns true for MOBILE_FRIENDLY", () => {
    expect(
      extractMobileUsability({
        inspectionResult: {
          mobileUsabilityResult: { verdict: "MOBILE_FRIENDLY" },
        },
      }),
    ).toBe(true);
  });

  it("returns false for NON_MOBILE_FRIENDLY", () => {
    expect(
      extractMobileUsability({
        inspectionResult: {
          mobileUsabilityResult: { verdict: "NON_MOBILE_FRIENDLY" },
        },
      }),
    ).toBe(false);
  });

  it("returns false for MOBILE_USABILITY_FAILED", () => {
    expect(
      extractMobileUsability({
        inspectionResult: {
          mobileUsabilityResult: { verdict: "MOBILE_USABILITY_FAILED" },
        },
      }),
    ).toBe(false);
  });

  it("returns null for VERDICT_UNSPECIFIED", () => {
    expect(
      extractMobileUsability({
        inspectionResult: {
          mobileUsabilityResult: { verdict: "VERDICT_UNSPECIFIED" },
        },
      }),
    ).toBe(null);
  });

  it("returns null when mobileUsabilityResult is absent", () => {
    expect(
      extractMobileUsability({
        inspectionResult: { indexStatusResult: { indexingState: "X" } },
      }),
    ).toBe(null);
  });

  it("returns null when inspectionResult is absent", () => {
    expect(extractMobileUsability({})).toBe(null);
  });

  it("returns null for non-object / null / wrong-type", () => {
    expect(extractMobileUsability(null)).toBe(null);
    expect(extractMobileUsability(undefined)).toBe(null);
    expect(extractMobileUsability("string")).toBe(null);
    expect(extractMobileUsability(42)).toBe(null);
  });

  it("returns null when verdict is non-string", () => {
    expect(
      extractMobileUsability({
        inspectionResult: { mobileUsabilityResult: { verdict: true } },
      }),
    ).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// J4 — mapInspectionResponse populates mobile_usability
// ─────────────────────────────────────────────────────────────────────

describe("mapInspectionResponse — J4 mobile_usability extraction", () => {
  it("populates mobile_usability=true on a MOBILE_FRIENDLY response", () => {
    const result = mapInspectionResponse({
      body: {
        inspectionResult: {
          indexStatusResult: { indexingState: "INDEXING_ALLOWED" },
          mobileUsabilityResult: { verdict: "MOBILE_FRIENDLY" },
        },
      },
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      nowIso: "2026-05-18T12:00:00.000Z",
    });
    expect(result.mobile_usability).toBe(true);
  });

  it("populates mobile_usability=null when the field is absent", () => {
    const result = mapInspectionResponse({
      body: { inspectionResult: {} },
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
      nowIso: "2026-05-18T12:00:00.000Z",
    });
    expect(result.mobile_usability).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// J2 — stale_over_7d returns cached state without fetching
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — J2 token stale_over_7d", () => {
  it("returns cached entry (regardless of TTL) and does NOT call fetch", async () => {
    // Token expired 10 days ago → stale_over_7d.
    _gscToken = makeToken({
      expires_at: Date.now() - 10 * 24 * 60 * 60 * 1000,
    });
    _cachedEntryRow = cachedRow();
    const result = await gscUrlInspect({
      tenantId: TENANT,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
    });
    expect(result).not.toBeNull();
    expect(result?.indexing_state).toBe("INDEXING_ALLOWED");
    // J4 cache-derived mobile_usability from cached raw.
    expect(result?.mobile_usability).toBe(true);
    expect(_fetchCalls).toBe(0);
    expect(_upsertCalls).toBe(0);
  });

  it("returns null when stale_over_7d AND no cached entry exists", async () => {
    _gscToken = makeToken({
      expires_at: Date.now() - 10 * 24 * 60 * 60 * 1000,
    });
    _cachedEntryRow = null;
    const result = await gscUrlInspect({
      tenantId: TENANT,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
    });
    expect(result).toBeNull();
    expect(_fetchCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// J5 — disconnected_at returns cached state without fetching
// ─────────────────────────────────────────────────────────────────────

describe("gscUrlInspect — J5 soft-disconnect", () => {
  it("returns cached entry when token.disconnected_at is set", async () => {
    _gscToken = makeToken({
      disconnected_at: "2026-05-10T08:00:00.000Z",
    });
    _cachedEntryRow = cachedRow();
    const result = await gscUrlInspect({
      tenantId: TENANT,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
    });
    expect(result).not.toBeNull();
    expect(result?.indexing_state).toBe("INDEXING_ALLOWED");
    expect(_fetchCalls).toBe(0);
  });

  it("returns null when disconnected_at is set AND no cached entry", async () => {
    _gscToken = makeToken({
      disconnected_at: "2026-05-10T08:00:00.000Z",
    });
    _cachedEntryRow = null;
    const result = await gscUrlInspect({
      tenantId: TENANT,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
    });
    expect(result).toBeNull();
    expect(_fetchCalls).toBe(0);
  });

  it("ignores empty-string disconnected_at (treated as not disconnected)", async () => {
    // Use a STALE cached entry (>24h) so we fall through to the
    // fresh-fetch branch and the test can assert fetch fires.
    _gscToken = makeToken({ disconnected_at: "" });
    _cachedEntryRow = cachedRow();
    const result = await gscUrlInspect({
      tenantId: TENANT,
      siteUrl: SITE_URL,
      inspectionUrl: INSPECTION_URL,
    });
    expect(result).not.toBeNull();
    // Fresh fetch fires because TTL was stale + token is fresh.
    expect(_fetchCalls).toBe(1);
  });
});
