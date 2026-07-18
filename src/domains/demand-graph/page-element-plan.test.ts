import { describe, it, expect } from "vitest";

import { buildPageResearchPack, type PageResearchInput } from "./page-research-pack";
import { buildOnPagePlan } from "./page-element-plan";

const base: Omit<PageResearchInput, "url" | "pageLabel" | "gscRanking"> = {
  gscLosing: [],
  aiFanouts: [],
  competitorTitles: [],
  ownedSiblings: [],
  proof: null,
};

const boyNames: PageResearchInput = {
  ...base,
  url: "https://iranopedia.com/persian-male-first-names",
  pageLabel: "persian boy names",
  gscRanking: [
    { query: "persian boy names", position: 6, impressions: 5000 },
    { query: "persian male names", position: 8, impressions: 2000 },
    { query: "iranian boy names", position: 11, impressions: 800 },
  ],
  aiFanouts: ["What are common Persian boy names?", "persian boy names with meaning", "persian girl names"],
  ownedSiblings: [{ slug: "persian-female-first-names", label: "persian girl names" }],
};

describe("buildOnPagePlan — concrete element placement (P4)", () => {
  it("EVERY element carries non-empty evidence (no generic recs)", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames), {
      serpPattern: { format: "ugc", titlePattern: "lead with the keyword", elementImplication: "x" },
      currentTitle: "Persian Boy Names | Iranopedia",
    });
    const all = [
      plan.title,
      plan.meta,
      plan.h1,
      plan.schema,
      plan.uxFix,
      ...plan.sections,
      ...plan.faqs,
      ...plan.internalLinks,
      ...plan.newSiblings,
    ].filter(Boolean);
    expect(all.length).toBeGreaterThan(3);
    for (const el of all) expect((el!.evidence || "").length).toBeGreaterThan(3);
  });

  it("title cites the primary intent + the SERP format; uses the current title", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames), {
      serpPattern: { format: "ugc", titlePattern: "lead with the keyword" },
      currentTitle: "Old Title",
    });
    expect(plan.title?.recommendation).toMatch(/persian boy names/i);
    expect(plan.title?.recommendation).toMatch(/Old Title/);
    expect(plan.title?.evidence.toLowerCase()).toContain("primary intent");
    expect(plan.title?.evidence.toLowerCase()).toContain("ugc");
  });

  it("FAQ targets come from the fan-out questions (the 'answer' bucket), not owned keywords", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames));
    const faqText = plan.faqs.map((f) => f.recommendation.toLowerCase()).join(" | ");
    expect(faqText).toContain("what are common persian boy names");
    // the question is NOT recommended as a title/H2 (it's an answer target)
    expect(plan.sections.map((s) => s.recommendation.toLowerCase()).join(" ")).not.toContain("what are common");
  });

  it("internal links cross-link siblings (don't merge)", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames));
    const links = plan.internalLinks.map((l) => l.recommendation.toLowerCase()).join(" | ");
    expect(links).toMatch(/persian girl names/);
    expect(links).toMatch(/don't merge/);
  });

  it("addressable volume is cited on the title when cached (never guessed)", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames), {
      volumeByKeyword: { "persian boy names": 50000 },
    });
    expect(plan.title?.evidence).toMatch(/~50k searches\/mo/);
  });

  it("turns the merged keyword portfolio into the title, sections, FAQs, and separate-page plan", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames), {
      keywordPortfolio: {
        primaryTarget: "persian male names",
        secondaryTargets: ["rare persian boy names"],
        questionTargets: ["what are traditional persian boy names?"],
        newPageCandidates: ["persian girl names"],
      },
      volumeByKeyword: { "persian male names": 1900, "rare persian boy names": 500 },
    });
    expect(plan.title?.recommendation).toMatch(/Persian Male Names/);
    expect(plan.sections[0]?.recommendation).toMatch(/Rare Persian Boy Names/);
    expect(plan.sections[0]?.evidence).toMatch(/DataForSEO/);
    expect(plan.faqs.some((faq) => faq.recommendation.includes("traditional persian boy names"))).toBe(true);
    expect(plan.newSiblings[0]?.recommendation).toMatch(/dedicated page.*Persian Girl Names/i);
  });

  it("Persian Swear Words: title_meta proof-flat is NEVER doFirst + surfaces a 'different lever' warning", () => {
    const swear: PageResearchInput = {
      ...base,
      url: "https://iranopedia.com/persian-swear-words",
      pageLabel: "persian swear words",
      gscRanking: [
        { query: "persian swear words", position: 5, impressions: 4000 },
        { query: "farsi swear words", position: 7, impressions: 1500 },
      ],
      aiFanouts: ["What does pedar sag mean?"],
      proof: { measuringFamilies: [], lostFamilies: ["title_meta"] },
    };
    const plan = buildOnPagePlan(buildPageResearchPack(swear), { friction: { deadPct: 24, ragePct: 3 } });
    expect(plan.doFirst?.slot).not.toBe("title");
    expect(plan.warnings.join(" ").toLowerCase()).toContain("different lever");
    // Clarity friction → a concrete UX fix with evidence
    expect(plan.uxFix?.evidence).toMatch(/24% dead clicks/);
  });

  it("mid-measurement page gets a compounding-edit warning", () => {
    const measuring: PageResearchInput = {
      ...base,
      url: "https://iranopedia.com/cities",
      pageLabel: "cities of iran",
      gscRanking: [{ query: "cities of iran", position: 4, impressions: 9000 }],
      proof: { measuringFamilies: ["title_meta"], lostFamilies: [] },
    };
    const plan = buildOnPagePlan(buildPageResearchPack(measuring));
    expect(plan.warnings.join(" ").toLowerCase()).toMatch(/mid-measurement|muddies/);
  });

  it("schema recommendation maps to the SERP format (table → Table/HowTo)", () => {
    const plan = buildOnPagePlan(buildPageResearchPack(boyNames), {
      serpPattern: { format: "table" },
    });
    expect(plan.schema?.recommendation).toMatch(/Table/);
  });

  it("broad page with new-page-intent keywords proposes a dedicated sibling page", () => {
    const cities: PageResearchInput = {
      ...base,
      url: "https://iranopedia.com/cities",
      pageLabel: "cities of iran",
      gscRanking: [
        { query: "cities of iran", position: 4, impressions: 9000 },
        { query: "biggest cities in iran", position: 6, impressions: 3000 },
      ],
      // a strongly-distinct intent with no sibling owner → new_page candidate
      aiFanouts: ["shiraz population and history guide"],
      ownedSiblings: [],
    };
    const plan = buildOnPagePlan(buildPageResearchPack(cities));
    // either a real new sibling OR (at minimum) sections + a clean doFirst with evidence
    expect(plan.doFirst).not.toBeNull();
    expect(plan.doFirst!.evidence.length).toBeGreaterThan(3);
  });
});
