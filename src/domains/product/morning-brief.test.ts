import { describe, it, expect } from "vitest";
import {
  buildMorningBrief,
  formatBriefItemForDevs,
  formatAllBriefsForEmail,
  type MorningBriefItem,
} from "./morning-brief";
import type { PrioritizedAction } from "./priority-engine";
import type { RecommendationType } from "./recommendation-engine";
import type { AnswerIntelligenceIndex, BrandPositioningByTopic } from "@/domains/answer-intelligence/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { MemoryInsight } from "@/domains/attribution/memory";

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

let _actionId = 0;
function makeAction(overrides: Partial<PrioritizedAction> = {}): PrioritizedAction {
  _actionId++;
  return {
    id: `action-${_actionId}`,
    type: "strengthen_structure" as RecommendationType,
    headline: "Add FAQ + schema to /services/kitchen-remodel",
    rationale: "This page is missing FAQ content and structured data. Adding both protects visibility.",
    sourceEvidence: "42 citations, 2 structural gaps",
    targetPageUrl: "https://example.com/services/kitchen-remodel",
    targetPagePath: "/services/kitchen-remodel",
    sourceChangeId: null,
    confidence: "high" as const,
    priority: 700,
    patternId: null,
    citationOpportunity: 42,
    answerContext: null,
    priorityScore: 75,
    bucket: "critical" as const,
    expectedOutcome: "Adding structure protects citations.",
    replicablePages: 0,
    ...overrides,
  };
}

function makeMemoryInsight(overrides: Partial<MemoryInsight> = {}): MemoryInsight {
  return {
    changeId: "mem-1",
    changeDescription: "Added FAQ section",
    changeSummary: "content: Kitchen Remodel Page",
    pageUrl: "/services/kitchen-remodel",
    pagePath: "/services/kitchen-remodel",
    topicTargeted: "kitchen remodel",
    changedAt: "2026-03-01T12:00:00Z",
    daysSince: 10,
    direction: "improving" as const,
    headline: "10 days ago you updated /services/kitchen-remodel — citations up 40%",
    detail: "Change: Added FAQ section · Citations: 2.0/day → 2.8/day",
    metricsBefore: { avgMentions: 3, avgCitations: 2, avgVisibility: 0.5, totalObservations: 10 },
    metricsAfter: { avgMentions: 4, avgCitations: 2.8, avgVisibility: 0.6, totalObservations: 12 },
    platformBreakdown: [],
    trendLine: [
      { date: "2026-02-25", mentions: 3, citations: 2 },
      { date: "2026-03-05", mentions: 4, citations: 3 },
    ],
    changeIndex: 1,
    ...overrides,
  };
}

function makeAnswerIntelligence(
  overrides: Partial<AnswerIntelligenceIndex> = {},
): AnswerIntelligenceIndex {
  return {
    built_at: "2026-03-15T00:00:00Z",
    brand_name: "Ritz Builders",
    owned_domain: "ritzbuilders.com",
    total_observations: 500,
    total_with_answer_text: 400,
    brand_positioning: [],
    visibility_cells: [],
    co_citation: {
      owned_domain: "ritzbuilders.com",
      total_answers_with_owned: 100,
      total_answers_without_owned: 200,
      competitors: [],
      by_topic: [],
    },
    narrative_shifts: [],
    topic_platform_summary: {},
    ...overrides,
  };
}

function makeBrandPositioning(
  overrides: Partial<BrandPositioningByTopic> = {},
): BrandPositioningByTopic {
  return {
    topic: "Kitchen Remodel",
    mention_count: 30,
    total_observations: 100,
    mention_rate: 0.3,
    citation_rate: 0.2,
    brand_descriptors: [],
    top_co_appearing_competitors: [],
    avg_position_when_mentioned: 3,
    typical_list_size: 5,
    ...overrides,
  };
}

function makeCitationIndex(
  overrides: Partial<CitationEvidenceIndex> = {},
): CitationEvidenceIndex {
  return {
    built_at: "2026-03-15T00:00:00Z",
    total_citations_processed: 1000,
    by_page_and_topic: [],
    by_topic: [],
    page_to_topics: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildMorningBrief
// ---------------------------------------------------------------------------

describe("buildMorningBrief", () => {
  it("returns empty items when no primaryAction", () => {
    const result = buildMorningBrief({
      primaryAction: null,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items).toEqual([]);
    expect(result.memoryInsights).toEqual([]);
    expect(result.trendPct).toBeNull();
    expect(result.totalOwnedCitations).toBe(0);
    expect(result.latestDataDate).toBeNull();
  });

  it("returns 1 item (need) when only primaryAction", () => {
    const primary = makeAction();

    const result = buildMorningBrief({
      primaryAction: primary,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: 12.5,
      totalOwnedCitations: 200,
      latestDataDate: "2026-03-15",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].priority).toBe("need");
    expect(result.items[0].id).toBe(primary.id);
    expect(result.trendPct).toBe(12.5);
    expect(result.totalOwnedCitations).toBe(200);
    expect(result.latestDataDate).toBe("2026-03-15");
  });

  it("returns 3 items (1 need + 2 suggested) when all provided", () => {
    const primary = makeAction({ id: "primary-1" });
    const secondary1 = makeAction({ id: "secondary-1", type: "replicate" });
    const secondary2 = makeAction({ id: "secondary-2", type: "investigate" });

    const result = buildMorningBrief({
      primaryAction: primary,
      secondaryActions: [secondary1, secondary2],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: -5,
      totalOwnedCitations: 150,
      latestDataDate: "2026-03-14",
    });

    expect(result.items).toHaveLength(3);
    expect(result.items[0].priority).toBe("need");
    expect(result.items[0].id).toBe("primary-1");
    expect(result.items[1].priority).toBe("suggested");
    expect(result.items[1].id).toBe("secondary-1");
    expect(result.items[2].priority).toBe("suggested");
    expect(result.items[2].id).toBe("secondary-2");
  });

  it("caps at 3 items even with many secondaryActions", () => {
    const primary = makeAction({ id: "p" });
    const secondaries = Array.from({ length: 5 }, (_, i) =>
      makeAction({ id: `s-${i}` }),
    );

    const result = buildMorningBrief({
      primaryAction: primary,
      secondaryActions: secondaries,
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items).toHaveLength(3); // 1 primary + 2 secondary (capped)
    expect(result.items[0].id).toBe("p");
    expect(result.items[1].id).toBe("s-0");
    expect(result.items[2].id).toBe("s-1");
  });

  it("serializes memoryInsights (top 2 only)", () => {
    const insights = [
      makeMemoryInsight({ changeId: "m1" }),
      makeMemoryInsight({ changeId: "m2" }),
      makeMemoryInsight({ changeId: "m3" }),
    ];

    const result = buildMorningBrief({
      primaryAction: makeAction(),
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
      memoryInsights: insights,
    });

    expect(result.memoryInsights).toHaveLength(2);
    expect(result.memoryInsights[0].changeId).toBe("m1");
    expect(result.memoryInsights[1].changeId).toBe("m2");
    // Verify serialized shape
    expect(result.memoryInsights[0]).toHaveProperty("headline");
    expect(result.memoryInsights[0]).toHaveProperty("detail");
    expect(result.memoryInsights[0]).toHaveProperty("direction");
    expect(result.memoryInsights[0]).toHaveProperty("daysSince");
    expect(result.memoryInsights[0]).toHaveProperty("pagePath");
    expect(result.memoryInsights[0]).toHaveProperty("trendLine");
    expect(result.memoryInsights[0]).toHaveProperty("changeIndex");
  });

  it("includes trendPct, totalOwnedCitations, latestDataDate", () => {
    const result = buildMorningBrief({
      primaryAction: null,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: 8.3,
      totalOwnedCitations: 345,
      latestDataDate: "2026-04-01",
    });

    expect(result.trendPct).toBe(8.3);
    expect(result.totalOwnedCitations).toBe(345);
    expect(result.latestDataDate).toBe("2026-04-01");
  });
});

// ---------------------------------------------------------------------------
// rewriteHeadline (via toBriefItem)
// ---------------------------------------------------------------------------

describe("rewriteHeadline (via toBriefItem)", () => {
  it("strengthen_structure: rewrites to 'Add FAQ + schema to /page'", () => {
    const action = makeAction({
      type: "strengthen_structure",
      headline: "Add FAQ content + structured data to Kitchen Remodel",
      rationale: "Missing FAQ content and structured data",
      targetPagePath: "/services/kitchen-remodel",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].headline).toBe("Add FAQ + schema to /services/kitchen-remodel");
  });

  it("strengthen_structure with only FAQ gap: rewrites correctly", () => {
    const action = makeAction({
      type: "strengthen_structure",
      headline: "Add FAQ to page",
      rationale: "Missing FAQ content on this page",
      targetPagePath: "/locations/san-jose",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].headline).toBe("Add FAQ content to /locations/san-jose");
  });

  it("strengthen_structure with only schema gap: rewrites correctly", () => {
    const action = makeAction({
      type: "strengthen_structure",
      headline: "Add schema to page",
      rationale: "Missing structured data on this page",
      targetPagePath: "/services/bathroom",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].headline).toBe("Add schema markup to /services/bathroom");
  });

  it("replicate: passes through headline as-is", () => {
    const action = makeAction({
      type: "replicate",
      headline: "Apply FAQ + schema package to /locations/fremont",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].headline).toBe("Apply FAQ + schema package to /locations/fremont");
  });

  it("investigate: passes through headline as-is", () => {
    const action = makeAction({
      type: "investigate",
      headline: 'Investigate: "Homepage Schema Update"',
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].headline).toBe('Investigate: "Homepage Schema Update"');
  });

  it("refresh_content: rewrites to 'Expand content on /page'", () => {
    const action = makeAction({
      type: "refresh_content",
      headline: "Refresh content on Kitchen page",
      targetPagePath: "/services/kitchen-remodel",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].headline).toBe("Expand content on /services/kitchen-remodel");
  });
});

// ---------------------------------------------------------------------------
// rewriteRationale (via toBriefItem)
// ---------------------------------------------------------------------------

describe("rewriteRationale (via toBriefItem)", () => {
  it("strengthen_structure: mentions citations + missing structured content", () => {
    const action = makeAction({
      type: "strengthen_structure",
      citationOpportunity: 42,
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].rationale).toContain("42 times");
    expect(result.items[0].rationale).toContain("FAQ and schema");
  });

  it("replicate: mentions citations + missing structural elements", () => {
    const action = makeAction({
      type: "replicate",
      citationOpportunity: 18,
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].rationale).toContain("18 times");
    expect(result.items[0].rationale).toContain("missing elements");
  });

  it("investigate: mentions visibility may have changed", () => {
    const action = makeAction({
      type: "investigate",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].rationale).toContain("AI visibility on this page may have shifted");
  });
});

// ---------------------------------------------------------------------------
// generateSteps (via toBriefItem)
// ---------------------------------------------------------------------------

describe("generateSteps (via toBriefItem)", () => {
  it("strengthen_structure with FAQ gap includes FAQ question suggestions when AI data available", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPageUrl: "https://example.com/services/kitchen-remodel",
      targetPagePath: "/services/kitchen-remodel",
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Kitchen Remodel",
          mention_count: 50,
        }),
      ],
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {
        "https://example.com/services/kitchen-remodel": ["Kitchen Remodel"],
      },
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: ai,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.length).toBeGreaterThanOrEqual(1);
    // Should have FAQ question suggestions
    const faqStep = steps.find((s) => s.includes("FAQ section"));
    expect(faqStep).toBeDefined();
    // Should include question suggestions from the "Renovation/Remodel" branch
    expect(faqStep).toContain("questions:");
  });

  it("strengthen_structure with schema gap includes schema steps", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing structured data on this page",
      targetPagePath: "/services/bathroom",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("FAQPage schema"))).toBe(true);
    expect(steps.some((s) => s.includes("Rich Results Test"))).toBe(true);
  });

  it("strengthen_structure with location page includes LocalBusiness schema", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing structured data on this page",
      targetPagePath: "/locations/san-jose",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("LocalBusiness schema"))).toBe(true);
  });

  it("replicate with multi-schema includes Article/Review/Service schema", () => {
    const action = makeAction({
      type: "replicate",
      headline: "Add multi-schema package to /services/adu",
      rationale: "This page is missing multi-schema support found on top performers",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("Article"))).toBe(true);
    expect(steps.some((s) => s.includes("Review"))).toBe(true);
    expect(steps.some((s) => s.includes("Service"))).toBe(true);
  });

  it("investigate includes diagnostic steps", () => {
    const action = makeAction({
      type: "investigate",
      targetPagePath: "/services/kitchen-remodel",
      targetPageUrl: "https://example.com/services/kitchen-remodel",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("recent content or structural changes"))).toBe(true);
    expect(steps.some((s) => s.includes("Compare current AI citations"))).toBe(true);
    expect(steps.some((s) => s.includes("monitor for one more cycle"))).toBe(true);
  });

  it("default fallback produces generic steps", () => {
    const action = makeAction({
      type: "refresh_stale_citation" as RecommendationType,
      targetPageUrl: "https://example.com/services/adu",
      targetPagePath: "/services/adu",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("Review page content"))).toBe(true);
  });

  it("strengthen_structure with FAQ gap but no AI data gives generic FAQ step", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("Add FAQ section addressing common questions"))).toBe(true);
  });

  it("replicate with FAQ+schema gaps generates combined steps", () => {
    const action = makeAction({
      type: "replicate",
      headline: "Apply FAQ + schema to /locations/fremont",
      rationale: "This page is missing FAQ content and schema markup",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("FAQ section"))).toBe(true);
    expect(steps.some((s) => s.includes("FAQPage schema"))).toBe(true);
    expect(steps.some((s) => s.includes("Rich Results Test"))).toBe(true);
  });

  it("replicate with generic gap falls back to structural review steps", () => {
    const action = makeAction({
      type: "replicate",
      headline: "Apply content improvements to /about",
      rationale: "This page has a structural gap that could benefit from updates",
      targetPagePath: "/about",
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const steps = result.items[0].steps;
    expect(steps.some((s) => s.includes("Review /about"))).toBe(true);
    expect(steps.some((s) => s.includes("structural pattern"))).toBe(true);
    expect(steps.some((s) => s.includes("Monitor AI citations"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// confidenceToLabel (via toBriefItem)
// ---------------------------------------------------------------------------

describe("confidenceToLabel (via toBriefItem)", () => {
  it("maps high → High confidence", () => {
    const action = makeAction({ confidence: "high" });
    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });
    expect(result.items[0].confidenceLabel).toBe("High confidence");
  });

  it("maps medium → Good confidence", () => {
    const action = makeAction({ confidence: "medium" });
    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });
    expect(result.items[0].confidenceLabel).toBe("Good confidence");
  });

  it("maps low → Worth trying", () => {
    const action = makeAction({ confidence: "low" });
    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });
    expect(result.items[0].confidenceLabel).toBe("Worth trying");
  });
});

// ---------------------------------------------------------------------------
// formatBriefItemForDevs
// ---------------------------------------------------------------------------

describe("formatBriefItemForDevs", () => {
  it("produces correct plain text format with steps, rationale, citations", () => {
    const item: MorningBriefItem = {
      id: "test-1",
      priority: "need",
      headline: "Add FAQ + schema to /services/kitchen-remodel",
      rationale: "42 AI citations but missing structured content.",
      steps: [
        "Add FAQ section with common questions",
        "Add FAQPage schema (JSON-LD)",
        "Verify with Rich Results Test",
      ],
      pageUrl: "https://example.com/services/kitchen-remodel",
      pagePath: "/services/kitchen-remodel",
      citationCount: 42,
      confidenceLabel: "High confidence",
      aiContext: null,
      recType: "strengthen_structure",
    };

    const output = formatBriefItemForDevs(item);

    expect(output).toContain("ACTION: Add FAQ + schema to /services/kitchen-remodel");
    expect(output).toContain("PAGE: https://example.com/services/kitchen-remodel");
    expect(output).toContain("STEPS:");
    expect(output).toContain("1. Add FAQ section with common questions");
    expect(output).toContain("2. Add FAQPage schema (JSON-LD)");
    expect(output).toContain("3. Verify with Rich Results Test");
    expect(output).toContain("WHY: 42 AI citations but missing structured content.");
    expect(output).toContain("CITATIONS: 42 | CONFIDENCE: High confidence");
  });

  it("includes AI context when present", () => {
    const item: MorningBriefItem = {
      id: "test-2",
      priority: "suggested",
      headline: "Investigate /services/adu",
      rationale: "Visibility may have changed.",
      steps: ["Check for changes"],
      pageUrl: "https://example.com/services/adu",
      pagePath: "/services/adu",
      citationCount: 10,
      confidenceLabel: "Good confidence",
      aiContext: "Mentioned in 30% of AI answers for this topic. Typically listed #2.",
      recType: "investigate",
    };

    const output = formatBriefItemForDevs(item);

    expect(output).toContain("AI CONTEXT: Mentioned in 30% of AI answers");
  });

  it("shows '(no specific page)' when pageUrl is null", () => {
    const item: MorningBriefItem = {
      id: "test-3",
      priority: "suggested",
      headline: 'Close competitive gap for "Custom Home Builder"',
      rationale: "Competitors dominate this topic.",
      steps: ["Review existing content"],
      pageUrl: null,
      pagePath: null,
      citationCount: 25,
      confidenceLabel: "Good confidence",
      aiContext: null,
      recType: "competitive_displacement",
    };

    const output = formatBriefItemForDevs(item);

    expect(output).toContain("PAGE: (no specific page)");
  });
});

// ---------------------------------------------------------------------------
// formatAllBriefsForEmail
// ---------------------------------------------------------------------------

describe("formatAllBriefsForEmail", () => {
  const items: MorningBriefItem[] = [
    {
      id: "e-1",
      priority: "need",
      headline: "Add FAQ to /services/kitchen-remodel",
      rationale: "Protects visibility.",
      steps: ["Add FAQ section", "Add schema"],
      pageUrl: "https://example.com/services/kitchen-remodel",
      pagePath: "/services/kitchen-remodel",
      citationCount: 42,
      confidenceLabel: "High confidence",
      aiContext: null,
      recType: "strengthen_structure",
    },
    {
      id: "e-2",
      priority: "suggested",
      headline: "Investigate /services/adu",
      rationale: "Visibility declining.",
      steps: ["Check page"],
      pageUrl: "https://example.com/services/adu",
      pagePath: "/services/adu",
      citationCount: 10,
      confidenceLabel: "Good confidence",
      aiContext: null,
      recType: "investigate",
    },
  ];

  it("has correct subject line", () => {
    const { subject } = formatAllBriefsForEmail(items, "2026-04-13");

    expect(subject).toBe("Beacon Daily Brief — 2026-04-13");
  });

  it("includes all items with labels", () => {
    const { body } = formatAllBriefsForEmail(items, "2026-04-13");

    expect(body).toContain("Beacon Daily Brief for 2026-04-13");
    expect(body).toContain("--- DO THIS FIRST ---");
    expect(body).toContain("--- NEXT UP #1 ---");
    expect(body).toContain("ACTION: Add FAQ to /services/kitchen-remodel");
    expect(body).toContain("ACTION: Investigate /services/adu");
    expect(body).toContain("Generated by Beacon");
  });

  it("contains step numbering for each item", () => {
    const { body } = formatAllBriefsForEmail(items, "2026-04-13");

    expect(body).toContain("1. Add FAQ section");
    expect(body).toContain("2. Add schema");
    expect(body).toContain("1. Check page");
  });
});

// ---------------------------------------------------------------------------
// toBriefItem preserves fields
// ---------------------------------------------------------------------------

describe("toBriefItem field mapping", () => {
  it("maps recType from action type", () => {
    const action = makeAction({ type: "competitive_displacement" });
    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].recType).toBe("competitive_displacement");
  });

  it("maps answerContext from action", () => {
    const action = makeAction({
      answerContext: "Mentioned in 25% of AI answers.",
    });
    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].aiContext).toBe("Mentioned in 25% of AI answers.");
  });

  it("maps pageUrl and pagePath from action", () => {
    const action = makeAction({
      targetPageUrl: "https://example.com/about",
      targetPagePath: "/about",
    });
    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    expect(result.items[0].pageUrl).toBe("https://example.com/about");
    expect(result.items[0].pagePath).toBe("/about");
  });
});

// ---------------------------------------------------------------------------
// FAQ question generation (via strengthen_structure with AI data)
// ---------------------------------------------------------------------------

describe("suggestFaqQuestions (via generateSteps)", () => {
  it("generates city-based questions for 'City Construction' topics", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPageUrl: "https://example.com/locations/san-jose",
      targetPagePath: "/locations/san-jose",
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "San Jose Construction",
          mention_count: 40,
        }),
      ],
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {
        "https://example.com/locations/san-jose": ["San Jose Construction"],
      },
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: ai,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const faqStep = result.items[0].steps.find((s) => s.includes("FAQ section"));
    expect(faqStep).toBeDefined();
    expect(faqStep).toContain("San Jose");
    expect(faqStep).toContain("custom home builder");
  });

  it("falls back to highest-mention topic when no page-topic mapping exists", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPageUrl: "https://example.com/",
      targetPagePath: "/",
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Luxury Home Builder",
          mention_count: 100,
        }),
        makeBrandPositioning({
          topic: "Kitchen Remodel",
          mention_count: 20,
        }),
      ],
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {},
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: ai,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const faqStep = result.items[0].steps.find((s) => s.includes("FAQ section"));
    expect(faqStep).toBeDefined();
    // Should use "Luxury Home Builder" (highest mention_count) and match the Builder branch
    expect(faqStep).toContain("luxury home builder");
  });
});
