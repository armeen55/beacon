import { describe, it, expect } from "vitest";
import { matchKeywordDemand } from "./keyword-match";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

const kw = (keyword: string, searchVolume: number | null): KeywordDemand => ({
  keyword, searchVolume, cpcUsd: null, competition: null, competitionLevel: null,
  monthlySearches: [], locationCode: 2840, languageCode: "en", source: "dataforseo",
  fetchedAt: "2026-06-20T00:00:00Z", confidence: "high", evidenceRef: "t",
});

const CACHE = [
  kw("persian wedding", 2400),
  kw("nowruz activities", 1300),
  kw("nowruz crafts for kids", 600),
  kw("iranian culture etiquette", 700),
  kw("culture of iran", 5000),
  kw("natural places in iran", 900),
  kw("iran natural attractions", 800),
  kw("nowruz gifts", 210),
  kw("famous iranian people", 880),
  kw("things to do in iran", 4400),
  kw("iran flag", 135000), // the big generic that must NOT dominate weak matches
];

const conf = (label: string, prompt: string | null = null) => matchKeywordDemand(label, prompt, CACHE).confidence;
const matched = (label: string, prompt: string | null = null) => matchKeywordDemand(label, prompt, CACHE).keyword;

describe("matchKeywordDemand — cultural-aware deterministic matcher", () => {
  it("Persian Wedding ↔ persian wedding (exact)", () => {
    expect(conf("Persian Wedding Traditions")).not.toBe("none");
    expect(matched("Persian Wedding")).toBe("persian wedding");
    expect(conf("Persian Wedding")).toBe("exact");
  });
  it("Nowruz Activities USA / Kids ↔ nowruz keywords (strips USA filler, keeps nowruz)", () => {
    expect(matched("Nowruz Activities USA")).toBe("nowruz activities");
    expect(["exact", "strong"]).toContain(conf("Nowruz Activities USA"));
    expect(matched("Nowruz Crafts for Kids")).toBe("nowruz crafts for kids");
  });
  it("Iranian Culture Etiquette ↔ iranian culture etiquette", () => {
    expect(matched("Iranian Culture Etiquette")).toBe("iranian culture etiquette");
    expect(conf("Iranian Culture Etiquette")).toBe("exact");
  });
  it("Culture of Iran ↔ culture of iran (of is a stopword)", () => {
    expect(matched("Culture of Iran")).toBe("culture of iran");
    expect(conf("Culture of Iran")).toBe("exact");
  });
  it("Iran Natural Attractions matches natural-places/attractions keywords", () => {
    const m = matchKeywordDemand("Iran Natural Attractions", null, CACHE);
    expect(["iran natural attractions", "natural places in iran"]).toContain(m.keyword);
    expect(m.confidence).not.toBe("none");
  });
  it("rejects a generic 'Gifts' label (only the commerce token 'gift' overlaps)", () => {
    expect(conf("Gifts")).toBe("none");
  });
  it("matches 'Nowruz Gifts' (nowruz is distinguishing — a cultural gift)", () => {
    expect(matched("Nowruz Gifts")).toBe("nowruz gifts");
  });
  it("rejects 'List Iranians' (filler + generic only)", () => {
    expect(conf("List Iranians")).toBe("none");
  });
  it("rejects 'Things Iran Highlights' (filler + generic only)", () => {
    expect(conf("Things Iran Highlights")).toBe("none");
  });
  it("matches 'Things to do in Iran' to its exact keyword (all-generic but exact phrase)", () => {
    expect(matched("Things to do in Iran")).toBe("things to do in iran");
    expect(conf("Things to do in Iran")).toBe("exact");
  });
  it("the giant generic 'iran flag' does NOT dominate an unrelated topic", () => {
    // a wedding topic must never resolve to iran flag just because it has volume
    expect(matched("Persian Wedding")).not.toBe("iran flag");
    expect(conf("Persian Marriage Customs")).not.toBe("exact");
  });
  it("ignores zero/null-volume keywords", () => {
    expect(matchKeywordDemand("widget", null, [kw("widget", null), kw("widget", 0)]).confidence).toBe("none");
  });
  it("operator ground-truth: 'most beautiful natural places' does NOT match 'most common name in iran' (shared word is only the superlative 'most')", () => {
    const m = matchKeywordDemand(
      "beautiful iran travel",
      "What are the most beautiful natural places in Iran?",
      [kw("most common name in iran", 70)],
    );
    expect(m.confidence).toBe("none");
    expect(m.keyword).toBeNull();
  });
});

describe("matchKeywordDemand — commerce keyword can't go 'strong' on a non-commerce topic", () => {
  const cache = [kw("nowruz gifts", 210), kw("nowruz activities", 1300)];
  it("'Nowruz Activities' picks the activities keyword, not gifts", () => {
    expect(matchKeywordDemand("Nowruz Activities", null, cache).keyword).toBe("nowruz activities");
  });
  it("with ONLY 'nowruz gifts' cached, a 'Nowruz Activities' topic is WEAK (gift not on-topic)", () => {
    const m = matchKeywordDemand("Nowruz Activities", null, [kw("nowruz gifts", 210)]);
    expect(m.keyword).toBe("nowruz gifts");
    expect(m.confidence).toBe("weak"); // related (nowruz) but NOT strong (no 'gift' in topic)
  });
  it("'Nowruz Gift Ideas' IS strong for 'nowruz gifts' (gift present)", () => {
    expect(matchKeywordDemand("Nowruz Gift Ideas", null, [kw("nowruz gifts", 210)]).confidence).toBe("strong");
  });
});
