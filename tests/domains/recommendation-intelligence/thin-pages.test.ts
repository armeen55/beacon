import { describe, it, expect } from "vitest";

import { buildThinPages, thinImpressionsAtStake } from "@/app/(shell)/today-thin-rows";

describe("buildThinPages", () => {
  it("flags thin pages with real impressions, ranked by impressions", () => {
    const pages = [
      { url: "/a", wordCount: 186 },
      { url: "/b", wordCount: 258 },
      { url: "/deep", wordCount: 1600 }, // not thin → excluded
    ];
    const impr = new Map([["/a", 5883], ["/b", 4905], ["/deep", 9000]]);
    const rows = buildThinPages(pages, impr);
    expect(rows.map((r) => r.url)).toEqual(["/a", "/b"]); // /deep excluded; sorted by impr
    expect(rows[0]!.wordCount).toBe(186);
  });

  it("excludes thin pages with no real traffic and pages with no word count", () => {
    const pages = [
      { url: "/ghost", wordCount: 120 },
      { url: "/unknown", wordCount: 0 },
    ];
    const rows = buildThinPages(pages, new Map([["/ghost", 5], ["/unknown", 9000]]));
    expect(rows).toHaveLength(0);
  });

  it("sums impressions at stake", () => {
    const rows = buildThinPages([{ url: "/a", wordCount: 200 }, { url: "/b", wordCount: 300 }], new Map([["/a", 100], ["/b", 60]]));
    expect(thinImpressionsAtStake(rows)).toBe(160);
  });
});
