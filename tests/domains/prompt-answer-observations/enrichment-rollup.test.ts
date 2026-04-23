import { describe, it, expect } from "vitest";

import { buildEnrichmentRollup } from "@/domains/prompt-answer-observations/enrichment-rollup";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

function obs(
  overrides: Partial<PromptAnswerObservation> & {
    id: string;
    platform: string;
    observed_at: string;
  },
): PromptAnswerObservation {
  return {
    prompt_id: "p",
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    topic: "",
    metadata: {},
    tenant_id: "t",
    ...overrides,
  };
}

describe("buildEnrichmentRollup", () => {
  const DATE = "2026-04-23";

  it("returns empty rollup when no observations fall on the target date", () => {
    const out = buildEnrichmentRollup({
      observations: [obs({ id: "a", platform: "perplexity", observed_at: "2026-04-22T12:00:00Z" })],
      date: DATE,
    });
    expect(out.date).toBe(DATE);
    expect(out.totalObservations).toBe(0);
    expect(out.byPlatform).toEqual([]);
    expect(out.topDescriptors).toEqual([]);
    expect(out.answerStructures).toEqual([]);
    expect(out.observationsWithDescriptors).toBe(0);
  });

  it("aggregates per-platform primary-recommendation rate + average citation rank", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "a1",
        platform: "perplexity",
        observed_at: `${DATE}T10:00:00Z`,
        primary_recommendation: true,
        citation_rank: 1,
      }),
      obs({
        id: "a2",
        platform: "perplexity",
        observed_at: `${DATE}T11:00:00Z`,
        primary_recommendation: false,
        citation_rank: 3,
      }),
      obs({
        id: "a3",
        platform: "perplexity",
        observed_at: `${DATE}T12:00:00Z`,
        primary_recommendation: true,
        citation_rank: null,
      }),
      obs({
        id: "b1",
        platform: "chatgpt",
        observed_at: `${DATE}T10:00:00Z`,
        primary_recommendation: false,
        citation_rank: null,
      }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.totalObservations).toBe(4);
    const perplexity = out.byPlatform.find((p) => p.platform === "perplexity");
    const chatgpt = out.byPlatform.find((p) => p.platform === "chatgpt");
    expect(perplexity?.observations).toBe(3);
    expect(perplexity?.primaryCount).toBe(2);
    expect(perplexity?.primaryRate).toBe(0.67);
    expect(perplexity?.citedCount).toBe(2);
    expect(perplexity?.avgCitationRank).toBe(2); // (1+3)/2
    expect(chatgpt?.observations).toBe(1);
    expect(chatgpt?.primaryCount).toBe(0);
    expect(chatgpt?.citedCount).toBe(0);
    expect(chatgpt?.avgCitationRank).toBeNull();
  });

  it("aggregates descriptor counts across observations (with per-obs dedup)", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "a1",
        platform: "perplexity",
        observed_at: `${DATE}T10:00:00Z`,
        descriptor_window: ["luxury", "custom", "luxury", "award-winning"],
      }),
      obs({
        id: "a2",
        platform: "perplexity",
        observed_at: `${DATE}T11:00:00Z`,
        descriptor_window: ["luxury", "modern"],
      }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.observationsWithDescriptors).toBe(2);
    // "luxury" appears in both obs — counts as 2 (not 3, despite appearing
    // twice within obs a1).
    const luxury = out.topDescriptors.find((d) => d.word === "luxury");
    expect(luxury?.count).toBe(2);
    const custom = out.topDescriptors.find((d) => d.word === "custom");
    expect(custom?.count).toBe(1);
    const modern = out.topDescriptors.find((d) => d.word === "modern");
    expect(modern?.count).toBe(1);
    const awardWinning = out.topDescriptors.find(
      (d) => d.word === "award-winning",
    );
    expect(awardWinning?.count).toBe(1);
  });

  it("truncates topDescriptors to maxDescriptors and orders by frequency", () => {
    const words = [
      "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
    ];
    const observations: PromptAnswerObservation[] = words.flatMap((w, i) =>
      // Word i appears in (i+1) observations — so "a" appears 1×, "o" 15×.
      Array.from({ length: i + 1 }, (_, k) =>
        obs({
          id: `${w}-${k}`,
          platform: "perplexity",
          observed_at: `${DATE}T10:00:${k.toString().padStart(2, "0")}Z`,
          descriptor_window: [w],
        }),
      ),
    );
    const out = buildEnrichmentRollup({
      observations,
      date: DATE,
      maxDescriptors: 5,
    });
    expect(out.topDescriptors).toHaveLength(5);
    // Top 5 by frequency: o (15), n (14), m (13), l (12), k (11).
    expect(out.topDescriptors.map((d) => d.word)).toEqual([
      "o", "n", "m", "l", "k",
    ]);
  });

  it("aggregates answer structures, sorted by count descending", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "a1", platform: "p", observed_at: `${DATE}T10:00:00Z`, answer_structure: "bullet_list" }),
      obs({ id: "a2", platform: "p", observed_at: `${DATE}T11:00:00Z`, answer_structure: "bullet_list" }),
      obs({ id: "a3", platform: "p", observed_at: `${DATE}T12:00:00Z`, answer_structure: "narrative" }),
      obs({ id: "a4", platform: "p", observed_at: `${DATE}T13:00:00Z`, answer_structure: "narrative" }),
      obs({ id: "a5", platform: "p", observed_at: `${DATE}T14:00:00Z`, answer_structure: "narrative" }),
      obs({ id: "a6", platform: "p", observed_at: `${DATE}T15:00:00Z`, answer_structure: "ranked_list" }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.answerStructures).toEqual([
      { structure: "narrative", count: 3 },
      { structure: "bullet_list", count: 2 },
      { structure: "ranked_list", count: 1 },
    ]);
  });

  it("skips observations whose date doesn't match", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "a1", platform: "p", observed_at: `${DATE}T10:00:00Z`, primary_recommendation: true }),
      obs({ id: "a2", platform: "p", observed_at: "2026-04-22T10:00:00Z", primary_recommendation: true }),
      obs({ id: "a3", platform: "p", observed_at: "2026-04-24T10:00:00Z", primary_recommendation: true }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.totalObservations).toBe(1);
    expect(out.byPlatform[0]?.observations).toBe(1);
  });
});
