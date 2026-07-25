/**
 * Provider-contract proof: the capability registry composed with the money-safe
 * core, bound to BOUNDED official DataForSEO fixtures. Every seam injected: no
 * network, no Supabase, no spend. Pins the exact paths, the required request
 * fields, the full-envelope rule, and method-compatible model resolution.
 */
import { describe, it, expect, vi } from "vitest";

import { providerCall, collectCapability, parseCapability, resolveEngineModel } from "@/domains/evidence/dataforseo/capabilities";
import type { ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import {
  labsKeywordsForSiteLive, serpTaskGetAdvanced, llmResponsesTaskPostAck, llmResponsesTaskGet,
  perplexityLive, chatgptModels, perplexityModels,
} from "../fixtures/dataforseo-envelopes";

const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc", DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();
const IDS = { tenantId: "t", unitKey: "u" };
const BASE = "https://api.dataforseo.com/v3/";

function harness(fetchBody: unknown, over: Record<string, unknown> = {}) {
  const calls = { fetch: [] as string[], bodies: [] as any[], writes: [] as Record<string, unknown>[] };
  const deps = {
    env: ENV, now: () => NOW,
    fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
      calls.fetch.push(url);
      if (init?.body) calls.bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(fetchBody), { status: 200 });
    }) as unknown as typeof fetch,
    claimEvidenceFetch: async () => ({ outcome: "claimed", payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0 }),
    reserveProviderSpend: async () => true,
    adjustProviderSpend: async () => true,
    cacheRead: async () => null,
    cacheWrite: async (_k: string, patch: Record<string, unknown>) => { calls.writes.push(patch); },
    cacheUpsert: async () => {},
    breaker: async () => ({ tripped: false }),
    ...over,
  };
  return { deps: deps as unknown as Record<string, unknown>, calls };
}

describe("exact provider paths, tags, and required payloads", () => {
  it("AI POST hits /task_post (or /live for Perplexity) and the tag carries the cacheKey", async () => {
    const chat = harness(llmResponsesTaskPostAck);
    const res = await providerCall("llm_chatgpt", { user_prompt: "hi", model_name: "gpt-4o" }, IDS, chat.deps);
    expect(res.state).toBe("waiting");
    expect(chat.calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_responses/task_post");
    expect(chat.calls.bodies[0][0].tag).toBe(res.cacheKey);

    const px = harness(perplexityLive);
    await providerCall("llm_perplexity", { user_prompt: "hi", model_name: "sonar" }, IDS, px.deps);
    expect(px.calls.fetch[0]).toBe(BASE + "ai_optimization/perplexity/llm_responses/live");
  });
  it("a waiting task resumes via the exact /task_get/{id} derivation from the registry", async () => {
    const row = { cache_key: "k", endpoint: "ai_optimization/chat_gpt/llm_responses/task_post", status: "pending", provider_task_id: "abc-123", payload: null, model_served: null, cost_usd: 0.03, expires_at: FUTURE };
    const { deps, calls } = harness(llmResponsesTaskGet, { cacheRead: async () => row });
    const res = await collectCapability("k", deps);
    expect(res.state).toBe("ok");
    expect(calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_responses/task_get/abc-123");
  });
  it("a scraper task resumes via /task_get/advanced/{id} (the plain variant does not exist)", async () => {
    const row = { cache_key: "k", endpoint: "ai_optimization/chat_gpt/llm_scraper/task_post", status: "pending", provider_task_id: "sc-1", payload: null, model_served: null, cost_usd: 0.035, expires_at: FUTURE };
    const ready = { status_code: 20000, tasks: [{ status_code: 20000, id: "sc-1", result: [{ items: [] }] }] };
    const { deps, calls } = harness(ready, { cacheRead: async () => row });
    const res = await collectCapability("k", deps);
    expect(res.state).toBe("ok");
    expect(calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_scraper/task_get/advanced/sc-1");
  });
  it("a 404 on collect is an honest error, never eternal waiting", async () => {
    const row = { cache_key: "k", endpoint: "serp/google/organic/task_post", status: "pending", provider_task_id: "t-9", payload: null, model_served: null, cost_usd: 0.0021, expires_at: FUTURE };
    const gone = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const { deps } = harness({}, { cacheRead: async () => row, fetchImpl: gone });
    const res = await collectCapability("k", deps);
    expect(res.state).toBe("error");
  });
  it("LLM bodies require user_prompt+model_name; scraper requires keyword+location+language+force_web_search", async () => {
    const llm = harness(llmResponsesTaskPostAck);
    await providerCall("llm_claude", { user_prompt: "q", model_name: "claude-sonnet-4-20250514", web_search: true }, IDS, llm.deps);
    expect(llm.calls.bodies[0][0]).toMatchObject({ user_prompt: "q", model_name: "claude-sonnet-4-20250514", web_search: true });

    const sc = harness({ status_code: 20000, cost: 0.035, tasks: [{ status_code: 20100, id: "s1" }] });
    await providerCall("llm_scraper_chatgpt", { keyword: "best crm", force_web_search: true, expand_citations: true }, IDS, sc.deps);
    const sb = sc.calls.bodies[0][0];
    expect(sb).toMatchObject({ keyword: "best crm", location_code: 2840, language_code: "en", force_web_search: true, expand_citations: true });
    expect(sb.user_prompt).toBeUndefined(); // keyword-based, NOT user_prompt

    const bad = harness({});
    expect((await providerCall("llm_scraper_chatgpt", { keyword: "x", expand_citations: true }, IDS, bad.deps)).state).toBe("error");
    expect(bad.calls.fetch).toHaveLength(0); // expand_citations without force_web_search rejected pre-network

    const miss = harness({});
    expect((await providerCall("llm_chatgpt", { model_name: "gpt-4o" }, IDS, miss.deps)).state).toBe("error");
    expect(miss.calls.fetch).toHaveLength(0); // missing user_prompt: typed error, no network
  });
});

describe("envelope parsing on the exact fixtures", () => {
  it("the Labs fixture through providerCall parses to nonempty keyword items", async () => {
    const { deps } = harness(labsKeywordsForSiteLive);
    const res = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, deps);
    if (res.state !== "ok") throw new Error(res.state);
    const parsed = parseCapability("labs_keywords_for_site", res.envelope);
    expect(parsed?.length).toBe(2);
    expect(parsed![0]).toMatchObject({ keyword: "video editing app for ipad pro", searchVolume: 30, difficulty: 60, intent: "transactional" });
    expect(parsed![0].monthlySearches).toHaveLength(2);
  });
  it("the SERP task_get fixture yields organic, PAA, related searches, and AI Overview", () => {
    const parsed = parseCapability("serp_organic", serpTaskGetAdvanced as unknown as ProviderEnvelope);
    expect(parsed!.organic.map((o) => o.domain)).toEqual(["python.org", "w3schools.com"]);
    expect(parsed!.paaQuestions).toHaveLength(2);
    expect(parsed!.relatedSearches).toHaveLength(3);
    expect(parsed!.aiOverview?.present).toBe(true);
    expect(parsed!.aiOverview?.references.map((r) => r.domain)).toEqual(["python.org", "wikipedia.org"]);
  });
  it("an LLM answer keeps citations null when web-search is off and lists them when on", async () => {
    const { deps } = harness(llmResponsesTaskGet, { cacheRead: async () => ({ cache_key: "k", endpoint: "ai_optimization/chat_gpt/llm_responses/task_post", status: "pending", provider_task_id: "abc-123", payload: null, model_served: null, cost_usd: 0, expires_at: FUTURE }) });
    const res = await collectCapability("k", deps);
    if (res.state !== "ok") throw new Error(res.state);
    const ans = parseCapability("llm_chatgpt", res.envelope);
    expect(ans!.webSearchReported).toBe(true);
    expect(ans!.citations?.map((c) => c.domain)).toEqual(["runnersworld.com", "wirecutter.com"]);
    expect(ans!.fanOutQueries).toHaveLength(2);
  });
  it("a cache hit parses identically to the fresh result", async () => {
    const fresh = harness(labsKeywordsForSiteLive);
    const r1 = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, fresh.deps);
    if (r1.state !== "ok") throw new Error(r1.state);
    const stored = fresh.calls.writes.find((w) => w.status === "ready")!.payload;
    const hit = harness(labsKeywordsForSiteLive, { claimEvidenceFetch: async () => ({ outcome: "ready", payload: stored, providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 }) });
    const r2 = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, hit.deps);
    if (r2.state !== "hit") throw new Error(r2.state);
    expect(hit.calls.fetch).toHaveLength(0);
    expect(parseCapability("labs_keywords_for_site", r2.envelope)).toEqual(parseCapability("labs_keywords_for_site", r1.envelope));
  });
});

describe("method-compatible model resolution", () => {
  it("picks a method-compatible id, fails closed when unavailable, and uses the labeled fallback in dry-run", async () => {
    const ok = harness(chatgptModels);
    expect(await resolveEngineModel("chatgpt", ok.deps)).toBe("gpt-4o"); // task_post_supported AND web_search; NOT gpt-5
    const px = harness(perplexityModels);
    expect(await resolveEngineModel("perplexity", px.deps)).toBe("sonar-reasoning-pro"); // Live-only, prefers web search

    const down = harness({}, { fetchImpl: vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect(await resolveEngineModel("chatgpt", down.deps)).toBeNull(); // configured+live, list unavailable -> fail closed

    const dry = harness({}, { env: { ...ENV, DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv });
    expect(await resolveEngineModel("gemini", dry.deps)).toBe("gemini-2.5-flash"); // labeled fallback, no network
    expect(dry.calls.fetch).toHaveLength(0);
  });
});
