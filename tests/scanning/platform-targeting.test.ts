/**
 * Phase C — Platform-specific recommendation intelligence tests.
 *
 * Tests that:
 * 1. Recommendations carry targetPlatforms based on rec type + action class
 * 2. FAQ schema recs target ChatGPT + Google AIO (data-proven)
 * 3. Comparison table recs target Google AIO only
 * 4. Perplexity is excluded by default (opt-in only)
 * 5. Platform suffix appears in key reason text
 */

import { describe, it, expect } from "vitest";
import { computeRecommendations, type BeaconRecommendation } from "@/domains/product/recommendation-engine";
import type { PageSnapshot } from "@/domains/pages/types";

function makeMinimalSnapshot(url: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url,
    h2_list: [],
    faqs: [],
    schema_types: [],
    table_count: 0,
    extraction_certainty: "confident",
    ...overrides,
  } as unknown as PageSnapshot;
}

describe("Phase C: platform targeting", () => {
  it("assigns chatgpt + google_aio to FAQ schema recs", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/atherton", {
      page_id: "pg-1",
      faqs: [
        { question: "Q1?", answer_excerpt: "A1", source: "html_section" },
        { question: "Q2?", answer_excerpt: "A2", source: "html_section" },
        { question: "Q3?", answer_excerpt: "A3", source: "html_section" },
      ],
      schema_types: [],
    } as unknown as PageSnapshot);
    const citMap = new Map([["https://example.com/locations/atherton", 100]]);

    const recs: BeaconRecommendation[] = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const faqRec = recs.find((r) => r.id.startsWith("rec-faq-schema-"));
    expect(faqRec).toBeDefined();
    expect(faqRec!.targetPlatforms).toEqual(["chatgpt", "google_aio"]);
    expect(faqRec!.targetPlatforms).not.toContain("perplexity");
  });

  it("assigns google_aio only to comparison_table recs", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/atherton", {
      page_id: "pg-2",
      table_count: 0,
      faqs: [],
      schema_types: [],
    });
    const citMap = new Map([["https://example.com/locations/atherton", 100]]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    const compRec = recs.find((r) => r.actionClass === "comparison_table");
    expect(compRec).toBeDefined();
    expect(compRec!.targetPlatforms).toEqual(["google_aio"]);
  });

  it("never automatically assigns perplexity to default rec types", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/atherton", {
      page_id: "pg-3",
      faqs: [],
      schema_types: ["Organization"],
    });
    const citMap = new Map([["https://example.com/locations/atherton", 100]]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    for (const rec of recs) {
      expect(rec.targetPlatforms).toBeDefined();
      expect(rec.targetPlatforms).not.toContain("perplexity");
    }
  });

  it("every generated recommendation has targetPlatforms set", () => {
    const snap = makeMinimalSnapshot("https://example.com/locations/atherton", {
      page_id: "pg-4",
      faqs: [{ question: "Q?", answer_excerpt: "A", source: "html_section" }],
      schema_types: [],
    } as unknown as PageSnapshot);
    const citMap = new Map([["https://example.com/locations/atherton", 100]]);

    const recs = computeRecommendations({
      impactRows: [],
      patterns: [],
      briefs: [],
      pageSnapshots: [snap],
      citationCountMap: citMap,
    });

    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.targetPlatforms).toBeDefined();
      expect(rec.targetPlatforms!.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Platform suffix in keyReason
// ---------------------------------------------------------------------------

import { buildMorningBrief } from "@/domains/product/morning-brief";
import type { PrioritizedAction } from "@/domains/product/priority-engine";

function makeAction(overrides: Partial<PrioritizedAction>): PrioritizedAction {
  return {
    id: "rec-test",
    type: "refresh_content",
    headline: "Test action",
    rationale: "Test rationale",
    sourceEvidence: "",
    targetPageUrl: null,
    targetPagePath: null,
    sourceChangeId: null,
    confidence: "medium",
    priority: 500,
    patternId: null,
    citationOpportunity: 0,
    priorityScore: 50,
    bucket: "high_leverage",
    expectedOutcome: "Test outcome",
    replicablePages: 0,
    ...overrides,
  } as PrioritizedAction;
}

describe("Phase C: platform suffix in keyReason", () => {
  it("appends platform suffix to key reason when citation count drives it", () => {
    const action = makeAction({
      citationOpportunity: 100,
      targetPlatforms: ["chatgpt", "google_aio"],
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

    const keyReason = result.items[0].keyReason;
    expect(keyReason).toBeDefined();
    expect(keyReason).toContain("primarily");
    expect(keyReason).toContain("ChatGPT");
    expect(keyReason).toContain("Google AIO");
  });

  it("omits platform suffix when targetPlatforms is empty", () => {
    const action = makeAction({
      citationOpportunity: 100,
      targetPlatforms: [],
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

    const keyReason = result.items[0].keyReason;
    expect(keyReason).toBeDefined();
    expect(keyReason).not.toContain("primarily");
  });
});
