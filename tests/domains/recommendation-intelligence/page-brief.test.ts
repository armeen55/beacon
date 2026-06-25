import { describe, it, expect } from "vitest";

import { buildPageBriefMarkdown, type PageBriefInput } from "@/app/(shell)/workbench/page-brief";

const base: PageBriefInput = {
  path: "/persian-female-first-names",
  canonUrl: "https://iranopedia.com/persian-female-first-names",
  title: "Persian Girl Names",
  h1: "Persian Female First Names",
  metaDescription: null,
  topQueries: [
    { query: "persian girl names", impressions: 6041, clicks: 73, position: 5.7 },
    { query: "iranian girl names", impressions: 900, clicks: 10, position: 8.2 },
  ],
  strikingDistance: [{ keyword: "persian girl names", volume: 6041, position: 5.7 }],
  bestMove: "Sharpen the title to climb from position 5.7 to the top 3.",
};

describe("buildPageBriefMarkdown", () => {
  it("renders the page header, do-this-first, on-page, quick wins, and a query table", () => {
    const md = buildPageBriefMarkdown(base, { dateLabel: "2026-06-25" });
    expect(md).toContain("# Page brief: /persian-female-first-names");
    expect(md).toContain("https://iranopedia.com/persian-female-first-names");
    expect(md).toContain("_Generated 2026-06-25_");
    expect(md).toContain("## ▶ Do this first");
    expect(md).toContain("Sharpen the title");
    expect(md).toContain("**Title:** Persian Girl Names");
    expect(md).toContain("**Meta description:** _(none)_"); // null → explicit none
    expect(md).toContain("## Quick wins");
    expect(md).toContain('"persian girl names" — position 5.7');
    expect(md).toContain("| Query | Position | Clicks/mo | Impressions/mo |");
    expect(md).toContain("| persian girl names | 5.7 | 73 | 6,041 |");
  });

  it("omits empty sections + the do-this-first when there's no move", () => {
    const md = buildPageBriefMarkdown({
      path: "/x",
      topQueries: [],
      strikingDistance: [],
      title: "X",
    });
    expect(md).not.toContain("## ▶ Do this first");
    expect(md).not.toContain("## Quick wins");
    expect(md).not.toContain("## What this page ranks for");
    expect(md).not.toMatch(/_Generated \d/); // no date stamp when not given
    expect(md).toContain("# Page brief: /x");
  });

  it("caps the query table at 15 rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ query: `q${i}`, impressions: 100, clicks: 1, position: 5 }));
    const md = buildPageBriefMarkdown({ path: "/x", topQueries: many, strikingDistance: [] });
    const rows = md.split("\n").filter((l) => l.startsWith("| q"));
    expect(rows).toHaveLength(15);
  });
});
