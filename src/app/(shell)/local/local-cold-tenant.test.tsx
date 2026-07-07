/**
 * Cold-tenant /local render pin (2026-07-07, FIX 1).
 *
 * A brand-new tenant that saved a domain in Config (so `hasListing` is true) but has
 * NO stored reviews and NO local source ever synced/imported must see an honest
 * "Connect your Google Business Profile" empty state, NOT a scary 0-out-of-100
 * listing-health scorecard. Rendered for real via renderToStaticMarkup so we assert
 * on the exact operator copy.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LocalPresenceSnapshot } from "@/lib/local-presence";

let snapshot: LocalPresenceSnapshot;

vi.mock("@/lib/local-presence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/local-presence")>("@/lib/local-presence");
  return { ...actual, getLocalPresenceSnapshot: async () => snapshot };
});
vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: async () => ({
    name: "Ritz Builders", domain: "ritzbuilders.com", phone: "", address: "", industry: "",
  }),
}));

import LocalPresencePage from "./page";

function coldSnapshot(over: Partial<LocalPresenceSnapshot> = {}): LocalPresenceSnapshot {
  return {
    hasListing: true, // a saved domain flips this true even for a cold tenant
    hasReviews: false,
    reviewCount: null,
    avgRating: null,
    healthTier: "weak",
    healthScore: 40, // domain+name earn points, so this is NOT 0 - a scorecard would read "you scored 40/100"
    healthBreakdown: { score: 40, tier: "weak", components: [] },
    nap: { present: ["name", "domain"], missing: ["phone", "address"], completeness: 50 },
    napState: "incomplete",
    sentimentBand: null,
    lastReviewImportAt: null,
    reviewImportAgeDays: null,
    lastSync: { google: null, yelp: null, manual: null },
    listingCompleteness: {
      checked_field_keys: ["name", "address", "phone", "website", "category"],
      present_fields: ["Business name", "Website (domain)"],
      missing_fields: ["Address", "Phone", "Category (industry)"],
      coverage_state: "weak",
    },
    ...over,
  };
}

describe("/local cold-tenant empty state (FIX 1)", () => {
  it("shows the connect empty state instead of a scorecard when no reviews and no local source", async () => {
    snapshot = coldSnapshot();
    const html = renderToStaticMarkup(await LocalPresencePage());
    expect(html).toContain("Connect your Google Business Profile to see your local health");
    expect(html).toContain("No local health to show yet");
    // The scary scorecard must NOT render.
    expect(html).not.toContain("Listing health");
    expect(html).not.toContain("/ 100");
    expect(html).not.toContain(">40<"); // no bare 0-ish/40 score number
  });

  it("does NOT fire the empty state once a local source has synced (reviews still absent)", async () => {
    snapshot = coldSnapshot({ lastSync: { google: "2026-07-01T00:00:00.000Z", yelp: null, manual: null } });
    const html = renderToStaticMarkup(await LocalPresencePage());
    expect(html).not.toContain("No local health to show yet");
    // The full page renders the health scorecard once there is a real source.
    expect(html).toContain("Listing health");
  });

  it("does NOT fire the empty state once reviews exist", async () => {
    snapshot = coldSnapshot({ hasReviews: true, reviewCount: 12, avgRating: 4.6, sentimentBand: "positive" });
    const html = renderToStaticMarkup(await LocalPresencePage());
    expect(html).not.toContain("No local health to show yet");
    expect(html).toContain("Listing health");
  });
});
