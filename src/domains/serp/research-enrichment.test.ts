import { describe, it, expect } from "vitest";
import { extractSerpPattern, planResearchEnrichment, type ResearchPackLite } from "./research-enrichment";
import type { SerpSnapshot, SerpFeature, SerpResult } from "./serp-provider";

const snap = (over: Partial<SerpSnapshot> & { titles?: string[]; domains?: string[] }): SerpSnapshot => {
  const titles = over.titles ?? [];
  const domains = over.domains ?? titles.map((_, i) => `site${i}.com`);
  const results: SerpResult[] = titles.map((t, i) => ({
    rank: i + 1,
    url: `https://${domains[i] ?? `site${i}.com`}/x`,
    title: t,
    domain: domains[i] ?? `site${i}.com`,
  }));
  return {
    query: over.query ?? "q",
    results: over.results ?? results,
    features: over.features ?? ([] as SerpFeature[]),
    source: "dataforseo",
    fetchedAt: "2026-06-29T00:00:00Z",
  };
};

describe("extractSerpPattern — deterministic 'what wins'", () => {
  it("a numbered-title SERP → list format + a list element implication", () => {
    const p = extractSerpPattern(snap({ query: "persian boy names", titles: ["10 Best Persian Boy Names", "Top 20 Persian Names", "25 Persian Boy Names With Meanings"] }));
    expect(p.format).toBe("list");
    expect(p.elementImplication.toLowerCase()).toContain("list");
    expect(p.query).toBe("persian boy names");
  });
  it("shop domains → product format", () => {
    const p = extractSerpPattern(snap({ titles: ["Persian Rug", "Buy Persian Rug", "Persian Rug Sale"], domains: ["etsy.com", "amazon.com", "wayfair.com"] }));
    expect(p.format).toBe("product");
  });
  it("forum domains → ugc format", () => {
    const p = extractSerpPattern(snap({ titles: ["thoughts?", "my experience", "help"], domains: ["reddit.com", "quora.com", "x.com"] }));
    expect(p.format).toBe("ugc");
  });
  it("featured snippet / PAA with no list cue → faq format", () => {
    const p = extractSerpPattern(snap({ titles: ["Tehran", "About Tehran", "Tehran Overview"], features: ["featured_snippet", "people_also_ask"] }));
    expect(p.format).toBe("faq");
  });
  it("guide-cue titles → guide format + captures modifiers", () => {
    const p = extractSerpPattern(snap({ titles: ["The Complete Guide to Nowruz", "How to Celebrate Nowruz", "Nowruz Explained"] }));
    expect(p.format).toBe("guide");
    expect(p.modifiers).toContain("guide");
  });
  it("reports the top winning domains", () => {
    const p = extractSerpPattern(snap({ titles: ["a", "b"], domains: ["en.wikipedia.org", "britannica.com"] }));
    expect(p.winningDomains).toEqual(["en.wikipedia.org", "britannica.com"]);
  });
});

describe("planResearchEnrichment — cached vs missing + spend", () => {
  const packs: ResearchPackLite[] = [
    { url: "/a", primaryIntent: "persian boy names", own: ["persian boy names", "persian male names"], sibling: ["persian girl names"] },
    { url: "/b", primaryIntent: "iran flag", own: ["iran flag", "historical flags of iran"], sibling: [] },
  ];
  it("splits cached vs missing and prices 1 volume batch + 1 SERP per missing primary", () => {
    const plan = planResearchEnrichment(packs, {
      volumeCached: new Set(["persian boy names"]),
      serpCached: new Set(["iran flag"]),
    });
    expect(plan.volumeMissing).toContain("persian male names");
    expect(plan.volumeMissing).toContain("persian girl names");
    expect(plan.volumeCached).toContain("persian boy names");
    expect(plan.serpMissing).toEqual(["persian boy names"]); // iran flag already cached
    expect(plan.volumeCalls).toBe(1); // all missing volume terms in one batch
    expect(plan.serpCalls).toBe(1);
    expect(plan.estUsd).toBeLessThan(0.1);
  });
  it("fully-cached → zero calls, zero spend", () => {
    const plan = planResearchEnrichment(packs, {
      volumeCached: new Set(["persian boy names", "persian male names", "persian girl names", "iran flag", "historical flags of iran"]),
      serpCached: new Set(["persian boy names", "iran flag"]),
    });
    expect(plan.volumeCalls).toBe(0);
    expect(plan.serpCalls).toBe(0);
    expect(plan.estUsd).toBe(0);
  });
});
