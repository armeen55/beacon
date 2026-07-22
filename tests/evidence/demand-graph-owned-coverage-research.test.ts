/**
 * OWNED COVERAGE + PAGE RESEARCH PACK (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/demand-graph/owned-coverage.test.ts (position-52 blind spot)
 *   src/domains/demand-graph/page-research-pack.test.ts
 * Pins kept: GSC-serving at ANY position beats a fresh create_page, sibling
 * intents never fold into one page, proof-aware lever blocks, dry-run spend
 * estimate before any live call, cached-volume-only (no fabricated numbers).
 */
import { describe, expect, it } from "vitest";
import {
  detectOwnedCoverageForTopic,
  detectOwnedCoverageForCard,
  acknowledgeSentence,
  topicsOverlap,
  ownedPagePath,
  type OwnedCoverageInput,
} from "@/domains/demand-graph/owned-coverage";
import {
  buildPageResearchPack,
  planResearchSpend,
  addressableVolume,
  type PageResearchInput,
} from "@/domains/demand-graph/page-research-pack";

const BANNED_DASH = /[‒–—―]/;
const NOWRUZ_URL = "https://iranopedia.com/nowruz";

const servingFixture: OwnedCoverageInput = {
  serving: [{ query: "persian new year", ownerPage: NOWRUZ_URL, position: 52 }],
  ownedPages: [],
};
const contentFixture: OwnedCoverageInput = {
  serving: [],
  ownedPages: [{ url: NOWRUZ_URL, title: "Nowruz - Persian New Year", h1: "Nowruz - Persian New Year" }],
};

describe("topicsOverlap + ownedPagePath", () => {
  it("reduces a full owned URL to its display path", () => {
    expect(ownedPagePath("https://iranopedia.com/nowruz")).toBe("/nowruz");
    expect(ownedPagePath("iranopedia.com/nowruz/")).toBe("/nowruz");
  });

  it("matches exact-phrase containment in both directions, rejects single shared tokens", () => {
    expect(topicsOverlap("persian new year", "Nowruz - Persian New Year")).toBe(true);
    expect(topicsOverlap("nowruz persian new year 2026 guide", "Persian New Year")).toBe(true);
    expect(topicsOverlap("nowruz activities usa", "Persian New Year")).toBe(false);
  });
});

describe("detectOwnedCoverageForTopic (the position-52 blind spot)", () => {
  it("finds the owned page Google already serves, even at position 52", () => {
    const m = detectOwnedCoverageForTopic("nowruz persian new year", servingFixture);
    expect(m!.basis).toBe("gsc_serving");
    expect(m!.ownedPath).toBe("/nowruz");
    expect(m!.position).toBe(52);
    expect(m!.sentence).toBe(
      "You already have /nowruz for this topic. I would improve that page before building a new one.",
    );
    expect(BANNED_DASH.test(m!.sentence)).toBe(false);
    expect(BANNED_DASH.test(m!.detail)).toBe(false);
  });

  it("finds a content-targeted page when GSC is silent, matches slugs, prefers GSC serving", () => {
    const content = detectOwnedCoverageForTopic("nowruz persian new year", contentFixture);
    expect(content!.basis).toBe("content");
    expect(content!.detail).toContain("Persian New Year");

    const slug = detectOwnedCoverageForTopic("kashan rugs buying guide", {
      serving: [],
      ownedPages: [{ url: "https://iranopedia.com/kashan-rugs", title: null, h1: null }],
    });
    expect(slug!.ownedPath).toBe("/kashan-rugs");

    const both = detectOwnedCoverageForTopic("nowruz persian new year", {
      serving: servingFixture.serving,
      ownedPages: contentFixture.ownedPages,
    });
    expect(both!.basis).toBe("gsc_serving");
  });

  it("returns null when nothing of mine targets the topic (genuine gaps stay uncovered)", () => {
    const input: OwnedCoverageInput = {
      serving: [{ query: "persian wedding traditions", ownerPage: "https://iranopedia.com/persian-wedding", position: 4 }],
      ownedPages: [{ url: "https://iranopedia.com/persian-wedding", title: "Persian Wedding Traditions", h1: "Persian Wedding" }],
    };
    expect(detectOwnedCoverageForTopic("chelow kabab recipe", input)).toBeNull();
  });
});

describe("detectOwnedCoverageForCard", () => {
  it("demotes when a CORE topic is owned; flags an owned Also-covers topic otherwise", () => {
    const demoted = detectOwnedCoverageForCard({
      coreTopics: ["Nowruz Activities USA", "nowruz persian new year"],
      alsoCovers: ["Nowruz Activities Kids", "Nowruz Persian New Year"],
      serving: servingFixture.serving,
      ownedPages: [],
    });
    expect(demoted.primary!.ownedPath).toBe("/nowruz");
    expect(demoted.coveredAlsoCovers).toEqual([]);

    const flagged = detectOwnedCoverageForCard({
      coreTopics: ["Nowruz Activities USA"],
      alsoCovers: ["Nowruz Persian New Year", "Nowruz Table Setting"],
      serving: servingFixture.serving,
      ownedPages: [],
    });
    expect(flagged.primary).toBeNull();
    expect(flagged.coveredAlsoCovers.map((c) => c.topic)).toEqual(["Nowruz Persian New Year"]);
  });

  it("leaves a genuinely uncovered card untouched", () => {
    const verdict = detectOwnedCoverageForCard({
      coreTopics: ["Chelow Kabab Recipe"],
      alsoCovers: ["Kabab Koobideh"],
      serving: servingFixture.serving,
      ownedPages: contentFixture.ownedPages,
    });
    expect(verdict.primary).toBeNull();
    expect(verdict.coveredAlsoCovers).toEqual([]);
  });
});

describe("acknowledgeSentence", () => {
  it("names the page, discloses additional covered topics, first person, no dashes", () => {
    const m = detectOwnedCoverageForTopic("nowruz persian new year", servingFixture)!;
    const s = acknowledgeSentence(m, ["Nowruz Persian New Year", "Nowruz Date", "Nowruz Traditions", "Haft Sin"]);
    expect(s).toContain("/nowruz");
    expect(s).toContain("Nowruz Persian New Year and Nowruz Date and 2 more related topics");
    expect(BANNED_DASH.test(s)).toBe(false);
  });
});

// ── page research pack ──────────────────────────────────────────────────────

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

describe("buildPageResearchPack: intent clustering (own vs sibling vs noise)", () => {
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

  it("picks the highest-impression query as primary; owns same-intent, cross-links the sibling", () => {
    const pack = buildPageResearchPack(boyNames);
    expect(pack.primaryIntent).toBe("persian boy names");
    expect(pack.clusters.own.map((s) => s.toLowerCase())).toContain("persian male names");
    expect(pack.clusters.internal_link.map((s) => s.toLowerCase())).toContain("persian girl names");
    expect(pack.clusters.own.map((s) => s.toLowerCase())).not.toContain("persian girl names");
  });

  it("an AI fan-out question is an answer-block target, NOT an owned keyword", () => {
    const pack = buildPageResearchPack(boyNames);
    const q = pack.keywords.find((k) => k.source === "ai_fanout");
    expect(q?.bucket).toBe("answer");
    expect(q?.element).toBe("answer_block");
    expect(pack.clusters.own).not.toContain(q?.keyword);
  });

  it("an off-topic candidate is NOISE; sibling pages with distinct history are never folded", () => {
    const noise = buildPageResearchPack(base({
      gscRanking: [{ query: "persian boy names", position: 3, impressions: 5000 }],
      aiFanouts: ["where to buy a used car in los angeles"],
    }));
    expect(noise.clusters.noise.map((s) => s.toLowerCase())).toContain("where to buy a used car in los angeles");

    const flags = buildPageResearchPack(base({
      url: "https://iranopedia.com/iran-flags",
      pageLabel: "iran flag",
      gscRanking: [
        { query: "iran flag", position: 7.5, impressions: 2300 },
        { query: "pahlavi iran flag", position: 8.0, impressions: 400 },
      ],
      ownedSiblings: [{ slug: "iran-flags/pahlavi-iran-flag", label: "pahlavi iran flag" }],
    }));
    expect(flags.clusters.own.map((s) => s.toLowerCase())).not.toContain("pahlavi iran flag");
  });
});

describe("buildPageResearchPack: proof-aware lever selection", () => {
  it("blocks the title/meta lever when it already lost, holds mid-measurement, primary when clean", () => {
    const lost = buildPageResearchPack(base({
      gscRanking: [{ query: "persian swear words", position: 7.2, impressions: 782 }],
      pageLabel: "persian swear words",
      aiFanouts: ["What does pedar sag mean?"],
      proof: { measuringFamilies: [], lostFamilies: ["title_meta"] },
    }));
    const lostTitle = lost.levers.find((l) => l.lever === "title_meta");
    expect(lostTitle?.blocked).toBe(true);
    expect(lost.levers.find((l) => l.primary)!.lever).not.toBe("title_meta");

    const measuring = buildPageResearchPack(base({
      gscRanking: [{ query: "persian boy names", position: 7, impressions: 5000 }],
      proof: { measuringFamilies: ["title_meta"], lostFamilies: [] },
    }));
    expect(measuring.levers.find((l) => l.lever === "title_meta")?.primary ?? false).toBe(false);

    const clean = buildPageResearchPack(base({
      gscRanking: [{ query: "persian boy names", position: 7, impressions: 5000 }],
    }));
    expect(clean.levers.find((l) => l.primary)?.lever).toBe("title_meta");
  });
});

describe("planResearchSpend + addressableVolume", () => {
  it("dry-run estimate counts unique own/sibling terms + one SERP per page; zero packs = zero spend", () => {
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
    expect(plan.serpCalls).toBe(2);
    expect(plan.uniqueTerms).toBe(4);
    expect(plan.estUsd).toBeLessThan(0.2);
    expect(planResearchSpend([])).toEqual({ uniqueTerms: 0, volumeCalls: 0, serpCalls: 0, estUsd: 0 });
  });

  it("addressableVolume sums cached volume only and never fabricates a number", () => {
    const vol = new Map<string, number | null>([["persian boy names", 5300], ["persian male names", 1900]]);
    expect(addressableVolume(["Persian Boy Names", "persian male names"], vol)).toBe(7200);
    expect(addressableVolume(["persian boy names"], new Map([["unrelated", 999]]))).toBeNull();
  });
});
