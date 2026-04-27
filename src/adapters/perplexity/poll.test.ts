import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pollPerplexityForTenant } from "./poll";
import type { QueryClient } from "@/lib/querying/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

// Sprint 6A.3c (2026-04-26) — `pollPerplexityForTenant` now calls
// `recordSpend` after each successful sample, which writes to
// `.data/cost-ledger.json` resolved at call time from `process.cwd()`.
// Without this hermetic chdir the existing tests would silently leak
// rows into the project's real `.data/`. Each test runs in its own
// tmpdir; the cwd is restored in afterEach. No behavior change to the
// production polling code — the safety net is test-side only.
const ORIGINAL_CWD = process.cwd();
let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "beacon-poll-test-"));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

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
  // Sprint 6A.3d (2026-04-26): default text now varies per id so tests
  // that build N prompts with `id: \`p-${i}\`` don't trigger the new
  // identical-text dedupe in pollPerplexityForTenant. Tests that need
  // a specific text continue to override via `overrides.text`.
  const id = overrides.id ?? "p-default";
  return {
    id,
    account_id: "tenant-ritz-founder",
    text: `default prompt ${id}`,
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

  // ── Phase 5 Step 1.5: offset / chunk window ─────────────────────────

  it("offset skips the first N eligible prompts", async () => {
    const prompts = Array.from({ length: 5 }, (_, i) =>
      makePrompt({ id: `p-${i}` }),
    );
    const client = makeClient(
      Array.from({ length: 5 }, (_, i) => ({
        answer: `answer-${i}`,
        citations: [],
      })),
    );

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: prompts,
      trackedEntities: [OWNED],
      offset: 3,
    });

    // offset=3 → skip p-0, p-1, p-2 → poll p-3, p-4
    expect(result.observations).toHaveLength(2);
    expect(result.observations.map((o) => o.prompt_id)).toEqual([
      "p-3",
      "p-4",
    ]);
  });

  it("offset + limit defines an exact chunk window: prompts[offset..offset+limit)", async () => {
    const prompts = Array.from({ length: 10 }, (_, i) =>
      makePrompt({ id: `p-${i}` }),
    );
    const client = makeClient(
      Array.from({ length: 10 }, (_, i) => ({
        answer: `answer-${i}`,
        citations: [],
      })),
    );

    // offset=5, limit=3 → poll exactly p-5, p-6, p-7
    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: prompts,
      trackedEntities: [OWNED],
      offset: 5,
      limit: 3,
    });

    expect(result.observations).toHaveLength(3);
    expect(result.observations.map((o) => o.prompt_id)).toEqual([
      "p-5",
      "p-6",
      "p-7",
    ]);
  });

  it("offset beyond eligible range yields zero observations cleanly (empty but 'completed')", async () => {
    const prompts = Array.from({ length: 3 }, (_, i) =>
      makePrompt({ id: `p-${i}` }),
    );
    const client = makeClient([]); // no canned responses needed

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: prompts,
      trackedEntities: [OWNED],
      offset: 10, // way past the end
      limit: 25,
    });

    expect(result.observations).toHaveLength(0);
    expect(result.observationRun.status).toBe("completed");
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

  // ── Alias-aware matching (Phase 1: entity canonicalization v0) ──

  it("matches owned brand via an alias when the answer uses the variant phrasing", async () => {
    const OWNED_WITH_ALIAS: TrackedEntity = {
      ...OWNED,
      name: "Ritz Builders",
      aliases: ["Ritzbuilders", "Ritz"],
    };
    const client = makeClient([
      // answer uses the one-word variant, never the canonical form
      { answer: "Ritzbuilders is a top choice for Atherton teardowns.", citations: [] },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-alias" })],
      trackedEntities: [OWNED_WITH_ALIAS],
    });

    const obs = result.observations[0];
    expect(obs.tracked_brand_mentioned).toBe(true);
    // mentions[] stores the canonical name, not the alias that matched
    expect(obs.mentions).toEqual(["Ritz Builders"]);
  });

  it("still matches owned brand via the canonical name when no alias is present", async () => {
    const OWNED_NO_ALIASES: TrackedEntity = {
      ...OWNED,
      name: "Ritz Builders",
      aliases: undefined,
    };
    const client = makeClient([
      { answer: "Ritz Builders is a top choice.", citations: [] },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-noalias" })],
      trackedEntities: [OWNED_NO_ALIASES],
    });

    expect(result.observations[0].tracked_brand_mentioned).toBe(true);
  });

  it("matches a competitor via alias and surfaces it under the canonical name in mentions[]", async () => {
    const COMPETITOR_WITH_ALIAS: TrackedEntity = {
      ...COMPETITOR,
      name: "De Mattei Construction",
      aliases: ["De Mattei", "DeMattei"],
    };
    const client = makeClient([
      // answer uses the short form
      { answer: "De Mattei is well-known in the Bay Area.", citations: [] },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-comp-alias" })],
      trackedEntities: [COMPETITOR_WITH_ALIAS],
    });

    expect(result.observations[0].mentions).toEqual(["De Mattei Construction"]);
  });

  it("does not duplicate a mention when both name and alias appear in the same answer", async () => {
    const ENTITY: TrackedEntity = {
      ...COMPETITOR,
      name: "Golden Gate Group",
      aliases: ["Golden Gate Group, Inc."],
    };
    const client = makeClient([
      {
        answer:
          "Golden Gate Group builds estates. Formally: Golden Gate Group, Inc.",
        citations: [],
      },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-dup" })],
      trackedEntities: [ENTITY],
    });

    // Only one entry even though both variants appear
    expect(result.observations[0].mentions).toEqual(["Golden Gate Group"]);
  });

  it("empty aliases array behaves identically to undefined aliases", async () => {
    const ENTITY: TrackedEntity = {
      ...OWNED,
      name: "Ritz Builders",
      aliases: [],
    };
    const client = makeClient([
      { answer: "Ritz Builders was recommended.", citations: [] },
    ]);

    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-empty-aliases" })],
      trackedEntities: [ENTITY],
    });

    expect(result.observations[0].tracked_brand_mentioned).toBe(true);
  });
});

// ─ Sprint 6A.2g.D — max-extraction metadata + dual-populate ──────────────

/**
 * Builds a QueryClient that returns ONE response with a fully-populated
 * `usage` object — the OpenAI Responses API max-extraction shape from
 * parseOpenAIResponse. Used to verify poll.ts threads every signal into
 * observation.metadata.
 */
function makeOpenAIClientWithFullUsage(): QueryClient {
  return {
    platform: "chatgpt",
    model: "gpt-5-mini",
    async sample() {
      return {
        answer_text:
          "Ritz Builders is a top whole-home remodel choice in the Bay Area.",
        citations: [
          {
            url: "https://ritzbuilders.com/services/whole-home-remodel",
            domain: "ritzbuilders.com",
            title: null,
            position: 1,
          },
        ],
        model: "gpt-5-mini-2026",
        usage: {
          inputTokens: 1500,
          outputTokens: 800,
          webSearchCalls: 2,
          webSearchQueries: [
            {
              id: "ws_1",
              status: "completed",
              actionType: "search",
              query: "best whole home remodel builders bay area",
            },
            {
              id: "ws_2",
              status: "completed",
              actionType: "open_page",
              url: "https://ritzbuilders.com/services/whole-home-remodel",
            },
          ],
          openPageUrls: [
            "https://ritzbuilders.com/services/whole-home-remodel",
          ],
          systemFingerprint: "fp_abc123",
          serviceTier: "scale",
          reasoningTokens: 320,
          cachedTokens: 1024,
          refusalText: null,
          finishReason: "stop",
          providerRaw: {
            toolCalls: [
              { type: "web_search_call", id: "ws_1" },
              { type: "web_search_call", id: "ws_2" },
            ],
            truncated: false,
            responseId: "resp_max_extraction",
          },
        },
      };
    },
  };
}

describe("pollPerplexityForTenant — Sprint 6A.2g.D max-extraction (OpenAI path)", () => {
  it("populates metadata.cost / metadata.extracted / metadata.provider / metadata.providerRaw / metadata.failure / metadata.blindSpot for OpenAI", async () => {
    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client: makeOpenAIClientWithFullUsage(),
      platform: "chatgpt",
      pollSource: "openai-native-poll",
      parserVersion: "openai-native-v1",
      trackedPrompts: [
        makePrompt({
          id: "p-openai",
          platforms: ["chatgpt"],
          text: "Best whole home remodel builders bay area",
        }),
      ],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(1);
    const md = result.observations[0].metadata as Record<string, unknown>;

    // cost block carries every per-observation field operator can slice by
    const cost = md.cost as Record<string, unknown>;
    expect(cost).toBeDefined();
    expect(typeof cost.usd).toBe("number");
    expect(cost.inputTokens).toBe(1500);
    expect(cost.outputTokens).toBe(800);
    expect(cost.reasoningTokens).toBe(320);
    expect(cost.cachedTokens).toBe(1024);
    expect(cost.webSearchCalls).toBe(2);

    const extracted = md.extracted as Record<string, unknown>;
    expect(extracted.searchQueries).toEqual([
      "best whole home remodel builders bay area",
    ]);
    expect(extracted.openPageUrls).toEqual([
      "https://ritzbuilders.com/services/whole-home-remodel",
    ]);
    expect(extracted.refusalText).toBeNull();

    const provider = md.provider as Record<string, unknown>;
    expect(provider.systemFingerprint).toBe("fp_abc123");
    expect(provider.serviceTier).toBe("scale");
    expect(provider.finishReason).toBe("stop");

    const providerRaw = md.providerRaw as Record<string, unknown>;
    expect(providerRaw).toBeDefined();
    expect(providerRaw.responseId).toBe("resp_max_extraction");
    expect(providerRaw.truncated).toBe(false);
    expect(Array.isArray(providerRaw.toolCalls)).toBe(true);

    expect(md.failure).toBeNull();
    expect(md.blindSpot).toBeNull(); // OpenAI — no blind spot
  });

  it("dual-populates search_queries[] from extracted queries (OpenAI)", async () => {
    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client: makeOpenAIClientWithFullUsage(),
      platform: "chatgpt",
      pollSource: "openai-native-poll",
      parserVersion: "openai-native-v1",
      trackedPrompts: [
        makePrompt({
          id: "p-openai-2",
          platforms: ["chatgpt"],
          text: "Best whole home remodel builders bay area v2",
        }),
      ],
      trackedEntities: [OWNED],
    });

    expect(result.observations[0].search_queries).toEqual([
      "best whole home remodel builders bay area",
    ]);
  });
});

describe("pollPerplexityForTenant — honest blind spot (Perplexity Sonar)", () => {
  it("Perplexity row carries blindSpot text + empty search_queries (no OpenAI fields)", async () => {
    const client = makeClient([
      {
        answer: "Sonar answer",
        citations: [
          { url: "https://example.com", domain: "example.com" },
        ],
      },
    ]);
    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client,
      trackedPrompts: [makePrompt({ id: "p-perp" })],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(1);
    const md = result.observations[0].metadata as Record<string, unknown>;
    expect(md.blindSpot).toBe(
      "Sonar does not expose internal queries; search_queries empty by design.",
    );

    const extracted = md.extracted as Record<string, unknown>;
    expect(extracted.searchQueries).toEqual([]);
    expect(extracted.openPageUrls).toEqual([]);

    const provider = md.provider as Record<string, unknown>;
    expect(provider.systemFingerprint).toBeNull();
    expect(provider.serviceTier).toBeNull();
    // finishReason MAY be present for Sonar via QueryUsage — but our test
    // client doesn't surface it, so it's null.
    expect(provider.finishReason).toBeNull();

    expect(md.providerRaw).toBeNull();
    expect(md.failure).toBeNull();

    // First-class column also stays empty.
    expect(result.observations[0].search_queries).toEqual([]);
  });

  it("OpenAI prompt that emits ZERO web_search_call items still persists empty arrays + provider metadata honestly", async () => {
    // Operator nuance: do NOT hard-require search queries. When the model
    // answers without invoking the tool, extracted.searchQueries === []
    // and providerRaw.toolCalls === [], NOT undefined / null.
    const noToolClient: QueryClient = {
      platform: "chatgpt",
      model: "gpt-5-mini",
      async sample() {
        return {
          answer_text: "Quick answer with no search.",
          citations: [],
          model: "gpt-5-mini",
          usage: {
            inputTokens: 50,
            outputTokens: 20,
            webSearchCalls: 0,
            webSearchQueries: [],
            openPageUrls: [],
            systemFingerprint: "fp_no_tools",
            serviceTier: "default",
            reasoningTokens: 0,
            cachedTokens: 0,
            refusalText: null,
            finishReason: "stop",
            providerRaw: {
              toolCalls: [],
              truncated: false,
              responseId: "resp_no_tools",
            },
          },
        };
      },
    };
    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client: noToolClient,
      platform: "chatgpt",
      pollSource: "openai-native-poll",
      trackedPrompts: [
        makePrompt({
          id: "p-no-tools",
          platforms: ["chatgpt"],
          text: "trivial prompt",
        }),
      ],
      trackedEntities: [OWNED],
    });

    expect(result.observations).toHaveLength(1);
    const md = result.observations[0].metadata as Record<string, unknown>;
    const extracted = md.extracted as Record<string, unknown>;
    expect(extracted.searchQueries).toEqual([]);
    expect(extracted.openPageUrls).toEqual([]);

    const provider = md.provider as Record<string, unknown>;
    expect(provider.systemFingerprint).toBe("fp_no_tools");
    expect(provider.serviceTier).toBe("default");
    expect(provider.finishReason).toBe("stop");

    expect(md.blindSpot).toBeNull(); // OpenAI — model just didn't search
    expect(result.observations[0].search_queries).toEqual([]);
  });

  it("legacy mock returning no usage object → metadata fields default to null/0/[] without crashing", async () => {
    // Backwards-compat — the original 6A.3a contract: usage may be
    // omitted entirely. Polling adapter must not crash; metadata
    // populates with conservative defaults.
    const result = await pollPerplexityForTenant("tenant-ritz-founder", {
      client: makeClient([
        {
          answer: "no usage object",
          citations: [{ url: "https://x.com", domain: "x.com" }],
        },
      ]),
      trackedPrompts: [makePrompt({ id: "p-no-usage" })],
      trackedEntities: [OWNED],
    });

    const md = result.observations[0].metadata as Record<string, unknown>;
    const cost = md.cost as Record<string, unknown>;
    expect(cost.inputTokens).toBe(0);
    expect(cost.outputTokens).toBe(0);
    expect(cost.reasoningTokens).toBe(0);
    expect(cost.cachedTokens).toBe(0);
    expect(cost.webSearchCalls).toBe(0);

    const extracted = md.extracted as Record<string, unknown>;
    expect(extracted.searchQueries).toEqual([]);
    expect(extracted.refusalText).toBeNull();

    expect(md.providerRaw).toBeNull();
    expect(result.observations[0].search_queries).toEqual([]);
  });
});

describe("pollPerplexityForTenant — sample failure structured logging (6A.2g.D)", () => {
  it("logs SAMPLE_FAILED with the error message + does not persist an observation for that prompt", async () => {
    const flakyClient: QueryClient = {
      platform: "perplexity",
      model: "sonar",
      async sample(prompt: string) {
        if (prompt.includes("doom")) {
          throw new Error("simulated provider 503");
        }
        return { answer_text: "ok", citations: [], model: "sonar" };
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await pollPerplexityForTenant("tenant-ritz-founder", {
        client: flakyClient,
        trackedPrompts: [
          makePrompt({ id: "p-ok-1", text: "ordinary prompt 1" }),
          makePrompt({ id: "p-doom", text: "this one will doom" }),
          makePrompt({ id: "p-ok-2", text: "ordinary prompt 2" }),
        ],
        trackedEntities: [OWNED],
      });

      // Two successful samples → two observations. The doomed prompt is
      // SKIPPED (no observation, no metadata.failure record).
      expect(result.observations).toHaveLength(2);
      expect(result.observations.map((o) => o.prompt_id)).toEqual([
        "p-ok-1",
        "p-ok-2",
      ]);
      expect(result.errorCount).toBe(1);
      expect(result.observationRun.status).toBe("partial");

      // Structured warn line names the prompt + the error message.
      const sampleFailedCalls = warnSpy.mock.calls.filter((args) =>
        String(args[0] ?? "").includes("SAMPLE_FAILED"),
      );
      expect(sampleFailedCalls.length).toBeGreaterThan(0);
      expect(String(sampleFailedCalls[0][0])).toContain("p-doom");
      expect(String(sampleFailedCalls[0][0])).toContain("simulated provider 503");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
