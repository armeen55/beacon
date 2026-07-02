import { describe, it, expect } from "vitest";
import { buildWikiGapOpportunities, MAX_WIKI_GAP_CARDS } from "./today-newpages-data";
import type { StoredWikiGaps, WikiGap } from "@/domains/wiki-gap/wiki-gap-store";

/**
 * today-newpages-wiki-gap.test.ts (2026-07-02, master plan item 23) - the feed
 * bounding + non-overlap tests for the beat-Wikipedia New Pages cards. Mirrors
 * the coverage keyword-gap-producer.test.ts gives item 16's cards, applied to
 * buildWikiGapOpportunities (pure - no Supabase, no fetch).
 */

const gap = (over: Partial<WikiGap> = {}): WikiGap => ({
  articleTitle: "Some_Topic",
  displayTitle: "Some Topic",
  queryText: "what is some topic",
  words: 180,
  sections: 2,
  lastRevisionAt: "2019-01-01T00:00:00Z",
  exists: true,
  demand: null,
  score: 80,
  band: "high",
  thin: true,
  stale: true,
  generic: false,
  yearsSinceRevision: 7,
  evidenceSentence: "Wikipedia's article on this is 180 words and was last touched in 2019. AI cites it anyway because nothing better exists. You can be the better source.",
  ...over,
});

const stored = (gaps: WikiGap[]): StoredWikiGaps => ({
  tenant_id: "tenant-x",
  computed_at: "2026-07-02T00:00:00Z",
  articlesChecked: gaps.length,
  gaps,
});

describe("buildWikiGapOpportunities - feed bounding", () => {
  it("returns [] when there is no stored run", () => {
    expect(buildWikiGapOpportunities(null, [])).toEqual([]);
  });

  it("returns [] when the stored run has zero gaps", () => {
    expect(buildWikiGapOpportunities(stored([]), [])).toEqual([]);
  });

  it("caps output at MAX_WIKI_GAP_CARDS even with many beatable gaps", () => {
    const many = Array.from({ length: 10 }, (_, i) => gap({ articleTitle: `Topic_${i}`, displayTitle: `Topic ${i}` }));
    const out = buildWikiGapOpportunities(stored(many), []);
    expect(out.length).toBe(MAX_WIKI_GAP_CARDS);
    expect(MAX_WIKI_GAP_CARDS).toBeLessThanOrEqual(3);
  });

  it("skips articles scored 'low' beatability - not worth a card", () => {
    const out = buildWikiGapOpportunities(stored([gap({ band: "low", score: 10 })]), []);
    expect(out).toEqual([]);
  });

  it("skips topics an existing graph/gap card already covers (non-overlap)", () => {
    const out = buildWikiGapOpportunities(stored([gap({ displayTitle: "Persian Cheetah" })]), ["persian cheetah"]);
    expect(out).toEqual([]);
  });

  it("carries the evidence sentence through to the card", () => {
    const out = buildWikiGapOpportunities(stored([gap()]), []);
    expect(out[0].wikiGapEvidence).toBe(gap().evidenceSentence);
  });

  it("marks 'high' band as a hot tier card and 'medium' as warm", () => {
    const out = buildWikiGapOpportunities(stored([gap({ articleTitle: "A", displayTitle: "A", band: "high" }), gap({ articleTitle: "B", displayTitle: "B", band: "medium" })]), []);
    expect(out.find((o) => o.topic.toLowerCase() === "a")?.tier).toBe("hot");
    expect(out.find((o) => o.topic.toLowerCase() === "b")?.tier).toBe("warm");
  });

  it("names wikipedia.org as the competitor domain (honest attribution)", () => {
    const out = buildWikiGapOpportunities(stored([gap()]), []);
    expect(out[0].topCompetitor).toBe("wikipedia.org");
    expect(out[0].competitorDomains).toEqual(["wikipedia.org"]);
  });

  it("uses real demand as searchVolume when known, null when not (never guessed)", () => {
    const withDemand = buildWikiGapOpportunities(stored([gap({ demand: 640 })]), []);
    expect(withDemand[0].searchVolume).toBe(640);
    const withoutDemand = buildWikiGapOpportunities(stored([gap({ demand: null })]), []);
    expect(withoutDemand[0].searchVolume).toBeNull();
  });

  it("ids are stable + namespaced so they never collide with graph or keyword-gap card ids", () => {
    const out = buildWikiGapOpportunities(stored([gap()]), []);
    expect(out[0].id.startsWith("wikigap::")).toBe(true);
  });
});
