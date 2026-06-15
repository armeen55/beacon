/**
 * 2026-05-16 — connector-tokens-supabase-and-gsc-scope-split.
 *
 * Replaces the prior file-backed `tests/lib/connector-store.test.ts`
 * (DELETED). Targets the async Supabase-backed API:
 *
 *   getConnectorToken / getGoogleConnectorToken / getYelpConnectorToken
 *   saveConnectorToken / updateConnectorToken / deleteConnectorToken
 *   getConnectorInfo
 *
 * Pins:
 *   • Save → read round-trip via mocked Supabase admin client.
 *   • Tenant-scoped read returns null for a different tenantId.
 *   • Missing row returns null (no exception).
 *   • Missing table (PostgREST 42P01) returns null on READS,
 *     does NOT throw — soft-fail covers the deploy/migration window.
 *   • Provider discrimination: google_gsc and google_gbp are independent.
 *     A GSC write does NOT appear in a GBP read.
 *   • Write paths throw on Supabase error so OAuth callback persistence
 *     fails loudly.
 *   • Explicit `tenantId` parameter overrides ambient `currentTenantId()`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// In-memory Supabase admin client mock
// ─────────────────────────────────────────────────────────────────────

type StoredRow = {
  tenant_id: string;
  provider: string;
  payload: unknown;
  updated_at: string;
};

let _rows: StoredRow[] = [];
/** When set, every Supabase op returns this error and skips storage. */
let _forceError: { code?: string; message: string } | null = null;

function applyFilters(
  rows: StoredRow[],
  filters: Array<{ col: keyof StoredRow; val: string }>,
): StoredRow[] {
  return rows.filter((r) =>
    filters.every((f) => (r[f.col] as unknown) === f.val),
  );
}

function buildQueryBuilder(table: string) {
  const filters: Array<{ col: keyof StoredRow; val: string }> = [];
  let kind: "select" | "delete" | null = null;

  const builder = {
    select(_cols: string) {
      kind = "select";
      return builder;
    },
    eq(col: keyof StoredRow, val: string) {
      filters.push({ col, val });
      return builder;
    },
    maybeSingle() {
      if (table !== "connector_tokens") {
        return Promise.resolve({ data: null, error: null });
      }
      if (_forceError) {
        return Promise.resolve({ data: null, error: _forceError });
      }
      const hits = applyFilters(_rows, filters);
      if (hits.length === 0) {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({
        data: { payload: hits[0]!.payload },
        error: null,
      });
    },
    delete() {
      kind = "delete";
      return builder;
    },
    upsert(
      row: StoredRow,
      _opts: { onConflict?: string },
    ): Promise<{ error: { code?: string; message: string } | null }> {
      if (_forceError) return Promise.resolve({ error: _forceError });
      const idx = _rows.findIndex(
        (r) => r.tenant_id === row.tenant_id && r.provider === row.provider,
      );
      if (idx >= 0) _rows[idx] = row;
      else _rows.push(row);
      return Promise.resolve({ error: null });
    },
    // delete().eq().eq() chains end with a thenable
    then(resolve: (v: { error: unknown }) => void) {
      if (kind === "delete") {
        if (_forceError) return resolve({ error: _forceError });
        _rows = _rows.filter((r) => {
          for (const f of filters) {
            if ((r[f.col] as unknown) !== f.val) return true;
          }
          return false;
        });
        return resolve({ error: null });
      }
      return resolve({ error: null });
    },
  };
  return builder;
}

const mockAdmin = {
  from: (table: string) => buildQueryBuilder(table),
};

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-default"),
}));

import {
  getConnectorToken,
  getGoogleConnectorToken,
  getYelpConnectorToken,
  getConnectorInfo,
  getConnectorHealth,
  saveConnectorToken,
  updateConnectorToken,
  deleteConnectorToken,
  isTokenExpired,
  type GoogleConnectorToken,
  type YelpConnectorToken,
} from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function gscToken(overrides?: Partial<GoogleConnectorToken>): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "gsc-access",
    refresh_token: "gsc-refresh",
    expires_at: Date.now() + 3600_000,
    connected_at: "2026-05-16T10:00:00Z",
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    ...overrides,
  };
}

function gbpToken(overrides?: Partial<GoogleConnectorToken>): GoogleConnectorToken {
  return {
    provider: "google_gbp",
    access_token: "gbp-access",
    refresh_token: "gbp-refresh",
    expires_at: Date.now() + 3600_000,
    connected_at: "2026-05-16T10:00:00Z",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    ...overrides,
  };
}

function ga4Token(overrides?: Partial<GoogleConnectorToken>): GoogleConnectorToken {
  return {
    provider: "google_ga4",
    access_token: "ga4-access",
    refresh_token: "ga4-refresh",
    expires_at: Date.now() + 3600_000,
    connected_at: "2026-05-18T10:00:00Z",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    ...overrides,
  };
}

function yelpToken(overrides?: Partial<YelpConnectorToken>): YelpConnectorToken {
  return {
    provider: "yelp",
    api_key: "yelp-test-key",
    connected_at: "2026-05-16T11:00:00Z",
    business_id: "test-business",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _rows = [];
  _forceError = null;
});

describe("connector-store (Supabase) — round-trip", () => {
  it("save → read returns the persisted token (google_gsc)", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    const t = await getGoogleConnectorToken("gsc", "tenant-a");
    expect(t).not.toBeNull();
    expect(t!.provider).toBe("google_gsc");
    expect(t!.access_token).toBe("gsc-access");
  });

  it("save → read returns the persisted token (google_gbp)", async () => {
    await saveConnectorToken(gbpToken(), "tenant-a");
    const t = await getGoogleConnectorToken("gbp", "tenant-a");
    expect(t).not.toBeNull();
    expect(t!.provider).toBe("google_gbp");
  });

  it("save → read returns the persisted token (yelp)", async () => {
    await saveConnectorToken(yelpToken(), "tenant-a");
    const t = await getYelpConnectorToken("tenant-a");
    expect(t).not.toBeNull();
    expect(t!.api_key).toBe("yelp-test-key");
  });
});

describe("connector-store — provider discrimination (CRITICAL)", () => {
  it("google_gsc write does NOT appear in google_gbp read", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    const gbp = await getGoogleConnectorToken("gbp", "tenant-a");
    expect(gbp).toBeNull();
  });

  it("google_gbp write does NOT appear in google_gsc read", async () => {
    await saveConnectorToken(gbpToken(), "tenant-a");
    const gsc = await getGoogleConnectorToken("gsc", "tenant-a");
    expect(gsc).toBeNull();
  });

  it("both Google providers can coexist for the same tenant", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    await saveConnectorToken(gbpToken(), "tenant-a");
    const gsc = await getGoogleConnectorToken("gsc", "tenant-a");
    const gbp = await getGoogleConnectorToken("gbp", "tenant-a");
    expect(gsc?.provider).toBe("google_gsc");
    expect(gbp?.provider).toBe("google_gbp");
    expect(gsc!.access_token).toBe("gsc-access");
    expect(gbp!.access_token).toBe("gbp-access");
  });

  it("Yelp coexists independently of either Google provider", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    await saveConnectorToken(yelpToken(), "tenant-a");
    const yelp = await getYelpConnectorToken("tenant-a");
    expect(yelp?.provider).toBe("yelp");
  });
});

describe("connector-store — tenant isolation (CRITICAL)", () => {
  it("tenant A's token is not visible to tenant B", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    const fromB = await getGoogleConnectorToken("gsc", "tenant-b");
    expect(fromB).toBeNull();
  });

  it("two tenants can both hold a google_gsc token independently", async () => {
    await saveConnectorToken(
      gscToken({ access_token: "alpha-token" }),
      "tenant-a",
    );
    await saveConnectorToken(
      gscToken({ access_token: "bravo-token" }),
      "tenant-b",
    );
    const a = await getGoogleConnectorToken("gsc", "tenant-a");
    const b = await getGoogleConnectorToken("gsc", "tenant-b");
    expect(a!.access_token).toBe("alpha-token");
    expect(b!.access_token).toBe("bravo-token");
  });

  it("delete for tenant A does NOT touch tenant B's token", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    await saveConnectorToken(gscToken(), "tenant-b");
    await deleteConnectorToken("google_gsc", "tenant-a");
    const a = await getGoogleConnectorToken("gsc", "tenant-a");
    const b = await getGoogleConnectorToken("gsc", "tenant-b");
    expect(a).toBeNull();
    expect(b).not.toBeNull();
  });
});

describe("connector-store — soft-fail on missing row / missing table", () => {
  it("returns null for an unknown provider/tenant pair (no exception)", async () => {
    const t = await getGoogleConnectorToken("gsc", "tenant-missing");
    expect(t).toBeNull();
  });

  it("getConnectorInfo returns disconnected for missing token (no exception)", async () => {
    const info = await getConnectorInfo("google_gsc", "tenant-missing");
    expect(info.status).toBe("disconnected");
    expect(info.connected_at).toBeNull();
  });

  it("READ returns null when Supabase reports undefined_table (42P01)", async () => {
    _forceError = { code: "42P01", message: "relation does not exist" };
    const t = await getGoogleConnectorToken("gsc", "tenant-a");
    expect(t).toBeNull();
  });

  it("READ surfaces non-undefined-table errors by throwing", async () => {
    _forceError = { code: "23505", message: "unique violation" };
    await expect(
      getGoogleConnectorToken("gsc", "tenant-a"),
    ).rejects.toThrow(/connector-store: read failed/);
  });

  it("DELETE soft-fails on undefined_table (idempotent for callers)", async () => {
    _forceError = { code: "42P01", message: "relation does not exist" };
    await expect(
      deleteConnectorToken("google_gsc", "tenant-a"),
    ).resolves.toBeUndefined();
  });
});

describe("connector-store — write paths fail loud", () => {
  it("SAVE throws when Supabase reports an error", async () => {
    _forceError = { code: "42501", message: "permission denied" };
    await expect(
      saveConnectorToken(gscToken(), "tenant-a"),
    ).rejects.toThrow(/connector-store: save failed/);
  });

  it("DELETE throws on non-undefined-table errors", async () => {
    _forceError = { code: "42501", message: "permission denied" };
    await expect(
      deleteConnectorToken("google_gsc", "tenant-a"),
    ).rejects.toThrow(/connector-store: delete failed/);
  });
});

describe("connector-store — updateConnectorToken merges in place", () => {
  it("merges patch fields into the existing token", async () => {
    await saveConnectorToken(gscToken({ access_token: "old" }), "tenant-a");
    await updateConnectorToken(
      "google_gsc",
      { access_token: "new" },
      "tenant-a",
    );
    const t = await getGoogleConnectorToken("gsc", "tenant-a");
    expect(t!.access_token).toBe("new");
    expect(t!.refresh_token).toBe("gsc-refresh");
  });

  it("is a no-op when the token does not exist", async () => {
    await updateConnectorToken(
      "google_gsc",
      { access_token: "ghost" },
      "tenant-a",
    );
    const t = await getGoogleConnectorToken("gsc", "tenant-a");
    expect(t).toBeNull();
  });
});

describe("connector-store — getConnectorInfo shape", () => {
  it("returns Google-shaped info for a google_gsc token", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    const info = await getConnectorInfo("google_gsc", "tenant-a");
    expect(info.status).toBe("connected");
    expect(info.connected_at).toBe("2026-05-16T10:00:00Z");
    expect(typeof info.expires_at).toBe("number");
    expect(info.selected_location_id).toBeNull();
  });

  it("returns Yelp-shaped info for a yelp token (no expires_at)", async () => {
    await saveConnectorToken(yelpToken(), "tenant-a");
    const info = await getConnectorInfo("yelp", "tenant-a");
    expect(info.status).toBe("connected");
    expect(info.expires_at).toBeNull();
  });
});

describe("connector-store — isTokenExpired", () => {
  it("returns true for an expired google_gsc token", () => {
    const t = gscToken({ expires_at: Date.now() - 1000 });
    expect(isTokenExpired(t)).toBe(true);
  });

  it("returns false for a valid google_gsc token", () => {
    expect(isTokenExpired(gscToken())).toBe(false);
  });

  it("returns false for yelp tokens (no expiry concept)", () => {
    expect(isTokenExpired(yelpToken())).toBe(false);
  });
});

describe("connector-store — getConnectorHealth (honest derived state)", () => {
  const NOW = Date.parse("2026-06-15T12:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;

  it("not_connected when no token row exists", async () => {
    const h = await getConnectorHealth("google_gsc", "tenant-missing", NOW);
    expect(h.health).toBe("not_connected");
    expect(h.healthReason).toBeNull();
  });

  it("not_connected when the token is soft-disconnected", async () => {
    await saveConnectorToken(
      gscToken({ disconnected_at: "2026-06-10T00:00:00Z" }),
      "tenant-a",
    );
    const h = await getConnectorHealth("google_gsc", "tenant-a", NOW);
    expect(h.health).toBe("not_connected");
  });

  it("GA4 connected but NO property picked → needs_attention with the pick-property reason", async () => {
    await saveConnectorToken(
      ga4Token({ last_synced_at: "2026-06-14T00:00:00Z" }),
      "tenant-a",
    );
    const h = await getConnectorHealth("google_ga4", "tenant-a", NOW);
    expect(h.health).toBe("needs_attention");
    expect(h.healthReason).toBe(
      "Connected — pick your Analytics property to start pulling data.",
    );
  });

  it("connected with a null last_synced_at → stays healthy (no false 'never synced' alarm)", async () => {
    // A null/empty last_synced_at is an UNRELIABLE 'never synced' signal — e.g.
    // GSC can hold 90 days of data with a null marker (marker predates
    // last-synced stamping). We deliberately do NOT raise a ⚠ here; a false
    // alarm on a source that actually has data is worse than staying quiet.
    await saveConnectorToken(gscToken(), "tenant-a"); // no last_synced_at
    const h = await getConnectorHealth("google_gsc", "tenant-a", NOW);
    expect(h.health).toBe("connected");
    expect(h.healthReason).toBeNull();
  });


  it("connected + synced recently → healthy connected, no reason", async () => {
    await saveConnectorToken(
      gscToken({ last_synced_at: new Date(NOW - 2 * DAY).toISOString() }),
      "tenant-a",
    );
    const h = await getConnectorHealth("google_gsc", "tenant-a", NOW);
    expect(h.health).toBe("connected");
    expect(h.healthReason).toBeNull();
  });

  it("connected but stale beyond 14 days → needs_attention with a soft stale hint", async () => {
    await saveConnectorToken(
      gscToken({ last_synced_at: new Date(NOW - 20 * DAY).toISOString() }),
      "tenant-a",
    );
    const h = await getConnectorHealth("google_gsc", "tenant-a", NOW);
    expect(h.health).toBe("needs_attention");
    expect(h.healthReason).toBe("Last pulled 20 days ago — Refresh to update.");
  });

  it("GA4 with property + recent sync → healthy connected", async () => {
    await saveConnectorToken(
      ga4Token({
        ga4_property_id: "123456789",
        last_synced_at: new Date(NOW - 1 * DAY).toISOString(),
      }),
      "tenant-a",
    );
    const h = await getConnectorHealth("google_ga4", "tenant-a", NOW);
    expect(h.health).toBe("connected");
  });

  it("preserves tenant isolation — tenant A's health is not derived from tenant B's token", async () => {
    await saveConnectorToken(
      gscToken({ last_synced_at: new Date(NOW - 2 * DAY).toISOString() }),
      "tenant-a",
    );
    const h = await getConnectorHealth("google_gsc", "tenant-b", NOW);
    expect(h.health).toBe("not_connected");
  });
});

describe("connector-store — getConnectorToken provider routing", () => {
  it("getConnectorToken('google_gsc') returns the GSC token, not GBP", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    await saveConnectorToken(gbpToken(), "tenant-a");
    const t = await getConnectorToken("google_gsc", "tenant-a");
    expect(t?.provider).toBe("google_gsc");
  });

  it("getConnectorToken('yelp') ignores Google tokens", async () => {
    await saveConnectorToken(gscToken(), "tenant-a");
    const t = await getConnectorToken("yelp", "tenant-a");
    expect(t).toBeNull();
  });
});
