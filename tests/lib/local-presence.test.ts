import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeStore } from "@/lib/persistence/json-store";
import type { ImportRun } from "@/lib/import/types";
import type { ConnectorToken, YelpConnectorToken } from "@/lib/connector-store";

// 2026-05-16 connector-tokens-supabase-and-gsc-scope-split:
// in-memory async mock of the new connector-store API.
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
    getConnectorToken: vi.fn(async (provider: string) => {
      return _tokenStore.get(provider) ?? null;
    }),
    getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" = "gsc") => {
      const key = kind === "gsc" ? "google_gsc" : "google_gbp";
      const t = _tokenStore.get(key);
      return t != null && (t.provider === "google_gsc" || t.provider === "google_gbp") ? t : null;
    }),
    getYelpConnectorToken: vi.fn(async () => {
      const t = _tokenStore.get("yelp");
      return t != null && t.provider === "yelp" ? t : null;
    }),
  };
});

import {
  formatReviewSourceTimeForDisplay,
  getLocalPresenceSnapshot,
  checkNap,
  computeListingHealth,
} from "@/lib/local-presence";
import { saveConnectorToken } from "@/lib/connector-store";

describe("getLocalPresenceSnapshot", () => {
  beforeEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
    // The in-memory connector-token mock accumulates across tests in
    // this file — without this reset, a token saved by one test (e.g.
    // a Yelp last_synced_at) leaks into the next via the
    // max(google, yelp) lastReviewImportAt logic, making
    // single-connector cases fail. The _resetTokenStore helper existed
    // but was never wired here.
    _resetTokenStore();
  });

  it("returns empty review fields when no imported reviews", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(s.hasReviews).toBe(false);
    expect(s.reviewCount).toBeNull();
    expect(s.avgRating).toBeNull();
    expect(s.sentimentBand).toBeNull();
    expect(s.lastReviewImportAt).toBeNull();
    expect(s.reviewImportAgeDays).toBeNull();
  });

  it("returns a valid health tier", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(["weak", "ok", "strong"]).toContain(s.healthTier);
  });

  it("returns a numeric health score 0–100", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(s.healthScore).toBeGreaterThanOrEqual(0);
    expect(s.healthScore).toBeLessThanOrEqual(100);
  });

  it("includes NAP status and napState", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(s.nap).toBeDefined();
    expect(s.nap.completeness).toBeGreaterThanOrEqual(0);
    expect(s.nap.completeness).toBeLessThanOrEqual(100);
    expect([...s.nap.present, ...s.nap.missing].sort()).toEqual(
      ["address", "domain", "name", "phone"].sort(),
    );
    expect(["complete", "incomplete", "inconsistent", "unknown"]).toContain(s.napState);
  });

  it("includes lastSync with independent google/yelp/manual fields", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(Object.keys(s.lastSync).sort()).toEqual(["google", "manual", "yelp"].sort());
    for (const k of ["google", "yelp", "manual"] as const) {
      const v = s.lastSync[k];
      expect(v === null || typeof v === "string").toBe(true);
    }
  });

  it("includes listingCompleteness audit with five checked keys", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(s.listingCompleteness.checked_field_keys).toHaveLength(5);
    expect(["strong", "partial", "weak"]).toContain(s.listingCompleteness.coverage_state);
    expect(s.listingCompleteness.present_fields.length + s.listingCompleteness.missing_fields.length).toBe(5);
  });

  it("includes breakdown with 7 components summing to score", async () => {
    const s = await getLocalPresenceSnapshot();
    expect(s.healthBreakdown.components).toHaveLength(7);
    const sum = s.healthBreakdown.components.reduce((a, c) => a + c.earned, 0);
    expect(sum).toBe(s.healthScore);
  });
});

describe("getLocalPresenceSnapshot + connector last_synced_at", () => {
  beforeEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
      });

  afterEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
          });

  it("uses Google connector last_synced_at for lastReviewImportAt when no import runs", async () => {
    await writeStore("local-reviews", [
      { id: "m1", source: "other", rating: 5, created_at: "2020-01-01" },
    ]);
    await saveConnectorToken({
      provider: "google_gbp",
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
      connected_at: "2026-04-13T08:00:00.000Z",
      scopes: [],
      last_synced_at: "2026-04-13T18:00:00.000Z",
    });
    const s = await getLocalPresenceSnapshot();
    expect(s.hasReviews).toBe(true);
    expect(s.lastReviewImportAt).toBe("2026-04-13T18:00:00.000Z");
  });

  it("uses the later of Google vs Yelp last_synced_at when no import runs", async () => {
    await writeStore("local-reviews", [
      { id: "m1", source: "other", rating: 5, created_at: "2020-01-01" },
    ]);
    await saveConnectorToken({
      provider: "google_gbp",
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
      connected_at: "2026-04-13T08:00:00.000Z",
      scopes: [],
      last_synced_at: "2026-04-13T10:00:00.000Z",
    });
    const yelp: YelpConnectorToken = {
      provider: "yelp",
      api_key: "k",
      connected_at: "2026-04-13T08:00:00.000Z",
      business_id: "b",
      last_synced_at: "2026-04-14T12:00:00.000Z",
    };
    await saveConnectorToken(yelp);
    const s = await getLocalPresenceSnapshot();
    expect(s.lastReviewImportAt).toBe("2026-04-14T12:00:00.000Z");
  });

  it("lastSync.google and lastSync.yelp mirror connector tokens independently", async () => {
    await saveConnectorToken({
      provider: "google_gbp",
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
      connected_at: "2026-04-13T08:00:00.000Z",
      scopes: [],
      last_synced_at: "2026-04-13T18:00:00.000Z",
    });
    const yelp: YelpConnectorToken = {
      provider: "yelp",
      api_key: "k",
      connected_at: "2026-04-13T08:00:00.000Z",
      business_id: "b",
      last_synced_at: "2026-04-15T09:00:00.000Z",
    };
    await saveConnectorToken(yelp);
    const s = await getLocalPresenceSnapshot();
    expect(s.lastSync.google).toBe("2026-04-13T18:00:00.000Z");
    expect(s.lastSync.yelp).toBe("2026-04-15T09:00:00.000Z");
    expect(s.lastSync.manual).toBeNull();
  });

  it("lastSync.manual uses latest non-connector reviews ImportRun", async () => {
    const older: ImportRun = {
      id: "r-old",
      source_system: "csv",
      entity_type: "reviews",
      format: "csv",
      started_at: "2026-03-01T10:00:00.000Z",
      completed_at: "2026-03-01T10:05:00.000Z",
      total_rows: 1,
      imported_count: 1,
      skipped_count: 0,
      errors: [],
      warnings: [],
      tenant_id: "tenant-test",
    };
    const newer: ImportRun = {
      id: "r-new",
      source_system: "json",
      entity_type: "reviews",
      format: "json",
      started_at: "2026-04-10T10:00:00.000Z",
      completed_at: "2026-04-10T10:05:00.000Z",
      total_rows: 2,
      imported_count: 2,
      skipped_count: 0,
      errors: [],
      warnings: [],
      tenant_id: "tenant-test",
    };
    await writeStore("import-runs", [older, newer]);
    const s = await getLocalPresenceSnapshot();
    expect(s.lastSync.manual).toBe("2026-04-10T10:05:00.000Z");
  });

  it("lastSync.manual ignores connector:google import-run rows", async () => {
    const connectorRun: ImportRun = {
      id: "gbp-1",
      source_system: "connector:google",
      entity_type: "reviews",
      format: "json",
      started_at: "2026-04-20T10:00:00.000Z",
      completed_at: "2026-04-20T10:05:00.000Z",
      total_rows: 5,
      imported_count: 5,
      skipped_count: 0,
      errors: [],
      warnings: [],
      tenant_id: "tenant-test",
    };
    await writeStore("import-runs", [connectorRun]);
    const s = await getLocalPresenceSnapshot();
    expect(s.lastSync.manual).toBeNull();
  });
});

describe("formatReviewSourceTimeForDisplay", () => {
  it("returns a relative phrase for recent timestamps", () => {
    const iso = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatReviewSourceTimeForDisplay(iso)).toContain("day");
  });

  it("returns non-empty string for invalid parse (pass-through)", () => {
    expect(formatReviewSourceTimeForDisplay("not-a-date")).toBe("not-a-date");
  });
});

describe("checkNap", () => {
  it("returns all present when all fields set", () => {
    const nap = checkNap({
      name: "Acme Inc",
      domain: "acme.com",
      phone: "555-0100",
      address: "123 Main St",
    });
    expect(nap.present).toEqual(["name", "domain", "phone", "address"]);
    expect(nap.missing).toEqual([]);
    expect(nap.completeness).toBe(100);
  });

  it("detects missing fields", () => {
    const nap = checkNap({
      name: "Acme Inc",
      domain: "acme.com",
      phone: "",
      address: "  ",
    });
    expect(nap.present).toEqual(["name", "domain"]);
    expect(nap.missing).toEqual(["phone", "address"]);
    expect(nap.completeness).toBe(50);
  });

  it("handles all empty", () => {
    const nap = checkNap({ name: "", domain: "", phone: "", address: "" });
    expect(nap.present).toEqual([]);
    expect(nap.missing).toEqual(["name", "domain", "phone", "address"]);
    expect(nap.completeness).toBe(0);
  });
});

describe("computeListingHealth", () => {
  it("returns 0 when nothing configured", () => {
    const h = computeListingHealth({
      nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 },
      hasReviews: false,
      avgRating: null,
      reviewImportAgeDays: null,
    });
    expect(h.score).toBe(0);
    expect(h.tier).toBe("weak");
  });

  it("returns 100 with perfect config and fresh reviews", () => {
    const h = computeListingHealth({
      nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
      hasReviews: true,
      avgRating: 5.0,
      reviewImportAgeDays: 0,
    });
    expect(h.score).toBe(100);
    expect(h.tier).toBe("strong");
  });

  it("partial review freshness at 31–90 days", () => {
    const h = computeListingHealth({
      nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
      hasReviews: true,
      avgRating: 5.0,
      reviewImportAgeDays: 45,
    });
    const freshnessComponent = h.components.find((c) => c.label === "Review freshness")!;
    expect(freshnessComponent.earned).toBe(5);
    expect(h.score).toBe(95);
  });

  it("zero freshness at >90 days", () => {
    const h = computeListingHealth({
      nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
      hasReviews: true,
      avgRating: 5.0,
      reviewImportAgeDays: 120,
    });
    const freshnessComponent = h.components.find((c) => c.label === "Review freshness")!;
    expect(freshnessComponent.earned).toBe(0);
    expect(h.score).toBe(90);
  });

  it("scales rating component proportionally", () => {
    const h = computeListingHealth({
      nap: { present: ["domain"], missing: ["name", "phone", "address"], completeness: 25 },
      hasReviews: true,
      avgRating: 3.0,
      reviewImportAgeDays: 5,
    });
    const ratingComponent = h.components.find((c) => c.label === "Average rating")!;
    expect(ratingComponent.earned).toBe(Math.round((3 / 5) * 15));
  });

  it("tier boundaries: weak < 35, ok 35–64, strong >= 65", () => {
    const make = (score: number) => {
      if (score >= 65) return "strong";
      if (score >= 35) return "ok";
      return "weak";
    };
    expect(make(0)).toBe("weak");
    expect(make(34)).toBe("weak");
    expect(make(35)).toBe("ok");
    expect(make(64)).toBe("ok");
    expect(make(65)).toBe("strong");
    expect(make(100)).toBe("strong");
  });
});
