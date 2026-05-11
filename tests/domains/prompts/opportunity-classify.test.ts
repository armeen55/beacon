import { describe, it, expect } from "vitest";

import { classifyPromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const TODAY = new Date("2026-04-24T12:00:00Z");

function mkPrompt(overrides: Partial<TrackedPrompt> & { id: string }): TrackedPrompt {
  return {
    account_id: "ritz",
    text: "Best luxury home builder Bay Area",
    topic_id: "luxury-home-builder",
    location_scope: "Bay Area",
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["perplexity", "chatgpt"],
    tags: [],
    is_active: true,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function mkEntity(overrides: Partial<TrackedEntity> & { id: string; name: string }): TrackedEntity {
  return {
    account_id: "ritz",
    entity_type: "competitor",
    domain: `${overrides.name.toLowerCase().replace(/\s+/g, "")}.com`,
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

const RITZ: TrackedEntity = mkEntity({
  id: "ent-ritz",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  is_owned: true,
});
const CRC: TrackedEntity = mkEntity({ id: "ent-crc", name: "CRC Builders" });
const HOMESTEAD: TrackedEntity = mkEntity({ id: "ent-hm", name: "Homestead" });
const ENTITIES = [RITZ, CRC, HOMESTEAD];

function mkObs(
  overrides: Partial<PromptAnswerObservation> & {
    id: string;
    prompt_id: string;
    platform: string;
    observed_at: string;
  },
): PromptAnswerObservation {
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
    topic: "luxury-home-builder",
    metadata: {},
    tenant_id: "t",
    ...overrides,
  };
}

describe("classifyPromptOpportunity — precedence + each heuristic", () => {
  const prompt = mkPrompt({ id: "prompt-A" });

  it("Early — zero observations in lookback window", () => {
    const out = classifyPromptOpportunity({
      prompt,
      observations: [],
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("early");
    expect(out.reasoning).toMatch(/No AI readings/);
    expect(out.evidence.observationCount).toBe(0);
  });

  it("Early — fewer than minObservationsForCategory (default 3)", () => {
    const obs = [
      mkObs({
        id: "o1",
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: true,
      }),
      mkObs({
        id: "o2",
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: "2026-04-23T11:00:00Z",
        primary_recommendation: true,
      }),
    ];
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("early");
    expect(out.reasoning).toMatch(/Only 2 AI readings/);
  });

  it("Winning — ≥50% primary on at least one platform", () => {
    const obs = Array.from({ length: 4 }, (_, i) =>
      mkObs({
        id: `o-${i}`,
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: `2026-04-23T${String(i).padStart(2, "0")}:00:00Z`,
        primary_recommendation: i < 3,
        citation_rank: i < 3 ? 1 : null,
        tracked_brand_mentioned: i < 3,
      }),
    );
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("winning");
    expect(out.reasoning).toMatch(/Primary on Perplexity/);
    expect(out.reasoning).toMatch(/3 of 4/);
  });

  it("Winning — primary on Perplexity even when absent on ChatGPT", () => {
    const obs = [
      ...Array.from({ length: 3 }, (_, i) =>
        mkObs({
          id: `p-${i}`,
          prompt_id: "prompt-A",
          platform: "perplexity",
          observed_at: `2026-04-23T10:${i}0:00Z`,
          primary_recommendation: true,
          tracked_brand_mentioned: true,
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        mkObs({
          id: `c-${i}`,
          prompt_id: "prompt-A",
          platform: "chatgpt",
          observed_at: `2026-04-23T11:${i}0:00Z`,
          primary_recommendation: false,
          tracked_brand_mentioned: false,
        }),
      ),
    ];
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("winning");
    expect(out.reasoning).toMatch(/absent on ChatGPT/);
  });

  it("Outranked — brand absent + ≥2 dominant competitors", () => {
    const obs = Array.from({ length: 4 }, (_, i) =>
      mkObs({
        id: `o-${i}`,
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: `2026-04-23T10:${i}0:00Z`,
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      }),
    );
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("outranked");
    expect(out.reasoning).toMatch(/absent/);
    expect(out.reasoning).toMatch(/CRC Builders/);
    expect(out.reasoning).toMatch(/Homestead/);
    expect(out.evidence.dominantCompetitors).toEqual([
      "CRC Builders",
      "Homestead",
    ]);
  });

  it("Outranked — requires ≥2 competitors to appear in ≥2 obs each", () => {
    // Only 1 dominant competitor (CRC in 3 obs). Homestead only once.
    const obs = [
      mkObs({
        id: "o1",
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders"],
      }),
      mkObs({
        id: "o2",
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: "2026-04-23T11:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      }),
      mkObs({
        id: "o3",
        prompt_id: "prompt-A",
        platform: "chatgpt",
        observed_at: "2026-04-23T12:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        competitor_co_mentions: ["CRC Builders"],
      }),
    ];
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    // Falls to Absent because only 1 competitor is dominant (CRC @ 3 obs).
    expect(out.category).toBe("absent");
  });

  it("Close — brand cited or mentioned but never primary", () => {
    const obs = [
      mkObs({
        id: "o1",
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: "2026-04-23T10:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: true,
        citation_rank: 3,
      }),
      mkObs({
        id: "o2",
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: "2026-04-23T11:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: true,
        citation_rank: 5,
      }),
      mkObs({
        id: "o3",
        prompt_id: "prompt-A",
        platform: "chatgpt",
        observed_at: "2026-04-23T12:00:00Z",
        primary_recommendation: false,
        tracked_brand_mentioned: true,
        citation_rank: 2,
      }),
    ];
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("close");
    expect(out.reasoning).toMatch(/never primary/);
    expect(out.reasoning).toMatch(/avg #3\.3/);
    expect(out.evidence.avgCitationRank).toBe(3.3);
  });

  it("Absent — fallback when no competitor dominance", () => {
    const obs = Array.from({ length: 3 }, (_, i) =>
      mkObs({
        id: `o-${i}`,
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: `2026-04-23T10:${i}0:00Z`,
        primary_recommendation: false,
        tracked_brand_mentioned: false,
      }),
    );
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("absent");
    expect(out.reasoning).toMatch(/not mentioned/);
  });

  it("tags ranked_list_miss when structure is 60%+ ranked_list and brand absent", () => {
    const obs = Array.from({ length: 5 }, (_, i) =>
      mkObs({
        id: `o-${i}`,
        prompt_id: "prompt-A",
        platform: "perplexity",
        observed_at: `2026-04-23T10:${i}0:00Z`,
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        answer_structure: i < 4 ? "ranked_list" : "narrative",
      }),
    );
    const out = classifyPromptOpportunity({
      prompt,
      observations: obs,
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("absent");
    expect(out.tags).toContain("ranked_list_miss");
    expect(out.reasoning).toMatch(/ranked list/);
  });

  it("ignores observations outside the lookback window", () => {
    const old = mkObs({
      id: "old",
      prompt_id: "prompt-A",
      platform: "perplexity",
      observed_at: "2026-04-10T10:00:00Z", // 14 days before now
      primary_recommendation: true,
      tracked_brand_mentioned: true,
    });
    const out = classifyPromptOpportunity({
      prompt,
      observations: [old],
      activeEntities: ENTITIES,
      options: { now: TODAY, lookbackDays: 7 },
    });
    expect(out.category).toBe("early");
    expect(out.evidence.observationCount).toBe(0);
  });

  it("ignores observations for other prompts", () => {
    const other = mkObs({
      id: "other",
      prompt_id: "prompt-OTHER",
      platform: "perplexity",
      observed_at: "2026-04-23T12:00:00Z",
      primary_recommendation: true,
    });
    const out = classifyPromptOpportunity({
      prompt,
      observations: [other, other, other],
      activeEntities: ENTITIES,
      options: { now: TODAY },
    });
    expect(out.category).toBe("early");
    expect(out.evidence.observationCount).toBe(0);
  });
});
