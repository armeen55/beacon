import { describe, it, expect } from "vitest";

import { buildPromptDrilldown } from "@/domains/prompts/prompt-drilldown";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const NOW = new Date("2026-04-24T12:00:00Z");

function mkPrompt(id: string, text: string): TrackedPrompt {
  return {
    id,
    account_id: "ritz",
    text,
    topic_id: "luxury-home-builder",
    location_scope: "Palo Alto",
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["perplexity", "chatgpt"],
    tags: [],
    is_active: true,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
  };
}

function mkEntity(overrides: Partial<TrackedEntity> & { id: string; name: string }): TrackedEntity {
  return {
    account_id: "ritz",
    entity_type: "competitor",
    domain: null,
    url: null,
    aliases: [],
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

const RITZ = mkEntity({
  id: "e-r",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  entity_type: "brand",
  is_owned: true,
});
const CRC = mkEntity({ id: "e-c", name: "CRC Builders" });
const HOMESTEAD = mkEntity({ id: "e-h", name: "Homestead" });
const ENTITIES = [RITZ, CRC, HOMESTEAD];

function mkObs(overrides: Partial<PromptAnswerObservation> & {
  id: string;
  prompt_id: string;
  platform: string;
  observed_at: string;
}): PromptAnswerObservation {
  return {
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

describe("buildPromptDrilldown", () => {
  it("builds a rich decision sentence = classifier reasoning + likely-action", () => {
    const prompt = mkPrompt("p1", "Best luxury home builder in Palo Alto?");
    const observations = Array.from({ length: 3 }, (_, i) =>
      mkObs({
        id: `o-${i}`,
        prompt_id: "p1",
        platform: "perplexity",
        observed_at: `2026-04-23T10:${i}0:00Z`,
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        citation_rank: 1,
      }),
    );
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      classifyOptions: { now: NOW },
    });
    expect(d.category).toBe("winning");
    expect(d.decisionSentence).toMatch(/Primary on Perplexity/);
    expect(d.decisionSentence).toMatch(/Keep monitoring/);
  });

  it("ranks top competitors by co-mention appearance frequency", () => {
    const prompt = mkPrompt("p2", "Bay Area whole-home renovation builders?");
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p2",
        platform: "perplexity",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "p2",
        platform: "perplexity",
        observed_at: "2026-04-23T11:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p2",
        platform: "chatgpt",
        observed_at: "2026-04-23T12:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      }),
    ];
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      classifyOptions: { now: NOW },
    });
    expect(d.competitors[0].name).toBe("CRC Builders");
    expect(d.competitors[0].appearances).toBe(3);
    expect(d.competitors[1].name).toBe("Homestead");
    expect(d.competitors[1].appearances).toBe(2);
  });

  it("aggregates descriptors near brand with per-obs dedup", () => {
    const prompt = mkPrompt("p3", "x");
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p3",
        platform: "perplexity",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        descriptor_window: ["luxury", "custom", "luxury", "modern"], // "luxury" dedup within obs → 1
      }),
      mkObs({
        id: "o2",
        prompt_id: "p3",
        platform: "perplexity",
        observed_at: "2026-04-23T11:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        descriptor_window: ["luxury", "award-winning"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "p3",
        platform: "perplexity",
        observed_at: "2026-04-23T12:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        descriptor_window: ["custom", "trusted"],
      }),
    ];
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      classifyOptions: { now: NOW },
    });
    const luxury = d.descriptorsNearBrand.find((x) => x.word === "luxury");
    const custom = d.descriptorsNearBrand.find((x) => x.word === "custom");
    expect(luxury?.count).toBe(2);
    expect(custom?.count).toBe(2);
  });

  it("detects dominant answer structure at ≥60%", () => {
    const prompt = mkPrompt("p4", "x");
    const observations = Array.from({ length: 5 }, (_, i) =>
      mkObs({
        id: `o-${i}`,
        prompt_id: "p4",
        platform: "perplexity",
        observed_at: `2026-04-23T10:${i}0:00Z`,
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        answer_structure: i < 4 ? "ranked_list" : "narrative",
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      }),
    );
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      classifyOptions: { now: NOW },
    });
    expect(d.dominantAnswerStructure).toEqual({
      structure: "ranked_list",
      share: 0.8,
      total: 5,
    });
  });

  it("null dominantAnswerStructure when no structure reaches 60%", () => {
    const prompt = mkPrompt("p5", "x");
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p5",
        platform: "perplexity",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        answer_structure: "ranked_list",
      }),
      mkObs({
        id: "o2",
        prompt_id: "p5",
        platform: "perplexity",
        observed_at: "2026-04-23T11:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        answer_structure: "bullet_list",
      }),
      mkObs({
        id: "o3",
        prompt_id: "p5",
        platform: "perplexity",
        observed_at: "2026-04-23T12:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        answer_structure: "narrative",
      }),
    ];
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      classifyOptions: { now: NOW },
    });
    expect(d.dominantAnswerStructure).toBeNull();
  });

  it("rawSamples returns last N observations newest-first with Ritz state classified", () => {
    const prompt = mkPrompt("p6", "x");
    const observations = [
      mkObs({
        id: "oldest",
        prompt_id: "p6",
        platform: "perplexity",
        observed_at: "2026-04-22T10:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
      }),
      mkObs({
        id: "middle",
        prompt_id: "p6",
        platform: "chatgpt",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: true,
        citation_rank: 3,
      }),
      mkObs({
        id: "newest",
        prompt_id: "p6",
        platform: "perplexity",
        observed_at: "2026-04-23T14:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
        citation_rank: 1,
      }),
    ];
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      classifyOptions: { now: NOW },
      maxRawSamples: 3,
    });
    expect(d.rawSamples[0].observationId).toBe("newest");
    expect(d.rawSamples[0].ritzState).toBe("primary");
    expect(d.rawSamples[1].observationId).toBe("middle");
    expect(d.rawSamples[1].ritzState).toBe("cited");
    expect(d.rawSamples[2].observationId).toBe("oldest");
    expect(d.rawSamples[2].ritzState).toBe("absent");
  });

  it("rawSamples populates answerTextFull + answerTextHead when answerTexts map is supplied", () => {
    const prompt = mkPrompt("p7", "x");
    const observations = [
      mkObs({
        id: "o1",
        prompt_id: "p7",
        platform: "perplexity",
        observed_at: "2026-04-23T14:00:00Z",
        primary_recommendation: true,
        tracked_brand_mentioned: true,
      }),
    ];
    const answerTexts = new Map([
      [
        "o1",
        "Ritz Builders is widely recommended as a top luxury home builder in the Bay Area, handling complex modern custom home projects across Palo Alto and Atherton.",
      ],
    ]);
    const d = buildPromptDrilldown({
      prompt,
      observations,
      activeEntities: ENTITIES,
      answerTexts,
      classifyOptions: { now: NOW },
    });
    expect(d.rawSamples[0].answerTextFull).toMatch(/Ritz Builders/);
    expect(d.rawSamples[0].answerTextHead).toMatch(/Ritz Builders/);
  });

  it("likely-action sentence varies by category", () => {
    const buildFor = (
      obsOverrides: Array<Partial<PromptAnswerObservation>>,
    ) => {
      const prompt = mkPrompt("p", "x");
      const obs = obsOverrides.map((o, i) =>
        mkObs({
          id: `o-${i}`,
          prompt_id: "p",
          platform: "perplexity",
          observed_at: `2026-04-23T10:${i}0:00Z`,
          ...o,
        }),
      );
      return buildPromptDrilldown({
        prompt,
        observations: obs,
        activeEntities: ENTITIES,
        classifyOptions: { now: NOW },
      });
    };

    const outranked = buildFor(
      Array.from({ length: 3 }, () => ({
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      })),
    );
    expect(outranked.category).toBe("outranked");
    expect(outranked.decisionSentence).toMatch(/competitive content/);

    const absent = buildFor(
      Array.from({ length: 3 }, () => ({
        primary_recommendation: false,
        tracked_brand_mentioned: false,
      })),
    );
    expect(absent.category).toBe("absent");
    expect(absent.decisionSentence).toMatch(/create a page/);

    const close = buildFor(
      Array.from({ length: 3 }, () => ({
        primary_recommendation: false,
        tracked_brand_mentioned: true,
        citation_rank: 3,
      })),
    );
    expect(close.category).toBe("close");
    expect(close.decisionSentence).toMatch(/strengthen the target page/);

    const early = buildFor([]);
    expect(early.category).toBe("early");
    expect(early.decisionSentence).toMatch(/Check back/);
  });
});
