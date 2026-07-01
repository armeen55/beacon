import { describe, it, expect } from "vitest";
import {
  buildKeywordBrief, buildSerpEvidence, whatToSteal, buildCompetitorEvidence,
  type CachedDemand, type SerpPatternLite,
} from "./daily-evidence-brief";

function demand(entries: Array<[string, CachedDemand]>): Map<string, CachedDemand> {
  return new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
}

describe("buildKeywordBrief", () => {
  it("returns null when no query has cached demand", () => {
    const brief = buildKeywordBrief(["persian rugs", "iranian food"], demand([]));
    expect(brief).toBeNull();
  });

  it("surfaces volume + competition for the page's queries, best-effort", () => {
    const brief = buildKeywordBrief(
      ["persian rugs", "iranian food"],
      demand([
        ["persian rugs", { volume: 2400, competition: "low" }],
        ["iranian food", { volume: 880, competition: "medium" }],
      ]),
    );
    expect(brief).not.toBeNull();
    expect(brief!.keywords).toEqual([
      { term: "persian rugs", volume: 2400, competition: "low" },
      { term: "iranian food", volume: 880, competition: "medium" },
    ]);
    expect(brief!.addressableVolume).toBe(3280);
  });

  it("keeps a query with no cached demand as a null row when at least one other has demand", () => {
    const brief = buildKeywordBrief(
      ["persian rugs", "no data term"],
      demand([["persian rugs", { volume: 1000, competition: "high" }]]),
    );
    expect(brief).not.toBeNull();
    expect(brief!.keywords).toEqual([
      { term: "persian rugs", volume: 1000, competition: "high" },
      { term: "no data term", volume: null, competition: null },
    ]);
    // Only the known volume counts toward addressable volume.
    expect(brief!.addressableVolume).toBe(1000);
  });

  it("is case-insensitive and de-duplicates queries", () => {
    const brief = buildKeywordBrief(
      ["Persian Rugs", "persian rugs", "PERSIAN RUGS"],
      demand([["persian rugs", { volume: 500, competition: "low" }]]),
    );
    expect(brief!.keywords).toHaveLength(1);
    expect(brief!.keywords[0]).toEqual({ term: "Persian Rugs", volume: 500, competition: "low" });
  });

  it("caps the number of rows at max (default 6)", () => {
    const queries = Array.from({ length: 10 }, (_, i) => `term ${i}`);
    const brief = buildKeywordBrief(
      queries,
      demand([["term 0", { volume: 100, competition: "low" }]]),
    );
    expect(brief!.keywords).toHaveLength(6);
  });

  it("returns addressableVolume null when demand exists only as competition (no volume)", () => {
    const brief = buildKeywordBrief(
      ["persian rugs"],
      demand([["persian rugs", { volume: null, competition: "medium" }]]),
    );
    expect(brief).not.toBeNull();
    expect(brief!.addressableVolume).toBeNull();
  });
});

function serp(entries: Array<[string, SerpPatternLite]>): Map<string, SerpPatternLite> {
  return new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
}

describe("buildSerpEvidence", () => {
  it("returns null when no query has a cached SERP pattern", () => {
    expect(buildSerpEvidence(["iran flag"], serp([]))).toBeNull();
  });

  it("picks the first (best) query with a real pattern and caps winning domains", () => {
    const ev = buildSerpEvidence(
      ["iran flag", "persian flag"],
      serp([
        ["iran flag", { format: "guide", winningDomains: ["wikipedia.org", "britannica.com", "worldatlas.com", "flagpedia.net"], elementImplication: "lead with a quick-facts table" }],
      ]),
    );
    expect(ev).toEqual({
      query: "iran flag",
      format: "guide",
      winningDomains: ["wikipedia.org", "britannica.com", "worldatlas.com"],
      whatToDo: "lead with a quick-facts table",
    });
  });

  it("skips a pattern with no winning domains and is case-insensitive", () => {
    const ev = buildSerpEvidence(
      ["Iran Flag", "cities of iran"],
      serp([
        ["iran flag", { format: "guide", winningDomains: [], elementImplication: "x" }],
        ["cities of iran", { format: "list", winningDomains: ["wikipedia.org"], elementImplication: "a ranked list" }],
      ]),
    );
    expect(ev?.query).toBe("cities of iran");
    expect(ev?.format).toBe("list");
  });
});

describe("whatToSteal", () => {
  it("returns null for no facts / thin page", () => {
    expect(whatToSteal(null)).toBeNull();
    expect(whatToSteal({})).toBeNull();
  });

  it("names the top 3 highest-leverage stealable elements", () => {
    const steal = whatToSteal({
      hasAnswerBlock: true, hasFaq: true, faqQuestionCount: 8,
      hasToolOrCalculator: true, schemaTypes: ["FAQPage"], wordCount: 2400, sectionCount: 7,
    });
    expect(steal).toBe("a direct answer at the top, an FAQ section (8 questions), an interactive tool");
  });

  it("includes depth + sections when those are the only signals", () => {
    expect(whatToSteal({ wordCount: 1800, sectionCount: 6 })).toBe("more depth (about 1800 words), 6 clear sections");
  });
});

describe("buildCompetitorEvidence", () => {
  it("returns null without a domain or without anything to steal", () => {
    expect(buildCompetitorEvidence({ domain: "", url: "x", facts: { hasFaq: true } })).toBeNull();
    expect(buildCompetitorEvidence({ domain: "x.com", url: "x", facts: {} })).toBeNull();
  });

  it("strips www and returns domain + url + steal line", () => {
    const ev = buildCompetitorEvidence({
      domain: "www.wikipedia.org",
      url: "https://en.wikipedia.org/wiki/Flag_of_Iran",
      facts: { hasAnswerBlock: true, hasFaq: true },
    });
    expect(ev).toEqual({
      domain: "wikipedia.org",
      url: "https://en.wikipedia.org/wiki/Flag_of_Iran",
      whatToSteal: "a direct answer at the top, an FAQ section",
    });
  });
});
