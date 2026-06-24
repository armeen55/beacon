import { describe, it, expect } from "vitest";
import {
  buildDemandGraph,
  type DemandInput,
  type OwnedPageInput,
  type CompetitorCitationInput,
} from "@/domains/demand-graph/build-graph";

function demand(p: Partial<DemandInput> & { key: string }): DemandInput {
  return {
    label: p.label ?? p.key,
    queries: p.queries ?? [p.key],
    gscImpressions: p.gscImpressions ?? null,
    searchVolume: p.searchVolume ?? null,
    aiExecutions: p.aiExecutions ?? null,
    ownedAiShare: p.ownedAiShare ?? null,
    fanoutSubQueries: p.fanoutSubQueries ?? [],
    topicId: p.topicId ?? null,
    ...p,
  };
}

describe("buildDemandGraph — the everything-helps-everything spine", () => {
  it("THE IRANOPEDIA WEDGE: high demand + competitor cited + no owned page → create_page", () => {
    const d: DemandInput[] = [
      demand({
        key: "persian-wedding",
        label: "Persian wedding traditions",
        gscImpressions: 4000,
        aiExecutions: 200,
        fanoutSubQueries: ["what is a sofreh aghd", "persian wedding ceremony order"],
      }),
    ];
    const competitors: CompetitorCitationInput[] = [
      { url: "https://theknot.com/content/persian-wedding", demandKey: "persian-wedding", weight: 30 },
      { url: "https://wikipedia.org/wiki/Persian_wedding", demandKey: "persian-wedding", weight: 18 },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: [], competitorCitations: competitors });

    const gap = g.moves.find((x) => x.demandKey === "persian-wedding")!;
    expect(gap.gap).toBe("create_page");
    expect(gap.ownedUrl).toBeNull();
    expect(gap.competitorUrls[0]).toBe("https://theknot.com/content/persian-wedding"); // highest weight first
    expect(gap.fanoutSeeds).toContain("what is a sofreh aghd"); // the outline is seeded
    expect(gap.score).toBeGreaterThan(0);
  });

  it("rank-but-AI-never-cites-you → answer_block (you exist, competitors get the citation)", () => {
    const d = [demand({ key: "farsi-vs-persian", label: "Farsi vs Persian", gscImpressions: 3000 })];
    const owned: OwnedPageInput[] = [
      {
        url: "https://iranopedia.com/farsi-vs-persian",
        servesDemandKeys: ["farsi-vs-persian"],
        gscImpressions: 3000,
        gscClicks: 120,
        gscPosition: 3,
        aiCitationCount: 0, // AI never cites you
      },
    ];
    const competitors = [
      { url: "https://history.com/persian-iranian-difference", demandKey: "farsi-vs-persian", weight: 12 },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: owned, competitorCitations: competitors });
    const gap = g.moves.find((x) => x.demandKey === "farsi-vs-persian")!;
    expect(gap.gap).toBe("answer_block");
    expect(gap.ownedUrl).toBe("https://iranopedia.com/farsi-vs-persian");
    expect(gap.competitorUrls).toContain("https://history.com/persian-iranian-difference");
  });

  it("ranks weakly (cited, but mid-position/low-CTR) → edit_page", () => {
    const d = [demand({ key: "cities-in-iran", label: "Cities in Iran", gscImpressions: 16000 })];
    const owned: OwnedPageInput[] = [
      {
        url: "https://iranopedia.com/cities",
        servesDemandKeys: ["cities-in-iran"],
        gscImpressions: 16000,
        gscClicks: 70, // ~0.4% CTR at position 9 → weak
        gscPosition: 9,
        aiCitationCount: 5, // cited, so not answer_block
      },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: owned, competitorCitations: [] });
    const gap = g.moves.find((x) => x.demandKey === "cities-in-iran")!;
    expect(gap.gap).toBe("edit_page");
  });

  it("high friction on an owned page → fix_experience (before chasing traffic)", () => {
    const d = [demand({ key: "iran-flags", label: "Iran flags", gscImpressions: 10000 })];
    const owned: OwnedPageInput[] = [
      {
        url: "https://iranopedia.com/iran-flags",
        servesDemandKeys: ["iran-flags"],
        gscImpressions: 10000,
        gscClicks: 400,
        gscPosition: 2,
        aiCitationCount: 3,
        clarityDeadClicks: 60, // friction dominates
      },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: owned, competitorCitations: [] });
    expect(g.moves.find((x) => x.demandKey === "iran-flags")!.gap).toBe("fix_experience");
  });

  it("strong + cited → healthy (monitor, no churn)", () => {
    const d = [demand({ key: "persian-male-names", label: "Persian male names", gscImpressions: 8000 })];
    const owned: OwnedPageInput[] = [
      {
        url: "https://iranopedia.com/persian-male-names",
        servesDemandKeys: ["persian-male-names"],
        gscImpressions: 8000,
        gscClicks: 600, // healthy CTR
        gscPosition: 2,
        aiCitationCount: 9,
      },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: owned, competitorCitations: [] });
    expect(g.moves.find((x) => x.demandKey === "persian-male-names")!.gap).toBe("healthy");
  });

  it("below the demand floor → low_demand (no wasted recommendation)", () => {
    const d = [demand({ key: "tiny", label: "Tiny", gscImpressions: 5 })];
    const g = buildDemandGraph({ demand: d, ownedPages: [], competitorCitations: [] });
    expect(g.moves.find((x) => x.demandKey === "tiny")!.gap).toBe("low_demand");
  });

  it("ranks gaps by score — bigger demand + competitor pressure first", () => {
    const d = [
      demand({ key: "big", label: "Big", gscImpressions: 20000 }),
      demand({ key: "small", label: "Small", gscImpressions: 200 }),
    ];
    const competitors = [
      { url: "https://c1.com/big", demandKey: "big", weight: 40 },
      { url: "https://c2.com/small", demandKey: "small", weight: 2 },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: [], competitorCitations: competitors });
    const actionable = g.moves.filter((x) => x.gap !== "low_demand");
    expect(actionable[0]!.demandKey).toBe("big");
  });

  it("high GA4 $value raises the score vs an equal-demand page with no money", () => {
    const d = [
      demand({ key: "money-q", label: "Money", gscImpressions: 5000 }),
      demand({ key: "vanity-q", label: "Vanity", gscImpressions: 5000 }),
    ];
    const owned: OwnedPageInput[] = [
      { url: "https://x.com/money", servesDemandKeys: ["money-q"], gscImpressions: 5000, gscClicks: 60, gscPosition: 8, aiCitationCount: 2, ga4Value: 5000 },
      { url: "https://x.com/vanity", servesDemandKeys: ["vanity-q"], gscImpressions: 5000, gscClicks: 60, gscPosition: 8, aiCitationCount: 2, ga4Value: 0 },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: owned, competitorCitations: [] });
    const money = g.moves.find((x) => x.demandKey === "money-q")!;
    const vanity = g.moves.find((x) => x.demandKey === "vanity-q")!;
    expect(money.components.dollarValue).toBe(5000);
    expect(money.score).toBeGreaterThan(vanity.score); // money-first
  });

  it("exposes raw components + high Clarity friction drives a fix_experience score up", () => {
    const d = [demand({ key: "leak", label: "Leaky", gscImpressions: 9000 })];
    const owned: OwnedPageInput[] = [
      { url: "https://x.com/leak", servesDemandKeys: ["leak"], gscImpressions: 9000, gscClicks: 350, gscPosition: 2, aiCitationCount: 3, clarityDeadClicks: 80 },
    ];
    const g = buildDemandGraph({ demand: d, ownedPages: owned, competitorCitations: [] });
    const m = g.moves.find((x) => x.demandKey === "leak")!;
    expect(m.gap).toBe("fix_experience");
    expect(m.components.friction).toBeGreaterThanOrEqual(80); // raw component exposed
    expect(m.components.demand).toBe(9000);
  });

  it("low evidence → low confidence (speculative, not fake certainty)", () => {
    // a create_page idea from ONLY a competitor citation — no GSC, no volume, no $
    const d = [demand({ key: "thin-idea", label: "Thin idea", aiExecutions: 0, gscImpressions: 0, searchVolume: 300 })];
    const competitors = [{ url: "https://c.com/x", demandKey: "thin-idea", weight: 4 }];
    const g = buildDemandGraph({ demand: d, ownedPages: [], competitorCitations: competitors });
    const m = g.moves.find((x) => x.demandKey === "thin-idea")!;
    expect(m.gap).toBe("create_page");
    expect(m.confidence).toBe("medium"); // volume + AI(competitor) = 2 signals
    expect(m.signals).not.toContain("GSC");

    // and an idea with THREE agreeing signals → high confidence
    const d2 = [demand({ key: "strong-idea", label: "Strong", gscImpressions: 4000, searchVolume: 2000 })];
    const comp2 = [{ url: "https://c.com/y", demandKey: "strong-idea", weight: 10 }];
    const g2 = buildDemandGraph({ demand: d2, ownedPages: [], competitorCitations: comp2 });
    expect(g2.moves.find((x) => x.demandKey === "strong-idea")!.confidence).toBe("high");
  });
});
