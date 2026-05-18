import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { readLocalReviews } from "@/lib/local-reviews-store";
import type { LocalReview } from "@/lib/local-reviews-types";
import type { ConnectorToken, YelpConnectorToken } from "@/lib/connector-store";

// 2026-05-16 connector-tokens-supabase-and-gsc-scope-split:
// in-memory mock of the new async connector-store API.
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
  getYelpConnectorToken,
} from "@/lib/connector-store";
import { runYelpReviewsSync } from "@/lib/connectors/yelp-reviews-sync";
import type { ImportRun } from "@/lib/import/types";

const yelpCfg = vi.hoisted(() => ({ yelpBusinessId: "test-yelp-biz" }));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({ yelpBusinessId: yelpCfg.yelpBusinessId }),
}));

function jsonResponse(obj: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
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

const fusionReview = {
  id: "yr-1",
  rating: 5,
  text: "Excellent",
  time_created: "2026-04-10T10:00:00.000Z",
  user: { name: "Alex" },
};

// Phase 7.7b Commit 2 (2026-04-25): see google-reviews-sync.test.ts for
// the rationale. json-store's anti-race guard lets cross-test pollution
// leak past `writeStore("import-runs", [])`; force-unlink the file first
// so the empty-write actually clears it.
function forceClearImportRunsFile(): void {
  const candidates = [
    join(process.cwd(), ".data", "import-runs.json"),
    // Phase 7.8b-2-d (2026-04-26): tenant-aware json-store routing — see
    // google-reviews-sync.test.ts for the same dual-clear rationale.
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

describe("runYelpReviewsSync", () => {
  beforeEach(async () => {
    yelpCfg.yelpBusinessId = "test-yelp-biz";
    vi.unstubAllGlobals();
    _resetTokenStore();
    forceClearImportRunsFile();
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    _resetTokenStore();
    forceClearImportRunsFile();
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
  });

  it("fetches business + reviews, merges, records import run and last_synced_at", async () => {
    await saveConnectorToken(yelpToken());

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v3/businesses/") && !url.includes("/reviews")) {
        return jsonResponse({ name: "Beacon Test Yelp" });
      }
      if (url.includes("/reviews")) {
        return jsonResponse({ reviews: [fusionReview] });
      }
      return jsonResponse({}, 404);
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.partial).toBe(false);

    const rows = await readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("yelp:yr-1");
    expect(rows[0]!.source).toBe("yelp");
    expect(rows[0]!.rating).toBe(5);
    expect(rows[0]!.listing_name).toBe("Beacon Test Yelp");

    expect((await getYelpConnectorToken())?.last_synced_at).toBeTruthy();

    const runs = await readStore<ImportRun>("import-runs", []);
    const yelpRun = runs.find((r) => r.source_system === "connector:yelp");
    expect(yelpRun).toBeDefined();
    expect(yelpRun!.imported_count).toBe(1);
  });

  it("dedupes by id: new Yelp row overwrites same yelp:id", async () => {
    const existing: LocalReview = {
      id: "yelp:yr-1",
      source: "yelp",
      rating: 2,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    await writeStore("local-reviews", [existing]);
    await saveConnectorToken(yelpToken());

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/reviews")) {
        return jsonResponse({ reviews: [fusionReview] });
      }
      return jsonResponse({ name: "L" });
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(true);
    const rows = await readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(5);
  });

  it("merges alongside other sources without deleting them", async () => {
    const googleRow: LocalReview = {
      id: "google:g1",
      source: "google",
      rating: 4,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    await writeStore("local-reviews", [googleRow]);
    await saveConnectorToken(yelpToken());

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/reviews")) {
        return jsonResponse({ reviews: [fusionReview] });
      }
      return jsonResponse({ name: "N" });
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(true);
    const rows = await readLocalReviews();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["google:g1", "yelp:yr-1"]);
  });

  it("counts rejected invalid rows and still merges valid ones", async () => {
    await saveConnectorToken(yelpToken());
    const bad = {
      id: "bad",
      rating: 99,
      time_created: "2026-01-01T00:00:00Z",
    };

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/reviews")) {
        return jsonResponse({ reviews: [bad, fusionReview] });
      }
      return jsonResponse({});
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(1);
    expect(await readLocalReviews()).toHaveLength(1);
  });

  it("returns partial with warnings when business details fail but reviews succeed", async () => {
    await saveConnectorToken(yelpToken());

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v3/businesses/") && !url.includes("/reviews")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      if (url.includes("/reviews")) {
        return jsonResponse({ reviews: [fusionReview] });
      }
      return jsonResponse({}, 404);
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.partial).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    const rows = await readLocalReviews();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.listing_name).toBeUndefined();
    expect((await getYelpConnectorToken())?.last_synced_at).toBeTruthy();
  });

  it("returns invalid_key on 401 from business fetch", async () => {
    await saveConnectorToken(yelpToken());
    vi.stubGlobal("fetch", () => jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401));

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_key");
    expect(result.message).toMatch(/Invalid Yelp API key/i);
  });

  it("returns invalid_key on 401 from reviews fetch", async () => {
    await saveConnectorToken(yelpToken());
    let n = 0;
    vi.stubGlobal("fetch", () => {
      n += 1;
      if (n === 1) return jsonResponse({ name: "X" });
      return jsonResponse({ error: {} }, 401);
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_key");
  });

  it("returns sync_failed on reviews 500", async () => {
    await saveConnectorToken(yelpToken());
    let p = 0;
    vi.stubGlobal("fetch", () => {
      p += 1;
      if (p === 1) return jsonResponse({ name: "X" });
      return jsonResponse({ error: { description: "Internal" } }, 500);
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("sync_failed");
  });

  it("returns rate-limit message on 429", async () => {
    await saveConnectorToken(yelpToken());
    let p = 0;
    vi.stubGlobal("fetch", () => {
      p += 1;
      if (p === 1) return jsonResponse({ name: "X" });
      return jsonResponse({}, 429);
    });

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("sync_failed");
    expect(result.message).toMatch(/rate limit/i);
  });

  it("returns not_connected when no Yelp token", async () => {
    vi.stubGlobal("fetch", () => jsonResponse({}));
    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_connected");
  });

  it("returns sync_failed when business id missing in config and token", async () => {
    yelpCfg.yelpBusinessId = "";
    await saveConnectorToken(yelpToken({ business_id: "" }));

    const result = await runYelpReviewsSync();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("sync_failed");
    expect(result.message).toMatch(/Yelp business ID/i);
  });
});
