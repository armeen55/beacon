import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { readLocalReviews } from "@/lib/local-reviews-store";
import type { LocalReview } from "@/lib/local-reviews-types";
import type { ConnectorToken, GoogleConnectorToken } from "@/lib/connector-store";

// 2026-05-16 connector-tokens-supabase-and-gsc-scope-split:
// replaced disk-backed sync API with async Supabase API. Mock in-memory
// for this test so assertions still target the legacy GBP review-sync
// behavior (provider renamed `google` → `google_gbp`).
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
        _tokenStore.set(provider, { ...existing, ...patch } as ConnectorToken);
      },
    ),
    deleteConnectorToken: vi.fn(async (provider: string) => {
      _tokenStore.delete(provider);
    }),
  };
});

import {
  saveConnectorToken,
  getGoogleConnectorToken,
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

const gbpReview = {
  reviewId: "rev-sync-1",
  starRating: "FOUR",
  createTime: "2026-04-10T10:00:00.000Z",
  comment: "Solid",
  reviewer: { displayName: "Pat" },
};

// Phase 7.7b Commit 2 (2026-04-25): json-store has an anti-race guard
// that refuses to overwrite a non-empty `import-runs.json` with `[]`
// (see src/lib/persistence/json-store.ts:105). Cross-test pollution
// from other suites (e.g. local-presence.test.ts stamping `tenant-test`)
// can therefore leak past the standard `writeStore([])` reset and trip
// the new tenantizeRows validation in `syncImportRuns`. Force-delete the
// file before each test so the guard's `existsSync` short-circuits and
// the empty write succeeds.
function forceClearImportRunsFile(): void {
  const candidates = [
    join(process.cwd(), ".data", "import-runs.json"),
    // Phase 7.8b-2-d (2026-04-26): tenant-aware json-store routing now writes
    // import-runs to `.data/tenants/<slug>/import-runs.json`. Cross-test
    // pollution can land in either path; clear both.
    join(process.cwd(), ".data", "tenants", "ritz-builders", "import-runs.json"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Best-effort; the writeStore below will still attempt a clean overwrite.
      }
    }
  }
}

describe("runGoogleReviewsSync", () => {
  beforeEach(async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    vi.unstubAllGlobals();
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

  it("fetches reviews for the selected location and records import run + last_synced_at", async () => {
    await saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.partial).toBe(false);

    const rows = await readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("google:rev-sync-1");
    expect(rows[0]!.rating).toBe(4);
    expect(rows[0]!.listing_name).toBe("Beacon Test Location");

    expect((await getGoogleConnectorToken("gbp"))?.last_synced_at).toBeTruthy();

    const runs = await readStore<ImportRun>("import-runs", []);
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
    await saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    const rows = await readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(4);
  });

  it("counts rejected invalid rows and still merges valid ones", async () => {
    await saveConnectorToken(baseToken());
    const bad = { reviewId: "bad", starRating: "INVALID", createTime: "2026-01-01T00:00:00Z" };
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [bad, gbpReview] }));

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(1);
    expect(await readLocalReviews()).toHaveLength(1);
  });

  it("returns reconnect when token refresh fails", async () => {
    await saveConnectorToken(
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
    await saveConnectorToken(
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
    expect((await getGoogleConnectorToken("gbp"))?.access_token).toBe("new-access");
  });

  it("returns no_location when selected_location_id is not set", async () => {
    await saveConnectorToken(baseToken({
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
    await saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () =>
      jsonResponse({ error: { message: "Internal" } }, 500),
    );

    const result = await runGoogleReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.partial).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect((await getGoogleConnectorToken("gbp"))?.last_synced_at).toBeTruthy();
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
    await saveConnectorToken(baseToken({
      selected_location_id: lid,
      selected_location_name: lname,
    }));
    vi.stubGlobal("fetch", () => jsonResponse({ reviews: [gbpReview] }));

    await runGoogleReviewsSync();
    const tok = (await getGoogleConnectorToken("gbp"))!;
    expect(tok.selected_location_id).toBe(lid);
    expect(tok.selected_location_name).toBe(lname);
  });
});

describe("fetchGoogleLocations", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.unstubAllGlobals();
    _resetTokenStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _resetTokenStore();
  });

  it("returns locations from multiple accounts", async () => {
    await saveConnectorToken(baseToken());
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
    await saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ accounts: [] }));

    const result = await fetchGoogleLocations();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locations).toHaveLength(0);
  });

  it("returns fetch_failed on account list 500", async () => {
    await saveConnectorToken(baseToken());
    vi.stubGlobal("fetch", () => jsonResponse({ error: { message: "boom" } }, 500));

    const result = await fetchGoogleLocations();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("fetch_failed");
  });
});
