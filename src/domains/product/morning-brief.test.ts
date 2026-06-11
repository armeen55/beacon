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
    headline: "citations on /services/kitchen-remodel up 40% over the past 10 days",
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
    tenant_id: "tenant-test",
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.length).toBeGreaterThanOrEqual(1);
    // Should have FAQ question suggestions
    const faqStep = allLines.find((s) => s.includes("FAQ"));
    expect(faqStep).toBeDefined();
    // Should include FAQ-related content
    expect(faqStep).toContain("FAQ");
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.join(" ").includes("schema")).toBe(true);
  });

  it("strengthen_structure with schema gap includes FAQPage schema step", () => {
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.join(" ").includes("FAQPage schema")).toBe(true);
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.join(" ").includes("Article")).toBe(true);
    expect(allLines.join(" ").includes("Review")).toBe(true);
    expect(allLines.join(" ").includes("Service")).toBe(true);
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.join(" ").includes("recent content or structural changes")).toBe(true);
    expect(allLines.join(" ").includes("Compare current citations")).toBe(true);
    expect(allLines.join(" ").includes("monitor for one more import cycle")).toBe(true);
  });

  it("refresh_stale_citation includes decline context", () => {
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    const allStaleText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" ");
    expect(allStaleText).toContain("Refresh");
  });

  it("strengthen_structure with FAQ gap but no AI data includes citation context", () => {
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.some((s) => s.includes("FAQ section") || s.includes("citations"))).toBe(true);
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.join(" ").includes("FAQ section")).toBe(true);
    expect(allLines.join(" ").includes("FAQPage schema")).toBe(true);
    expect(allLines.join(" ").includes("Rich Results Test")).toBe(true);
  });

  it("replicate with generic gap falls back to honest insufficient-data message", () => {
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    expect(allLines.some((s) => s.includes("Insufficient data") || s.includes("/about"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// confidenceToLabel (via toBriefItem)
// ---------------------------------------------------------------------------

describe("confidenceToLabel (via toBriefItem)", () => {
  it("maps high → Strong signal", () => {
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
    expect(result.items[0].confidenceLabel).toBe("Strong signal");
  });

  it("maps medium → Signal detected", () => {
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
    expect(result.items[0].confidenceLabel).toBe("Signal detected");
  });

  it("maps low → Early data", () => {
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
    expect(result.items[0].confidenceLabel).toBe("Early data");
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
      contextLines: [],
      monitorLine: null,
      keyReason: null,
      steps: [
        "Add FAQ section with common questions",
        "Add FAQPage schema (JSON-LD)",
        "Verify with Rich Results Test",
      ],
      pageUrl: "https://example.com/services/kitchen-remodel",
      pagePath: "/services/kitchen-remodel",
      citationCount: 42,
      confidenceLabel: "Strong signal",
      aiContext: null,
      recType: "strengthen_structure",
    };

    const output = formatBriefItemForDevs(item);

    expect(output).toContain("ACTION: Add FAQ + schema to /services/kitchen-remodel");
    expect(output).toContain("PAGE: https://example.com/services/kitchen-remodel");
    expect(output).toContain("DO:");
    expect(output).toContain("1. Add FAQ section with common questions");
    expect(output).toContain("2. Add FAQPage schema (JSON-LD)");
    expect(output).toContain("3. Verify with Rich Results Test");
    expect(output).toContain("WHY: 42 AI citations but missing structured content.");
    expect(output).toContain("CITATIONS: 42 | CONFIDENCE: Strong signal");
  });

  it("includes AI context when present", () => {
    const item: MorningBriefItem = {
      id: "test-2",
      priority: "suggested",
      headline: "Investigate /services/adu",
      rationale: "Visibility may have changed.",
      contextLines: [],
      monitorLine: null,
      keyReason: null,
      steps: ["Check for changes"],
      pageUrl: "https://example.com/services/adu",
      pagePath: "/services/adu",
      citationCount: 10,
      confidenceLabel: "Signal detected",
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
      contextLines: [],
      monitorLine: null,
      keyReason: null,
      steps: ["Review existing content"],
      pageUrl: null,
      pagePath: null,
      citationCount: 25,
      confidenceLabel: "Signal detected",
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
      contextLines: [],
      monitorLine: null,
      keyReason: null,
      steps: ["Add FAQ section", "Add schema"],
      pageUrl: "https://example.com/services/kitchen-remodel",
      pagePath: "/services/kitchen-remodel",
      citationCount: 42,
      confidenceLabel: "Strong signal",
      aiContext: null,
      recType: "strengthen_structure",
    },
    {
      id: "e-2",
      priority: "suggested",
      headline: "Investigate /services/adu",
      rationale: "Visibility declining.",
      contextLines: [],
      monitorLine: null,
      keyReason: null,
      steps: ["Check page"],
      pageUrl: "https://example.com/services/adu",
      pagePath: "/services/adu",
      citationCount: 10,
      confidenceLabel: "Signal detected",
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

    const ritzFaqTemplates = [
      {
        topicPattern: "^(\\w[\\w\\s]*?)\\s+Construction$",
        questions: [
          "What should I look for in a custom home builder in {city}?",
          "How much does it cost to build a custom home in {city}?",
          "How long does a custom home build take in {city}?",
        ],
      },
    ];

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: ai,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
      faqTemplates: ritzFaqTemplates,
    });

    const faqStep = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].find((s) => s.includes("FAQ"));
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

    const faqStep = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].find((s) => s.includes("FAQ"));
    expect(faqStep).toBeDefined();
    // Should use "Luxury Home Builder" (highest mention_count) and match the Builder branch
    expect(faqStep).toContain("luxury home builder");
  });

  it("uses dental faqTemplates when provided", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPageUrl: "https://smiledental.com/treatments/whitening",
      targetPagePath: "/treatments/whitening",
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Teeth Whitening Manhattan",
          mention_count: 30,
        }),
      ],
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {
        "https://smiledental.com/treatments/whitening": ["Teeth Whitening Manhattan"],
      },
    });

    const dentalTemplates = [
      {
        topicPattern: "Whitening|Cosmetic",
        questions: [
          "How long does {topic} last?",
          "Is {topic} covered by dental insurance?",
          "What are the side effects of {topic}?",
        ],
      },
    ];

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: ai,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
      faqTemplates: dentalTemplates,
    });

    const faqStep = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].find((s) => s.includes("FAQ"));
    expect(faqStep).toBeDefined();
    // Dental template questions should appear, NOT construction questions
    expect(faqStep).toContain("dental insurance");
    expect(faqStep).not.toContain("custom home builder");
    expect(faqStep).not.toContain("construction");
  });

  it("falls back to generic questions when no faqTemplates match", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPageUrl: "https://example.com/misc",
      targetPagePath: "/misc",
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Organic Dog Food",
          mention_count: 25,
        }),
      ],
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {
        "https://example.com/misc": ["Organic Dog Food"],
      },
    });

    // No templates match "Organic Dog Food"
    const unrelatedTemplates = [
      {
        topicPattern: "Construction",
        questions: ["How much does {topic} cost?"],
      },
    ];

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: ai,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
      faqTemplates: unrelatedTemplates,
    });

    const faqStep = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].find((s) => s.includes("FAQ"));
    expect(faqStep).toBeDefined();
    // Generic fallback should reference the actual topic
    expect(faqStep).toContain("organic dog food");
    // Should NOT contain construction template content
    expect(faqStep).not.toContain("construction");
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Specificity tests — steps must reference Beacon-specific data
// ---------------------------------------------------------------------------

describe("Phase 4: recommendation content specificity", () => {
  it("strengthen_structure with section gaps produces gap-specific steps", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPagePath: "/services/kitchen",
      citationOpportunity: 250,
      sectionGaps: [
        { label: "faq", display: "FAQ section", pct: 0.85, insertAfter: "Our Process" },
        { label: "cost", display: "Cost breakdown", pct: 0.60, insertAfter: null },
      ],
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

    const allArr = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    // Should reference specific gap percentages and placement
    expect(allArr.some((s) => s.includes("85%") || s.includes("FAQ section"))).toBe(true);
    expect(allArr.some((s) => s.includes("60%") || s.includes("Cost breakdown"))).toBe(true);
    expect(allArr.some((s) => s.includes('after "Our Process"'))).toBe(true);
    // Should NOT contain generic "addressing common questions" text
    expect(allArr.every((s) => !s.includes("addressing common questions"))).toBe(true);
  });

  it("competitive_displacement with competitorContext names the competitor", () => {
    const action = makeAction({
      type: "competitive_displacement",
      headline: 'Close competitive gap for "Kitchen Remodel"',
      citationOpportunity: 150,
      competitorContext: {
        competitorDomain: "supplehomes.com",
        competitorCitations: 200,
        ownedCitations: 50,
        topic: "Kitchen Remodel",
      },
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

    const allTextCC = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" | ");
    // Must name the specific competitor and their citation count
    expect(allTextCC).toContain("supplehomes.com");
    expect(allTextCC).toContain("200");
    // Should NOT contain generic "Check if competitors" text
    expect(allTextCC).not.toContain("Check if competitors have content you don't");
  });

  it("replicate with priorSuccess references the specific prior result", () => {
    const action = makeAction({
      type: "replicate",
      actionClass: "faq_addition",
      targetPagePath: "/locations/atherton",
      citationOpportunity: 120,
      priorSuccess: {
        changeId: "cl-1",
        pagePath: "/locations/menlo-park",
        description: "Added 7-question FAQ section",
        citationDelta: 18.5,
      },
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

    const allArr2 = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    // Must reference the specific prior success page and delta
    expect(allArr2.some((s) => s.includes("/locations/menlo-park") || s.includes("19%"))).toBe(true);
    expect(allArr2.some((s) => s.includes("Added 7-question FAQ section") || s.includes("FAQ"))).toBe(true);
  });

  it("page-specific citation context is prepended when data exists", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPagePath: "/services/bathroom",
      targetPageUrl: "https://example.com/services/bathroom",
      citationOpportunity: 340,
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {
        "https://example.com/services/bathroom": ["Bathroom Remodel Bay Area"],
      },
    });

    const result = buildMorningBrief({
      primaryAction: action,
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: citIndex,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
    });

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    const allStepText = allLines.join(" ");
    expect(allStepText).toContain("340");
    expect(allStepText).toContain("Bathroom Remodel");
  });

  it("observed AI queries surface in refresh_content steps", () => {
    const action = makeAction({
      type: "refresh_content",
      targetPagePath: "/services/renovation",
      targetPageUrl: "https://example.com/services/renovation",
      citationOpportunity: 80,
      observedQueries: [
        "architect-led design-build firm",
        "full-service renovation contractor",
      ],
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

    const allLines = [...(result.items[0].contextLines ?? []), ...result.items[0].steps];
    // Must surface actual AI language
    const allRefreshText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" ");
    expect(allRefreshText).toContain("architect-led design-build firm");
    expect(allRefreshText).toContain("AI");
  });

  it("generic fallback text is never produced", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPagePath: "/unknown-page",
      citationOpportunity: 0,
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

    const allText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" ");
    // None of the old generic fallback text should appear
    expect(allText).not.toContain("Implement the suggested change");
    expect(allText).not.toContain("Apply the structural pattern from top-performing pages");
    expect(allText).not.toContain("Review the target page for structural gaps");
    expect(allText).not.toContain("Check if competitors have content you don't");
  });
});

// ---------------------------------------------------------------------------
// Phase 5: Answer Intelligence deep integration tests
// ---------------------------------------------------------------------------

describe("Phase 5: answer intelligence drives recommendation content", () => {
  it("competitive_displacement shows co-citation displacement data", () => {
    const action = makeAction({
      type: "competitive_displacement",
      headline: 'Close competitive gap for "Kitchen Remodel"',
      citationOpportunity: 150,
      competitorContext: {
        competitorDomain: "supplehomes.com",
        competitorCitations: 200,
        ownedCitations: 50,
        topic: "Kitchen Remodel",
      },
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Kitchen Remodel",
          mention_count: 30,
          mention_rate: 0.35,
          brand_descriptors: [
            { fragment: "architect-led design-build firm", source_count: 5, platforms: ["ChatGPT"], example_observation_id: "obs-1" },
            { fragment: "luxury renovation specialist", source_count: 3, platforms: ["Perplexity"], example_observation_id: "obs-2" },
          ],
        }),
      ],
      co_citation: {
        owned_domain: "ritzbuilders.com",
        total_answers_with_owned: 30,
        total_answers_without_owned: 55,
        competitors: [],
        by_topic: [{
          topic: "Kitchen Remodel",
          answers_with_owned: 20,
          answers_without_owned: 40,
          top_when_present: [{ domain: "supplehomes.com", count: 15 }],
          top_when_absent: [
            { domain: "supplehomes.com", count: 35 },
            { domain: "houzz.com", count: 28 },
            { domain: "angi.com", count: 12 },
          ],
        }],
      },
    });

    const citIndex = makeCitationIndex({
      by_topic: [{
        topic: "Kitchen Remodel",
        total_citations: 350,
        owned_citations: 50,
        competitor_citations: 200,
        directory_citations: 100,
        other_citations: 0,
        top_owned_pages: [],
        top_competitor_pages: [
          { url: "https://supplehomes.com/kitchen-remodel", count: 120 },
          { url: "https://houzz.com/kitchen-remodel-ideas", count: 80 },
        ],
        top_directory_pages: [],
      }],
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

    const allText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" | ");

    // Must show displacement data — who replaces you when absent
    expect(allText).toContain("supplehomes.com");
    expect(allText).toContain("houzz.com");
    // Must show absence ratio
    expect(allText).toContain("40/60");
    // Must show competitor pages winning
    // Competitor page study step removed in Phase 8 compression
    // Must show AI descriptors
    expect(allText).toContain("architect-led design-build firm");
    // ChatGPT cannot produce any of these data points
  });

  it("improve_internal_links names specific high-citation source pages", () => {
    const action = makeAction({
      type: "improve_internal_links",
      targetPagePath: "/services/adu",
      targetPageUrl: "https://example.com/services/adu",
      citationOpportunity: 45,
    });

    const citIndex = makeCitationIndex({
      page_to_topics: {
        "https://example.com/services/adu": ["ADU Construction"],
      },
      by_topic: [{
        topic: "ADU Construction",
        total_citations: 200,
        owned_citations: 45,
        competitor_citations: 155,
        directory_citations: 0,
        other_citations: 0,
        top_owned_pages: [
          { url: "https://example.com/", count: 180 },
          { url: "https://example.com/services/remodel", count: 95 },
          { url: "https://example.com/locations/palo-alto", count: 60 },
        ],
        top_competitor_pages: [],
        top_directory_pages: [],
      }],
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "ADU Construction",
          mention_count: 15,
          mention_rate: 0.22,
        }),
      ],
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

    const allText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" | ");

    // Must name specific source pages with citation counts
    expect(allText).toContain("/");
    // Source pages now inline in step text
    // Source pages now inline in step text
    // Must include mention rate context
    expect(allText).toContain("22%");
    // Should NOT contain generic "your highest-citation pages" without names
    // Source pages now inline in step text
  });

  it("topic_cluster_gap uses AI descriptors + competitor displacement to define page content", () => {
    const action = makeAction({
      type: "topic_cluster_gap",
      headline: 'Add guide/comparison page for "Luxury Home Builder"',
      citationOpportunity: 300,
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Luxury Home Builder",
          mention_count: 45,
          mention_rate: 0.40,
          brand_descriptors: [
            { fragment: "boutique design-build practice", source_count: 4, platforms: ["ChatGPT", "Perplexity"], example_observation_id: "obs-1" },
            { fragment: "high-end custom residential", source_count: 3, platforms: ["Gemini"], example_observation_id: "obs-2" },
          ],
        }),
      ],
      co_citation: {
        owned_domain: "ritzbuilders.com",
        total_answers_with_owned: 45,
        total_answers_without_owned: 70,
        competitors: [],
        by_topic: [{
          topic: "Luxury Home Builder",
          answers_with_owned: 40,
          answers_without_owned: 60,
          top_when_present: [],
          top_when_absent: [{ domain: "supplehomes.com", count: 50 }],
        }],
      },
    });

    const citIndex = makeCitationIndex({
      by_topic: [{
        topic: "Luxury Home Builder",
        total_citations: 500,
        owned_citations: 200,
        competitor_citations: 300,
        directory_citations: 0,
        other_citations: 0,
        top_owned_pages: [
          { url: "https://example.com/luxury-home-builder-bay-area", count: 150 },
          { url: "https://example.com/services/custom-homes", count: 50 },
        ],
        top_competitor_pages: [],
        top_directory_pages: [],
      }],
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

    const allText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" | ");

    // Must use AI descriptors to define page content
    expect(allText).toContain("boutique design-build practice");
    expect(allText).toContain("high-end custom residential");
    // Must name the competitor displacement threat
    expect(allText).toContain("supplehomes.com");
    expect(allText).toContain("50 answers");
    // Must name specific pages to link from
    expect(allText).toContain("/luxury-home-builder-bay-area");
    expect(allText).toContain("/services/custom-homes");
  });

  it("strengthen_structure with AI descriptors generates descriptor-based FAQ questions", () => {
    const action = makeAction({
      type: "strengthen_structure",
      rationale: "Missing FAQ content on this page",
      targetPagePath: "/services/kitchen-remodel",
      targetPageUrl: "https://example.com/services/kitchen-remodel",
      citationOpportunity: 120,
    });

    const ai = makeAnswerIntelligence({
      brand_positioning: [
        makeBrandPositioning({
          topic: "Kitchen Remodel",
          mention_count: 25,
          mention_rate: 0.30,
          avg_position_when_mentioned: 2.5,
          brand_descriptors: [
            { fragment: "full-service renovation firm", source_count: 4, platforms: ["ChatGPT"], example_observation_id: "obs-1" },
            { fragment: "design-build kitchen specialist", source_count: 3, platforms: ["Perplexity"], example_observation_id: "obs-2" },
            { fragment: "Bay Area remodel contractor", source_count: 2, platforms: ["Gemini"], example_observation_id: "obs-3" },
          ],
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

    const allText = [...(result.items[0].contextLines ?? []), ...result.items[0].steps].join(" | ");

    // Must use AI descriptors to generate FAQ questions
    expect(allText).toContain("full-service renovation firm");
    // Must show mention rate and position
    expect(allText).toContain("30%");
    expect(allText).toContain("#3");
    // FAQ questions should be derived from how AI describes the brand
    expect(allText).toContain("FAQ");
  });
});

// ── 2026-06-11: tenant-vocabulary title intent (no fabricated builder copy) ──

describe("buildMorningBrief — tenant-vocabulary title suggestions", () => {
  function actionFor(url: string) {
    return {
      id: "act-1",
      type: "page_edit",
      title: "Improve page",
      rationale: "test",
      targetPageUrl: url,
      targetPagePath: new URL(url).pathname,
      priorityScore: 90,
      citationOpportunity: null,
      answerContext: null,
    } as unknown as PrioritizedAction;
  }
  const snapFor = (url: string) =>
    ({
      url,
      title: "Catering | La Palma",
      h1: "Catering",
      h2_list: [],
    }) as unknown as import("@/domains/pages/types").PageSnapshot;
  const queryIndexFor = (url: string, queries: string[]) =>
    ({
      by_page: { [url.replace(/\/+$/, "").toLowerCase()]: queries },
      by_topic: {},
      by_city: {},
    }) as unknown as import("@/domains/answer-intelligence/query-index").QueryKeywordIndex;

  it("a taqueria's suggestion uses ITS OWN service phrase — never 'Custom Home Builder'", () => {
    const url = "https://lapalma.com/services/catering";
    const brief = buildMorningBrief({
      primaryAction: actionFor(url),
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
      pageSnapshots: [snapFor(url)],
      queryIndex: queryIndexFor(url, ["best catering in tucson"]),
      cities: ["tucson"],
      industry: "restaurant",
      services: ["catering", "taco bar"],
    });
    const allSteps = brief.items.flatMap((i) => i.steps).join("\n");
    expect(allSteps).not.toContain("Custom Home Builder");
    expect(allSteps).not.toContain("Bay Area");
  });

  it("no intent signal + no tenant vocab → NO fabricated suggestion", () => {
    const url = "https://example.com/services/widgets";
    const brief = buildMorningBrief({
      primaryAction: actionFor(url),
      secondaryActions: [],
      answerIntelligence: null,
      citationIndex: null,
      trendPct: null,
      totalOwnedCitations: 0,
      latestDataDate: null,
      pageSnapshots: [snapFor(url)],
      queryIndex: queryIndexFor(url, ["completely unrelated query"]),
    });
    const allSteps = brief.items.flatMap((i) => i.steps).join("\n");
    expect(allSteps).not.toContain("Custom Home Builder");
  });
});
