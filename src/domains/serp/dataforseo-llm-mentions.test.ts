import { describe, it, expect, vi } from "vitest";
import {
  runLlmMentions,
  runLlmPromptResponses,
  readAllCachedLlmMentions,
  parseLlmMentions,
  planLlmMentionsCall,
  questionForTopic,
  resolveEngineEndpoint,
  resolveEngineModel,
  MAX_PROMPTS_PER_ENGINE_RUN,
  type LlmMentionsRunDeps,
  type LlmMentionRecord,
} from "./dataforseo-llm-mentions";

const CONFIGURED_ENV = {
  BEACON_SERP_PROVIDER: "dataforseo",
  DATAFORSEO_AUTH_B64: "dGVzdDp0ZXN0",
  DATAFORSEO_DRY_RUN: "false",
  DATAFORSEO_MONTHLY_CAP_USD: "50",
} as unknown as NodeJS.ProcessEnv;

// Shape copied from a real 2026-07-01 live probe of
// /v3/ai_optimization/chat_gpt/llm_responses/live (gpt-4o-mini, forced web search).
const BODY = {
  cost: 0.027133,
  tasks: [
    {
      status_code: 20000,
      cost: 0.027133,
      result: [
        {
          model_name: "gpt-4o-mini-2024-07-18",
          input_tokens: 8524,
          output_tokens: 424,
          web_search: true,
          money_spent: 0.026533,
          items: [
            {
              type: "message",
              sections: [
                {
                  type: "text",
                  text:
                    "1. **Iranopedia**: A complete rug guide. ([iranopedia.com](https://www.iranopedia.com/persian-rugs?utm_source=openai))\n" +
                    "2. **Jozan Magazine**: Antique rug news. ([jozan.net](https://www.jozan.net/?utm_source=openai))\n" +
                    "Also see the Iranopedia carpet history page at https://www.iranopedia.com/iran-carpets for more.",
                  annotations: [
                    { title: "Types of Persian Rugs", url: "https://www.iranopedia.com/persian-rugs?utm_source=openai" },
                    { title: "Jozan", url: "https://www.jozan.net/?utm_source=openai" },
                    { title: "WikiRug", url: "https://en.wikirug.org/wiki/Main_Page?utm_source=openai" },
                  ],
                },
              ],
            },
          ],
          fan_out_queries: ["best websites persian carpets"],
        },
      ],
    },
  ],
};

function deps(over: Partial<LlmMentionsRunDeps> = {}): Partial<LlmMentionsRunDeps> {
  return {
    env: CONFIGURED_ENV,
    now: () => new Date("2026-07-01T00:00:00Z"),
    tenantId: async () => "tenant-iranopedia",
    spentThisMonthUsd: async () => 0,
    recordSpend: vi.fn(async () => {}),
    readCache: async () => [],
    writeCache: async () => {},
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => BODY }) as unknown as Response),
    ...over,
  };
}

function record(topic: string, fetchedAt: string): LlmMentionRecord {
  return {
    topic,
    question: questionForTopic(topic),
    mentions: [{ domain: "iranopedia.com", count: 2 }],
    model: "gpt-4o-mini-2024-07-18",
    answerExcerpt: "excerpt",
    usedWebSearch: true,
    source: "dataforseo",
    fetchedAt,
    evidenceRef: "dataforseo:ai_optimization/llm_responses",
  };
}

describe("planLlmMentionsCall", () => {
  it("dedupes, lowercases, drops too-short, caps the batch, prices it", () => {
    const plan = planLlmMentionsCall(["Persian Carpets", "persian carpets", " ", "a", "Iran Flag History"], {
      env: CONFIGURED_ENV,
    });
    expect(plan.topics).toEqual(["persian carpets", "iran flag history"]);
    expect(plan.model).toBe("gpt-4o-mini");
    expect(plan.estCostUsd).toBeCloseTo(2 * plan.estCostPerTopicUsd);
    expect(plan.endpoint).toContain("/v3/ai_optimization/chat_gpt/llm_responses/live");
  });

  it("respects the DATAFORSEO_LLM_MENTIONS_PATH override (path or full URL)", () => {
    const byPath = planLlmMentionsCall(["x y"], {
      env: { ...CONFIGURED_ENV, DATAFORSEO_LLM_MENTIONS_PATH: "/v3/ai_optimization/claude/llm_responses/live" },
    });
    expect(byPath.endpoint).toBe("https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/live");
    const byUrl = planLlmMentionsCall(["x y"], {
      env: { ...CONFIGURED_ENV, DATAFORSEO_LLM_MENTIONS_PATH: "https://example.com/custom" } as NodeJS.ProcessEnv,
    });
    expect(byUrl.endpoint).toBe("https://example.com/custom");
  });
});

describe("parseLlmMentions - citation extraction", () => {
  it("counts distinct cited URLs per domain, strips www., dedupes text vs annotation", () => {
    const parsed = parseLlmMentions(BODY);
    // iranopedia.com: /persian-rugs (text + annotation, deduped) + /iran-carpets (text only) = 2
    expect(parsed.mentions.find((m) => m.domain === "iranopedia.com")?.count).toBe(2);
    expect(parsed.mentions.find((m) => m.domain === "jozan.net")?.count).toBe(1);
    // annotation-only URL (not in the prose) still counts
    expect(parsed.mentions.find((m) => m.domain === "en.wikirug.org")?.count).toBe(1);
    // sorted by count desc
    expect(parsed.mentions[0].domain).toBe("iranopedia.com");
    expect(parsed.model).toBe("gpt-4o-mini-2024-07-18");
    expect(parsed.usedWebSearch).toBe(true);
    expect(parsed.actualCostUsd).toBeCloseTo(0.027133);
    expect(parsed.answerText).toContain("Iranopedia");
  });

  it("returns empty on a malformed body (never throws)", () => {
    expect(parseLlmMentions({ garbage: true }).mentions).toEqual([]);
    expect(parseLlmMentions(null).mentions).toEqual([]);
    expect(parseLlmMentions("nope").model).toBeNull();
  });

  it("no-web-search answer with zero URLs -> zero mentions, honest flags", () => {
    const noSearch = {
      cost: 0.0008,
      tasks: [
        {
          result: [
            {
              model_name: "gpt-4o-mini-2024-07-18",
              web_search: false,
              items: [
                {
                  type: "message",
                  sections: [{ type: "text", text: "Read books about carpets at your library.", annotations: null }],
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseLlmMentions(noSearch);
    expect(parsed.mentions).toEqual([]);
    expect(parsed.usedWebSearch).toBe(false);
    expect(parsed.answerText).toContain("library");
  });
});

describe("runLlmMentions - the money gauntlet", () => {
  it("is DISABLED when DataForSEO is not configured (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmMentions(["persian carpets"], {}, deps({ env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("DRY-RUN by default - returns the plan, spends nothing, makes no call", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmMentions(["persian carpets"], {}, deps({ env: { ...CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" }, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(r.plan.topics).toEqual(["persian carpets"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CAP blocks the call (fail-closed) when over budget", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmMentions(["persian carpets"], {}, deps({ spentThisMonthUsd: async () => 49.99, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails CLOSED when monthly spend is unknown", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmMentions(["persian carpets"], {}, deps({ spentThisMonthUsd: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves the CACHE without spending", async () => {
    const fetchImpl = vi.fn();
    const recordSpend = vi.fn(async () => {});
    const r = await runLlmMentions(["persian carpets"], {}, deps({
      readCache: async () => [
        { key: "gpt-4o-mini|persian carpets", record: record("persian carpets", "2026-06-30T00:00:00Z"), fetchedAt: "2026-06-30T00:00:00Z" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      recordSpend,
    }));
    expect(r.status).toBe("cache_hit");
    expect(r.records).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });

  it("a STALE cache row (>7d) is a miss - dry-run still blocks the call", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmMentions(["persian carpets"], {}, deps({
      env: { ...CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" },
      readCache: async () => [
        { key: "gpt-4o-mini|persian carpets", record: record("persian carpets", "2026-06-01T00:00:00Z"), fetchedAt: "2026-06-01T00:00:00Z" },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    expect(r.status).toBe("dry_run");
    expect(r.records).toEqual([]); // stale record is not served as fresh
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("OK path: one call per topic, records REAL spend from the price field, caches", async () => {
    const recordSpend = vi.fn(async () => {});
    const writeCache = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => BODY }) as unknown as Response);
    const r = await runLlmMentions(["persian carpets", "iran flag history"], {}, deps({
      recordSpend,
      writeCache,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    expect(r.status).toBe("ok");
    expect(r.records).toHaveLength(2);
    expect(r.records[0].mentions[0].domain).toBe("iranopedia.com");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(recordSpend).toHaveBeenCalledTimes(2);
    // ledger uses the API's real cost field (0.027133), not the flat estimate
    expect(recordSpend).toHaveBeenCalledWith("tenant-iranopedia", 0.027133);
    expect(r.costUsd).toBeCloseTo(2 * 0.027133);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });

  it("stops MID-RUN when the next call would cross the cap", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => BODY }) as unknown as Response);
    // spent 49.95, cap 50: first call (est 0.03) fits, second (0.03 more) does not
    const r = await runLlmMentions(["persian carpets", "iran flag history"], {}, deps({
      spentThisMonthUsd: async () => 49.95,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("ok"); // partial success is still success
    expect(r.records).toHaveLength(1);
  });

  it("all live calls failing -> error, nothing recorded", async () => {
    const recordSpend = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    const r = await runLlmMentions(["persian carpets"], {}, deps({ recordSpend, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("error");
    expect(r.records).toEqual([]);
    expect(recordSpend).not.toHaveBeenCalled();
  });
});

describe("readAllCachedLlmMentions (cache-only, $0)", () => {
  const NOW = () => new Date("2026-07-01T00:00:00Z");

  it("returns fresh records", async () => {
    const out = await readAllCachedLlmMentions({
      now: NOW,
      readCache: async () => [
        { key: "gpt-4o-mini|persian carpets", record: record("persian carpets", "2026-06-30T00:00:00Z"), fetchedAt: "2026-06-30T00:00:00Z" },
        { key: "gpt-4o-mini|iran flag history", record: record("iran flag history", "2026-06-29T00:00:00Z"), fetchedAt: "2026-06-29T00:00:00Z" },
      ],
    });
    expect(out.map((r) => r.topic).sort()).toEqual(["iran flag history", "persian carpets"]);
  });

  it("drops stale (>7d) rows", async () => {
    const out = await readAllCachedLlmMentions({
      now: NOW,
      readCache: async () => [
        { key: "a", record: record("stale topic", "2026-06-01T00:00:00Z"), fetchedAt: "2026-06-01T00:00:00Z" },
        { key: "b", record: record("fresh topic", "2026-06-30T00:00:00Z"), fetchedAt: "2026-06-30T00:00:00Z" },
      ],
    });
    expect(out.map((r) => r.topic)).toEqual(["fresh topic"]);
  });

  it("dedupes by topic, newest fetch wins", async () => {
    const out = await readAllCachedLlmMentions({
      now: NOW,
      readCache: async () => [
        { key: "gpt-4o-mini|persian carpets", record: record("persian carpets", "2026-06-28T00:00:00Z"), fetchedAt: "2026-06-28T00:00:00Z" },
        { key: "gpt-4o|persian carpets", record: record("persian carpets", "2026-06-30T00:00:00Z"), fetchedAt: "2026-06-30T00:00:00Z" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].fetchedAt).toBe("2026-06-30T00:00:00Z");
  });

  it("fail-soft: a throwing cache read -> []", async () => {
    const out = await readAllCachedLlmMentions({
      now: NOW,
      readCache: async () => {
        throw new Error("store down");
      },
    });
    expect(out).toEqual([]);
  });
});

describe("engine parameter (item 4) - endpoint + model resolution", () => {
  it("routes each engine to its own llm_responses endpoint by default", () => {
    expect(resolveEngineEndpoint("gemini", CONFIGURED_ENV)).toBe(
      "https://api.dataforseo.com/v3/ai_optimization/gemini/llm_responses/live",
    );
    expect(resolveEngineEndpoint("claude", CONFIGURED_ENV)).toBe(
      "https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/live",
    );
    expect(resolveEngineEndpoint("chat_gpt", CONFIGURED_ENV)).toBe(
      "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live",
    );
  });

  it("honors per-engine path overrides, plus the legacy generic override for chat_gpt only", () => {
    const env = {
      ...CONFIGURED_ENV,
      DATAFORSEO_LLM_MENTIONS_PATH: "/v3/legacy/override",
      DATAFORSEO_LLM_MENTIONS_PATH_GEMINI: "https://example.com/gemini-custom",
    } as NodeJS.ProcessEnv;
    expect(resolveEngineEndpoint("gemini", env)).toBe("https://example.com/gemini-custom");
    expect(resolveEngineEndpoint("chat_gpt", env)).toBe("https://api.dataforseo.com/v3/legacy/override");
    // The generic override never leaks onto sibling engines.
    expect(resolveEngineEndpoint("claude", env)).toBe(
      "https://api.dataforseo.com/v3/ai_optimization/claude/llm_responses/live",
    );
  });

  it("honors per-engine model overrides", () => {
    expect(resolveEngineModel("gemini", CONFIGURED_ENV)).toBe("gemini-2.5-flash");
    expect(
      resolveEngineModel("gemini", { ...CONFIGURED_ENV, DATAFORSEO_LLM_MODEL_GEMINI: "gemini-x" } as NodeJS.ProcessEnv),
    ).toBe("gemini-x");
  });
});

describe("runLlmPromptResponses - the engine gauntlet on real prompts", () => {
  const items = [
    { key: "prm-1", question: "what are the best persian rug shops" },
    { key: "prm-2", question: "where can I learn about iranian carpets" },
  ];

  it("DRY-RUN by default - no call, no spend", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmPromptResponses(items, { engine: "gemini" }, deps({
      env: { ...CONFIGURED_ENV, DATAFORSEO_DRY_RUN: "true" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    expect(r.status).toBe("dry_run");
    expect(r.costUsd).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disabled when DataForSEO is not configured", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmPromptResponses(items, { engine: "claude" }, deps({ env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(r.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails CLOSED on unknown monthly spend", async () => {
    const fetchImpl = vi.fn();
    const r = await runLlmPromptResponses(items, { engine: "gemini" }, deps({
      spentThisMonthUsd: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    expect(r.status).toBe("capped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("OK path: asks the REAL prompt text at the engine endpoint, records spend, returns cited URLs", async () => {
    const recordSpend = vi.fn(async () => {});
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ?? "" });
      return { ok: true, json: async () => BODY } as unknown as Response;
    });
    const r = await runLlmPromptResponses(items, { engine: "gemini" }, deps({
      recordSpend,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }));
    expect(r.status).toBe("ok");
    expect(r.answers).toHaveLength(2);
    expect(calls[0]!.url).toContain("/v3/ai_optimization/gemini/llm_responses/live");
    expect(calls[0]!.body).toContain("what are the best persian rug shops");
    expect(calls[0]!.body).toContain("gemini-2.5-flash");
    // force_web_search is a chat_gpt-only knob - never sent to siblings.
    expect(calls[0]!.body).not.toContain("force_web_search");
    expect(r.answers[0]!.engine).toBe("gemini");
    expect(r.answers[0]!.citedUrls).toContain("https://www.iranopedia.com/iran-carpets");
    expect(recordSpend).toHaveBeenCalledWith("tenant-iranopedia", 0.027133);
  });

  it("caps the batch at MAX_PROMPTS_PER_ENGINE_RUN and dedupes keys", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `k${i % 30}`, question: `question number ${i}` }));
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => BODY }) as unknown as Response);
    const r = await runLlmPromptResponses(many, { engine: "claude" }, deps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(MAX_PROMPTS_PER_ENGINE_RUN).toBe(25);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_PROMPTS_PER_ENGINE_RUN);
    expect(r.answers.length).toBeLessThanOrEqual(MAX_PROMPTS_PER_ENGINE_RUN);
  });

  it("serves a fresh (<20h) cached answer without spending", async () => {
    const fetchImpl = vi.fn();
    const recordSpend = vi.fn(async () => {});
    const cachedRecord = {
      key: "tenant-iranopedia|gemini|gemini-2.5-flash|prm-1",
      record: {
        key: "prm-1",
        question: items[0]!.question,
        engine: "gemini",
        model: "gemini-2.5-flash",
        answerText: "cached answer",
        mentions: [],
        citedUrls: [],
        usedWebSearch: true,
        fetchedAt: "2026-06-30T20:00:00Z",
        evidenceRef: "dataforseo:ai_optimization/gemini/llm_responses",
      },
      fetchedAt: "2026-06-30T20:00:00Z", // 4h before the injected now
    };
    const r = await runLlmPromptResponses([items[0]!], { engine: "gemini" }, deps({
      readCache: async () => [cachedRecord] as never,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      recordSpend,
    }));
    expect(r.status).toBe("cache_hit");
    expect(r.answers[0]!.answerText).toBe("cached answer");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
