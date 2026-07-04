import { describe, it, expect } from "vitest";

import {
  BACK_OF_RESULTS_CAP,
  BACK_OF_RESULTS_MIN_IMPRESSIONS,
  BACK_OF_RESULTS_MIN_POSITION,
  buildBackOfResultsRegister,
  ordinal,
  type BackOfResultsInput,
} from "./back-of-results";
import { brandTokensFor } from "./brand-split";

const BANNED_DASH = /[‒–—―]/;

const row = (over: Partial<BackOfResultsInput>): BackOfResultsInput => ({
  query: "persian saffron",
  clicks: 0,
  impressions: 400,
  position: 42,
  page: "https://example.com/saffron",
  ...over,
});

describe("ordinal (the honest 'around 40th' phrasing)", () => {
  it("handles the standard suffixes and the teens", () => {
    expect(ordinal(31)).toBe("31st");
    expect(ordinal(42)).toBe("42nd");
    expect(ordinal(63)).toBe("63rd");
    expect(ordinal(40)).toBe("40th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(111)).toBe("111th");
  });
});

describe("buildBackOfResultsRegister (deep-rank demand, invisible everywhere else)", () => {
  it("keeps the 30-to-100 band with real demand and builds the honest line", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "persian saffron", impressions: 900, position: 40 }),
    ])!;
    expect(reg.queries).toHaveLength(1);
    const q = reg.queries[0]!;
    expect(q.position).toBe(40);
    expect(q.line).toContain('You rank around 40th for "persian saffron"');
    expect(q.line).toContain("Google showed you 900 times in the last 90 days");
    expect(q.line).toContain("A dedicated page could compete properly.");
  });

  it("excludes searches inside the top 30 and below position 100", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "too shallow", impressions: 900, position: 25 }),
      row({ query: "too deep", impressions: 900, position: 120 }),
      row({ query: "just right", impressions: 900, position: 40 }),
    ])!;
    expect(reg.queries.map((q) => q.query)).toEqual(["just right"]);
  });

  it("honors the position boundaries exactly", () => {
    expect(BACK_OF_RESULTS_MIN_POSITION).toBe(30);
    const atFloor = buildBackOfResultsRegister([row({ query: "at 30", impressions: 900, position: 30 })]);
    expect(atFloor).not.toBeNull();
    const under = buildBackOfResultsRegister([row({ query: "at 29.9", impressions: 900, position: 29.9 })]);
    expect(under).toBeNull();
  });

  it("drops queries under the real-demand impressions floor", () => {
    const under = buildBackOfResultsRegister([
      row({ query: "noise", impressions: BACK_OF_RESULTS_MIN_IMPRESSIONS - 1, position: 40 }),
    ]);
    expect(under).toBeNull();
    const atFloor = buildBackOfResultsRegister([
      row({ query: "real", impressions: BACK_OF_RESULTS_MIN_IMPRESSIONS, position: 40 }),
    ]);
    expect(atFloor).not.toBeNull();
  });

  it("collapses the same query across pages, summing demand and weighting position", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "Persian Saffron", impressions: 300, position: 35, page: "https://example.com/a" }),
      row({ query: "persian saffron", impressions: 600, position: 45, page: "https://example.com/b" }),
    ])!;
    expect(reg.queries).toHaveLength(1);
    const q = reg.queries[0]!;
    expect(q.impressions).toBe(900);
    // Weighted position: (35*300 + 45*600) / 900 = 41.67 -> rounds to 42.
    expect(q.position).toBe(42);
    // Owner page is the one that took the most impressions.
    expect(q.ownerPage).toBe("https://example.com/b");
  });

  it("excludes brand searches through the one brand classifier", () => {
    const reg = buildBackOfResultsRegister(
      [
        row({ query: "iranopedia saffron", impressions: 900, position: 40 }),
        row({ query: "persian saffron", impressions: 900, position: 40 }),
      ],
      { brandTokens: brandTokensFor("Iranopedia") },
    )!;
    expect(reg.queries.map((q) => q.query)).toEqual(["persian saffron"]);
  });

  it("ranks by demand and caps the section", () => {
    const many = Array.from({ length: BACK_OF_RESULTS_CAP + 5 }, (_, i) =>
      row({ query: `q${i}`, impressions: 300 + i * 10, position: 40 }),
    );
    const reg = buildBackOfResultsRegister(many)!;
    expect(reg.queries).toHaveLength(BACK_OF_RESULTS_CAP);
    // Biggest demand first: q14 (impressions 440) leads.
    expect(reg.queries[0]!.query).toBe(`q${BACK_OF_RESULTS_CAP + 4}`);
    // The cap is honored on the sub-line count too.
    expect(reg.subLine).toContain(`${BACK_OF_RESULTS_CAP} searches`);
  });

  it("respects a custom cap and window", () => {
    const reg = buildBackOfResultsRegister(
      [
        row({ query: "a", impressions: 900, position: 40 }),
        row({ query: "b", impressions: 800, position: 40 }),
      ],
      { cap: 1, windowDays: 28 },
    )!;
    expect(reg.queries).toHaveLength(1);
    expect(reg.windowDays).toBe(28);
    expect(reg.queries[0]!.line).toContain("in the last 28 days");
  });

  it("keeps ownerPage null when no page carried impressions (never a guess)", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "pageless", impressions: 900, position: 40, page: null }),
    ])!;
    expect(reg.queries[0]!.ownerPage).toBeNull();
  });

  it("is empty-safe: nothing qualifying returns null so the section self-hides", () => {
    expect(buildBackOfResultsRegister([])).toBeNull();
    expect(buildBackOfResultsRegister([row({ query: "", impressions: 900, position: 40 })])).toBeNull();
    expect(buildBackOfResultsRegister([row({ impressions: 0, position: 40 })])).toBeNull();
  });

  it("uses singular 'search' phrasing for one query", () => {
    const reg = buildBackOfResultsRegister([row({ query: "solo", impressions: 900, position: 40 })])!;
    expect(reg.subLine).toContain("1 search where");
  });

  it("never emits an em or en dash on any rendered string", () => {
    const reg = buildBackOfResultsRegister([
      row({ query: "persian saffron", impressions: 900, position: 40 }),
    ])!;
    expect(BANNED_DASH.test(reg.subLine)).toBe(false);
    for (const q of reg.queries) expect(BANNED_DASH.test(q.line)).toBe(false);
  });
});
