import { describe, it, expect } from "vitest";
import { pollPerplexityForTenant } from "./poll";
import type { QueryClient } from "@/lib/querying/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

/**
 * Helpers
 */
function makeClient(
  responses: Array<{
    answer: string;
    citations: Array<{ url: string; domain: string }>;
    model?: string;
  }>,
): QueryClient {
  let i = 0;
  return {
    platform: "perplexity",
    model: "sonar",
    async sample() {
      const r = responses[i++];
      if (!r) throw new Error("test: out of canned responses");
      return {
        answer_text: r.answer,
        citations: r.citations.map((c, idx) => ({
          url: c.url,
          domain: c.domain,
          title: null,
          position: idx + 1,
        })),
        model: r.model ?? "sonar",
      };
    },
  };
}

function makePrompt(overrides: Partial<TrackedPrompt> = {}): TrackedPrompt {
  return {
    id: "p-default",
    account_id: "tenant-ritz-founder",
    text: "default prompt",
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: ["perplexity"],
    tags: [],
    is_active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function makeEntity(overrides: Partial<TrackedEntity> = {}): TrackedEntity {
  return {
    id: "e-default",
    account_id: "tenant-ritz-founder",
    entity_type: "competitor",
    name: "Default Entity",
    domain: "default.example",
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

const OWNED = makeEntity({
  id: "e-ritz",
  entity_type: "brand",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  is_owned: true,
});
const COMPETITOR = makeEntity({
  id: "e-supple",
  name: "Supple Homes",
  domain: "supplehomes.com",
});

describe("pollPerplexityForTenant", () => {
  it("maps a perplexity response into the PromptAnswerObservation shape", async () => {
    const fixedTime = new Date("2026-04-22T17:30:00Z");
    const client = makeClient([
      {
        answer:
          "Ritz Builders and Supple Homes are top Palo Alto custom home builders.",
        citations: [
          { url: "https://ritzbuilders.com/about", domain: "ritzbuilders.com" },
          { url: "https://supplehomes.com", domain: "supplehomes.com" },
          { url: "https://houzz.com/ritz", domain: "houzz.com" },
        ],
      },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      now: () => fixedTime,
      trackedPrompts: [
        makePrompt({
          id: "p1",
          text: "Best custom home builders in Palo Alto?",
          topic_id: "topic-builders",
        }),
      ],
      trackedEntities: [OWNED, COMPETITOR],
    });

    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];

    expect(obs.prompt_id).toBe("p1");
    expect(obs.tenant_id).toBe("tenant-ritz-founder");
    expect(obs.platform).toBe("perplexity");
    expect(obs.topic).toBe("topic-builders");
    expect(obs.citation_count).toBe(3);
    expect(obs.owned_citation_count).toBe(1);
    expect(obs.tracked_brand_cited).toBe(true);
    expect(obs.tracked_brand_mentioned).toBe(true);
    expect(obs.citation_domains).toEqual(
      expect.arrayContaining([
        "ritzbuilders.com",
        "supplehomes.com",
        "houzz.com",
      ]),
    );
    expect(obs.mentions).toEqual(
      expect.arrayContaining(["Ritz Builders", "Supple Homes"]),
    );
    expect(obs.answer_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(obs.metadata).toMatchObject({
      source_system: "beacon_native",
      model: "sonar",
    });
    expect(obs.observed_at).toBe(fixedTime.toISOString());

    expect(result.answerTexts[obs.id]).toContain("Ritz Builders");

    expect(result.observationRun.run_type).toBe("citation_sample_import");
    expect(result.observationRun.source).toBe("perplexity-native-poll");
    expect(result.observationRun.status).toBe("completed");
    expect(result.observationRun.tenant_id).toBe("tenant-ritz-founder");
    expect(result.observationRun.pages_with_errors).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it("owned_citation_count counts only citations matching an owned domain", async () => {
    const client = makeClient([
      {
        answer: "",
        citations: [
          { url: "https://ritzbuilders.com/a", domain: "ritzbuilders.com" },
          { url: "https://ritzbuilders.com/b", domain: "ritzbuilders.com" },
          { url: "https://supplehomes.com", domain: "supplehomes.com" },
        ],
      },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p1" })],
      trackedEntities: [OWNED, COMPETITOR],
    });

    const obs = result.observations[0];
    // Dedupes by domain: two ritzbuilders.com citations count as one domain
    expect(obs.citation_domains).toHaveLength(2);
    expect(obs.owned_citation_count).toBe(1);
    expect(obs.citation_count).toBe(3); // raw citation count preserved
  });

  it("tracked_brand_mentioned is false when only a competitor is named", async () => {
    const client = makeClient([
      { answer: "Supple Homes is a top choice.", citations: [] },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p1" })],
      trackedEntities: [OWNED, COMPETITOR],
    });

    const obs = result.observations[0];
    expect(obs.tracked_brand_mentioned).toBe(false);
    expect(obs.tracked_brand_cited).toBe(false);
    expect(obs.mentions).toEqual(["Supple Homes"]);
  });

  it("skips inactive prompts", async () => {
    const client = makeClient([{ answer: "x", citations: [] }]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [
        makePrompt({ id: "p-on", is_active: true }),
        makePrompt({ id: "p-off", is_active: false }),
      ],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].prompt_id).toBe("p-on");
  });

  it("filters out prompts whose platforms[] excludes perplexity", async () => {
    const client = makeClient([]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [
        makePrompt({ id: "p-cg", platforms: ["chatgpt"] }),
        makePrompt({ id: "p-gem", platforms: ["gemini"] }),
      ],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(0);
    expect(result.observationRun.status).toBe("completed");
  });

  it("empty platforms[] means any platform — prompt is polled", async () => {
    const client = makeClient([
      { answer: "Ritz Builders rocks.", citations: [] },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-any", platforms: [] })],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(1);
  });

  it("respects limit", async () => {
    const prompts = Array.from({ length: 5 }, (_, i) =>
      makePrompt({ id: `p-${i}` }),
    );
    const client = makeClient(
      Array.from({ length: 5 }, () => ({ answer: "x", citations: [] })),
    );

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: prompts,
      trackedEntities: [OWNED],
      limit: 2,
    });

    expect(result.observations).toHaveLength(2);
  });

  it("marks the run partial when some prompts error and some succeed", async () => {
    let calls = 0;
    const flakyClient: QueryClient = {
      platform: "perplexity",
      model: "sonar",
      async sample() {
        calls += 1;
        if (calls === 2) throw new Error("boom");
        return { answer_text: "ok", citations: [], model: "sonar" };
      },
    };

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client: flakyClient,
      trackedPrompts: [
        makePrompt({ id: "p-1" }),
        makePrompt({ id: "p-2" }),
        makePrompt({ id: "p-3" }),
      ],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(2);
    expect(result.errorCount).toBe(1);
    expect(result.observationRun.status).toBe("partial");
    expect(result.observationRun.pages_with_errors).toBe(1);
  });

  it("marks the run failed when every prompt errors", async () => {
    const deadClient: QueryClient = {
      platform: "perplexity",
      model: "sonar",
      async sample() {
        throw new Error("API down");
      },
    };

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client: deadClient,
      trackedPrompts: [makePrompt({ id: "p-1" }), makePrompt({ id: "p-2" })],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(0);
    expect(result.observationRun.status).toBe("failed");
  });

  it("marks the run completed when there are zero eligible prompts", async () => {
    const client = makeClient([]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ is_active: false })],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(0);
    expect(result.observationRun.status).toBe("completed");
  });
});
