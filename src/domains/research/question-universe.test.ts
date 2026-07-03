import { describe, it, expect } from "vitest";

import {
  buildQuestionUniverse,
  coverageFor,
  describeQuestionSources,
  isNearDuplicateQuestion,
  isQuestionShaped,
  seedQuestionsForTopic,
  uncoveredQuestions,
  FANOUT_WEIGHT_POINTS,
  PAA_PRESENCE_POINTS,
  NATIVE_LIBRARY_POINTS,
  type OwnerPageExtract,
  type UniverseQuestionRow,
} from "./question-universe";

/**
 * BEACON_500 R11 / N30: the demand-ranked question universe. Pure merge /
 * dedupe / rank / coverage tests plus the byte-identical-when-empty consumer
 * pins (the precompute drafter seam and the New Pages brief seam both merge
 * via `seeds.length > 0 ? merge : existing`).
 */

const TENANT = "tenant-test";

function extract(over: Partial<OwnerPageExtract> = {}): OwnerPageExtract {
  return {
    url: "https://example.com/nowruz",
    headings: [],
    faqQuestions: [],
    bodyText: null,
    ...over,
  };
}

describe("isQuestionShaped", () => {
  it("admits question-word queries and literal question marks", () => {
    expect(isQuestionShaped("how to cook tahdig")).toBe(true);
    expect(isQuestionShaped("when is nowruz 2026")).toBe(true);
    expect(isQuestionShaped("What do cheetahs eat")).toBe(true);
    expect(isQuestionShaped("tahdig recipe?")).toBe(true);
  });
  it("rejects plain keyword queries", () => {
    expect(isQuestionShaped("best restaurants tehran")).toBe(false);
    expect(isQuestionShaped("tahdig recipe")).toBe(false);
    expect(isQuestionShaped("")).toBe(false);
  });
});

describe("isNearDuplicateQuestion (the registry-normalizer dedupe rule)", () => {
  it("collapses rephrasings that share all distinguishing tokens", () => {
    expect(isNearDuplicateQuestion("when is nowruz 2026", "nowruz 2026 date?")).toBe(true);
  });
  it("never collapses questions that differ by a distinguishing token (a year is real demand)", () => {
    expect(isNearDuplicateQuestion("when is nowruz 2026", "when is nowruz 2025")).toBe(false);
  });
  it("single-token questions only collapse on exact token equality", () => {
    expect(isNearDuplicateQuestion("what is tahdig", "tahdig?")).toBe(true);
    expect(isNearDuplicateQuestion("what is tahdig", "tahdig recipe ideas")).toBe(false);
  });
});

describe("buildQuestionUniverse: merge + dedupe + rank", () => {
  it("merges the four sources into one row per real question, summing demand", () => {
    const u = buildQuestionUniverse({
      tenantId: TENANT,
      gscQueries: [
        { query: "when is nowruz 2026", impressions: 340, clicks: 12, ownerPage: "https://example.com/nowruz" },
        { query: "best restaurants tehran", impressions: 900, clicks: 40, ownerPage: null }, // not question-shaped
      ],
      fanoutSeeds: [{ subQuery: "nowruz 2026 date", weight: 3 }],
      paaQuestions: [{ question: "When is Nowruz 2026?" }],
      nativeLibrary: [{ text: "when is nowruz 2026" }],
    });

    expect(u.rows).toHaveLength(1);
    const row = u.rows[0]!;
    expect(row.question).toBe("when is nowruz 2026"); // canonical = highest-demand first-seen phrasing
    expect(row.sources).toEqual(["gsc", "ai_fanout", "native_poll", "paa"]);
    expect(row.gscImpressions).toBe(340);
    expect(row.fanoutWeight).toBe(3);
    expect(row.paaSeen).toBe(true);
    expect(row.inNativeLibrary).toBe(true);
    expect(row.demandScore).toBe(340 + 3 * FANOUT_WEIGHT_POINTS + PAA_PRESENCE_POINTS + NATIVE_LIBRARY_POINTS);
    expect(row.variants).toContain("nowruz 2026 date");
    expect(u.stats.mergedAway).toBe(3); // fanout + paa + library all merged into the GSC row
  });

  it("keeps questions apart when a distinguishing token differs", () => {
    const u = buildQuestionUniverse({
      tenantId: TENANT,
      gscQueries: [
        { query: "when is nowruz 2026", impressions: 100, clicks: 1, ownerPage: null },
        { query: "when is nowruz 2025", impressions: 50, clicks: 1, ownerPage: null },
      ],
    });
    expect(u.rows).toHaveLength(2);
  });

  it("ranks by demand x not-covered: an answered question sinks below uncovered ones", () => {
    const extracts = new Map<string, OwnerPageExtract>([
      [
        "https://example.com/nowruz",
        extract({ headings: ["Nowruz 2026 date"], url: "https://example.com/nowruz" }),
      ],
    ]);
    const u = buildQuestionUniverse({
      tenantId: TENANT,
      gscQueries: [
        // Higher demand, but ANSWERED on its owner page.
        { query: "when is nowruz 2026", impressions: 900, clicks: 10, ownerPage: "https://example.com/nowruz" },
        // Lower demand, unowned -> not answered anywhere.
        { query: "how long does yalda night last", impressions: 120, clicks: 2, ownerPage: null },
      ],
      ownerExtracts: extracts,
    });
    expect(u.rows[0]!.question).toBe("how long does yalda night last");
    expect(u.rows[0]!.coverageStatus).toBe("not_answered");
    expect(u.rows[1]!.coverageStatus).toBe("answered");
    expect(u.rows[1]!.priority).toBe(0);
    expect(u.rows[1]!.demandScore).toBeGreaterThan(u.rows[0]!.demandScore); // demand kept honest
  });

  it("prefers the N2 registry owner over the GSC impressions owner", () => {
    const u = buildQuestionUniverse({
      tenantId: TENANT,
      gscQueries: [{ query: "when is nowruz 2026", impressions: 10, clicks: 0, ownerPage: "https://example.com/wrong" }],
      resolveOwnerFor: () => "https://example.com/registry-owner",
    });
    expect(u.rows[0]!.ownership).toBe("https://example.com/registry-owner");
  });

  it("caps the universe and keeps the best rows", () => {
    const u = buildQuestionUniverse({
      tenantId: TENANT,
      gscQueries: [
        { query: "how to make ghormeh sabzi", impressions: 500, clicks: 9, ownerPage: null },
        { query: "when is yalda night", impressions: 300, clicks: 4, ownerPage: null },
        { query: "what is haft sin", impressions: 100, clicks: 1, ownerPage: null },
      ],
      cap: 2,
    });
    expect(u.rows).toHaveLength(2);
    expect(u.rows.map((r) => r.question)).toEqual(["how to make ghormeh sabzi", "when is yalda night"]);
  });
});

describe("coverage detection", () => {
  it("answered: a heading dedicated to the question", () => {
    const c = coverageFor("when is nowruz 2026", extract({ headings: ["Nowruz 2026 date"] }));
    expect(c.status).toBe("answered");
    expect(c.detail).toContain("Nowruz 2026 date");
  });
  it("answered: a stored FAQ question dedicated to it", () => {
    const c = coverageFor("how long does yalda night last", extract({ faqQuestions: ["How long does Yalda night last?"] }));
    expect(c.status).toBe("answered");
  });
  it("partial: all key words appear in the body but no section owns it", () => {
    const c = coverageFor(
      "when is nowruz 2026",
      extract({ headings: ["History"], bodyText: "Nowruz falls in March. In 2026 the celebration continues." }),
    );
    expect(c.status).toBe("partial");
  });
  it("not_answered: the page never covers it", () => {
    const c = coverageFor("when is nowruz 2026", extract({ headings: ["Tahdig recipe"], bodyText: "Rice and saffron." }));
    expect(c.status).toBe("not_answered");
  });
  it("unchecked: no stored extracts is honest abstention, never a verdict", () => {
    const c = coverageFor("when is nowruz 2026", null);
    expect(c.status).toBe("unchecked");
  });
});

describe("consumer seams (pinned byte-identical when the universe is empty)", () => {
  const universe: UniverseQuestionRow[] = buildQuestionUniverse({
    tenantId: TENANT,
    gscQueries: [
      { query: "how long does yalda night last", impressions: 220, clicks: 3, ownerPage: null },
      { query: "when is nowruz 2026", impressions: 340, clicks: 10, ownerPage: null },
    ],
  }).rows;

  it("PIN: seedQuestionsForTopic returns [] on an empty universe, and the consumer merge keeps the SAME reference", () => {
    const existing = ["what is haft sin"];
    const seeds = seedQuestionsForTopic([], "yalda night", { existing });
    expect(seeds).toEqual([]);
    // The exact merge pattern precompute-drafts.ts and the New Pages board use:
    const merged = seeds.length > 0 ? [...existing, ...seeds] : existing;
    expect(merged).toBe(existing); // byte-identical consumer input
  });

  it("seeds only topic-relevant uncovered questions, deduped against what the caller already has", () => {
    const seeds = seedQuestionsForTopic(universe, "yalda night traditions", { existing: [] });
    expect(seeds).toEqual(["how long does yalda night last"]);
    const deduped = seedQuestionsForTopic(universe, "yalda night traditions", {
      existing: ["how long does yalda night last?"],
    });
    expect(deduped).toEqual([]);
  });

  it("respects the limit", () => {
    expect(seedQuestionsForTopic(universe, "nowruz yalda", { limit: 1 })).toHaveLength(1);
  });

  it("uncoveredQuestions excludes answered rows", () => {
    const answered: UniverseQuestionRow = { ...universe[0]!, coverageStatus: "answered", priority: 0 };
    const rows = [answered, universe[1]!];
    const un = uncoveredQuestions(rows, 5);
    expect(un.every((r) => r.coverageStatus !== "answered")).toBe(true);
  });

  it("describeQuestionSources speaks plain words and never calls impressions searches", () => {
    const row = universe.find((r) => r.question === "when is nowruz 2026")!;
    const line = describeQuestionSources(row);
    expect(line).toBe("shown on Google 340 times in the last 90 days");
    expect(line).not.toMatch(/search(es)?\b/i);
    expect(line).not.toMatch(/[–—]/); // no em or en dashes
  });
});
