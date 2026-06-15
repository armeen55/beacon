/**
 * #113 — Profound silent-cap honesty (2026-06-15).
 *
 * The Profound nightly sync caps how many topics (categories) it pulls
 * per run (MAX_CATEGORIES_PER_NIGHT). Before this fix the overflow was
 * only a server-side log.warn and the sync result returned the *capped*
 * count as `categories`, so the customer-facing "Sync now" card reported
 * a clean success while N topics were silently dropped.
 *
 * These tests pin the honest reporting: when the engine returns
 * categories_skipped > 0, the "Sync now" detail must say "Synced N of M
 * topics — K not pulled this run" instead of a clean success. When
 * nothing is dropped (categories_skipped: 0) the detail must NOT mention
 * the cap.
 *
 * Mocks every import-time dependency of the settings connectors actions
 * module so the test depends only on the summarizer + syncProfoundNow,
 * never Supabase or the live Profound API.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Mocks — only the Profound engine's return is varied per test.
// ─────────────────────────────────────────────────────────────────────

let _profound: unknown = { synced: true, categories: 0, categories_total: 0, categories_skipped: 0, citation_rows: 0, visibility_rows: 0, bot_rows: 0, referral_rows: 0 };

vi.mock("@/lib/connectors/profound/sync-nightly", () => ({
  syncProfoundNightlyForTenant: vi.fn(async () => _profound),
}));

// The other four sync engines are imported at module load — stub them so
// the module resolves. They are never called by syncProfoundNow.
vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({
  syncGscSearchAnalyticsForTenant: vi.fn(),
}));
vi.mock("@/lib/connectors/ga4/sync-url-traffic", () => ({
  syncGa4UrlTrafficForTenant: vi.fn(),
}));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({
  syncClarityDailyMetricsForTenant: vi.fn(),
}));
vi.mock("@/lib/connectors/semrush/sync-organic-keywords", () => ({
  syncSemrushOrganicKeywordsForTenant: vi.fn(),
}));

vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: vi.fn(async () => ({ status: "connected" })),
  deleteConnectorToken: vi.fn(async () => {}),
  saveConnectorToken: vi.fn(async () => {}),
  // updateConnectorToken stamps last_synced_at on success — best-effort no-op.
  updateConnectorToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/connectors/gsc/disconnect-flow", () => ({
  softDisconnectGsc: vi.fn(async () => ({ applied: false, disconnected_at: null })),
}));
vi.mock("@/lib/connectors/ga4/property-selection", () => ({
  listGa4PropertiesForTenant: vi.fn(),
}));
vi.mock("@/lib/connectors/google-auth", () => ({
  buildGoogleAuthUrl: vi.fn(),
  encodeOAuthState: vi.fn(),
  generateOAuthNonce: vi.fn(),
}));
vi.mock("@/lib/connectors/google-reviews-sync", () => ({
  runGoogleReviewsSync: vi.fn(),
  fetchGoogleLocations: vi.fn(),
}));
vi.mock("@/lib/connectors/yelp-reviews-sync", () => ({
  runYelpReviewsSync: vi.fn(),
}));
vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: vi.fn(async () => ({})),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));
vi.mock("@/lib/actions", () => ({
  now: () => "2026-06-15T12:00:00.000Z",
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Re-import after mocking.
import { syncProfoundNow } from "@/app/(shell)/settings/connectors/actions";

beforeEach(() => {
  _profound = { synced: true, categories: 0, categories_total: 0, categories_skipped: 0, citation_rows: 0, visibility_rows: 0, bot_rows: 0, referral_rows: 0 };
});

describe("syncProfoundNow — silent-cap honesty (#113)", () => {
  it("reports 'N of M topics' when the per-night cap dropped some", async () => {
    _profound = {
      synced: true,
      categories: 10,
      categories_total: 15,
      categories_skipped: 5,
      citation_rows: 120,
      visibility_rows: 40,
      bot_rows: 0,
      referral_rows: 0,
    };
    const r = await syncProfoundNow();
    expect(r.ok).toBe(true);
    // Honest disclosure: the customer sees that 5 of 15 topics were NOT pulled.
    expect(r.detail).toContain("Synced 10 of 15 topics");
    expect(r.detail).toContain("5 not pulled this run");
    // Still reports the rows it DID pull.
    expect(r.detail).toContain("120 rows");
  });

  it("does NOT mention the cap when every topic was pulled (categories_skipped: 0)", async () => {
    _profound = {
      synced: true,
      categories: 4,
      categories_total: 4,
      categories_skipped: 0,
      citation_rows: 33,
      visibility_rows: 8,
      bot_rows: 0,
      referral_rows: 0,
    };
    const r = await syncProfoundNow();
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("Synced 33 rows.");
    expect(r.detail).not.toMatch(/topics|not pulled/i);
  });

  it("a capped run with zero rows still discloses the dropped topics", async () => {
    _profound = {
      synced: true,
      categories: 10,
      categories_total: 12,
      categories_skipped: 2,
      citation_rows: 0,
      visibility_rows: 0,
      bot_rows: 0,
      referral_rows: 0,
    };
    const r = await syncProfoundNow();
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("Synced 10 of 12 topics");
    expect(r.detail).toContain("2 not pulled this run");
  });
});
