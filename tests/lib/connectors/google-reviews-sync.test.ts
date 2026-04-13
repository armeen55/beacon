import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { readLocalReviews } from "@/lib/local-reviews-store";
import type { LocalReview } from "@/lib/local-reviews-types";
import {
  _deleteStoreFile,
  _resetCache,
  saveConnectorToken,
  getGoogleConnectorToken,
  type GoogleConnectorToken,
} from "@/lib/connector-store";
import {
  runGoogleReviewsSync,
  fetchGoogleLocations,
} from "@/lib/connectors/google-reviews-sync";
import type { ImportRun } from "@/lib/import/types";

function jsonResponse(obj: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function baseToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google",
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

const gbpReview = {
  reviewId: "rev-sync-1",
  starRating: "FOUR",
  createTime: "2026-04-10T10:00:00.000Z",
  comment: "Solid",
  reviewer: { displayName: "Pat" },
};

describe("runGoogleReviewsSync", () => {
  beforeEach(async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    vi.unstubAllGlobals();
    _deleteStoreFile();
    _resetCache();
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _deleteStoreFile();
    _resetCache();
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
  });

  it("fetches reviews for the selected location and records import run + last_synced_at", async () => {
    saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.partial).toBe(false);

    const rows = readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("google:rev-sync-1");
    expect(rows[0]!.rating).toBe(4);
    expect(rows[0]!.listing_name).toBe("Beacon Test Location");

    expect(getGoogleConnectorToken()?.last_synced_at).toBeTruthy();

    const runs = readStore<ImportRun>("import-runs", []);
    const gbpRun = runs.find((r) => r.source_system === "connector:google");
    expect(gbpRun).toBeDefined();
    expect(gbpRun!.imported_count).toBe(1);
  });

  it("dedupes by id: connector row overwrites same google:id", async () => {
    const existing: LocalReview = {
      id: "google:rev-sync-1",
      source: "google",
      rating: 2,
      created_at: "2020-01-01",
    };
    await writeStore("local-reviews", [existing]);
    saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    const rows = readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(4);
  });

  it("counts rejected invalid rows and still merges valid ones", async () => {
    saveConnectorToken(baseToken());
    const bad = { reviewId: "bad", starRating: "INVALID", createTime: "2026-01-01T00:00:00Z" };
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [bad, gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(1);
    expect(readLocalReviews()).toHaveLength(1);
  });

  it("returns reconnect when token refresh fails", async () => {
    saveConnectorToken(
      baseToken({ expires_at: Date.now() - 1000, refresh_token: "rt" }),
    );
    vi.stubGlobal("fetch", () =>
      jsonResponse({ error: "invalid_grant" }, 400),
    );

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("reconnect");
  });

  it("refreshes expired access then completes sync", async () => {
    saveConnectorToken(
      baseToken({ expires_at: Date.now() - 1000, access_token: "old" }),
    );

    const chain: Promise<Response>[] = [
      jsonResponse({
        access_token: "new-access",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "x",
      }),
      jsonResponse({ reviews: [gbpReview] }),
    ];
    let n = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return chain[n++]!;
      return chain[n++]!;
    });

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    expect(getGoogleConnectorToken()?.access_token).toBe("new-access");
  });

  it("returns no_location when selected_location_id is not set", async () => {
    saveConnectorToken(baseToken({
      selected_location_id: undefined,
      selected_location_name: undefined,
    }));
    vi.stubGlobal("fetch", () => jsonResponse({}));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_location");
    expect(result.message).toMatch(/Select a location/i);
  });

  it("returns sync_failed on reviews 500", async () => {
    saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () =>
      jsonResponse({ error: { message: "Internal" } }, 500),
    );

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.partial).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(getGoogleConnectorToken()?.last_synced_at).toBeTruthy();
  });

  it("returns not_connected when no token", async () => {
    vi.stubGlobal("fetch", () => jsonResponse({}));
    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_connected");
  });

  it("selection persists after sync", async () => {
    const lid = "accounts/x/locations/sel1";
    const lname = "My Selected Loc";
    saveConnectorToken(baseToken({
      selected_location_id: lid,
      selected_location_name: lname,
    }));
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    await runGoogleReviewsSync();
    const tok = getGoogleConnectorToken()!;
    expect(tok.selected_location_id).toBe(lid);
    expect(tok.selected_location_name).toBe(lname);
  });
});

describe("fetchGoogleLocations", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.unstubAllGlobals();
    _deleteStoreFile();
    _resetCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _deleteStoreFile();
    _resetCache();
  });

  it("returns locations from multiple accounts", async () => {
    saveConnectorToken(baseToken());
    const responses: Promise<Response>[] = [
      jsonResponse({ accounts: [{ name: "accounts/a1" }] }),
      jsonResponse({
        locations: [
          { name: "accounts/a1/locations/L1", title: "Loc One", address: { locality: "City" } },
          { name: "accounts/a1/locations/L2", title: "Loc Two" },
        ],
      }),
    ];
    let i = 0;
    vi.stubGlobal("fetch", () => responses[i++] ?? jsonResponse({}, 404));

    const result = await fetchGoogleLocations();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locations).toHaveLength(2);
    expect(result.locations[0]!.locationId).toBe("accounts/a1/locations/L1");
    expect(result.locations[0]!.locationName).toBe("Loc One");
    expect(result.locations[0]!.address).toBe("City");
    expect(result.locations[1]!.address).toBeNull();
  });

  it("returns not_connected when no token", async () => {
    const result = await fetchGoogleLocations();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_connected");
  });

  it("returns empty array when no accounts", async () => {
    saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ accounts: [] }));

    const result = await fetchGoogleLocations();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locations).toHaveLength(0);
  });

  it("returns fetch_failed on account list 500", async () => {
    saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ error: { message: "boom" } }, 500));

    const result = await fetchGoogleLocations();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("fetch_failed");
  });
});
