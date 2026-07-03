import { describe, it, expect } from "vitest";

import {
  computeFeatureSteal, computeFeatureSteals, isMajorAuthorityDomain, qualifiesForSteal,
  weakOwnerSteals, buildFeatureStealHintNotes, MAX_FEATURE_STEAL_HINTS_PER_NIGHT,
  type FeatureStealHistoryRow,
} from "./feature-steal";

/**
 * BEACON_500 item 25: the steal detector. Pure, no I/O. Rank-2-8 gate, weak vs
 * strong owner classification, and the bounded hint feed for the daily plan.
 */

function row(overrides: Partial<FeatureStealHistoryRow> = {}): FeatureStealHistoryRow {
  return {
    query: "iran flag",
    capturedAt: "2026-07-02T00:00:00.000Z",
    ownRank: 4,
    ownUrl: "https://iranopedia.com/iran-flag",
    snippetOwner: null,
    paaQuestions: [],
    ...overrides,
  };
}

describe("isMajorAuthorityDomain", () => {
  it("flags wikipedia, britannica, and major news as strong", () => {
    expect(isMajorAuthorityDomain("wikipedia.org")).toBe(true);
    expect(isMajorAuthorityDomain("en.wikipedia.org")).toBe(true);
    expect(isMajorAuthorityDomain("britannica.com")).toBe(true);
    expect(isMajorAuthorityDomain("nytimes.com")).toBe(true);
    expect(isMajorAuthorityDomain("www.bbc.com")).toBe(true);
  });

  it("flags .gov and .edu suffix families as strong", () => {
    expect(isMajorAuthorityDomain("census.gov")).toBe(true);
    expect(isMajorAuthorityDomain("stanford.edu")).toBe(true);
  });

  it("does not flag a small blog or unrelated domain as strong", () => {
    expect(isMajorAuthorityDomain("smallblog.com")).toBe(false);
    expect(isMajorAuthorityDomain("personal-blog.com")).toBe(false);
    expect(isMajorAuthorityDomain("")).toBe(false);
  });

  it("does not false-positive on a suffix look-alike domain", () => {
    expect(isMajorAuthorityDomain("notwikipedia.org")).toBe(false);
    expect(isMajorAuthorityDomain("wikipedia.org.fake.com")).toBe(false);
  });
});

describe("qualifiesForSteal (rank 2-8 gate)", () => {
  it("rejects rank 1 (already owns everything worth owning)", () => {
    expect(qualifiesForSteal(1)).toBe(false);
  });

  it("accepts ranks 2 through 8", () => {
    for (let r = 2; r <= 8; r += 1) expect(qualifiesForSteal(r)).toBe(true);
  });

  it("rejects rank 9 and worse", () => {
    expect(qualifiesForSteal(9)).toBe(false);
    expect(qualifiesForSteal(40)).toBe(false);
  });

  it("rejects null/absent rank", () => {
    expect(qualifiesForSteal(null)).toBe(false);
  });
});

describe("computeFeatureSteal - snippet steals", () => {
  it("returns [] when the rank does not qualify, even with a snippet present", () => {
    const candidates = computeFeatureSteal(
      row({ ownRank: 1, snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "t", format: "paragraph" } }),
      "iranopedia.com",
    );
    expect(candidates).toEqual([]);
  });

  it("returns [] when the tenant already owns the snippet", () => {
    const candidates = computeFeatureSteal(
      row({ snippetOwner: { ownerDomain: "iranopedia.com", ownerUrl: "https://iranopedia.com/x", textExcerpt: "t", format: "paragraph" } }),
      "iranopedia.com",
    );
    expect(candidates).toEqual([]);
  });

  it("returns a weak-owner candidate with the exact sentence shape for a small blog", () => {
    const candidates = computeFeatureSteal(
      row({ ownRank: 4, query: "world cup schedule", snippetOwner: { ownerDomain: "personal-blog.com", ownerUrl: "https://personal-blog.com/x", textExcerpt: "t", format: "paragraph" } }),
      "iranopedia.com",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ feature: "snippet", ownerDomain: "personal-blog.com", ownerStrength: "weak", format: "paragraph" });
    expect(candidates[0].sentence).toBe(
      'The answer box on your #4 search "world cup schedule" belongs to a small blog (personal-blog.com). It answers in a paragraph; a tighter paragraph answer high on your page can take it.',
    );
  });

  it("marks a wikipedia-owned snippet honestly strong (hard), never an easy win", () => {
    const candidates = computeFeatureSteal(
      row({ ownRank: 3, snippetOwner: { ownerDomain: "wikipedia.org", ownerUrl: "https://wikipedia.org/x", textExcerpt: "t", format: "table" } }),
      "iranopedia.com",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].ownerStrength).toBe("strong");
    expect(candidates[0].sentence).toContain("a strong site");
    expect(candidates[0].sentence).toContain("hard steal");
  });
});

describe("computeFeatureSteal - PAA steals", () => {
  it("returns a weak-owner PAA candidate when an answering domain is present", () => {
    const candidates = computeFeatureSteal(
      row({ ownRank: 5, paaQuestions: [{ question: "What do the colors mean?", answerDomain: "smallblog.net" }] }),
      "iranopedia.com",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ feature: "paa", ownerDomain: "smallblog.net", ownerStrength: "weak", format: null });
  });

  it("ignores PAA questions with no answerDomain (nothing stealable named)", () => {
    const candidates = computeFeatureSteal(row({ ownRank: 5, paaQuestions: [{ question: "no answer domain" }] }), "iranopedia.com");
    expect(candidates).toEqual([]);
  });

  it("ignores a PAA question the tenant itself answers", () => {
    const candidates = computeFeatureSteal(
      row({ ownRank: 5, paaQuestions: [{ question: "q", answerDomain: "iranopedia.com" }] }),
      "iranopedia.com",
    );
    expect(candidates).toEqual([]);
  });

  it("returns BOTH a snippet and a PAA candidate when both are stealable", () => {
    const candidates = computeFeatureSteal(
      row({
        ownRank: 6,
        snippetOwner: { ownerDomain: "blogone.com", ownerUrl: "https://blogone.com/x", textExcerpt: "t", format: "list" },
        paaQuestions: [{ question: "q", answerDomain: "blogtwo.com" }],
      }),
      "iranopedia.com",
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.feature).sort()).toEqual(["paa", "snippet"]);
  });
});

describe("computeFeatureSteals - matrix across queries", () => {
  it("uses only the MOST RECENT capture per query, never mixing owners across days", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "iran flag", capturedAt: "2026-06-01T00:00:00.000Z", ownRank: 4, snippetOwner: { ownerDomain: "oldowner.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "iran flag", capturedAt: "2026-07-01T00:00:00.000Z", ownRank: 4, snippetOwner: { ownerDomain: "newowner.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
    ];
    const out = computeFeatureSteals(rows, "iranopedia.com");
    expect(out).toHaveLength(1);
    expect(out[0].ownerDomain).toBe("newowner.com");
  });

  it("sorts weak-owner candidates before strong-owner, then by rank ascending", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "a", ownRank: 3, snippetOwner: { ownerDomain: "wikipedia.org", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "b", ownRank: 7, snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "c", ownRank: 2, snippetOwner: { ownerDomain: "otherblog.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
    ];
    const out = computeFeatureSteals(rows, "iranopedia.com");
    expect(out.map((c) => c.query)).toEqual(["c", "b", "a"]);
  });

  it("returns [] for empty input", () => {
    expect(computeFeatureSteals([], "iranopedia.com")).toEqual([]);
  });
});

describe("weakOwnerSteals", () => {
  it("filters out strong-owner candidates", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "a", ownRank: 3, snippetOwner: { ownerDomain: "wikipedia.org", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "b", ownRank: 4, snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
    ];
    const all = computeFeatureSteals(rows, "iranopedia.com");
    const weak = weakOwnerSteals(all);
    expect(weak).toHaveLength(1);
    expect(weak[0].ownerDomain).toBe("smallblog.com");
  });
});

describe("buildFeatureStealHintNotes (bounded hint feed)", () => {
  it("bounds hints to MAX_FEATURE_STEAL_HINTS_PER_NIGHT (2)", () => {
    expect(MAX_FEATURE_STEAL_HINTS_PER_NIGHT).toBe(2);
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "a", ownRank: 2, snippetOwner: { ownerDomain: "blog1.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "b", ownRank: 3, snippetOwner: { ownerDomain: "blog2.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "c", ownRank: 4, snippetOwner: { ownerDomain: "blog3.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
    ];
    const candidates = computeFeatureSteals(rows, "iranopedia.com");
    const hints = buildFeatureStealHintNotes(candidates);
    expect(hints.size).toBe(2);
  });

  it("never surfaces a strong-owner candidate as a hint", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "a", ownRank: 2, snippetOwner: { ownerDomain: "wikipedia.org", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
    ];
    const candidates = computeFeatureSteals(rows, "iranopedia.com");
    const hints = buildFeatureStealHintNotes(candidates);
    expect(hints.size).toBe(0);
  });

  it("keys hints by normalized (lowercased/trimmed) query", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "  Iran Flag  ", ownRank: 4, snippetOwner: { ownerDomain: "blog1.com", ownerUrl: "u", textExcerpt: "t", format: "list" } }),
    ];
    const candidates = computeFeatureSteals(rows, "iranopedia.com");
    const hints = buildFeatureStealHintNotes(candidates);
    expect(hints.has("iran flag")).toBe(true);
    expect(hints.get("iran flag")?.format).toBe("list");
  });

  it("caps at a custom limit when provided", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "a", ownRank: 2, snippetOwner: { ownerDomain: "blog1.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
      row({ query: "b", ownRank: 3, snippetOwner: { ownerDomain: "blog2.com", ownerUrl: "u", textExcerpt: "t", format: "paragraph" } }),
    ];
    const candidates = computeFeatureSteals(rows, "iranopedia.com");
    const hints = buildFeatureStealHintNotes(candidates, 1);
    expect(hints.size).toBe(1);
  });
});

describe("dash guard - no em or en dashes anywhere in generated sentences", () => {
  it("checks weak and strong snippet + PAA sentences", () => {
    const rows: FeatureStealHistoryRow[] = [
      row({ query: "weak snippet", ownRank: 4, snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "u", textExcerpt: "t", format: "table" } }),
      row({ query: "strong snippet", ownRank: 3, snippetOwner: { ownerDomain: "britannica.com", ownerUrl: "u", textExcerpt: "t", format: "list" } }),
      row({ query: "weak paa", ownRank: 6, paaQuestions: [{ question: "q", answerDomain: "otherblog.com" }] }),
      row({ query: "strong paa", ownRank: 2, paaQuestions: [{ question: "q", answerDomain: "nytimes.com" }] }),
    ];
    const out = computeFeatureSteals(rows, "iranopedia.com");
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.sentence).not.toMatch(/[–—]/);
    }
  });
});
