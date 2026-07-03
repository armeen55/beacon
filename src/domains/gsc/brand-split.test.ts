import { describe, it, expect } from "vitest";

import {
  brandTokensFor,
  brandTokensForConfig,
  buildScoreboardBrandLens,
  isBrandQuery,
  type BrandSplitRow,
} from "./brand-split";
import {
  brandTokensFor as reExportedTokens,
  isBrandQuery as reExportedIsBrand,
} from "@/domains/forecast/tenant-ctr-curve";

const BANNED_DASH = /[‒–—―]/;

describe("brandTokensFor (moved from R9, byte-identical behavior)", () => {
  it("multi-word brand yields the full name plus the leading word", () => {
    expect(brandTokensFor("Ritz Builders")).toEqual(["ritz builders", "ritz"]);
  });

  it("single-word brand yields just the one token", () => {
    expect(brandTokensFor("Iranopedia")).toEqual(["iranopedia"]);
  });

  it("a short leading word (under 3 chars) is not a token on its own", () => {
    expect(brandTokensFor("AJ Construction")).toEqual(["aj construction"]);
  });

  it("empty/null name yields no tokens", () => {
    expect(brandTokensFor("")).toEqual([]);
    expect(brandTokensFor(null)).toEqual([]);
    expect(brandTokensFor(undefined)).toEqual([]);
  });

  it("tenant-ctr-curve re-exports the SAME functions (one implementation)", () => {
    expect(reExportedTokens).toBe(brandTokensFor);
    expect(reExportedIsBrand).toBe(isBrandQuery);
  });
});

describe("isBrandQuery", () => {
  const tokens = brandTokensFor("Ritz Builders");

  it("matches the full brand and the leading word, case-insensitive", () => {
    expect(isBrandQuery("Ritz Builders reviews", tokens)).toBe(true);
    expect(isBrandQuery("ritz kitchen remodel", tokens)).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(isBrandQuery("kitchen remodel near me", tokens)).toBe(false);
  });

  it("multi-word brand with a short first word only matches the full name", () => {
    const aj = brandTokensFor("AJ Construction");
    expect(isBrandQuery("aj construction reviews", aj)).toBe(true);
    expect(isBrandQuery("aj plumbing", aj)).toBe(false);
  });

  it("no tokens means nothing is brand (never a guess)", () => {
    expect(isBrandQuery("ritz builders", [])).toBe(false);
  });
});

describe("brandTokensForConfig", () => {
  it("adds the domain label and dedupes against the name", () => {
    expect(brandTokensForConfig({ name: "Iranopedia", domain: "https://www.iranopedia.com" })).toEqual([
      "iranopedia",
    ]);
  });

  it("domain-only config still yields the label", () => {
    expect(brandTokensForConfig({ domain: "iranopedia.com" })).toEqual(["iranopedia"]);
  });

  it("a too-short domain label is skipped (would classify half the language)", () => {
    expect(brandTokensForConfig({ domain: "go.com" })).toEqual([]);
  });

  it("empty config yields no tokens", () => {
    expect(brandTokensForConfig({})).toEqual([]);
    expect(brandTokensForConfig({ name: "", domain: "" })).toEqual([]);
  });
});

describe("buildScoreboardBrandLens", () => {
  /** 14 ascending reported dates: Jun 1 .. Jun 14. */
  const dates = Array.from({ length: 14 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
  const tokens = brandTokensFor("Iranopedia");

  const row = (date: string, query: string, clicks: number): BrandSplitRow => ({ date, query, clicks });

  it("splits clicks brand vs non-brand on the scoreboard's own week windows", () => {
    const rows: BrandSplitRow[] = [
      // prior 7 (Jun 1-7): 10 non-brand, 5 brand
      row("2026-06-02", "persian recipes", 10),
      row("2026-06-03", "iranopedia", 5),
      // last 7 (Jun 8-14): 12 non-brand, 7 brand
      row("2026-06-09", "persian boy names", 8),
      row("2026-06-10", "tehran travel guide", 4),
      row("2026-06-12", "iranopedia persian names", 7),
      // outside both windows: ignored
      row("2026-05-20", "persian cats", 99),
    ];
    const lens = buildScoreboardBrandLens({ rows, tokens, reportedDates: dates })!;
    expect(lens.prior7).toEqual({ nonBrandClicks: 10, brandClicks: 5 });
    expect(lens.last7).toEqual({ nonBrandClicks: 12, brandClicks: 7 });
    expect(lens.nonBrandDeltaPct).toBe(20);
    expect(lens.subLine).toContain("Non-brand clicks: 12");
    expect(lens.subLine).toContain("the growth that finds NEW people");
    expect(lens.subLine).toContain("up 20% vs the week before");
    expect(lens.subLine).toContain("Counted from searches where Google shows me the words.");
  });

  it("null delta when the prior week had no non-brand clicks", () => {
    const rows = [row("2026-06-09", "persian recipes", 6)];
    const lens = buildScoreboardBrandLens({ rows, tokens, reportedDates: dates })!;
    expect(lens.nonBrandDeltaPct).toBeNull();
    expect(lens.subLine).toContain("Non-brand clicks: 6");
    expect(lens.subLine).not.toContain("vs the week before");
  });

  it("returns null without brand tokens, under 14 reported days, or with no visible clicks", () => {
    const rows = [row("2026-06-09", "persian recipes", 6)];
    expect(buildScoreboardBrandLens({ rows, tokens: [], reportedDates: dates })).toBeNull();
    expect(buildScoreboardBrandLens({ rows, tokens, reportedDates: dates.slice(0, 10) })).toBeNull();
    expect(buildScoreboardBrandLens({ rows: [], tokens, reportedDates: dates })).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const lens = buildScoreboardBrandLens({
      rows: [row("2026-06-09", "persian recipes", 6), row("2026-06-02", "persian food", 9)],
      tokens,
      reportedDates: dates,
    })!;
    expect(BANNED_DASH.test(lens.subLine)).toBe(false);
  });
});
