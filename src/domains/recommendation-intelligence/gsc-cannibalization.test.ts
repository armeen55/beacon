import { describe, expect, it } from "vitest";

import { groupCannibalizationRows } from "./gsc-cannibalization";

/** RPC row builder (pos_weighted = position × impressions, the RPC convention). */
function r(query: string, url: string, clicks: number, impressions: number, position: number) {
  return { query, url, clicks, impressions, pos_weighted: position * impressions };
}

describe("groupCannibalizationRows", () => {
  it("groups a query with 2+ own URLs into one case, lead = best position", () => {
    const cases = groupCannibalizationRows([
      r("iran flag", "https://x.test/iran-flags", 1, 2000, 4.0),
      r("iran flag", "https://x.test/iran-flags/history", 0, 1394, 8.0),
      r("persian boy names", "https://x.test/persian-male-names", 217, 2068, 1.0), // single URL
    ]);
    // Only the 2-URL query is a cannibalization case.
    expect(cases).toHaveLength(1);
    const c = cases[0];
    expect(c.query).toBe("iran flag");
    expect(c.urlCount).toBe(2);
    expect(c.totalClicks).toBe(1);
    expect(c.totalImpressions).toBe(3394);
    // Lead = best (lowest) position; competitors sorted best-first.
    expect(c.bestPosition).toBe(4);
    expect(c.competingUrls[0].position).toBe(4);
    expect(c.leadUrl).toContain("/iran-flags");
    // Combined impressions-weighted position is between the two.
    expect(c.weightedPosition).toBeGreaterThan(4);
    expect(c.weightedPosition).toBeLessThan(8);
  });

  it("drops queries where only one own URL ranks", () => {
    const cases = groupCannibalizationRows([
      r("solo query", "https://x.test/only", 5, 500, 3.0),
    ]);
    expect(cases).toEqual([]);
  });

  it("ranks cases by combined impressions (worst first)", () => {
    const cases = groupCannibalizationRows([
      r("small", "https://x.test/a", 0, 120, 5),
      r("small", "https://x.test/b", 0, 120, 9),
      r("big", "https://x.test/c", 0, 2000, 4),
      r("big", "https://x.test/d", 0, 1500, 7),
    ]);
    expect(cases.map((c) => c.query)).toEqual(["big", "small"]);
  });

  it("merges rows that canonicalize to the same page (no self-cannibalization)", () => {
    // Same page via trailing slash / fragment should collapse, not look like 2 URLs.
    const cases = groupCannibalizationRows([
      r("q", "https://x.test/page", 1, 500, 5),
      r("q", "https://x.test/page#frag", 1, 500, 5),
    ]);
    expect(cases).toEqual([]);
  });
});
