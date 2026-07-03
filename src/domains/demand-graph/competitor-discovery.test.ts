/**
 * competitor-discovery.test.ts (BEACON_500 P9 v1 420).
 *
 * Pins the pure detector: it FIRES a ranked list when a domain keeps appearing
 * across multiple tracked queries, is EMPTY when no domain clears the overlap
 * floor, excludes the own + noise domains, uses the latest capture per query,
 * and produces an honest dash-free headline. No I/O.
 */
import { describe, it, expect } from "vitest";

import {
  discoverCompetitors,
  buildHeadline,
  type CompetitorDiscoveryHistoryRow,
  type DiscoveredCompetitor,
} from "./competitor-discovery";

const OWN = "iranopedia.com";

function row(overrides: Partial<CompetitorDiscoveryHistoryRow> = {}): CompetitorDiscoveryHistoryRow {
  return {
    query: "persian rugs",
    capturedAt: "2026-07-02T00:00:00.000Z",
    ownRank: null,
    topDomains: [],
    ...overrides,
  };
}

describe("discoverCompetitors (pure detector)", () => {
  it("is EMPTY on empty input", () => {
    const r = discoverCompetitors([], OWN);
    expect(r.competitors).toEqual([]);
    expect(r.queriesWithData).toBe(0);
    expect(r.headline).toBeNull();
  });

  it("FIRES: a domain appearing across 2+ tracked queries becomes a competitor", () => {
    const rows: CompetitorDiscoveryHistoryRow[] = [
      row({ query: "persian rugs", ownRank: 6, topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/rugs" }] }),
      row({ query: "iran flags", ownRank: 5, topDomains: [{ rank: 2, domain: "rival.com", url: "https://rival.com/flags" }] }),
    ];
    const r = discoverCompetitors(rows, OWN);
    expect(r.competitors).toHaveLength(1);
    expect(r.competitors[0]!.domain).toBe("rival.com");
    expect(r.competitors[0]!.queryOverlap).toBe(2);
    expect(r.competitors[0]!.queriesBeatingYou).toBe(2);
    expect(r.competitors[0]!.bestRank).toBe(1);
    expect(r.headline).toBe("These 1 site keeps beating you on the searches you care about.");
    expect(r.headline).not.toMatch(/[—–]/);
  });

  it("is EMPTY when no domain clears the overlap floor (single-query appearance)", () => {
    const rows: CompetitorDiscoveryHistoryRow[] = [
      row({ query: "persian rugs", topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/rugs" }] }),
      row({ query: "iran flags", topDomains: [{ rank: 1, domain: "other.com", url: "https://other.com/flags" }] }),
    ];
    // Each domain appears on only ONE query -> below MIN_QUERY_OVERLAP.
    expect(discoverCompetitors(rows, OWN).competitors).toEqual([]);
  });

  it("excludes the own domain and noise/aggregator domains", () => {
    const rows: CompetitorDiscoveryHistoryRow[] = [
      row({
        query: "persian rugs",
        ownRank: 1,
        topDomains: [
          { rank: 1, domain: OWN, url: "https://iranopedia.com/rugs" },
          { rank: 2, domain: "pinterest.com", url: "https://pinterest.com/pin/1" },
        ],
      }),
      row({
        query: "iran flags",
        ownRank: 1,
        topDomains: [
          { rank: 1, domain: OWN, url: "https://iranopedia.com/flags" },
          { rank: 2, domain: "pinterest.com", url: "https://pinterest.com/pin/2" },
        ],
      }),
    ];
    expect(discoverCompetitors(rows, OWN).competitors).toEqual([]);
  });

  it("uses the LATEST capture per query (a stale appearance is not counted)", () => {
    const rows: CompetitorDiscoveryHistoryRow[] = [
      // rival.com was there in the old capture...
      row({ query: "persian rugs", capturedAt: "2026-06-01T00:00:00.000Z", topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/rugs" }] }),
      // ...but gone in the newest one for that query.
      row({ query: "persian rugs", capturedAt: "2026-07-02T00:00:00.000Z", topDomains: [{ rank: 1, domain: "other.com", url: "https://other.com/rugs" }] }),
      row({ query: "iran flags", capturedAt: "2026-07-02T00:00:00.000Z", topDomains: [{ rank: 1, domain: "rival.com", url: "https://rival.com/flags" }] }),
    ];
    const r = discoverCompetitors(rows, OWN);
    // rival.com now only overlaps ONE current query -> below floor -> not listed.
    expect(r.competitors).toEqual([]);
    expect(r.queriesWithData).toBe(2);
  });

  it("counts queriesBeatingYou honestly (tenant ranked above the competitor is not beaten)", () => {
    const rows: CompetitorDiscoveryHistoryRow[] = [
      // You are #1, rival #3 -> not beaten here.
      row({ query: "persian rugs", ownRank: 1, topDomains: [{ rank: 3, domain: "rival.com", url: "https://rival.com/rugs" }] }),
      // You are absent -> beaten here.
      row({ query: "iran flags", ownRank: null, topDomains: [{ rank: 2, domain: "rival.com", url: "https://rival.com/flags" }] }),
    ];
    const r = discoverCompetitors(rows, OWN);
    expect(r.competitors).toHaveLength(1);
    expect(r.competitors[0]!.queryOverlap).toBe(2);
    expect(r.competitors[0]!.queriesBeatingYou).toBe(1);
  });

  it("ranks by queriesBeatingYou, then overlap, then best rank", () => {
    const rows: CompetitorDiscoveryHistoryRow[] = [];
    // One capture per query holds BOTH domains: you are #1, so strong.com (#2)
    // is beaten-by-nobody... adjust: you are absent so strong.com beats you,
    // weak.com sits below you. Put both rivals in the SAME capture per query.
    for (const q of ["a", "b"]) {
      rows.push(
        row({
          query: q,
          ownRank: 3, // you at #3
          topDomains: [
            { rank: 1, domain: "strong.com", url: `https://strong.com/${q}` }, // beats you
            { rank: 5, domain: "weak.com", url: `https://weak.com/${q}` }, // below you, does not beat
          ],
        }),
      );
    }
    const r = discoverCompetitors(rows, OWN);
    expect(r.competitors.map((c) => c.domain)).toEqual(["strong.com", "weak.com"]);
    expect(r.competitors[0]!.queriesBeatingYou).toBe(2);
    expect(r.competitors[1]!.queriesBeatingYou).toBe(0);
  });

  it("buildHeadline returns the watch variant when nobody clearly beats you", () => {
    const comps: DiscoveredCompetitor[] = [
      { domain: "a.com", queryOverlap: 3, queriesBeatingYou: 0, bestRank: 2, exampleQueries: [] },
    ];
    const headline = buildHeadline(comps);
    expect(headline).toContain("showing up next to you");
    expect(headline).not.toMatch(/[—–]/);
  });

  it("buildHeadline is null on an empty list", () => {
    expect(buildHeadline([])).toBeNull();
  });
});
