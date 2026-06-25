import { describe, it, expect } from "vitest";

import { buildCtrGapRows, ctrGapClicksLeft, type CtrGapPage } from "@/app/(shell)/today-ctrgap-rows";
import { estimatedCtr } from "@/domains/recommendation-intelligence/ctr-curve";

const page = (p: string, queries: CtrGapPage["queries"]): CtrGapPage => ({ page: p, queries });
const q = (query: string, clicks: number, impressions: number, position: number) => ({ query, clicks, impressions, position });

describe("buildCtrGapRows", () => {
  it("flags a well-ranked query with CTR far below expected", () => {
    // Position 3 → expected ~10% CTR. 1000 impr, 20 clicks = 2% actual → big gap.
    const rows = buildCtrGapRows([page("https://x/a", [q("good rank low ctr", 20, 1000, 3)])], estimatedCtr);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.query).toBe("good rank low ctr");
    expect(rows[0]!.clicksLeft).toBeGreaterThan(50); // ~ (0.10 - 0.02) * 1000
  });

  it("ignores queries that already meet expected CTR", () => {
    const rows = buildCtrGapRows([page("https://x/a", [q("healthy", 100, 1000, 3)])], estimatedCtr); // 10% = expected
    expect(rows).toEqual([]);
  });

  it("ignores poorly-ranked queries (that's a ranking problem, not a snippet one)", () => {
    const rows = buildCtrGapRows([page("https://x/a", [q("low rank", 1, 1000, 25)])], estimatedCtr);
    expect(rows).toEqual([]);
  });

  it("ignores thin-impression queries", () => {
    const rows = buildCtrGapRows([page("https://x/a", [q("thin", 0, 50, 3)])], estimatedCtr);
    expect(rows).toEqual([]);
  });

  it("keeps the worst query per page and ranks by clicks left, capped", () => {
    const rows = buildCtrGapRows(
      [
        page("https://x/a", [q("small gap", 30, 600, 3), q("big gap", 10, 2000, 2)]),
        page("https://x/b", [q("med gap", 15, 800, 4)]),
      ],
      estimatedCtr,
      { cap: 1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.page).toBe("https://x/a");
    expect(rows[0]!.query).toBe("big gap"); // worst on page a
  });

  it("sums clicks left on the table", () => {
    const rows = buildCtrGapRows([page("https://x/a", [q("g", 20, 1000, 3)])], estimatedCtr);
    expect(ctrGapClicksLeft(rows)).toBe(rows[0]!.clicksLeft);
  });
});
