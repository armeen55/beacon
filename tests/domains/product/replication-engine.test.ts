import { describe, expect, it } from "vitest";
import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { BeaconRecommendation } from "@/domains/product/recommendation-engine";
import {
  qualifyWinnerTierFromImpact,
  buildReplicationCards,
  isReplicationTargetBlocked,
} from "@/domains/product/replication-engine";

function row(
  over: Partial<ScorecardRowWithImpact> & {
    change: ScorecardRowWithImpact["change"];
  },
): ScorecardRowWithImpact {
  return {
    verdict: "validated",
    impact: {
      direction: "positive",
      confidence: "high",
      whyExplanation: "test",
      nextAction: "none",
    },
    totalEventsLinked: 2,
    evidenceTier: "probable",
    topics: ["t1"],
    platforms: ["chatgpt"],
    topScore: 10,
    ...over,
  } as ScorecardRowWithImpact;
}

describe("qualifyWinnerTierFromImpact", () => {
  it("returns validated for validated positive rows with events", () => {
    expect(
      qualifyWinnerTierFromImpact(
        row({
          change: { id: "c1", asset_name: "A", url: "https://x.com/p" } as ScorecardRowWithImpact["change"],
        }),
      ),
    ).toBe("validated");
  });

  it("returns qualified_partial only for high-confidence partial with enough events", () => {
    expect(
      qualifyWinnerTierFromImpact(
        row({
          verdict: "partial",
          impact: {
            direction: "positive",
            confidence: "high",
            whyExplanation: "test",
            nextAction: "none",
          },
          totalEventsLinked: 2,
          change: { id: "c2", asset_name: "B", url: "https://x.com/q" } as ScorecardRowWithImpact["change"],
        }),
      ),
    ).toBe("qualified_partial");
  });

  it("returns null for partial with low confidence", () => {
    expect(
      qualifyWinnerTierFromImpact(
        row({
          verdict: "partial",
          impact: {
            direction: "positive",
            confidence: "low",
            whyExplanation: "test",
            nextAction: "none",
          },
          totalEventsLinked: 5,
          change: { id: "c3", asset_name: "C", url: "https://x.com/r" } as ScorecardRowWithImpact["change"],
        }),
      ),
    ).toBeNull();
  });
});

describe("isReplicationTargetBlocked", () => {
  it("blocks when rollout is shipped", () => {
    const r = isReplicationTargetBlocked(
      "https://example.com/a",
      [
        {
          targetPage: "https://example.com/a",
          shippedAt: "2026-01-01",
          verifiedAt: null,
        } as import("@/domains/pages/issues").RolloutExecution,
      ],
      [],
    );
    expect(r.blocked).toBe(true);
  });
});

describe("buildReplicationCards", () => {
  it("groups two replicate recs for the same winner into one card with two targets", () => {
    const impactRows: ScorecardRowWithImpact[] = [
      row({
        change: {
          id: "win-1",
          asset_name: "Winner",
          url: "https://example.com/winner",
        } as ScorecardRowWithImpact["change"],
      }),
    ];
    const recs: BeaconRecommendation[] = [
      {
        id: "r1",
        type: "replicate",
        headline: "T1",
        rationale: "x",
        sourceEvidence: "e",
        targetPageUrl: "https://example.com/t1",
        targetPagePath: "/t1",
        sourceChangeId: "win-1",
        confidence: "high",
        priority: 900,
        patternId: "pattern-a",
        citationOpportunity: 10,
      },
      {
        id: "r2",
        type: "replicate",
        headline: "T2",
        rationale: "y",
        sourceEvidence: "e",
        targetPageUrl: "https://example.com/t2",
        targetPagePath: "/t2",
        sourceChangeId: "win-1",
        confidence: "high",
        priority: 800,
        patternId: "pattern-a",
        citationOpportunity: 8,
      },
    ];
    const cards = buildReplicationCards({
      recommendations: recs,
      impactRows,
      patterns: [
        {
          id: "pattern-a",
          name: "Test pattern",
          type: "city_page_module",
          sourcePages: [],
        } as unknown as import("@/domains/pages/playbook").MinedPattern,
      ],
      rolloutExecutions: [],
      pageIssues: [],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].targets).toHaveLength(2);
    expect(cards[0].sourceChangeId).toBe("win-1");
  });
});
