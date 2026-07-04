import { describe, it, expect } from "vitest";

import {
  DISCOVER_MIN_IMPRESSIONS,
  FOOTPRINT_MIN_IMPRESSIONS,
  buildDiscoverPresence,
  buildGscFootprint,
  type FootprintPageInput,
} from "./footprint";

const BANNED_DASH = /[‒–—―]/;

const page = (over: Partial<FootprintPageInput>): FootprintPageInput => ({
  page: "https://example.com/a",
  impressions90d: 1000,
  clicks90d: 40,
  queries: ["persian recipes", "tehran travel"],
  ...over,
});

describe("buildGscFootprint (v1 491, the whole Google presence)", () => {
  it("rolls up distinct pages, distinct searches, and total appearances", () => {
    const fp = buildGscFootprint([
      page({ page: "https://example.com/a", impressions90d: 3000, clicks90d: 120, queries: ["persian recipes", "saffron"] }),
      page({ page: "https://example.com/b", impressions90d: 2000, clicks90d: 80, queries: ["Saffron", "tehran travel"] }),
    ])!;
    expect(fp.pageCount).toBe(2);
    // "saffron"/"Saffron" collapse case-insensitively -> 3 distinct searches.
    expect(fp.queryCount).toBe(3);
    expect(fp.totalImpressions).toBe(5000);
    expect(fp.totalClicks).toBe(200);
    expect(fp.line).toContain("Google shows 2 of your pages across 3 different searches");
    expect(fp.line).toContain("5,000 times in the last 90 days");
    expect(fp.line).toContain("your whole Google footprint");
  });

  it("drops blank URLs and pages with no appearances (nothing to summarize)", () => {
    const fp = buildGscFootprint([
      page({ page: "", impressions90d: 5000 }),
      page({ page: "https://example.com/a", impressions90d: 0 }),
      page({ page: "https://example.com/b", impressions90d: 500, queries: ["x"] }),
    ])!;
    expect(fp.pageCount).toBe(1);
    expect(fp.totalImpressions).toBe(500);
  });

  it("uses singular grammar for a one-page, one-search footprint", () => {
    const fp = buildGscFootprint([page({ impressions90d: 500, queries: ["persian recipes"] })])!;
    expect(fp.line).toContain("Google shows 1 of your page across 1 different search");
  });

  it("is empty-safe: no pages or under the appearance floor returns null", () => {
    expect(buildGscFootprint([])).toBeNull();
    expect(
      buildGscFootprint([page({ impressions90d: FOOTPRINT_MIN_IMPRESSIONS - 1 })]),
    ).toBeNull();
  });

  it("respects a custom window and is dash-clean", () => {
    const fp = buildGscFootprint([page({ impressions90d: 900 })], 28)!;
    expect(fp.windowDays).toBe(28);
    expect(fp.line).toContain("in the last 28 days");
    expect(BANNED_DASH.test(fp.line)).toBe(false);
  });
});

describe("buildDiscoverPresence (v1 493, self-hides when Discover has no data)", () => {
  it("reports Discover appearances and visitors when present", () => {
    const d = buildDiscoverPresence({ impressions: 4200, clicks: 130 })!;
    expect(d.impressions).toBe(4200);
    expect(d.clicks).toBe(130);
    expect(d.line).toContain("Google Discover showed your pages 4,200 times in the last 90 days");
    expect(d.line).toContain("bringing in 130 visitors");
    expect(d.line).toContain("Discover is Google's phone home feed");
    expect(BANNED_DASH.test(d.line)).toBe(false);
  });

  it("omits the visitors clause when Discover drove impressions but no clicks", () => {
    const d = buildDiscoverPresence({ impressions: 4200, clicks: 0 })!;
    expect(d.line).not.toContain("visitor");
    expect(d.line).toContain("4,200 times");
  });

  it("uses singular 'visitor' for exactly one click", () => {
    const d = buildDiscoverPresence({ impressions: 200, clicks: 1 })!;
    expect(d.line).toContain("bringing in 1 visitor.");
  });

  it("NEVER fabricates a presence: null totals or under the floor returns null", () => {
    expect(buildDiscoverPresence(null)).toBeNull();
    expect(buildDiscoverPresence({ impressions: DISCOVER_MIN_IMPRESSIONS - 1, clicks: 0 })).toBeNull();
  });
});
