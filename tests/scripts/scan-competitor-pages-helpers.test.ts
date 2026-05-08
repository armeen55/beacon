/**
 * Narrow tests for `pickTopCompetitorUrls` — the pure picker the
 * scan-competitor-pages CLI uses to select which competitor URLs to
 * snapshot. T-CompPageBlueprints Layer B (2026-05-08).
 *
 * Test contract (Layer B.2 — pure helper):
 *   1. Picks top-N by citationCount desc.
 *   2. Filters non-blueprint sourceTypes (directory, review_platform,
 *      editorial_roundup, forum).
 *   3. Drops non-http(s) URLs and dedupes.
 *
 * The scanner script's runtime contract (default dry-run, --write
 * required to persist) is enforced at the script's argv parser
 * level. Importing the script directly would invoke main(); these
 * tests target the pure picker only — the same function the script
 * imports.
 */

import { describe, expect, it } from "vitest";

import {
  pickTopCompetitorUrls,
  type CompetitorEvidenceLike,
} from "@/domains/pages/competitor-page-snapshots";

function row(
  over: Partial<CompetitorEvidenceLike> = {},
): CompetitorEvidenceLike {
  return {
    pageUrl: "https://example.com/x",
    domain: "example.com",
    citationCount: 0,
    sourceType: "competitor_service_page",
    ...over,
  };
}

describe("pickTopCompetitorUrls", () => {
  it("sorts by citationCount descending", () => {
    const out = pickTopCompetitorUrls(
      [
        row({ pageUrl: "https://a.com/1", domain: "a.com", citationCount: 50 }),
        row({ pageUrl: "https://b.com/2", domain: "b.com", citationCount: 200 }),
        row({ pageUrl: "https://c.com/3", domain: "c.com", citationCount: 100 }),
      ],
      10,
    );
    expect(out.map((t) => t.url)).toEqual([
      "https://b.com/2",
      "https://c.com/3",
      "https://a.com/1",
    ]);
  });

  it("respects the limit", () => {
    const out = pickTopCompetitorUrls(
      Array.from({ length: 10 }, (_, i) =>
        row({
          pageUrl: `https://a${i}.com/x`,
          domain: `a${i}.com`,
          citationCount: 100 - i,
        }),
      ),
      3,
    );
    expect(out).toHaveLength(3);
    expect(out.map((t) => t.url)).toEqual([
      "https://a0.com/x",
      "https://a1.com/x",
      "https://a2.com/x",
    ]);
  });

  it("drops directory / review-platform / editorial-roundup / forum sourceTypes", () => {
    const out = pickTopCompetitorUrls(
      [
        row({ pageUrl: "https://x.com/svc", sourceType: "competitor_service_page", citationCount: 100 }),
        row({ pageUrl: "https://yelp.com/x", sourceType: "review_platform", citationCount: 500 }),
        row({ pageUrl: "https://houzz.com/x", sourceType: "directory", citationCount: 600 }),
        row({ pageUrl: "https://reddit.com/r/x", sourceType: "forum", citationCount: 400 }),
        row({ pageUrl: "https://nytimes.com/x", sourceType: "editorial_roundup", citationCount: 700 }),
      ],
      10,
    );
    expect(out.map((t) => t.url)).toEqual(["https://x.com/svc"]);
  });

  it("drops non-http(s) URLs (defensive — never fetch ftp:/javascript:/empty)", () => {
    const out = pickTopCompetitorUrls(
      [
        row({ pageUrl: "https://a.com/1", citationCount: 50 }),
        row({ pageUrl: "ftp://b.com/2", citationCount: 200 }),
        row({ pageUrl: "javascript:alert(1)", citationCount: 999 }),
        row({ pageUrl: "", citationCount: 100 }),
      ],
      10,
    );
    expect(out.map((t) => t.url)).toEqual(["https://a.com/1"]);
  });

  it("dedupes by URL — first occurrence wins", () => {
    const out = pickTopCompetitorUrls(
      [
        row({ pageUrl: "https://a.com/x", citationCount: 100 }),
        row({ pageUrl: "https://a.com/x", citationCount: 999 }), // duplicate
      ],
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0].citationCount).toBe(100);
  });

  it("returns empty when limit is 0 or negative or input is empty", () => {
    expect(pickTopCompetitorUrls([], 5)).toEqual([]);
    expect(
      pickTopCompetitorUrls([row({ citationCount: 100 })], 0),
    ).toEqual([]);
    expect(
      pickTopCompetitorUrls([row({ citationCount: 100 })], -1),
    ).toEqual([]);
  });

  it("preserves citationCount in the output row", () => {
    const out = pickTopCompetitorUrls(
      [row({ pageUrl: "https://a.com/x", domain: "a.com", citationCount: 582 })],
      5,
    );
    expect(out[0]).toEqual({
      url: "https://a.com/x",
      domain: "a.com",
      citationCount: 582,
    });
  });

  it("treats missing sourceType as a competitor (no filter applies)", () => {
    const out = pickTopCompetitorUrls(
      [
        {
          pageUrl: "https://x.com/x",
          domain: "x.com",
          citationCount: 50,
        },
      ],
      5,
    );
    expect(out).toHaveLength(1);
  });
});
