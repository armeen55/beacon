import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  buildNativeDayBuckets,
  denseSeries,
  NATIVE_REGIME_START,
  type UrlCitationSeries,
} from "./url-citation-history";

describe("normalizeUrl", () => {
  it("strips scheme + host + trailing slash for full URLs", () => {
    expect(normalizeUrl("https://ritzbuilders.com/locations/palo-alto/")).toBe(
      "/locations/palo-alto",
    );
    expect(normalizeUrl("http://www.ritzbuilders.com/services/foo")).toBe(
      "/services/foo",
    );
    expect(normalizeUrl("https://ritzbuilders.com/")).toBe("/");
    expect(normalizeUrl("https://ritzbuilders.com")).toBe("/");
  });

  it("leaves path-only URLs alone (normalised)", () => {
    expect(normalizeUrl("/locations/palo-alto")).toBe("/locations/palo-alto");
    expect(normalizeUrl("/locations/palo-alto/")).toBe("/locations/palo-alto");
    expect(normalizeUrl("/")).toBe("/");
  });

  it("strips host-looking segment when no leading slash", () => {
    expect(normalizeUrl("ritzbuilders.com/services/foo")).toBe("/services/foo");
    expect(normalizeUrl("www.ritzbuilders.com/locations/atherton")).toBe(
      "/locations/atherton",
    );
  });

  it("matches same page across representations", () => {
    const forms = [
      "https://ritzbuilders.com/locations/palo-alto",
      "https://ritzbuilders.com/locations/palo-alto/",
      "http://www.ritzbuilders.com/locations/palo-alto",
      "/locations/palo-alto",
      "/locations/palo-alto/",
      "ritzbuilders.com/locations/palo-alto/",
    ];
    const normalized = forms.map(normalizeUrl);
    const unique = [...new Set(normalized)];
    expect(unique).toEqual(["/locations/palo-alto"]);
  });

  it("handles null / empty / whitespace", () => {
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("lowercases the path", () => {
    expect(normalizeUrl("/Locations/Palo-Alto")).toBe("/locations/palo-alto");
    expect(normalizeUrl("https://Ritzbuilders.COM/Services")).toBe("/services");
  });

  it("handles non-standard values gracefully (e.g. Profound, GBP)", () => {
    // Non-URL tokens get treated as paths.
    expect(normalizeUrl("Profound")).toBe("/profound");
    expect(normalizeUrl("Google Business Profile")).toBe("/google business profile");
  });
});

// ---------------------------------------------------------------------------
// Commit 7 (2026-04-24) — native per-URL per-day citation invariants
//
// These invariants are operator-level guarantees:
//   1. One observation can contribute at most 1 count per owned URL per day.
//   2. Duplicate occurrences of the same owned URL inside a single answer's
//      citations list do NOT increase the per-URL daily count.
//   3. Pre-NATIVE_REGIME_START benchmark + post-NATIVE_REGIME_START native
//      series concatenate without fake summing across the boundary.
//   4. Any zero-fill or missing-day rendering must carry the regime tag of
//      the date it fell in (no silent continuity).
// ---------------------------------------------------------------------------

const RITZ_PA_PALO_ALTO = "/locations/palo-alto";
const RITZ_HOME = "/";
const OWNED_SET = new Set<string>([RITZ_PA_PALO_ALTO, RITZ_HOME]);

function nativeObs(
  overrides: {
    id: string;
    observed_at: string;
    platform: string;
    citation_urls: string[];
  },
) {
  return {
    id: overrides.id,
    platform: overrides.platform,
    observed_at: overrides.observed_at,
    citation_urls: overrides.citation_urls,
    citation_domains: null,
  };
}

describe("buildNativeDayBuckets — owned-URL dedup invariant", () => {
  it("invariant 1+2: duplicate owned URL inside a single answer counts once", () => {
    const obs = nativeObs({
      id: "obs-dup-A",
      observed_at: "2026-04-23T12:00:00Z",
      platform: "perplexity",
      citation_urls: [
        "https://ritzbuilders.com/locations/palo-alto",
        "https://ritzbuilders.com/locations/palo-alto/",
        "https://ritzbuilders.com/locations/palo-alto?utm_source=x",
        "https://houzz.com/somepage",
      ],
    });
    const out = buildNativeDayBuckets([obs], {
      ownedOnly: true,
      since: null,
      ownedUrlPathSet: OWNED_SET,
    });
    // Exactly one bucket for /locations/palo-alto, count=1 (even though
    // the URL appeared 3 times under different query-string / trailing-
    // slash variants), and zero for houzz (not owned).
    const paBucket = out.get(RITZ_PA_PALO_ALTO);
    expect(paBucket).toBeDefined();
    expect(paBucket!.size).toBe(1);
    expect(paBucket!.get("2026-04-23")!.count).toBe(1);
    expect(paBucket!.get("2026-04-23")!.source_type).toBe("derived");
    expect(out.has("/somepage")).toBe(false);
  });

  it("invariant 2: same owned URL across TWO observations same day → count = 2", () => {
    const obsA = nativeObs({
      id: "obs-A",
      observed_at: "2026-04-23T12:00:00Z",
      platform: "perplexity",
      citation_urls: ["https://ritzbuilders.com/locations/palo-alto"],
    });
    const obsB = nativeObs({
      id: "obs-B",
      observed_at: "2026-04-23T18:00:00Z",
      platform: "chatgpt",
      citation_urls: ["https://ritzbuilders.com/locations/palo-alto/"],
    });
    const out = buildNativeDayBuckets([obsA, obsB], {
      ownedOnly: true,
      since: null,
      ownedUrlPathSet: OWNED_SET,
    });
    const day = out.get(RITZ_PA_PALO_ALTO)!.get("2026-04-23")!;
    expect(day.count).toBe(2);
    expect(day.by_platform.perplexity).toBe(1);
    expect(day.by_platform.chatgpt).toBe(1);
  });

  it("invariant 1 sanity: 10 duplicates across one answer still = 1", () => {
    const dupes = Array(10).fill("https://ritzbuilders.com/locations/palo-alto");
    const obs = nativeObs({
      id: "obs-ten-dupes",
      observed_at: "2026-04-23T12:00:00Z",
      platform: "perplexity",
      citation_urls: dupes,
    });
    const out = buildNativeDayBuckets([obs], {
      ownedOnly: true,
      since: null,
      ownedUrlPathSet: OWNED_SET,
    });
    expect(out.get(RITZ_PA_PALO_ALTO)!.get("2026-04-23")!.count).toBe(1);
  });

  it("skips observations with null or empty citation_urls (pre-Commit-7 rows)", () => {
    const obs = {
      id: "obs-null",
      observed_at: "2026-04-23T12:00:00Z",
      platform: "perplexity",
      citation_urls: null,
      citation_domains: ["ritzbuilders.com"],
    };
    const out = buildNativeDayBuckets([obs], {
      ownedOnly: true,
      since: null,
      ownedUrlPathSet: OWNED_SET,
    });
    expect(out.size).toBe(0);
  });

  it("skips observations strictly before NATIVE_REGIME_START", () => {
    const benchmarkObs = nativeObs({
      id: "obs-pre-boundary",
      observed_at: "2026-04-21T12:00:00Z",
      platform: "perplexity",
      citation_urls: ["https://ritzbuilders.com/locations/palo-alto"],
    });
    const nativeObsOnBoundary = nativeObs({
      id: "obs-boundary-day",
      observed_at: "2026-04-22T00:00:00Z",
      platform: "perplexity",
      citation_urls: ["https://ritzbuilders.com/locations/palo-alto"],
    });
    const out = buildNativeDayBuckets(
      [benchmarkObs, nativeObsOnBoundary],
      { ownedOnly: true, since: null, ownedUrlPathSet: OWNED_SET },
    );
    // Only the boundary-day observation counts — the pre-boundary one is
    // the benchmark regime's territory.
    const byDate = out.get(RITZ_PA_PALO_ALTO)!;
    expect(byDate.has("2026-04-22")).toBe(true);
    expect(byDate.has("2026-04-21")).toBe(false);
    expect(byDate.get("2026-04-22")!.count).toBe(1);
  });

  it("NATIVE_REGIME_START constant is hardcoded to 2026-04-22", () => {
    // Guard: anyone editing this constant must also update the design note
    // in docs/ and the tests covering the pure-split abstain.
    expect(NATIVE_REGIME_START).toBe("2026-04-22");
  });
});

describe("denseSeries — regime tagging across the boundary (invariants 3+4)", () => {
  /**
   * Invariant 3: pre-boundary benchmark days + post-boundary native days
   * concatenate into one series without cross-regime summing. Each day
   * carries exactly the tag of its own regime.
   *
   * Invariant 4: zero-filled days (missing daily rows) STILL resolve to
   * the regime of their date, not to a default. No silent continuity.
   */
  function series(daily: UrlCitationSeries["daily"]): UrlCitationSeries {
    return {
      url: RITZ_PA_PALO_ALTO,
      raw_urls: ["https://ritzbuilders.com/locations/palo-alto"],
      is_owned: true,
      daily,
    };
  }

  it("invariant 3: concatenates benchmark days (pre) + derived days (post) without summing", () => {
    const s = series([
      { date: "2026-04-20", count: 5, by_platform: {}, source_type: "benchmark" },
      { date: "2026-04-21", count: 7, by_platform: {}, source_type: "benchmark" },
      { date: "2026-04-22", count: 2, by_platform: {}, source_type: "derived" },
      { date: "2026-04-23", count: 3, by_platform: {}, source_type: "derived" },
    ]);
    const out = denseSeries(s, { first: "2026-04-20", last: "2026-04-23" });
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ date: "2026-04-20", count: 5, source_type: "benchmark" });
    expect(out[1]).toEqual({ date: "2026-04-21", count: 7, source_type: "benchmark" });
    expect(out[2]).toEqual({ date: "2026-04-22", count: 2, source_type: "derived" });
    expect(out[3]).toEqual({ date: "2026-04-23", count: 3, source_type: "derived" });
    // No point is "mixed"; each carries exactly its regime's tag.
    for (const p of out) {
      expect(["benchmark", "derived"]).toContain(p.source_type);
    }
    // No summing: total pre = 12, total post = 5. No single day is 12+5.
    const max = Math.max(...out.map((p) => p.count));
    expect(max).toBe(7);
  });

  it("invariant 4: zero-filled missing days carry the regime of their date", () => {
    // Series has only two days of data; range asks for a week spanning
    // the boundary. Missing days should still carry the right regime tag.
    const s = series([
      { date: "2026-04-20", count: 5, by_platform: {}, source_type: "benchmark" },
      { date: "2026-04-23", count: 3, by_platform: {}, source_type: "derived" },
    ]);
    const out = denseSeries(s, { first: "2026-04-19", last: "2026-04-24" });
    expect(out).toHaveLength(6);
    const by = Object.fromEntries(out.map((p) => [p.date, p]));
    expect(by["2026-04-19"]).toEqual({
      date: "2026-04-19",
      count: 0,
      source_type: "benchmark",
    });
    expect(by["2026-04-20"]).toEqual({
      date: "2026-04-20",
      count: 5,
      source_type: "benchmark",
    });
    expect(by["2026-04-21"]).toEqual({
      date: "2026-04-21",
      count: 0,
      source_type: "benchmark",
    });
    expect(by["2026-04-22"]).toEqual({
      date: "2026-04-22",
      count: 0,
      source_type: "derived",
    });
    expect(by["2026-04-23"]).toEqual({
      date: "2026-04-23",
      count: 3,
      source_type: "derived",
    });
    expect(by["2026-04-24"]).toEqual({
      date: "2026-04-24",
      count: 0,
      source_type: "derived",
    });
  });

  it("downstream: the pure-split abstain fires correctly when a mixed-boundary series is fed to the verdict engine", async () => {
    // End-to-end contract: a change date of 2026-04-21 with a pre-window
    // (all benchmark) and a post-window (all derived) → the verdict engine
    // returns `not_enough_native_baseline` rather than a silently wrong
    // Z-score. This test guarantees denseSeries + computeUrlVerdict work
    // together per the boundary design.
    const { computeUrlVerdict } = await import("@/domains/attribution/url-verdict");
    const denseOut = denseSeries(
      series([
        { date: "2026-04-07", count: 5, by_platform: {}, source_type: "benchmark" },
        { date: "2026-04-08", count: 5, by_platform: {}, source_type: "benchmark" },
        { date: "2026-04-09", count: 5, by_platform: {}, source_type: "benchmark" },
        { date: "2026-04-10", count: 5, by_platform: {}, source_type: "benchmark" },
        { date: "2026-04-22", count: 8, by_platform: {}, source_type: "derived" },
        { date: "2026-04-23", count: 8, by_platform: {}, source_type: "derived" },
        { date: "2026-04-24", count: 8, by_platform: {}, source_type: "derived" },
      ]),
      { first: "2026-04-07", last: "2026-04-24" },
    );
    const verdict = computeUrlVerdict({
      series: denseOut,
      changeDate: "2026-04-21",
      asOfDate: "2026-04-24",
    });
    // Baseline window = Apr 7..20 (benchmark), post window = Apr 22..24 (derived).
    // Pure-split → abstain.
    expect(verdict.verdict).toBe("not_enough_native_baseline");
    expect(verdict.z).toBeNull();
    expect(verdict.explanation.summary).toMatch(/Profound benchmark/);
    expect(verdict.explanation.summary).toMatch(/native polling/);
  });
});
