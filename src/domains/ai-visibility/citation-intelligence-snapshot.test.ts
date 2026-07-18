import { describe, expect, it, vi } from "vitest";

import { refreshCitationIntelligenceForTenant } from "./citation-intelligence-snapshot";
import type { PatternProfile } from "@/domains/citability/mine-answer-patterns";

describe("refreshCitationIntelligenceForTenant", () => {
  it("runs all cache-only intelligence with the explicit tenant and writes one bounded snapshot", async () => {
    const writeSnapshot = vi.fn(async () => {});
    const tenantId = "tenant-iranopedia";
    const now = new Date("2026-07-17T20:00:00.000Z");
    const result = await refreshCitationIntelligenceForTenant(tenantId, now, {
      minePatterns: vi.fn(async (id) => ({
        tenant_id: id,
        computed_at: now.toISOString(),
        observationsWithCitations: 20,
        observationsWithText: 18,
        sentencesClassified: 14,
        bucketCounts: { stat_first: 7, definition: 4, attributed_claim: 3, list_lead: 0, date_anchored: 0, other: 0 },
        bucketSharePct: { stat_first: 50, definition: 29, attributed_claim: 21, list_lead: 0, date_anchored: 0, other: 0 },
        dominantPatterns: ["stat_first", "definition", "attributed_claim"] as PatternProfile["dominantPatterns"],
      })),
      scanDrift: vi.fn(async () => ({
        events: Array.from({ length: 25 }, (_, index) => ({
          promptText: `nowruz question ${index}`,
          engine: "ChatGPT",
          kind: "brand_dropped" as const,
          beforeSentence: "Iranopedia was cited.",
          afterSentence: null,
          whenIso: now.toISOString(),
          relatedMoveLabel: "nowruz traditions",
        })),
        coverage: { pairsWithHistory: 10, pairsComparable: 8, observationsConsidered: 40 },
      })),
      loadSecondOrder: vi.fn(async () => ({
        domains: Array.from({ length: 25 }, (_, index) => ({
          domain: `source-${index}.example`,
          class: "other" as const,
          isOutreachTarget: false,
          citationCount: 25 - index,
          topTopics: ["nowruz traditions"],
          exampleCitedUrl: `https://source-${index}.example/nowruz`,
          examplePrompt: "What are Nowruz traditions?",
          suggestedAction: "Worth a look.",
          outreach: { inOutreachPipeline: false },
        })),
        rowsScanned: 90,
      })),
      writeSnapshot,
    });

    expect(result.patternsMined).toBe(14);
    expect(result.driftEvents).toBe(20);
    expect(result.secondOrderDomains).toBe(20);
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    expect(writeSnapshot).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ tenantId, computedAt: now.toISOString() }),
    );
  });
});
