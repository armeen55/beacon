/**
 * W3 Step 3.11 (2026-05-04) — Action Type Planner v0 acceptance tests.
 *
 * Pin the 13 operator-locked acceptance cases from the W3 §3.11 spec:
 *
 *   - "best luxury home builders" fanout → buyer-decision Page / Table /
 *     Section, NOT a self-claim H2.
 *   - existing page with weak title → rewrite_title.
 *   - existing page with weak meta → rewrite_meta_description.
 *   - existing page with weak/missing H1 → rewrite_h1.
 *   - no owned page → create_page.
 *   - question-shaped fanout → add_faq.
 *   - comparison fanout → add_comparison_table.
 *   - homepage over-cited while target page exists → add_internal_links.
 *   - visible FAQ exists → add_schema (FAQPage enabled).
 *   - absent visible FAQ → add_schema BLOCKED.
 *   - technical page facts → technical_fix.
 *   - planner explains why each action type was chosen + why NOT every
 *     other type was chosen.
 *   - action table renders every new type label cleanly.
 *   - H2 / FAQ are NOT always selected when another type is more
 *     appropriate.
 */

import { describe, expect, it } from "vitest";
import {
  buildRecommendedActionPlan,
  fanoutHasForbiddenSuperlative,
  fanoutHasQuestionShape,
  fanoutLooksComparison,
  h1IsWeak,
  metaIsWeak,
  normalizedIntentFromSignal,
  ownedPageBestMatch,
  pageHasTechnicalIssue,
  planLabelFor,
  schemaIsRecommendable,
  titleIsWeak,
  type PageFactsForPlanner,
  type PlanActionType,
} from "./action-type-planner";
import type {
  AffectedPromptBlock,
  AiSearchSignalBlock,
  CompetitorPageBlueprint,
  OwnedPageCandidateBlock,
  SpecificEditEvidencePacket,
} from "./specific-edit-evidence";
import {
  ACTION_ROW_TYPE_LABEL,
  type ActionRowType,
} from "./recommendation-action-rows";

// ── Fixture builders ───────────────────────────────────────────────────

function makeQuery(query: string, count = 1): AiSearchSignalBlock["topSearchQueries"][number] {
  return { query, count, promptIds: ["p1"], platforms: ["chatgpt"] };
}

function makeSignal(
  overrides: Partial<AiSearchSignalBlock> = {},
): AiSearchSignalBlock {
  return {
    topSearchQueries: [],
    topDescriptors: [],
    topCompetitorCoMentions: [],
    caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
    ...overrides,
  };
}

function makePrompt(promptText: string): AffectedPromptBlock {
  return {
    promptId: "p1",
    promptText,
    category: "outranked",
    observationCount: 8,
    brandPrimaryShare: 0,
    topPrimaryCompetitor: { name: "Kasten Builders", share: 0.4 },
    descriptorsNearBrand: [],
    actualSearchQueries: [],
    citedSourcePages: [],
    descriptorWindows: [],
  };
}

function makeOwnedPage(
  url: string,
  overrides: Partial<OwnedPageCandidateBlock> = {},
): OwnedPageCandidateBlock {
  return {
    url,
    routeType: "service",
    detectedGeo: null,
    detectedService: null,
    matchScore: 0.8,
    matchReasons: [],
    title: "Existing Title",
    h1: "Existing H1",
    h2s: ["Existing H2"],
    ...overrides,
  };
}

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  return {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-04T00:00:00Z",
    tenantId: "tenant-test",
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Luxury Home Builder Bay Area",
    clusterKind: "topic",
    affectedPrompts: [],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: [],
    allowedActionTypes: [],
    aiSearchSignal: makeSignal(),
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [],
    evidenceHash: "evhash",
    ...overrides,
  };
}

function makeFacts(
  url: string,
  overrides: Partial<PageFactsForPlanner> = {},
): PageFactsForPlanner {
  return {
    url,
    title: "A reasonable existing title for the luxury home builder Bay Area page",
    h1: "Luxury custom home builders in the Bay Area",
    metaDescription:
      "Long-form meta description with luxury and Bay Area mentioned for SERP framing of the page.",
    h2s: ["Architect-led design-build", "Site-specific estates", "Luxury home permitting"],
    visibleFaqExists: false,
    breadcrumbHierarchyExists: false,
    servicePageContentExists: true,
    hasSchemaOnPage: false,
    noindexed: false,
    canonicalMismatch: false,
    invalidSchema: false,
    crawlStale: false,
    crawlBlocked: false,
    homepageOverCitedForCluster: false,
    ...overrides,
  };
}

// ── 1. "best luxury home builders" → comparison-stage table ───────────

describe("Operator-locked rule 7 — comparison fanout selects Table, never self-claim H2", () => {
  it("'best luxury home builders Bay Area' picks add_comparison_table", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("which luxury builder should I hire?")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      aiSearchSignal: makeSignal({
        topSearchQueries: [
          makeQuery("best luxury home builders Bay Area", 4),
          makeQuery("top luxury home builders Bay Area", 2),
        ],
      }),
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury"),
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].actionType).toBe("add_comparison_table");
    expect(plans[0].actionType).not.toBe("add_h2_section");
  });

  it("self-claim 'best builder' fanout never degrades to add_h2_section even when page broadly matches", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("which luxury builder?")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      aiSearchSignal: makeSignal({
        topSearchQueries: [makeQuery("best luxury home builders Bay Area", 5)],
      }),
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", {
        // healthy h2 list; the comparison-fanout rule still wins
        h2s: ["Luxury process", "Luxury design", "Luxury permitting"],
      }),
    });
    expect(plans[0].actionType).not.toBe("add_h2_section");
  });
});

// ── 2/3/4. weak title / meta / h1 ─────────────────────────────────────

describe("Operator-locked rules 4/5/3 — weak page elements pick rewrite_h1 > rewrite_title > rewrite_meta", () => {
  it("missing H1 → rewrite_h1 (highest priority of the three)", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("design-build cost in Bay Area?")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      clusterLabel: "Luxury Home Builder Bay Area",
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", { h1: null }),
    });
    expect(plans[0].actionType).toBe("rewrite_h1");
  });

  it("generic title 'Home' (acceptable H1) → rewrite_title", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      clusterLabel: "Luxury Home Builder Bay Area",
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", {
        title: "Home",
        h1: "Luxury custom home builders in the Bay Area", // valid
      }),
    });
    expect(plans[0].actionType).toBe("rewrite_title");
  });

  it("missing meta description (acceptable H1 + title) → rewrite_meta_description", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      clusterLabel: "Luxury Home Builder Bay Area",
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", {
        title: "Luxury custom home builders Bay Area | Ritz Builders",
        h1: "Luxury custom home builders in the Bay Area",
        metaDescription: "",
      }),
    });
    expect(plans[0].actionType).toBe("rewrite_meta_description");
  });
});

// ── 5. no owned page → create_page ───────────────────────────────────

describe("Operator-locked rule 1 — no owned page picks create_page", () => {
  it("empty ownedPageCandidates → create_page", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area")],
      ownedPageCandidates: [], // no coverage
      aiSearchSignal: makeSignal({
        topSearchQueries: [makeQuery("luxury home builder bay area", 3)],
      }),
    });
    const plans = buildRecommendedActionPlan({ packet });
    expect(plans[0].actionType).toBe("create_page");
    expect(plans[0].targetUrl).toBeNull();
    expect(plans[0].targetPageLabel).toBe("New page");
  });
});

// ── 6. question-shaped fanout → add_faq ───────────────────────────────

describe("Operator-locked rule 7 — question-shaped fanout picks add_faq", () => {
  it("fanout 'how do I choose a luxury home builder?' → add_faq", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area cost")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      aiSearchSignal: makeSignal({
        topSearchQueries: [
          // Buyer-neutral question; no comparison superlative.
          makeQuery("how do I find a luxury home builder in the Bay Area?", 3),
        ],
      }),
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury"),
    });
    expect(plans[0].actionType).toBe("add_faq");
  });
});

// ── 7. comparison fanout → add_comparison_table (already covered) ────

// ── 8. homepage over-cited → add_internal_links ──────────────────────

describe("Operator-locked rule 9 — homepage over-cited picks add_internal_links", () => {
  it("input flag `homepageOverCitedForCluster: true` → add_internal_links", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("Bay Area builder")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury"),
      homepageOverCitedForCluster: true,
    });
    expect(plans[0].actionType).toBe("add_internal_links");
  });

  it("falls back to pageFacts.homepageOverCitedForCluster when explicit hint omitted", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("Bay Area builder")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", {
        homepageOverCitedForCluster: true,
      }),
    });
    expect(plans[0].actionType).toBe("add_internal_links");
  });
});

// ── 9. visible FAQ enables FAQPage schema ─────────────────────────────

describe("Operator-locked rule 8 — schema only when visible content supports it", () => {
  it("visible FAQ exists → schemaIsRecommendable=true (FAQPage unlocked)", () => {
    const facts = makeFacts("https://example.com/luxury", {
      visibleFaqExists: true,
      hasSchemaOnPage: false,
    });
    expect(schemaIsRecommendable(facts)).toBe(true);
  });

  it("absent visible FAQ + no breadcrumbs + no service content → schemaIsRecommendable=false", () => {
    const facts = makeFacts("https://example.com/luxury", {
      visibleFaqExists: false,
      breadcrumbHierarchyExists: false,
      servicePageContentExists: false,
      hasSchemaOnPage: false,
    });
    expect(schemaIsRecommendable(facts)).toBe(false);
  });

  it("schema already present → schemaIsRecommendable=false (don't propose duplicate)", () => {
    const facts = makeFacts("https://example.com/luxury", {
      visibleFaqExists: true,
      hasSchemaOnPage: true,
    });
    expect(schemaIsRecommendable(facts)).toBe(false);
  });
});

// ── 10. technical page facts → technical_fix ──────────────────────────

describe("Operator-locked rule 11 — technical defects outrank content edits", () => {
  it("noindexed page → technical_fix", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", { noindexed: true }),
    });
    expect(plans[0].actionType).toBe("technical_fix");
  });

  it("invalid schema → technical_fix", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("x")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", { invalidSchema: true }),
    });
    expect(plans[0].actionType).toBe("technical_fix");
  });

  it("crawl blocked → technical_fix", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("x")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", { crawlBlocked: true }),
    });
    expect(plans[0].actionType).toBe("technical_fix");
  });
});

// ── 11. audit explains why this + why NOT others ─────────────────────

describe("Operator-locked — every plan explains why this action type + why NOT others", () => {
  it("audit.whyThisActionType is non-empty + names the chosen rule", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area")],
      ownedPageCandidates: [],
    });
    const plans = buildRecommendedActionPlan({ packet });
    expect(plans[0].audit.whyThisActionType.length).toBeGreaterThan(15);
    expect(plans[0].audit.whyThisActionType.toLowerCase()).toMatch(/owned page|cluster|new page|create/);
  });

  it("audit.whyNotOtherTypes covers ALL 11 non-chosen plan types with rejection reasons", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area")],
      ownedPageCandidates: [],
    });
    const plans = buildRecommendedActionPlan({ packet });
    const chosen = plans[0].actionType;
    const otherTypes = plans[0].audit.whyNotOtherTypes.map((w) => w.type);
    // Should be 11 (= 12 total plan types - the chosen one).
    expect(otherTypes).toHaveLength(11);
    for (const w of plans[0].audit.whyNotOtherTypes) {
      expect(w.type).not.toBe(chosen);
      expect(w.because.length).toBeGreaterThan(5);
    }
  });

  it("audit.confidence reflects evidence: fanout queries → 'fanout-backed'", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder")],
      ownedPageCandidates: [],
      aiSearchSignal: makeSignal({
        topSearchQueries: [makeQuery("luxury home builder bay area", 3)],
      }),
    });
    const plans = buildRecommendedActionPlan({ packet });
    expect(plans[0].audit.confidence).toBe("fanout-backed");
  });

  it("audit.confidence falls to 'thin' when no fanout, no prompts, no facts", () => {
    const packet = makePacket({
      affectedPrompts: [],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
    });
    const plans = buildRecommendedActionPlan({
      packet,
      // no pageFacts so factsPresent=false
    });
    expect(plans[0].audit.confidence).toBe("thin");
  });

  it("audit.rawFanoutTriggers carries verbatim queries (including 'best …')", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("p")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      aiSearchSignal: makeSignal({
        topSearchQueries: [
          makeQuery("best luxury home builders Bay Area 2023", 2),
          makeQuery("top custom home builders", 1),
        ],
      }),
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury"),
    });
    expect(plans[0].audit.rawFanoutTriggers).toContain(
      "best luxury home builders Bay Area 2023",
    );
    expect(plans[0].audit.rawFanoutTriggers).toContain("top custom home builders");
  });
});

// ── 12. action table renders every new type label cleanly ────────────

describe("Operator-locked — action table renders all 13 task-type labels cleanly", () => {
  const REQUIRED_LABELS = [
    "Page",
    "Title",
    "Meta",
    "H1",
    "H2",
    "Section",
    "Copy",
    "FAQ",
    "Schema",
    "Links",
    "Table",
    "Technical",
    "Review",
  ] as const;

  it("ACTION_ROW_TYPE_LABEL covers every required label", () => {
    const labels = new Set(Object.values(ACTION_ROW_TYPE_LABEL));
    for (const required of REQUIRED_LABELS) {
      expect(labels.has(required)).toBe(true);
    }
  });

  it("planLabelFor surfaces the same operator-readable labels for each PlanActionType", () => {
    const PLAN_LABELS: Array<[PlanActionType, string]> = [
      ["create_page", "Page"],
      ["rewrite_title", "Title"],
      ["rewrite_meta_description", "Meta"],
      ["rewrite_h1", "H1"],
      ["add_h2_section", "H2"],
      ["improve_body_copy", "Copy"],
      ["add_faq", "FAQ"],
      ["add_schema", "Schema"],
      ["add_internal_links", "Links"],
      ["add_comparison_table", "Table"],
      ["technical_fix", "Technical"],
      ["review_decision", "Review"],
    ];
    for (const [plan, label] of PLAN_LABELS) {
      expect(planLabelFor(plan)).toBe(label);
    }
  });

  it("ActionRowType includes edit_h1 + add_comparison_table (W3 §3.11 additions)", () => {
    const labels = ACTION_ROW_TYPE_LABEL as Record<ActionRowType, string>;
    expect(labels["edit_h1"]).toBe("H1");
    expect(labels["add_comparison_table"]).toBe("Table");
  });
});

// ── 13. H2 / FAQ NOT always selected when other types are more apt ───

describe("Operator-locked — H2/FAQ are NOT always selected", () => {
  it("homepage over-cited beats H2/FAQ even when the fanout looks comparison-y", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder?")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      aiSearchSignal: makeSignal({
        topSearchQueries: [makeQuery("best luxury home builders", 4)],
      }),
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury"),
      homepageOverCitedForCluster: true,
    });
    expect(plans[0].actionType).toBe("add_internal_links");
    expect(plans[0].actionType).not.toBe("add_h2_section");
    expect(plans[0].actionType).not.toBe("add_faq");
  });

  it("technical defect beats H2/FAQ", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder?")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      aiSearchSignal: makeSignal({
        topSearchQueries: [makeQuery("how do I find a luxury home builder?", 4)],
      }),
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", {
        canonicalMismatch: true,
      }),
    });
    expect(plans[0].actionType).toBe("technical_fix");
    expect(plans[0].actionType).not.toBe("add_h2_section");
    expect(plans[0].actionType).not.toBe("add_faq");
  });

  it("weak title beats add_h2_section even when page H2s are healthy", () => {
    const packet = makePacket({
      affectedPrompts: [makePrompt("luxury home builder Bay Area")],
      ownedPageCandidates: [makeOwnedPage("https://example.com/luxury")],
      clusterLabel: "Luxury Home Builder Bay Area",
    });
    const plans = buildRecommendedActionPlan({
      packet,
      pageFacts: makeFacts("https://example.com/luxury", {
        title: "Home",
        h1: "Luxury custom home builders Bay Area",
      }),
    });
    expect(plans[0].actionType).toBe("rewrite_title");
  });
});

// ── canGenerateNow + recommendedGenerator + risk + element type ──────

describe("Plan output shape", () => {
  it("canGenerateNow=true ONLY for add_h2_section + add_faq in v0", () => {
    const SAFE: PlanActionType[] = ["add_h2_section", "add_faq"];
    for (const safe of SAFE) {
      const plan = makePlan(safe);
      expect(plan.canGenerateNow).toBe(true);
    }
    const NON_SAFE: PlanActionType[] = [
      "create_page",
      "rewrite_title",
      "rewrite_meta_description",
      "rewrite_h1",
      "improve_body_copy",
      "add_schema",
      "add_internal_links",
      "add_comparison_table",
      "technical_fix",
      "review_decision",
    ];
    for (const plan of NON_SAFE) {
      const p = makePlan(plan);
      expect(p.canGenerateNow).toBe(false);
    }
  });

  it("recommendedGenerator maps to a concrete existing ActionType for every plan", () => {
    const ALL: PlanActionType[] = [
      "create_page",
      "rewrite_title",
      "rewrite_meta_description",
      "rewrite_h1",
      "add_h2_section",
      "improve_body_copy",
      "add_faq",
      "add_schema",
      "add_internal_links",
      "add_comparison_table",
      "technical_fix",
      "review_decision",
    ];
    for (const plan of ALL) {
      const p = makePlan(plan);
      expect(typeof p.recommendedGenerator).toBe("string");
      expect(p.recommendedGenerator.length).toBeGreaterThan(0);
    }
  });

  it("riskLevel populated for every plan (low / medium / high)", () => {
    const plan = makePlan("technical_fix");
    expect(plan.riskLevel).toBe("high");
    expect(makePlan("add_h2_section").riskLevel).toBe("low");
    expect(makePlan("rewrite_title").riskLevel).toBe("medium");
  });

  it("proposedElementType populated for content edits, null for page-level / review", () => {
    expect(makePlan("rewrite_h1").proposedElementType).toBe("h1");
    expect(makePlan("rewrite_title").proposedElementType).toBe("title");
    expect(makePlan("rewrite_meta_description").proposedElementType).toBe(
      "meta",
    );
    expect(makePlan("add_h2_section").proposedElementType).toBe("h2");
    expect(makePlan("add_faq").proposedElementType).toBe("faq_question");
    expect(makePlan("add_comparison_table").proposedElementType).toBe("table");
    expect(makePlan("create_page").proposedElementType).toBeNull();
    expect(makePlan("technical_fix").proposedElementType).toBeNull();
    expect(makePlan("review_decision").proposedElementType).toBeNull();
  });
});

// ── Heuristic helpers ─────────────────────────────────────────────────

describe("Heuristic helpers", () => {
  it("fanoutHasForbiddenSuperlative detects 'best …' / 'top …' queries", () => {
    expect(
      fanoutHasForbiddenSuperlative(
        makeSignal({ topSearchQueries: [makeQuery("best luxury home builders")] }),
      ),
    ).toBe(true);
    expect(
      fanoutHasForbiddenSuperlative(
        makeSignal({ topSearchQueries: [makeQuery("luxury home builder")] }),
      ),
    ).toBe(false);
  });

  it("fanoutLooksComparison detects 'vs', 'compare', 'who should I hire'", () => {
    expect(
      fanoutLooksComparison(
        makeSignal({
          topSearchQueries: [makeQuery("design-build vs architect")],
        }),
        [],
      ),
    ).toBe(true);
    expect(
      fanoutLooksComparison(
        makeSignal({}),
        [makePrompt("who should I hire to build my home?")],
      ),
    ).toBe(true);
    expect(
      fanoutLooksComparison(
        makeSignal({ topSearchQueries: [makeQuery("luxury home builder")] }),
        [],
      ),
    ).toBe(false);
  });

  it("fanoutHasQuestionShape detects 'How do I …?' / 'Who builds …?'", () => {
    expect(
      fanoutHasQuestionShape(
        makeSignal({
          topSearchQueries: [makeQuery("how do I find a luxury home builder?")],
        }),
        [],
      ),
    ).toBe(true);
    expect(
      fanoutHasQuestionShape(
        makeSignal({}),
        [makePrompt("Who builds custom homes in Cupertino?")],
      ),
    ).toBe(true);
    expect(
      fanoutHasQuestionShape(
        makeSignal({ topSearchQueries: [makeQuery("luxury home builder")] }),
        [],
      ),
    ).toBe(false);
  });

  it("titleIsWeak / metaIsWeak / h1IsWeak detect operator-locked patterns", () => {
    expect(
      titleIsWeak({
        title: "Home",
        h1: "x",
        clusterLabel: "Luxury Bay Area",
        topFanoutQuery: null,
      }),
    ).toBe(true);
    expect(
      titleIsWeak({
        title: "Luxury Bay Area Builder | Real Title",
        h1: "x",
        clusterLabel: "Luxury Bay Area",
        topFanoutQuery: null,
      }),
    ).toBe(false);
    expect(metaIsWeak({ meta: null, clusterLabel: "x" })).toBe(true);
    expect(metaIsWeak({ meta: "short", clusterLabel: "x" })).toBe(true);
    expect(h1IsWeak({ h1: null, clusterLabel: "x" })).toBe(true);
    expect(h1IsWeak({ h1: "Welcome", clusterLabel: "x" })).toBe(true);
  });

  it("pageHasTechnicalIssue fires on any of: noindex / canonical / invalid schema / blocked / stale", () => {
    expect(pageHasTechnicalIssue(makeFacts("u", { noindexed: true }))).toBe(true);
    expect(pageHasTechnicalIssue(makeFacts("u", { canonicalMismatch: true }))).toBe(true);
    expect(pageHasTechnicalIssue(makeFacts("u", { invalidSchema: true }))).toBe(true);
    expect(pageHasTechnicalIssue(makeFacts("u", { crawlBlocked: true }))).toBe(true);
    expect(pageHasTechnicalIssue(makeFacts("u", { crawlStale: true }))).toBe(true);
    expect(pageHasTechnicalIssue(makeFacts("u"))).toBe(false);
  });

  it("ownedPageBestMatch returns highest-scoring candidate, null on empty", () => {
    expect(ownedPageBestMatch([])).toBeNull();
    const top = ownedPageBestMatch([
      makeOwnedPage("https://x.com/a", { matchScore: 0.5 }),
      makeOwnedPage("https://x.com/b", { matchScore: 0.9 }),
      makeOwnedPage("https://x.com/c", { matchScore: 0.7 }),
    ]);
    expect(top?.url).toBe("https://x.com/b");
  });

  it("normalizedIntentFromSignal strips superlatives + falls back to prompts", () => {
    expect(
      normalizedIntentFromSignal(
        makeSignal({
          topSearchQueries: [makeQuery("best luxury home builders Bay Area")],
        }),
        [],
      ),
    ).toMatch(/^Buyers searching for luxury home builders/);
    expect(
      normalizedIntentFromSignal(makeSignal({}), [
        makePrompt("Looking for a Bay Area builder"),
      ]),
    ).toMatch(/Prompt-only intent/);
    expect(
      normalizedIntentFromSignal(makeSignal({}), []),
    ).toMatch(/abstain/);
  });
});

// ── Helper for plan-shape tests ──────────────────────────────────────

function makePlan(plan: PlanActionType) {
  // Build a fixture that triggers the SPECIFIC plan we want, so we
  // can inspect the resulting ActionPlan's shape.
  switch (plan) {
    case "create_page":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("p")],
          ownedPageCandidates: [],
        }),
      })[0];
    case "technical_fix":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("p")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
        }),
        pageFacts: makeFacts("https://example.com/x", { noindexed: true }),
      })[0];
    case "add_internal_links":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("p")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
        }),
        pageFacts: makeFacts("https://example.com/x"),
        homepageOverCitedForCluster: true,
      })[0];
    case "rewrite_h1":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("p")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
          clusterLabel: "Luxury Builder",
        }),
        pageFacts: makeFacts("https://example.com/x", { h1: null }),
      })[0];
    case "rewrite_title":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("p")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
          clusterLabel: "Luxury Builder",
        }),
        pageFacts: makeFacts("https://example.com/x", {
          title: "Home",
          h1: "Luxury Builder",
        }),
      })[0];
    case "rewrite_meta_description":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("p")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
          clusterLabel: "Luxury Builder",
        }),
        pageFacts: makeFacts("https://example.com/x", {
          title: "Luxury Builder | Real Title",
          h1: "Luxury Builder",
          metaDescription: "",
        }),
      })[0];
    case "add_comparison_table":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("which luxury builder?")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
          aiSearchSignal: makeSignal({
            topSearchQueries: [makeQuery("best luxury home builders Bay Area", 3)],
          }),
        }),
        pageFacts: makeFacts("https://example.com/x"),
      })[0];
    case "add_faq":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("luxury home builder Bay Area")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
          aiSearchSignal: makeSignal({
            topSearchQueries: [
              makeQuery("how do I find a luxury home builder in the Bay Area?", 3),
            ],
          }),
        }),
        pageFacts: makeFacts("https://example.com/x", {
          // Disable schema — add_faq must fire before add_schema in
          // this fixture (rule 8 vs rule 9).
          servicePageContentExists: false,
          visibleFaqExists: false,
          breadcrumbHierarchyExists: false,
        }),
      })[0];
    case "add_schema":
      return buildRecommendedActionPlan({
        packet: makePacket({
          // No question-shaped fanout, no comparison fanout — schema
          // wins over add_faq / add_comparison_table.
          affectedPrompts: [makePrompt("luxury home builder Bay Area")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
        }),
        pageFacts: makeFacts("https://example.com/x", {
          visibleFaqExists: true,
          servicePageContentExists: true,
          // Healthy h1/title/meta + cluster-relevant H2s so the
          // page-level rewrite + body-copy-thin rules don't fire.
          h2s: [
            "Architect-led design-build",
            "Luxury home permitting",
            "Site-specific estates",
          ],
        }),
      })[0];
    case "add_h2_section":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("luxury home builder Bay Area")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
        }),
        pageFacts: makeFacts("https://example.com/x", {
          // Disable schema (so add_h2_section fires before add_schema).
          servicePageContentExists: false,
          visibleFaqExists: false,
          breadcrumbHierarchyExists: false,
          // Cluster-relevant H2s so body-copy isn't thin → planner
          // routes to add_h2_section, not improve_body_copy.
          h2s: [
            "Architect-led design-build",
            "Luxury home permitting",
            "Site-specific estates",
          ],
        }),
      })[0];
    case "improve_body_copy":
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [makePrompt("luxury home builder")],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
          clusterLabel: "Luxury Builder",
        }),
        pageFacts: makeFacts("https://example.com/x", {
          h1: "Luxury Builder",
          title: "Luxury Builder | Title",
          metaDescription:
            "Long meta with luxury and Bay Area mentioned for SERP framing of the luxury builder page.",
          h2s: ["Process overview", "Site visits", "Permitting overview"], // none mention luxury
        }),
      })[0];
    case "review_decision":
      // No fanout · no prompts · no page facts to trigger any
      // rule → falls through to the review_decision terminal.
      return buildRecommendedActionPlan({
        packet: makePacket({
          affectedPrompts: [],
          ownedPageCandidates: [makeOwnedPage("https://example.com/x")],
        }),
        // Omit pageFacts entirely so the technical / page-rewrite /
        // schema rules can't fire. The owned page exists so the
        // create_page rule doesn't fire either.
        pageFacts: null,
      })[0];
  }
}
