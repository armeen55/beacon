import { describe, it, expect } from "vitest";
import { buildPageResearchPack, planResearchSpend, type PageResearchInput } from "./page-research-pack";

const base = (over: Partial<PageResearchInput>): PageResearchInput => ({
  url: "https://iranopedia.com/persian-male-names",
  pageLabel: "persian boy names",
  gscRanking: [],
  gscLosing: [],
  aiFanouts: [],
  competitorTitles: [],
  ownedSiblings: [],
  proof: null,
  ...over,
});

describe("buildPageResearchPack — intent clustering (own vs sibling vs noise)", () => {
  const boyNames = base({
    gscRanking: [
      { query: "persian boy names", position: 3.8, impressions: 5300 },
      { query: "persian male names", position: 3.5, impressions: 1900 },
      { query: "iranian boy names", position: 2.8, impressions: 1400 },
      { query: "persian girl names", position: 5.0, impressions: 600 },
    ],
    gscLosing: [{ query: "persian male names", dropPct: 52 }],
    aiFanouts: ["What are popular Persian boy names in America?"],
    ownedSiblings: [{ slug: "persian-female-first-names", label: "persian girl names" }],
  });

  it("picks the highest-impression query as primary intent", () => {
    expect(buildPageResearchPack(boyNames).primaryIntent).toBe("persian boy names");
  });

  it("'persian male names' is OWNed by this page (boy ≡ male, same intent)", () => {
    const pack = buildPageResearchPack(boyNames);
    expect(pack.clusters.own.map((s) => s.toLowerCase())).toContain("persian male names");
  });

  it("'persian girl names' is a SIBLING cross-link, never folded into the boy page", () => {
    const pack = buildPageResearchPack(boyNames);
    expect(pack.clusters.internal_link.map((s) => s.toLowerCase())).toContain("persian girl names");
    expect(pack.clusters.own.map((s) => s.toLowerCase())).not.toContain("persian girl names");
  });

  it("an AI fan-out question maps to an answer-block element under 'own'", () => {
    const pack = buildPageResearchPack(boyNames);
    const q = pack.keywords.find((k) => k.source === "ai_fanout");
    expect(q?.bucket).toBe("own");
    expect(q?.element).toBe("answer_block");
  });

  it("an off-topic candidate is NOISE, not owned", () => {
    const pack = buildPageResearchPack(base({
      gscRanking: [{ query: "persian boy names", position: 3, impressions: 5000 }],
      aiFanouts: ["where to buy a used car in los angeles"],
    }));
    expect(pack.clusters.noise.map((s) => s.toLowerCase())).toContain("where to buy a used car in los angeles");
    expect(pack.clusters.own.map((s) => s.toLowerCase())).not.toContain("where to buy a used car in los angeles");
  });
});

describe("buildPageResearchPack — different historical intent is not a merge", () => {
  it("Pahlavi flag is NOT owned by the generic iran-flags page (cross-link, not fold)", () => {
    const pack = buildPageResearchPack(base({
      url: "https://iranopedia.com/iran-flags",
      pageLabel: "iran flag",
      gscRanking: [
        { query: "iran flag", position: 7.5, impressions: 2300 },
        { query: "historical flags of iran", position: 5.1, impressions: 1500 },
        { query: "pahlavi iran flag", position: 8.0, impressions: 400 },
      ],
      ownedSiblings: [{ slug: "iran-flags/pahlavi-iran-flag", label: "pahlavi iran flag" }],
    }));
    expect(pack.clusters.own.map((s) => s.toLowerCase())).not.toContain("pahlavi iran flag");
  });

  it("a city page is NOT claimed by the broad cities hub", () => {
    const pack = buildPageResearchPack(base({
      url: "https://iranopedia.com/cities",
      pageLabel: "cities of iran",
      gscRanking: [
        { query: "biggest cities in iran", position: 9, impressions: 8000 },
        { query: "cities of iran", position: 9.3, impressions: 3000 },
        { query: "tehran", position: 30, impressions: 300 },
      ],
      ownedSiblings: [{ slug: "tehran", label: "tehran" }],
    }));
    expect(pack.clusters.own.map((s) => s.toLowerCase())).not.toContain("tehran");
  });
});

describe("buildPageResearchPack — proof-aware lever selection", () => {
  it("blocks the title/meta lever when it already lost, and makes a different lever primary", () => {
    const pack = buildPageResearchPack(base({
      url: "https://iranopedia.com/funny-farsi-phrases",
      pageLabel: "persian swear words",
      gscRanking: [{ query: "persian swear words", position: 7.2, impressions: 782 }],
      aiFanouts: ["What does pedar sag mean?"],
      proof: { measuringFamilies: [], lostFamilies: ["title_meta"] },
    }));
    const title = pack.levers.find((l) => l.lever === "title_meta");
    expect(title?.blocked).toBe(true);
    expect(title?.primary).toBe(false);
    const primary = pack.levers.find((l) => l.primary);
    expect(primary).toBeTruthy();
    expect(primary!.lever).not.toBe("title_meta");
  });

  it("holds (does not make primary) a lever that is mid-measurement", () => {
    const pack = buildPageResearchPack(base({
      gscRanking: [{ query: "persian boy names", position: 7, impressions: 5000 }],
      proof: { measuringFamilies: ["title_meta"], lostFamilies: [] },
    }));
    const title = pack.levers.find((l) => l.lever === "title_meta");
    // present but held → not primary
    expect(title?.primary ?? false).toBe(false);
  });

  it("title/meta is primary for a clean striking-distance page with no proof block", () => {
    const pack = buildPageResearchPack(base({
      gscRanking: [{ query: "persian boy names", position: 7, impressions: 5000 }],
    }));
    const primary = pack.levers.find((l) => l.primary);
    expect(primary?.lever).toBe("title_meta");
  });
});

describe("planResearchSpend — dry-run estimate before any live call", () => {
  it("counts unique own/sibling terms + one SERP per page, and stays tiny for top-5", () => {
    const packs = [
      { primaryIntent: "persian boy names", keywords: [
        { keyword: "persian boy names", bucket: "own" as const },
        { keyword: "persian male names", bucket: "own" as const },
        { keyword: "persian girl names", bucket: "sibling" as const },
        { keyword: "off topic thing", bucket: "noise" as const },
      ] },
      { primaryIntent: "iran flag", keywords: [{ keyword: "iran flag", bucket: "own" as const }] },
    ];
    const plan = planResearchSpend(packs);
    expect(plan.serpCalls).toBe(2); // one per page with a primary intent
    expect(plan.uniqueTerms).toBe(4); // 3 own/sibling + iran flag; noise excluded
    expect(plan.volumeCalls).toBe(1); // well under the 700-kw batch
    expect(plan.estUsd).toBeLessThan(0.2); // top-5 research is sub-$0.20
  });
  it("zero packs → zero spend", () => {
    const plan = planResearchSpend([]);
    expect(plan).toEqual({ uniqueTerms: 0, volumeCalls: 0, serpCalls: 0, estUsd: 0 });
  });
});
