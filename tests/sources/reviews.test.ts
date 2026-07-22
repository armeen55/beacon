/**
 * SOURCES — reviews connectors (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/{google-reviews-sync, yelp-reviews-sync,
 * google-reviews-map, yelp-reviews-map}.
 *
 * Pinned boundaries (one happy-path + fail-closed per connector):
 *   • Google (GBP): happy sync records import run + last_synced_at; expired
 *     access refreshes then completes; refresh failure → reconnect; no token →
 *     not_connected; no location selected → no_location.
 *   • Yelp: happy sync merges with yelp: ids; 401 → invalid_key; no token →
 *     not_connected; missing business id → sync_failed.
 *   • Mappers reject invalid ratings/timestamps/ids and never fabricate rows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { readLocalReviews } from "@/lib/local-reviews-store";
import type { ConnectorToken, GoogleConnectorToken, YelpConnectorToken } from "@/lib/connector-store";

let _tokenStore: Map<string, ConnectorToken> = new Map();

function _resetTokenStore(): void {
  _tokenStore = new Map();
}

vi.mock("@/lib/connector-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/connector-store")>(
    "@/lib/connector-store",
  );
  return {
    ...actual,
    saveConnectorToken: vi.fn(async (token: ConnectorToken) => {
      _tokenStore.set(token.provider, token);
    }),
    getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" = "gsc") => {
      const key = kind === "gsc" ? "google_gsc" : "google_gbp";
      const t = _tokenStore.get(key);
      return t != null && (t.provider === "google_gsc" || t.provider === "google_gbp")
        ? (t as GoogleConnectorToken)
        : null;
    }),
    getYelpConnectorToken: vi.fn(async () => {
      const t = _tokenStore.get("yelp");
      return t != null && t.provider === "yelp" ? t : null;
    }),
    updateConnectorToken: vi.fn(
      async (provider: string, patch: Record<string, unknown>) => {
        const existing = _tokenStore.get(provider);
        if (!existing || existing.provider !== provider) return;
        // Mirror the SQL patch rule: a patch can NEVER touch refresh_token.
        const { refresh_token: _dropped, ...safePatch } = patch;
        void _dropped;
        _tokenStore.set(provider, { ...existing, ...safePatch } as ConnectorToken);
      },
    ),
    persistRefreshedGoogleToken: vi.fn(
      async (
        provider: string,
        refreshed: { access_token: string; expires_in: number; refresh_token?: string },
      ) => {
        const existing = _tokenStore.get(provider) as GoogleConnectorToken | undefined;
        if (existing == null || existing.provider !== provider) return;
        const newExpiresAt = Date.now() + refreshed.expires_in * 1000;
        if (existing.expires_at >= newExpiresAt) return;
        const merged: GoogleConnectorToken = {
          ...existing,
          access_token: refreshed.access_token,
          expires_at: newExpiresAt,
        };
        if (refreshed.refresh_token) merged.refresh_token = refreshed.refresh_token;
        _tokenStore.set(provider, merged as ConnectorToken);
      },
    ),
    deleteConnectorToken: vi.fn(async (provider: string) => {
      _tokenStore.delete(provider);
    }),
  };
});

const yelpCfg = vi.hoisted(() => ({ yelpBusinessId: "test-yelp-biz" }));
vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({ yelpBusinessId: yelpCfg.yelpBusinessId }),
  getBusinessConfigForCurrentTenant: async () => ({ yelpBusinessId: yelpCfg.yelpBusinessId }),
}));

import { saveConnectorToken, getGoogleConnectorToken, getYelpConnectorToken } from "@/lib/connector-store";
import { runGoogleReviewsSync } from "@/lib/connectors/google-reviews-sync";
import { runYelpReviewsSync } from "@/lib/connectors/yelp-reviews-sync";
import { mapGbpReviewToLocalReview } from "@/lib/connectors/google-reviews-map";
import { mapYelpReviewToLocalReview } from "@/lib/connectors/yelp-reviews-map";
import type { ImportRun } from "@/lib/import/types";

function jsonResponse(obj: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function gbpToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_gbp",
    access_token: "access-test",
    refresh_token: "1//refresh-test",
    expires_at: Date.now() + 3_600_000,
    connected_at: "2026-04-13T10:00:00Z",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    selected_location_id: "accounts/tst/locations/loc1",
    selected_location_name: "Beacon Test Location",
    ...over,
  };
}

function yelpToken(over: Partial<YelpConnectorToken> = {}): YelpConnectorToken {
  return {
    provider: "yelp",
    api_key: "yelp-key-test",
    connected_at: "2026-04-13T10:00:00Z",
    business_id: "",
    ...over,
  };
}

const gbpReview = {
  reviewId: "rev-sync-1",
  starRating: "FOUR",
  createTime: "2026-04-10T10:00:00.000Z",
  comment: "Solid",
  reviewer: { displayName: "Pat" },
};

const fusionReview = {
  id: "yr-1",
  rating: 5,
  text: "Excellent",
  time_created: "2026-04-10T10:00:00.000Z",
  user: { name: "Alex" },
};

// json-store's anti-race guard refuses to overwrite a non-empty
// import-runs.json with [] — force-unlink so the reset actually clears it.
function forceClearImportRunsFile(): void {
  const candidates = [
    join(process.cwd(), ".data", "import-runs.json"),
    join(process.cwd(), ".data", "tenants", "ritz-builders", "import-runs.json"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Best-effort.
      }
    }
  }
}

beforeEach(async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.unstubAllGlobals();
  yelpCfg.yelpBusinessId = "test-yelp-biz";
  _resetTokenStore();
  forceClearImportRunsFile();
  await writeStore("local-reviews", []);
  await writeStore("import-runs", []);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  _resetTokenStore();
  forceClearImportRunsFile();
  await writeStore("local-reviews", []);
  await writeStore("import-runs", []);
});

// ─────────────────────────────────────────────────────────────────────
// Google (GBP) reviews sync
// ─────────────────────────────────────────────────────────────────────

describe("runGoogleReviewsSync", () => {
  it("happy path: fetches reviews, merges, records import run + last_synced_at", async () => {
    await saveConnectorToken(gbpToken());
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(0);

    const rows = await readLocalReviews();
    expect(rows[0]!.id).toBe("google:rev-sync-1");
    expect(rows[0]!.rating).toBe(4);
    expect((await getGoogleConnectorToken("gbp"))?.last_synced_at).toBeTruthy();

    const runs = await readStore<ImportRun>("import-runs", []);
    expect(runs.find((r) => r.source_system === "connector:google")?.imported_count).toBe(1);
  });

  it("refreshes an expired access token then completes the sync (persisted token)", async () => {
    await saveConnectorToken(gbpToken({ expires_at: Date.now() - 1000, access_token: "old" }));
    const chain: Promise<Response>[] = [
      jsonResponse({ access_token: "new-access", expires_in: 3600, token_type: "Bearer", scope: "x" }),
      jsonResponse({ reviews: [gbpReview] }),
    ];
    let n = 0;
    vi.stubGlobal("fetch", () => chain[n++]!);

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    expect((await getGoogleConnectorToken("gbp"))?.access_token).toBe("new-access");
  });

  it("fail-closed: refresh failure → reconnect; no token → not_connected; no location → no_location", async () => {
    await saveConnectorToken(gbpToken({ expires_at: Date.now() - 1000, refresh_token: "rt" }));
    vi.stubGlobal("fetch", () => jsonResponse({ error: "invalid_grant" }, 400));
    const reconnect = await runGoogleReviewsSync();
    expect(reconnect.ok).toBe(false);
    if (!reconnect.ok) expect(reconnect.code).toBe("reconnect");

    _resetTokenStore();
    vi.stubGlobal("fetch", () => jsonResponse({}));
    const none = await runGoogleReviewsSync();
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.code).toBe("not_connected");

    await saveConnectorToken(
      gbpToken({ selected_location_id: undefined, selected_location_name: undefined }),
    );
    const noLoc = await runGoogleReviewsSync();
    expect(noLoc.ok).toBe(false);
    if (!noLoc.ok) expect(noLoc.code).toBe("no_location");
  });

  it("a reviews 500 degrades to partial with warnings (honest, not silent success)", async () => {
    await saveConnectorToken(gbpToken());
    vi.stubGlobal("fetch", () => jsonResponse({ error: { message: "Internal" } }, 500));
    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.partial).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Yelp reviews sync
// ─────────────────────────────────────────────────────────────────────

describe("runYelpReviewsSync", () => {
  it("happy path: fetches business + reviews, merges with yelp: ids, records the run", async () => {
    await saveConnectorToken(yelpToken());
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v3/businesses/") && !url.includes("/reviews")) {
        return jsonResponse({ name: "Beacon Test Yelp" });
      }
      if (url.includes("/reviews")) return jsonResponse({ reviews: [fusionReview] });
      return jsonResponse({}, 404);
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);

    const rows = await readLocalReviews();
    expect(rows[0]!.id).toBe("yelp:yr-1");
    expect(rows[0]!.listing_name).toBe("Beacon Test Yelp");
    expect((await getYelpConnectorToken())?.last_synced_at).toBeTruthy();
  });

  it("fail-closed: 401 → invalid_key; no token → not_connected; missing business id → sync_failed", async () => {
    await saveConnectorToken(yelpToken());
    vi.stubGlobal("fetch", () => jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401));
    const invalid = await runYelpReviewsSync();
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe("invalid_key");

    _resetTokenStore();
    vi.stubGlobal("fetch", () => jsonResponse({}));
    const none = await runYelpReviewsSync();
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.code).toBe("not_connected");

    yelpCfg.yelpBusinessId = "";
    await saveConnectorToken(yelpToken({ business_id: "" }));
    const noBiz = await runYelpReviewsSync();
    expect(noBiz.ok).toBe(false);
    if (!noBiz.ok) expect(noBiz.code).toBe("sync_failed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Mappers — reject invalid rows, never fabricate
// ─────────────────────────────────────────────────────────────────────

describe("mapGbpReviewToLocalReview", () => {
  const ctx = { listingTitle: "Test Shop", locationName: "accounts/1/locations/loc1" };

  it("maps a valid GBP review and extracts reviewId from name when missing", () => {
    const r = mapGbpReviewToLocalReview(
      {
        reviewId: "abc123",
        starRating: "FIVE",
        createTime: "2026-01-15T12:00:00.000Z",
        comment: "Great work",
        reviewer: { displayName: "Jane" },
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.id).toBe("google:abc123");
      expect(r.row.rating).toBe(5);
    }
    const fromName = mapGbpReviewToLocalReview(
      { name: "accounts/1/locations/l1/reviews/xyz789", starRating: "THREE", createTime: "2026-02-01T00:00:00Z" },
      ctx,
    );
    expect(fromName.ok).toBe(true);
    if (fromName.ok) expect(fromName.row.id).toBe("google:xyz789");
  });

  it("rejects missing id, invalid star rating, and invalid create time", () => {
    expect(
      mapGbpReviewToLocalReview({ starRating: "FIVE", createTime: "2026-01-01T00:00:00Z" }, ctx).ok,
    ).toBe(false);
    expect(
      mapGbpReviewToLocalReview(
        { reviewId: "r1", starRating: "NINETY", createTime: "2026-01-01T00:00:00Z" },
        ctx,
      ).ok,
    ).toBe(false);
    expect(
      mapGbpReviewToLocalReview({ reviewId: "r1", starRating: "FOUR", createTime: "not-a-date" }, ctx)
        .ok,
    ).toBe(false);
  });
});

describe("mapYelpReviewToLocalReview", () => {
  const ctx = { businessId: "acme-corp-sf", listingName: "Acme HQ" };

  it("maps a valid Fusion review with yelp: id and trims optional fields", () => {
    const m = mapYelpReviewToLocalReview(
      {
        id: "abc123",
        rating: 4,
        text: "  Solid work.  ",
        time_created: "2026-04-10T15:30:00.000Z",
        user: { name: "  Pat  " },
      },
      ctx,
    );
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.row.id).toBe("yelp:abc123");
      expect(m.row.review_text).toBe("Solid work.");
      expect(m.row.reviewer_name).toBe("Pat");
    }
  });

  it("rejects missing id, non-integer or out-of-range ratings, and invalid timestamps", () => {
    expect(
      mapYelpReviewToLocalReview({ rating: 5, time_created: "2026-01-01T00:00:00Z" }, ctx),
    ).toMatchObject({ ok: false, reason: "missing_review_id" });
    expect(
      mapYelpReviewToLocalReview({ id: "x", rating: 4.5, time_created: "2026-01-01T00:00:00Z" }, ctx),
    ).toMatchObject({ ok: false, reason: "invalid_rating" });
    expect(
      mapYelpReviewToLocalReview({ id: "x", rating: 6, time_created: "2026-01-01T00:00:00Z" }, ctx),
    ).toMatchObject({ ok: false, reason: "invalid_rating" });
    expect(
      mapYelpReviewToLocalReview({ id: "x", rating: 2, time_created: "not-a-date" }, ctx),
    ).toMatchObject({ ok: false, reason: "invalid_time_created" });
  });
});
