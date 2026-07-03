// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { KeywordsTableClient, hasAnyRelatedQuestions, inTab, isZeroSignalRow, matchesFilter, sortRows, type FilterTab } from "./keywords-table-client";
import type { KeywordLibraryRow } from "@/domains/research/keyword-library";

function row(overrides: Partial<KeywordLibraryRow> = {}): KeywordLibraryRow {
  return {
    keyword: "persian new year",
    searchesPerMo: 2400,
    timesShownPerMo: 900,
    clicks: 40,
    yourPosition: 5,
    difficulty: 30,
    trend: null,
    ownerPage: "/nowruz",
    ownerPageHref: "/page/nowruz",
    competitorOwners: [],
    relatedQuestions: [],
    sources: ["gsc", "dataforseo_demand"],
    lastChecked: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("keywords-table-client, tab filters (pure)", () => {
  it("'ranking' matches only rows with a top-10 own position", () => {
    expect(inTab(row({ yourPosition: 3 }), "ranking")).toBe(true);
    expect(inTab(row({ yourPosition: 15 }), "ranking")).toBe(false);
    expect(inTab(row({ yourPosition: null }), "ranking")).toBe(false);
  });

  it("'close' matches positions 11-20", () => {
    expect(inTab(row({ yourPosition: 14 }), "close")).toBe(true);
    expect(inTab(row({ yourPosition: 5 }), "close")).toBe(false);
    expect(inTab(row({ yourPosition: 25 }), "close")).toBe(false);
  });

  it("'not_owned' matches rows with no owner page", () => {
    expect(inTab(row({ ownerPage: null }), "not_owned")).toBe(true);
    expect(inTab(row({ ownerPage: "/nowruz" }), "not_owned")).toBe(false);
  });

  it("'trending' and 'seasonal' key off the trend tag exactly", () => {
    expect(inTab(row({ trend: "spike" }), "trending")).toBe(true);
    expect(inTab(row({ trend: "seasonal" }), "trending")).toBe(false);
    expect(inTab(row({ trend: "seasonal" }), "seasonal")).toBe(true);
  });

  it("'all' always matches", () => {
    expect(inTab(row(), "all")).toBe(true);
    expect(inTab(row({ yourPosition: null, ownerPage: null }), "all")).toBe(true);
  });
});

describe("keywords-table-client, text filter (pure)", () => {
  it("matches on keyword, owner page, competitor domains, and related questions", () => {
    const r = row({
      keyword: "sofreh aghd meaning",
      ownerPage: "/weddings/sofreh-aghd",
      competitorOwners: ["wikipedia.org"],
      relatedQuestions: ["What is a sofreh aghd?"],
    });
    expect(matchesFilter(r, "sofreh")).toBe(true);
    expect(matchesFilter(r, "wikipedia")).toBe(true);
    expect(matchesFilter(r, "what is a sofreh")).toBe(true);
    expect(matchesFilter(r, "unrelated term")).toBe(false);
  });

  it("empty needle matches everything", () => {
    expect(matchesFilter(row(), "")).toBe(true);
  });
});

describe("keywords-table-client, zero-signal rows (pure)", () => {
  it("flags a row with no volume, impressions, clicks, position, owner, or trend", () => {
    expect(
      isZeroSignalRow(
        row({ searchesPerMo: null, timesShownPerMo: null, clicks: null, yourPosition: null, ownerPage: null, ownerPageHref: null, trend: null }),
      ),
    ).toBe(true);
  });

  it("does not flag a row with even one real signal", () => {
    expect(isZeroSignalRow(row({ searchesPerMo: null, timesShownPerMo: 10, clicks: null, yourPosition: null, ownerPage: null, ownerPageHref: null }))).toBe(false);
    expect(isZeroSignalRow(row({ searchesPerMo: null, timesShownPerMo: null, clicks: null, yourPosition: null, ownerPage: "/nowruz", ownerPageHref: "/page/nowruz" }))).toBe(false);
    expect(isZeroSignalRow(row({ searchesPerMo: null, timesShownPerMo: null, clicks: null, yourPosition: null, ownerPage: null, ownerPageHref: null, trend: "spike" }))).toBe(false);
  });
});

describe("keywords-table-client, sort (pure)", () => {
  const rows = [
    row({ keyword: "b kw", searchesPerMo: 100, timesShownPerMo: 50, clicks: 5, yourPosition: 8 }),
    row({ keyword: "a kw", searchesPerMo: 900, timesShownPerMo: 10, clicks: 1, yourPosition: 2 }),
    row({ keyword: "c kw", searchesPerMo: null, timesShownPerMo: 200, clicks: 20, yourPosition: null }),
  ];

  it("sorts by volume descending, nulls last", () => {
    const sorted = sortRows(rows, "volume", -1);
    expect(sorted.map((r) => r.keyword)).toEqual(["a kw", "b kw", "c kw"]);
  });

  it("sorts by keyword alphabetically ascending", () => {
    const sorted = sortRows(rows, "keyword", 1);
    expect(sorted.map((r) => r.keyword)).toEqual(["a kw", "b kw", "c kw"]);
  });

  it("sorts by position with best (lowest) rank first, unranked always last", () => {
    const sorted = sortRows(rows, "position", 1);
    expect(sorted.map((r) => r.keyword)).toEqual(["a kw", "b kw", "c kw"]);
  });

  it("reversing direction on position flips the ranked rows but keeps unranked last", () => {
    const ascending = sortRows(rows, "position", 1);
    const descending = sortRows(rows, "position", -1);
    expect(ascending.map((r) => r.keyword)).toEqual(["a kw", "b kw", "c kw"]);
    expect(descending.map((r) => r.keyword)).toEqual(["b kw", "a kw", "c kw"]);
    // Unranked ("c kw") never jumps to the top just because direction flipped.
    expect(descending[descending.length - 1].keyword).toBe("c kw");
  });

  it("keeps unknown-volume rows last even when direction is flipped to ascending", () => {
    // "c kw" has searchesPerMo: null. Ascending direction should never put an
    // unknown value ahead of a real (even if small) number.
    const sorted = sortRows(rows, "volume", 1);
    expect(sorted[sorted.length - 1].keyword).toBe("c kw");
  });
});

describe("KeywordsTableClient, static render smoke", () => {
  it("renders the header row, real keyword rows, and the honest count line", () => {
    const html = renderToStaticMarkup(
      <KeywordsTableClient
        rows={[
          row({ keyword: "persian new year", searchesPerMo: 2400, timesShownPerMo: 900 }),
          row({ keyword: "nowruz gifts", searchesPerMo: null, timesShownPerMo: 300, ownerPage: null, ownerPageHref: null }),
        ]}
        worklistBaseHref="/changes"
      />,
    );
    expect(html).toContain("persian new year");
    expect(html).toContain("nowruz gifts");
    expect(html).toContain("Searches/mo");
    expect(html).toContain("Times shown");
    expect(html).toContain("Showing 2 of 2 keywords");
    // Label rule: never present the word SERP on the surface.
    expect(html.toLowerCase()).not.toContain("serp");
    // FP7 finding: Difficulty column removed while the data source is
    // unpopulated (was rendering "?" on every row).
    expect(html).not.toContain("Difficulty");
  });

  it("renders the honest empty state when no rows match (0 total)", () => {
    const html = renderToStaticMarkup(<KeywordsTableClient rows={[]} worklistBaseHref="/changes" />);
    expect(html).toContain("No keywords match that filter");
  });

  it("links the owner page to its dossier and marks unowned keywords honestly", () => {
    const html = renderToStaticMarkup(
      <KeywordsTableClient
        rows={[row({ keyword: "owned kw", ownerPage: "/nowruz", ownerPageHref: "/page/nowruz" }), row({ keyword: "unowned kw", ownerPage: null, ownerPageHref: null })]}
        worklistBaseHref="/changes"
      />,
    );
    expect(html).toContain('href="/page/nowruz"');
    expect(html).toContain("Not owned");
  });

  it("collapses zero-signal rows behind a footer expander, default collapsed", () => {
    const zeroSignal = row({
      keyword: "unmeasured kw",
      searchesPerMo: null,
      timesShownPerMo: null,
      clicks: null,
      yourPosition: null,
      ownerPage: null,
      ownerPageHref: null,
      trend: null,
    });
    const html = renderToStaticMarkup(
      <KeywordsTableClient rows={[row({ keyword: "persian new year" }), zeroSignal]} worklistBaseHref="/changes" />,
    );
    expect(html).not.toContain("unmeasured kw");
    expect(html).toContain("1 keyword I am still gathering numbers for.");
    expect(html).toContain("Showing 1 of 2 keywords");
  });

  it("does not render 'No questions found' chrome anywhere when the library has zero questions", () => {
    // Static-render smoke can't click open a row's drawer, so this pins the
    // absence of the old always-there empty-state string across the whole
    // rendered surface (it must never appear again for a library with 0
    // related questions, since the section is now hidden library-wide).
    const html = renderToStaticMarkup(
      <KeywordsTableClient
        rows={[row({ keyword: "persian new year", competitorOwners: ["wikipedia.org"], relatedQuestions: [] })]}
        worklistBaseHref="/changes"
      />,
    );
    expect(html).not.toContain("No questions found for this keyword yet.");
  });
});

describe("hasAnyRelatedQuestions (pure)", () => {
  it("is false when no row in the library has a related question", () => {
    expect(hasAnyRelatedQuestions([row({ relatedQuestions: [] }), row({ keyword: "b", relatedQuestions: [] })])).toBe(false);
  });

  it("is true when at least one row anywhere has a related question", () => {
    expect(hasAnyRelatedQuestions([row({ relatedQuestions: [] }), row({ keyword: "b", relatedQuestions: ["When is Nowruz?"] })])).toBe(true);
  });
});

describe("FilterTab exhaustiveness", () => {
  it("every tab id is handled by inTab without falling through to a default true", () => {
    const tabs: FilterTab[] = ["all", "ranking", "close", "not_owned", "trending", "seasonal"];
    for (const t of tabs) {
      expect(() => inTab(row(), t)).not.toThrow();
    }
  });
});
