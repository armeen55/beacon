import { describe, it, expect } from "vitest";
import { generateRecommendations } from "@/domains/recommendations/generate";
import { buildPromptDecisionMatrix } from "@/domains/prompts/decision-matrix";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

function mkPrompt(overrides: Partial<TrackedPrompt> & { id: string }): TrackedPrompt {
  return {
    account_id: "ritz",
    text: `prompt ${overrides.id}`,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: "recommendation",
    platforms: ["perplexity"],
    tags: [],
    is_active: true,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

const RITZ: TrackedEntity = {
  id: "e-r",
  account_id: "ritz",
  entity_type: "brand",
  name: "Ritz Builders",
  aliases: [],
  domain: "ritzbuilders.com",
  url: null,
  location_scope: null,
  service_scope: null,
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

function mkObs(
  overrides: Partial<PromptAnswerObservation> & {
    id: string;
    prompt_id: string;
    observed_at: string;
  },
): PromptAnswerObservation {
  return {
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    platform: "perplexity",
    topic: "",
    metadata: {},
    tenant_id: "t",
    primary_recommendation: false,
    competitor_co_mentions: ["CRC Builders", "Homestead"],
    ...overrides,
  };
}

describe("operator-facing titles never leak internal taxonomy", () => {
  it("cluster rec title strips the 'Shield: ' prefix from topic_id", () => {
    const prompts = [
      mkPrompt({
        id: "p1",
        location_scope: "Palo Alto",
        topic_id: "Shield: Luxury Home Builder Bay Area",
        text: "Who is the best luxury home builder in Palo Alto?",
      }),
      mkPrompt({
        id: "p2",
        location_scope: "Palo Alto",
        topic_id: "Shield: Luxury Home Builder Bay Area",
        text: "Top luxury architects in Palo Alto?",
      }),
      mkPrompt({
        id: "p3",
        location_scope: "Palo Alto",
        topic_id: "Shield: Luxury Home Builder Bay Area",
        text: "Custom luxury homes Palo Alto recommendations?",
      }),
    ];
    const observations = prompts.flatMap((p) =>
      Array.from({ length: 3 }, (_, i) =>
        mkObs({
          id: `${p.id}-o${i}`,
          prompt_id: p.id,
          observed_at: `2026-04-23T10:0${i}:00Z`,
        }),
      ),
    );
    const matrix = buildPromptDecisionMatrix({
      prompts,
      observations,
      activeEntities: [RITZ],
      now: new Date("2026-04-24T12:00:00Z"),
    });
    const recs = generateRecommendations({
      matrix,
      activeEntities: [RITZ],
      trackedPrompts: prompts,
    });
    for (const rec of recs) {
      expect(rec.title).not.toMatch(/Shield:/i);
      expect(rec.title).not.toMatch(/Internal:/i);
      expect(rec.description).not.toMatch(/Shield:/i);
      if (rec.clusterLabel) {
        expect(rec.clusterLabel).not.toMatch(/Shield:/i);
      }
    }
  });
});
