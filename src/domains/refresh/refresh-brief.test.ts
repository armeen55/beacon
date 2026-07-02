import { describe, expect, it } from "vitest";
import {
  buildRefreshBrief,
  findNewQueryGaps,
  findWinnerSectionGap,
  buildWinnerSectionSentence,
  buildNewQueryGapSentence,
  buildLosingQuerySentence,
  briefSentences,
  type LosingQuery,
} from "./refresh-brief";
import type { RefreshCandidateRank } from "./decay-queue";

const RANK: RefreshCandidateRank = {
  page: "/persian-cats",
  clicksLostPerMonth: 60,
  clicksLostQuarter: 180,
  positionDrift: 1.9,
  priorClicks: 480,
  currentClicks: 300,
  priorPosition: 4.2,
  currentPosition: 6.1,
  currentImpressions: 7000,
  sentence: "This page earned 160 clicks a month last quarter and is fading, down about 60 clicks a month since. A refresh usually brings these back.",
};

describe("findNewQueryGaps", () => {
  it("flags a high-impression query with no matching H2", () => {
    const gaps = findNewQueryGaps(
      [{ query: "persian cat price 2026", impressions: 500 }],
      ["Persian Cat History", "Grooming Tips"],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.query).toBe("persian cat price 2026");
  });

  it("does not flag a query already covered by an existing H2", () => {
    const gaps = findNewQueryGaps(
      [{ query: "persian cat grooming tips", impressions: 500 }],
      ["Persian Cat Grooming Tips"],
    );
    expect(gaps).toEqual([]);
  });

  it("floors out low-impression queries", () => {
    const gaps = findNewQueryGaps([{ query: "obscure persian cat fact", impressions: 5 }], ["History"]);
    expect(gaps).toEqual([]);
  });

  it("treats a page with no H2s at all as fully uncovered", () => {
    const gaps = findNewQueryGaps([{ query: "persian cat price", impressions: 100 }], []);
    expect(gaps).toHaveLength(1);
  });

  it("caps at the max gaps per part, best-impression-first", () => {
    const distinctTopics = ["pricing plans", "shipping policy", "return process", "warranty terms", "size chart", "care instructions"];
    const queries = distinctTopics.map((query, i) => ({ query, impressions: 100 - i }));
    const gaps = findNewQueryGaps(queries, ["Completely Different Heading"]);
    expect(gaps.length).toBeLessThanOrEqual(3);
    expect(gaps[0]!.query).toBe("pricing plans");
  });
});

describe("findWinnerSectionGap", () => {
  it("returns null when there is no competitor teardown", () => {
    expect(findWinnerSectionGap(null, ["History"])).toBeNull();
  });

  it("returns null when the competitor outline is empty", () => {
    expect(findWinnerSectionGap({ domain: "rival.com", outline: [], freshnessDate: null }, ["History"])).toBeNull();
  });

  it("names a competitor section this page has no equivalent H2 for", () => {
    const gap = findWinnerSectionGap(
      { domain: "rival.com", outline: ["2026 Pricing Guide"], freshnessDate: "2026-01-15" },
      ["History", "Grooming"],
    );
    expect(gap).not.toBeNull();
    expect(gap!.sectionTitle).toBe("2026 Pricing Guide");
    expect(gap!.domain).toBe("rival.com");
  });

  it("returns null when every competitor section already has a matching H2", () => {
    const gap = findWinnerSectionGap(
      { domain: "rival.com", outline: ["Grooming Tips"], freshnessDate: null },
      ["Grooming Tips For Persian Cats"],
    );
    expect(gap).toBeNull();
  });
});

describe("sentence builders (honesty + no dashes)", () => {
  it("buildWinnerSectionSentence names the domain, section, and year when known", () => {
    const s = buildWinnerSectionSentence({ domain: "rival.com", sectionTitle: "2026 Pricing", freshnessDate: "2026-03-01" });
    expect(s).toContain("rival.com");
    expect(s).toContain("2026 Pricing");
    expect(s).toContain("2026");
    expect(s).not.toMatch(/[–—]/);
  });

  it("buildWinnerSectionSentence omits the year when freshnessDate is unknown", () => {
    const s = buildWinnerSectionSentence({ domain: "rival.com", sectionTitle: "FAQ", freshnessDate: null });
    expect(s).toContain("rival.com");
    expect(s).not.toMatch(/[–—]/);
  });

  it("buildNewQueryGapSentence returns null for an empty list (honest absence)", () => {
    expect(buildNewQueryGapSentence([])).toBeNull();
  });

  it("buildLosingQuerySentence returns null for an empty list (honest absence)", () => {
    expect(buildLosingQuerySentence([])).toBeNull();
  });

  it("buildLosingQuerySentence names the top query and drop percent", () => {
    const losing: LosingQuery[] = [{ query: "persian cat price", priorClicks: 100, recentClicks: 40, dropPct: 60 }];
    const s = buildLosingQuerySentence(losing);
    expect(s).toContain("persian cat price");
    expect(s).toContain("60%");
    expect(s).not.toMatch(/[–—]/);
  });
});

describe("buildRefreshBrief", () => {
  it("assembles all three evidence parts when every source has data", () => {
    const brief = buildRefreshBrief({
      rank: RANK,
      pageQueries: [{ query: "persian cat price 2026", impressions: 500 }],
      ownH2s: ["Persian Cat History"],
      losingQueries: [{ query: "persian cat breeders", priorClicks: 200, recentClicks: 80, dropPct: 60 }],
      competitor: { domain: "rival.com", outline: ["2026 Pricing Guide"], freshnessDate: "2026-01-01" },
    });
    expect(brief.hasEvidence).toBe(true);
    expect(brief.newQueryGaps.length).toBeGreaterThan(0);
    expect(brief.losingQueries.length).toBeGreaterThan(0);
    expect(brief.winnerSection).not.toBeNull();
    expect(briefSentences(brief)).toHaveLength(3);
  });

  it("is honest when every evidence source is missing (hasEvidence false, no fabricated parts)", () => {
    const brief = buildRefreshBrief({
      rank: RANK,
      pageQueries: [],
      ownH2s: [],
      losingQueries: [],
      competitor: null,
    });
    expect(brief.hasEvidence).toBe(false);
    expect(brief.newQueryGaps).toEqual([]);
    expect(brief.losingQueries).toEqual([]);
    expect(brief.winnerSection).toBeNull();
    expect(briefSentences(brief)).toEqual([]);
  });

  it("is honest with a partial brief (only the rank + one evidence part)", () => {
    const brief = buildRefreshBrief({
      rank: RANK,
      pageQueries: [],
      ownH2s: [],
      losingQueries: [{ query: "persian cat breeders", priorClicks: 200, recentClicks: 80, dropPct: 60 }],
      competitor: null,
    });
    expect(brief.hasEvidence).toBe(true);
    expect(brief.newQueryGaps).toEqual([]);
    expect(brief.winnerSection).toBeNull();
    expect(briefSentences(brief)).toHaveLength(1);
  });

  it("never emits an em or en dash anywhere in the brief sentences", () => {
    const brief = buildRefreshBrief({
      rank: RANK,
      pageQueries: [{ query: "persian cat price 2026", impressions: 500 }],
      ownH2s: [],
      losingQueries: [{ query: "persian cat breeders", priorClicks: 200, recentClicks: 80, dropPct: 60 }],
      competitor: { domain: "rival.com", outline: ["2026 Pricing Guide"], freshnessDate: "2026-01-01" },
    });
    for (const s of briefSentences(brief)) expect(s).not.toMatch(/[–—]/);
  });
});
