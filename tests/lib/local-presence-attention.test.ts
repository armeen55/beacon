import { describe, it, expect } from "vitest";
import type { LocalPresenceSnapshot } from "@/lib/local-presence";
import {
  REVIEW_IMPORT_STALE_AFTER_DAYS,
  buildMarketLocalStripModel,
  buildTodayLocalAttention,
  deriveListingCompletenessAudit,
  deriveNapConsistencyState,
  deriveReviewImportFreshness,
  napStateDisplay,
  napStateExplanation,
  reviewsImportStale,
  shouldShowTodayLocalAttention,
} from "@/lib/local-presence";

function emptyBreakdown(tier: "weak" | "ok" | "strong", score: number) {
  return {
    score,
    tier,
    components: [],
  };
}

function snap(p: Partial<LocalPresenceSnapshot>): LocalPresenceSnapshot {
  const defaults: LocalPresenceSnapshot = {
    hasListing: true,
    hasReviews: false,
    reviewCount: null,
    avgRating: null,
    healthTier: "ok",
    healthScore: 40,
    healthBreakdown: emptyBreakdown("ok", 40),
    nap: { present: ["name", "domain"], missing: ["phone", "address"], completeness: 50 },
    napState: "incomplete",
    sentimentBand: null,
    lastReviewImportAt: null,
    reviewImportAgeDays: null,
    lastSync: { google: null, yelp: null, manual: null },
    listingCompleteness: deriveListingCompletenessAudit({
      nameFromConfig: "Co",
      nameFromGoogleLocation: null,
      address: "",
      phone: "",
      domain: "co.example",
      industry: "",
    }),
  };
  return {
    ...defaults,
    ...p,
    nap: p.nap ?? defaults.nap,
    napState: p.napState ?? defaults.napState,
    healthBreakdown: p.healthBreakdown ?? defaults.healthBreakdown,
    lastSync: p.lastSync ?? defaults.lastSync,
    listingCompleteness: p.listingCompleteness ?? defaults.listingCompleteness,
  };
}

describe("Track 1.4f — NAP consistency state derivation", () => {
  it("returns unknown when no listing", () => {
    expect(deriveNapConsistencyState({ hasListing: false, nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 } })).toBe("unknown");
  });

  it("returns incomplete when NAP fields are missing", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["domain"], missing: ["name", "phone", "address"], completeness: 25 } },
    )).toBe("incomplete");
  });

  it("returns complete when all fields present and no conflicts", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 } },
    )).toBe("complete");
  });

  it("returns inconsistent when listing names conflict with configured name", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 } },
      { configuredName: "Acme Inc", reviewListingNames: ["Acme Inc", "Acme Corp"] },
    )).toBe("inconsistent");
  });

  it("returns complete when all listing names match configured name (case-insensitive)", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 } },
      { configuredName: "Acme Inc", reviewListingNames: ["acme inc", "Acme Inc"] },
    )).toBe("complete");
  });

  it("returns complete when no review listing names available", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 } },
      { configuredName: "Acme Inc", reviewListingNames: [] },
    )).toBe("complete");
  });

  it("inconsistent takes precedence over incomplete", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["name", "domain"], missing: ["phone", "address"], completeness: 50 } },
      { configuredName: "Acme Inc", reviewListingNames: ["Different Name"] },
    )).toBe("inconsistent");
  });

  it("unknown takes precedence over everything", () => {
    expect(deriveNapConsistencyState(
      { hasListing: false, nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 } },
      { configuredName: "Acme Inc", reviewListingNames: ["Different Name"] },
    )).toBe("unknown");
  });

  it("ignores review listing names when configured name is empty", () => {
    expect(deriveNapConsistencyState(
      { hasListing: true, nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 } },
      { configuredName: "  ", reviewListingNames: ["Something"] },
    )).toBe("complete");
  });
});

describe("Track 1.4f — NAP display + explanation helpers", () => {
  it("napStateDisplay returns correct labels", () => {
    expect(napStateDisplay("complete")).toBe("Complete");
    expect(napStateDisplay("incomplete")).toBe("Incomplete");
    expect(napStateDisplay("inconsistent")).toBe("Inconsistent");
    expect(napStateDisplay("unknown")).toBe("Unknown");
  });

  it("napStateExplanation returns factual copy", () => {
    expect(napStateExplanation("complete")).toContain("complete");
    expect(napStateExplanation("incomplete")).toContain("missing");
    // audit-wave6 #3: the inconsistent state is derived from review listing NAMES
    // only — copy now reflects that (was the over-claiming "do not agree ... phone").
    expect(napStateExplanation("inconsistent")).toContain("listing names");
    expect(napStateExplanation("unknown")).toContain("not have enough data");
  });
});

describe("Track 1.4g — Today local attention (4-state NAP)", () => {
  it("hides when strong + complete NAP + reviews + fresh import", () => {
    const s = snap({
      healthTier: "strong",
      healthScore: 90,
      healthBreakdown: emptyBreakdown("strong", 90),
      hasListing: true,
      nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
      napState: "complete",
      hasReviews: true,
      reviewCount: 5,
      avgRating: 4.5,
      lastReviewImportAt: new Date().toISOString(),
      reviewImportAgeDays: 5,
    });
    expect(shouldShowTodayLocalAttention(s)).toBe(false);
    expect(buildTodayLocalAttention(s)).toBeNull();
  });

  it("shows when no reviews", () => {
    const s = snap({
      hasReviews: false,
      reviewCount: null,
      lastReviewImportAt: null,
      reviewImportAgeDays: null,
    });
    expect(shouldShowTodayLocalAttention(s)).toBe(true);
    const a = buildTodayLocalAttention(s);
    expect(a).not.toBeNull();
    expect(a!.headline).toBe("Local presence needs attention");
    expect(a!.facts.some((f) => f.includes("No review rows in Beacon yet"))).toBe(true);
    expect(a!.href).toBe("/local");
    expect(a!.footnote).toContain("imported or synced");
  });

  it("shows when review import is older than threshold", () => {
    const s = snap({
      hasReviews: true,
      reviewCount: 2,
      avgRating: 4.0,
      lastReviewImportAt: new Date(Date.now() - (REVIEW_IMPORT_STALE_AFTER_DAYS + 5) * 86_400_000).toISOString(),
      reviewImportAgeDays: REVIEW_IMPORT_STALE_AFTER_DAYS + 5,
      nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
      napState: "complete",
      healthTier: "ok",
      healthScore: 50,
      healthBreakdown: emptyBreakdown("ok", 50),
    });
    expect(shouldShowTodayLocalAttention(s)).toBe(true);
    const a = buildTodayLocalAttention(s);
    expect(a!.facts.some((f) => f.includes("30 days") && f.includes("Stored review"))).toBe(true);
  });

  it("shows when NAP incomplete", () => {
    const s = snap({
      nap: { present: ["domain"], missing: ["name", "phone", "address"], completeness: 25 },
      napState: "incomplete",
      hasReviews: true,
      reviewCount: 1,
      avgRating: 5,
      lastReviewImportAt: new Date().toISOString(),
      reviewImportAgeDays: 0,
      healthTier: "strong",
      healthScore: 80,
      healthBreakdown: emptyBreakdown("strong", 80),
    });
    expect(shouldShowTodayLocalAttention(s)).toBe(true);
    const a = buildTodayLocalAttention(s);
    expect(a!.facts.some((f) => f.includes("NAP fields incomplete"))).toBe(true);
  });

  it("shows when NAP inconsistent", () => {
    const s = snap({
      nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
      napState: "inconsistent",
      hasReviews: true,
      reviewCount: 5,
      avgRating: 4.5,
      lastReviewImportAt: new Date().toISOString(),
      reviewImportAgeDays: 0,
      healthTier: "strong",
      healthScore: 90,
      healthBreakdown: emptyBreakdown("strong", 90),
    });
    expect(shouldShowTodayLocalAttention(s)).toBe(true);
    const a = buildTodayLocalAttention(s);
    expect(a!.facts.some((f) => f.includes("conflict"))).toBe(true);
  });

  it("shows when NAP unknown (no listing)", () => {
    const s = snap({
      hasListing: false,
      napState: "unknown",
      nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 },
    });
    expect(shouldShowTodayLocalAttention(s)).toBe(true);
    const a = buildTodayLocalAttention(s);
    expect(a!.facts[0]).toMatch(/domain|listing anchor/i);
  });

  it("caps facts at two lines", () => {
    const s = snap({
      hasListing: false,
      napState: "unknown",
      nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 },
      hasReviews: false,
    });
    const a = buildTodayLocalAttention(s);
    expect(a!.facts.length).toBeLessThanOrEqual(2);
  });
});

describe("Track 1.4g — stale + review helpers", () => {
  it("reviewsImportStale is false when no reviews", () => {
    const s = snap({ hasReviews: false, napState: "incomplete" });
    expect(reviewsImportStale(s)).toBe(false);
    expect(deriveReviewImportFreshness(s)).toBe("none");
  });

  it("reviewsImportStale when import age over threshold", () => {
    const s = snap({
      hasReviews: true,
      lastReviewImportAt: "2020-01-01T00:00:00.000Z",
      reviewImportAgeDays: 400,
      napState: "complete",
    });
    expect(reviewsImportStale(s)).toBe(true);
    expect(deriveReviewImportFreshness(s)).toBe("stale");
  });
});

describe("Track 1.4g — Market strip model (4-state NAP)", () => {
  it("renders review line for counts and avg", () => {
    const m = buildMarketLocalStripModel(
      snap({
        hasReviews: true,
        reviewCount: 3,
        avgRating: 4.2,
        healthTier: "ok",
        nap: { present: ["name", "domain"], missing: ["phone", "address"], completeness: 50 },
        napState: "incomplete",
      }),
    );
    expect(m.healthTierLabel).toBe("OK");
    expect(m.napDisplay).toBe("Incomplete");
    expect(m.napState).toBe("incomplete");
    expect(m.reviewLine).toContain("3 stored");
    expect(m.reviewLine).toContain("4.2");
    expect(m.footnote).toContain("imported or synced");
    expect(m.listingCompletenessPhrase).toBe("Listing completeness: limited");
  });

  it("renders no review copy when empty", () => {
    const m = buildMarketLocalStripModel(snap({ hasReviews: false, napState: "incomplete" }));
    expect(m.reviewLine).toBe("No review rows in Beacon yet");
  });

  it("renders inconsistent NAP display", () => {
    const m = buildMarketLocalStripModel(
      snap({
        nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
        napState: "inconsistent",
      }),
    );
    expect(m.napDisplay).toBe("Inconsistent");
    expect(m.napState).toBe("inconsistent");
  });

  it("renders unknown NAP display", () => {
    const m = buildMarketLocalStripModel(
      snap({
        hasListing: false,
        napState: "unknown",
        nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 },
      }),
    );
    expect(m.napDisplay).toBe("Unknown");
    expect(m.napState).toBe("unknown");
  });

  it("includes listing completeness phrase when not strong", () => {
    const partial = deriveListingCompletenessAudit({
      nameFromConfig: "A",
      nameFromGoogleLocation: null,
      address: "",
      phone: "",
      domain: "a.com",
      industry: "x",
    });
    const m = buildMarketLocalStripModel(
      snap({
        napState: "complete",
        nap: { present: ["name", "domain", "phone", "address"], missing: [], completeness: 100 },
        healthTier: "strong",
        hasReviews: true,
        reviewCount: 1,
        avgRating: 5,
        listingCompleteness: partial,
      }),
    );
    expect(m.listingCompletenessPhrase).toBe("Listing completeness: partial");
  });
});

describe("Track 1.4h–k — Today listing completeness line", () => {
  it("does not add listing completeness when NAP incomplete dominates", () => {
    const a = buildTodayLocalAttention(snap({ napState: "incomplete" }));
    expect(a!.facts.some((f) => f.includes("Listing data is limited"))).toBe(false);
  });

  it("adds listing data limited when weak completeness and NAP is unknown", () => {
    const weak = deriveListingCompletenessAudit({
      nameFromConfig: "",
      nameFromGoogleLocation: null,
      address: "",
      phone: "",
      domain: "",
      industry: "",
    });
    expect(weak.coverage_state).toBe("weak");
    const s = snap({
      hasListing: false,
      napState: "unknown",
      nap: { present: [], missing: ["name", "domain", "phone", "address"], completeness: 0 },
      hasReviews: true,
      reviewCount: 1,
      avgRating: 5,
      lastReviewImportAt: new Date().toISOString(),
      reviewImportAgeDays: 1,
      healthTier: "strong",
      healthScore: 80,
      healthBreakdown: emptyBreakdown("strong", 80),
      listingCompleteness: weak,
    });
    const a = buildTodayLocalAttention(s);
    expect(a!.facts.some((f) => f.includes("No website domain configured"))).toBe(true);
    expect(a!.facts.some((f) => f.includes("Listing data is limited"))).toBe(true);
    expect(a!.facts.length).toBeLessThanOrEqual(2);
  });
});
