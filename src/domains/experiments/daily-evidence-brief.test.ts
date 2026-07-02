import { describe, it, expect } from "vitest";
import {
  buildKeywordBrief, buildSerpEvidence, whatToSteal, buildCompetitorEvidence, buildRankMovementSentence,
  type CachedDemand, type SerpPatternLite, type EvidenceSerp,
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
      { term: "persian rugs", volume: 2400, competition: "low", difficulty: null },
      { term: "iranian food", volume: 880, competition: "medium", difficulty: null },
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
      { term: "persian rugs", volume: 1000, competition: "high", difficulty: null },
      { term: "no data term", volume: null, competition: null, difficulty: null },
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
    expect(brief!.keywords[0]).toEqual({ term: "Persian Rugs", volume: 500, competition: "low", difficulty: null });
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

  describe("item 18: difficulty upgrade ($0 cached read)", () => {
    it("carries a cached real difficulty score alongside the competition label", () => {
      const brief = buildKeywordBrief(
        ["persian rugs"],
        demand([["persian rugs", { volume: 2400, competition: "low", difficulty: 34 }]]),
      );
      expect(brief!.keywords[0]).toEqual({ term: "persian rugs", volume: 2400, competition: "low", difficulty: 34 });
    });

    it("stays unchanged (difficulty null) when no verdict run has cached a difficulty score yet", () => {
      const brief = buildKeywordBrief(
        ["persian rugs"],
        demand([["persian rugs", { volume: 2400, competition: "low" }]]),
      );
      expect(brief!.keywords[0].difficulty).toBeNull();
    });
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

describe("buildRankMovementSentence (item 17)", () => {
  it("turns a real observed delta into the literal movement sentence", () => {
    const s = buildRankMovementSentence({ fromRank: 9, toRank: 6, fromAt: "2026-06-20T00:00:00Z" });
    expect(s).toBe("You moved 9 to 6 on Google for this search since Jun 20.");
  });

  it("states a drop just as plainly (owned, not dressed up)", () => {
    const s = buildRankMovementSentence({ fromRank: 4, toRank: 8, fromAt: "2026-06-20T00:00:00Z" });
    expect(s).toBe("You moved 4 to 8 on Google for this search since Jun 20.");
  });

  it("says held when the observed position did not change", () => {
    const s = buildRankMovementSentence({ fromRank: 6, toRank: 6, fromAt: "2026-06-20T00:00:00Z" });
    expect(s).toBe("You have held spot 6 on Google for this search since Jun 20.");
  });

  it("is honest silence (null) without a delta or with a bad date", () => {
    expect(buildRankMovementSentence(null)).toBeNull();
    expect(buildRankMovementSentence(undefined)).toBeNull();
    expect(buildRankMovementSentence({ fromRank: 9, toRank: 6, fromAt: "not-a-date" })).toBeNull();
    expect(buildRankMovementSentence({ fromRank: Number.NaN, toRank: 6, fromAt: "2026-06-20T00:00:00Z" })).toBeNull();
  });

  it("never emits an em or en dash (dash guard)", () => {
    const sentences = [
      buildRankMovementSentence({ fromRank: 9, toRank: 6, fromAt: "2026-06-20T00:00:00Z" }),
      buildRankMovementSentence({ fromRank: 6, toRank: 6, fromAt: "2026-06-20T00:00:00Z" }),
      buildRankMovementSentence({ fromRank: 4, toRank: 8, fromAt: "2026-12-31T00:00:00Z" }),
    ];
    for (const s of sentences) {
      expect(s).toBeTruthy();
      expect(s).not.toMatch(/[–—]/);
    }
  });
});

describe("EvidenceSerp.featureSteal (item 25)", () => {
  it("is absent by default - honest silence when no steal candidate exists", () => {
    const ev = buildSerpEvidence(
      ["iran flag"],
      serp([["iran flag", { format: "guide", winningDomains: ["wikipedia.org"], elementImplication: "lead with facts" }]]),
    );
    expect(ev).not.toBeNull();
    expect(ev!.featureSteal).toBeUndefined();
  });

  it("carries the steal fact (owner domain, format, dash-clean sentence) when attached", () => {
    const withSteal: EvidenceSerp = {
      query: "iran flag",
      format: "guide",
      winningDomains: ["wikipedia.org"],
      whatToDo: "lead with facts",
      featureSteal: {
        ownerDomain: "personal-blog.com",
        format: "paragraph",
        sentence: 'The answer box here belongs to personal-blog.com, beatable.',
      },
    };
    expect(withSteal.featureSteal?.ownerDomain).toBe("personal-blog.com");
    expect(withSteal.featureSteal?.sentence).not.toMatch(/[–—]/);
  });
});
