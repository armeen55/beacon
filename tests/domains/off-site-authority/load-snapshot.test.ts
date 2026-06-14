/**
 * Section 7 C7a — Off-Site Authority loader runtime tests.
 *
 * Mocks the four named-global / hybrid-scope helper modules and the
 * tenant-context module, then verifies the loader:
 *   - calls currentTenantId once
 *   - calls isPlaceholderConfig in the LOADER (not inside compute)
 *   - passes businessConfigIsPlaceholder boolean to compute
 *   - passes brandName resolved from businessConfig.name (null when empty)
 *   - calls readLocalReviews with NO args (per its existing signature)
 *   - returns compute output verbatim
 *   - default `now` is a bounded Date around the call moment
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const _spies = {
  currentTenantId: vi.fn(async () => "tenant-test"),
  getBusinessConfig: vi.fn(() => ({
    name: "Test Brand",
    industry: "Builder",
    yelpBusinessId: "",
    locations: ["Atherton, CA"],
    // Section 7 C7g v1 (2026-05-16) — operator-entered off-site
    // profile URLs default to "" in the mock so existing C7a/C7c
    // loader tests retain inferred/unknown behavior for the four
    // new channels.
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
  })),
  isPlaceholderConfig: vi.fn(() => false),
  readLocalReviews: vi.fn(async () => [
    { source: "google", rating: 5 },
    { source: "google", rating: 4 },
  ]),
  // 2026-05-16 connector-tokens-supabase-and-gsc-scope-split:
  // connector-store reads are async; off-site uses the GBP provider.
  getGoogleConnectorToken: vi.fn(async (_kind?: "gsc" | "gbp") => ({ provider: "google_gbp" })),
  getYelpConnectorToken: vi.fn(async () => null),
};

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: () => _spies.currentTenantId(),
}));
vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => _spies.getBusinessConfig(),
  // audit #2 follow-up (2026-06-14): the loader now also calls
  // hydrateBusinessConfigFromSupabase, falling back to getBusinessConfig.
  // Return null so the sync getBusinessConfig spy stays the source.
  hydrateBusinessConfigFromSupabase: async () => null,
  // The real isPlaceholderConfig takes a config arg; the spy is
  // arity-0 here so it can be invoked from the loader without
  // surfacing the BusinessConfig type into this test file.
  isPlaceholderConfig: (_cfg: unknown) => _spies.isPlaceholderConfig(),
}));
vi.mock("@/lib/local-reviews-store", () => ({
  readLocalReviews: () => _spies.readLocalReviews(),
}));
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: () => _spies.getGoogleConnectorToken(),
  getYelpConnectorToken: () => _spies.getYelpConnectorToken(),
}));

import { loadOffSitePresenceSnapshot } from "@/domains/off-site-authority/load-snapshot";

beforeEach(() => {
  for (const k of Object.values(_spies)) k.mockClear();
});

describe("Section 7 C7a — loadOffSitePresenceSnapshot", () => {
  it("calls currentTenantId exactly once and threads the resolved id", async () => {
    _spies.currentTenantId.mockResolvedValueOnce("tenant-xyz");
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    expect(_spies.currentTenantId).toHaveBeenCalledTimes(1);
    expect(out.tenant_id).toBe("tenant-xyz");
  });

  it("calls isPlaceholderConfig in the loader (not inside compute) and passes the boolean through", async () => {
    _spies.isPlaceholderConfig.mockReturnValueOnce(true);
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    expect(_spies.isPlaceholderConfig).toHaveBeenCalledTimes(1);
    // The placeholder note is emitted by the pure compute when the
    // boolean is true → end-to-end proof that the loader passed it.
    expect(
      out.data_sources_note.some((n) =>
        n.startsWith("business-config is the neutral placeholder"),
      ),
    ).toBe(true);
  });

  it("brand_name = businessConfig.name when non-empty", async () => {
    _spies.getBusinessConfig.mockReturnValueOnce({
      name: "Acme Builders",
      industry: "Builder",
      yelpBusinessId: "",
      locations: ["Palo Alto, CA"],
      houzzProfileUrl: "",
      angiProfileUrl: "",
      bbbProfileUrl: "",
      industryDirectoryProfileUrl: "",
    });
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    expect(out.brand_name).toBe("Acme Builders");
  });

  it("brand_name = null when businessConfig.name is empty string", async () => {
    _spies.getBusinessConfig.mockReturnValueOnce({
      name: "",
      industry: "Builder",
      yelpBusinessId: "",
      locations: ["Palo Alto, CA"],
      houzzProfileUrl: "",
      angiProfileUrl: "",
      bbbProfileUrl: "",
      industryDirectoryProfileUrl: "",
    });
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    expect(out.brand_name).toBeNull();
  });

  it("calls readLocalReviews with no arguments (matches existing helper signature)", async () => {
    await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    expect(_spies.readLocalReviews).toHaveBeenCalledTimes(1);
    expect(_spies.readLocalReviews.mock.calls[0]).toEqual([]);
  });

  it("threads google token presence into the GBP channel", async () => {
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    const gbp = out.channels.find((c) => c.channel === "gbp")!;
    expect(gbp.claimed).toBe(true);
    expect(gbp.review_count).toBe(2);
    expect(gbp.rating).toBeCloseTo(4.5, 1);
    expect(gbp.confidence).toBe("high");
  });

  it("C7g v1 — threads operator-entered profile URLs into compute (configured + medium)", async () => {
    _spies.getBusinessConfig.mockReturnValueOnce({
      name: "Test Brand",
      industry: "Builder",
      yelpBusinessId: "",
      locations: ["Atherton, CA"],
      houzzProfileUrl: "https://www.houzz.com/pro/test-brand",
      angiProfileUrl: "https://www.angi.com/companylist/us/ca/test.htm",
      bbbProfileUrl: "https://www.bbb.org/us/ca/atherton/profile/test-brand",
      industryDirectoryProfileUrl:
        "https://www.nahb.org/directory/test-brand",
    });
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    for (const ch of ["houzz", "angi", "bbb", "industry_directory"] as const) {
      const row = out.channels.find((c) => c.channel === ch)!;
      expect(row.claimed).toBe(true);
      expect(row.source).toBe("business_config");
      expect(row.confidence).toBe("medium");
      expect(row.profile_url).toBeTruthy();
    }
  });

  it("C7g v1 — empty profile URLs leave channels inferred/unknown", async () => {
    // Default mock has all four URLs as "" — verify inferred behavior.
    const out = await loadOffSitePresenceSnapshot({
      now: new Date("2026-05-16T12:00:00Z"),
    });
    for (const ch of ["houzz", "angi", "bbb", "industry_directory"] as const) {
      const row = out.channels.find((c) => c.channel === ch)!;
      expect(row.claimed).toBeNull();
      expect(row.source).toBe("inferred");
      expect(row.confidence).toBe("unknown");
      expect(row.profile_url).toBeNull();
    }
  });

  it("default `now` falls within a bounded window around call time", async () => {
    const t0 = Date.now();
    const out = await loadOffSitePresenceSnapshot();
    const t1 = Date.now();
    const stamp = Date.parse(out.generated_at);
    expect(Number.isNaN(stamp)).toBe(false);
    // Loose bound: snapshot timestamp is within 2s either side of the
    // call (covers test-clock skew + async resolution).
    expect(stamp).toBeGreaterThanOrEqual(t0 - 2000);
    expect(stamp).toBeLessThanOrEqual(t1 + 2000);
  });
});
