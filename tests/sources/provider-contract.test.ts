/**
 * Provider-contract proof: the capability registry composed with the money-safe core, bound to BOUNDED official
 * DataForSEO fixtures. No network, no Supabase, no spend. Pins the exact paths (post, FREE task_get, FREE
 * tasks_ready), the PER-ENGINE request body with its documented output-token bound, DYNAMIC Standard-vs-Live
 * routing, the envelope rule, and method-aware resolution.
 */
import { describe, it, expect, vi } from "vitest";
import { providerCall, collectCapability, parseCapability, resolveEngineModel } from "@/domains/evidence/dataforseo/capabilities";
import { identityCacheKey } from "@/domains/evidence/dataforseo/cached-call";
import type { ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { classifyTaskStatus, classifyPaidResponse, type TaskStatusClass, type PaidResponseAction } from "@/domains/evidence/dataforseo/status-contract";
import { labsKeywordsForSiteLive, serpTaskGetAdvanced, llmResponsesTaskPostAck, llmResponsesTaskGet, perplexityLive, chatgptModels, perplexityModels } from "../fixtures/dataforseo-envelopes";
const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc", DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z");
const IDS = { tenantId: "t", unitKey: "u" };
const BASE = "https://api.dataforseo.com/v3/";
const modelsEnv = (...models: Record<string, unknown>[]): ProviderEnvelope => ({ status_code: 20000, tasks: [{ status_code: 20000, result: models as unknown[] }] } as ProviderEnvelope);
const STD = modelsEnv({ model_name: "gpt-4o", web_search_supported: true, task_post_supported: true });
const modelsFor = (name: string, post: boolean) => modelsEnv({ model_name: name, web_search_supported: true, task_post_supported: post });
const taskRow = (endpoint: string, over: Record<string, unknown> = {}) => ({ cache_key: "k", endpoint, status: "pending", provider_task_id: "abc-123", payload: null, model_served: null, cost_usd: 0.03, expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(), quarantined_at: null, ...over });
/** fetchImpl routes the FREE /models GET to modelsBody (default = fetchBody) and every other call to fetchBody, so an engine call resolves its model then posts. */
function harness(fetchBody: unknown, over: Record<string, unknown> = {}) {
  const { modelsBody = fetchBody, ...depsOver } = over;
  const calls = { fetch: [] as string[], bodies: [] as Record<string, unknown>[][], writes: [] as Record<string, unknown>[] };
  const deps = { env: ENV, now: () => NOW,
    fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
      calls.fetch.push(url); if (init?.body) calls.bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(url.endsWith("/models") ? modelsBody : fetchBody), { status: 200 });
    }) as unknown as typeof fetch,
    claimEvidenceFetch: async () => ({ outcome: "claimed", payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0 }),
    reserveProviderSpend: async () => true, adjustProviderSpend: async () => true, cacheUpsert: async () => {}, breaker: async () => ({ tripped: false }),
    cacheRead: async () => null, cacheWrite: async (_k: string, patch: Record<string, unknown>) => { calls.writes.push(patch); }, ...depsOver };
  return { deps: deps as unknown as Record<string, unknown>, calls, task: () => calls.fetch.filter((u) => !u.endsWith("/models")) };
}
describe("exact task-status taxonomy (docs.dataforseo.com/v3/appendix/errors)", () => {
  it("pins every documented code onto one class and fails closed on everything else", () => {
    const groups: [TaskStatusClass, (number | null)[]][] = [
      ["ready", [20000]], ["waiting", [null, 20100, 40601, 40602]], ["missing", [40401, 40403]], // waiting = still the provider's turn; ONLY the two missing codes are proven dead -> the one repost
      ["transient", [50000, 50001, 50301, 50302, 50303]], // FREE collect, id preserved
      ["blocked", [40000, 40100, 40103, 40200, 40202, 40400, 40402, 40404, 40405, 40406, 40407, 40408, 40501, 40506, 50100, 50304, 50401, 50402, 44999, 61234]]]; // never missing, never a paid repost: contract, account, duplicate, terminal, unknown
    for (const [cls, codes] of groups) for (const code of codes) expect([code, classifyTaskStatus(code)]).toEqual([code, cls]);
  });
  it("judges a PAID response on REPORTED cost first, then on BOTH statuses: every non-success status must be exact-temporary at a reported 0", () => {
    const paid: [number | null, number | null, number | null, PaidResponseAction][] = [
      [20000, null, null, "uncertain"], [50301, null, null, "uncertain"], [20000, 50301, 0.02, "uncertain"], [20000, 50303, 0.001, "uncertain"], // unreported or nonzero cost: the provider may have charged
      [50301, null, 0, "retry_free_release"], [20000, 50000, 0, "retry_free_release"], [20000, 50303, 0, "retry_free_release"], [50303, null, 0, "retry_free_release"], [50301, 50303, 0, "retry_free_release"], // every non-success status exact-temporary + a REPORTED zero
      [40100, 50303, 0, "blocked"], [87654, 50303, 0, "blocked"], // a conflicting auth or unknown TOP status fails closed even beside a temporary task status
      [20000, null, 0, "blocked"], [null, null, 0, "blocked"], // a rejected paid response carrying no non-success status proves nothing temporary
      [50100, null, 0, "blocked"], [20000, 50100, 0, "blocked"], [20000, 50401, 0, "blocked"], [20000, 50402, 0, "blocked"], // terminal, or live-only where any retry is a NEW charge
      [40401, null, 0, "blocked"], [20000, 40403, 0, "blocked"], // a POST/Live reply can never prove a task is missing
      [20000, 61234, 0, "blocked"]]; // undocumented: fails closed
    for (const c of paid) expect([c[0], c[1], c[2], classifyPaidResponse(c[0], c[1], c[2])]).toEqual(c);
  });
});
describe("exact provider paths + DYNAMIC method routing", () => {
  it("a Standard AI POST hits /task_post, the tag carries the cacheKey, and the model rides back; Perplexity is Live", async () => {
    const chat = harness(llmResponsesTaskPostAck, { modelsBody: STD }); const res = await providerCall("llm_chatgpt", { user_prompt: "hi", web_search: true }, IDS, chat.deps);
    if (res.state !== "waiting") throw new Error(res.state); expect(res.modelRequested).toBe("gpt-4o");
    expect(chat.task()[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_responses/task_post"); expect(chat.calls.bodies[0][0].tag).toBe(res.cacheKey);
    const px = harness(perplexityLive, { modelsBody: modelsFor("sonar", false) }); await providerCall("llm_perplexity", { user_prompt: "hi" }, IDS, px.deps); expect(px.task()[0]).toBe(BASE + "ai_optimization/perplexity/llm_responses/live");
  });
  it("routes the SAME engine to Standard or to Live purely from the model resolution", async () => {
    for (const [post, path] of [[true, "task_post"], [false, "live"]] as [boolean, string][]) {
      const g = harness(post ? llmResponsesTaskPostAck : perplexityLive, { modelsBody: modelsFor("gemini-2.5-pro", post) });
      await providerCall("llm_gemini", { user_prompt: "g", web_search: true }, IDS, g.deps); expect(g.task()[0]).toBe(`${BASE}ai_optimization/gemini/llm_responses/${path}`);
    }
  });
  it("resumes Standard via /task_get/{id}, scraper via /task_get/advanced/{id}, and a raw 404 fails closed", async () => {
    const a = harness(llmResponsesTaskGet, { cacheRead: async () => taskRow("ai_optimization/chat_gpt/llm_responses/task_post") }); expect((await collectCapability("k", a.deps)).state).toBe("ok"); expect(a.calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_responses/task_get/abc-123");
    const b = harness({ status_code: 20000, tasks: [{ status_code: 20000, id: "sc-1", result: [{ items: [] }] }] }, { cacheRead: async () => taskRow("ai_optimization/chat_gpt/llm_scraper/task_post", { provider_task_id: "sc-1" }) }); expect((await collectCapability("k", b.deps)).state).toBe("ok"); expect(b.calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_scraper/task_get/advanced/sc-1");
    const c = harness({}, { cacheRead: async () => taskRow("serp/google/organic/task_post"), fetchImpl: vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch });
    const dead = await collectCapability("k", c.deps); expect(dead.state === "error" && dead.disposition).toBe("blocked"); // a raw HTTP 404 never reposts
  });
  it("derives every family's FREE tasks_ready path and recovers a quarantined task by tag", async () => {
    for (const family of ["serp/google/organic", "serp/google/ai_mode", "ai_optimization/chat_gpt/llm_responses", "ai_optimization/claude/llm_responses", "ai_optimization/gemini/llm_responses", "ai_optimization/chat_gpt/llm_scraper"]) {
      const g = harness(serpTaskGetAdvanced, { cacheRead: async () => taskRow(`${family}/task_post`, { provider_task_id: null, quarantined_at: NOW.toISOString() }) });
      g.deps.fetchImpl = vi.fn(async (u: string) => { g.calls.fetch.push(u); return new Response(JSON.stringify(u.includes("tasks_ready") ? { status_code: 20000, tasks: [{ status_code: 20000, result: [{ id: "found-1", tag: "k" }] }] } : serpTaskGetAdvanced), { status: 200 }); }) as unknown as typeof fetch;
      expect((await collectCapability("k", g.deps)).state).toBe("ok"); expect([g.calls.fetch[0], g.calls.fetch.some((u) => u.includes("task_post"))]).toEqual([`${BASE}${family}/tasks_ready`, false]); // FREE GET per family, never a paid repost
    }
  });
});
describe("web-enabled request bodies per engine (only documented fields)", () => {
  it("ChatGPT sends web_search ONLY: force_web_search draws an in-body 40501 on its reasoning models, and no web field rides an unasked or unsupported search", async () => {
    const chat = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("o4-mini", true) }); const r1 = await providerCall("llm_chatgpt", { user_prompt: "q", web_search: true }, IDS, chat.deps);
    const cb = chat.calls.bodies[0][0]; expect(cb).toMatchObject({ user_prompt: "q", model_name: "o4-mini", max_output_tokens: 2048, web_search: true });
    expect(["force_web_search" in cb, "web_search_country_iso_code" in cb]).toEqual([false, false]); // structurally ABSENT, not merely falsy: the provider rejects the pair
    const off = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("o4-mini", true) }); await providerCall("llm_chatgpt", { user_prompt: "q" }, IDS, off.deps);
    const nw = harness(llmResponsesTaskPostAck, { modelsBody: modelsEnv({ model_name: "o1", web_search_supported: false, task_post_supported: true }) }); await providerCall("llm_chatgpt", { user_prompt: "q", web_search: true }, IDS, nw.deps);
    expect(["web_search" in off.calls.bodies[0][0], "web_search" in nw.calls.bodies[0][0]]).toEqual([false, false]);
    const key = (publicInput: Record<string, unknown>) => identityCacheKey({ endpoint: "ai_optimization/chat_gpt/llm_responses/task_post", publicInput, locationCode: 2840, languageCode: "en", device: null, modelRequested: "o4-mini" });
    expect([("cacheKey" in r1 ? r1.cacheKey : null) === key({ user_prompt: "q", web_search: true }), key({ user_prompt: "q", web_search: true }) === key({ user_prompt: "q", web_search: true, force_web_search: true, web_search_country_iso_code: "US" })]).toEqual([true, false]); // the REAL call derives this exact identity, and rejected rows never serve the corrected ask
  });
  it("Claude sends force_web_search + country when asked (documented; conflicts only with use_reasoning, which we never send) and neither when web search is off", async () => {
    const on = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("claude-sonnet-4-20250514", true) }); await providerCall("llm_claude", { user_prompt: "q", web_search: true, force_web_search: true, web_search_country_iso_code: "US" }, IDS, on.deps);
    expect(on.calls.bodies[0][0]).toMatchObject({ user_prompt: "q", model_name: "claude-sonnet-4-20250514", max_output_tokens: 2048, web_search: true, force_web_search: true, web_search_country_iso_code: "US" });
    const off = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("claude-sonnet-4-20250514", true) }); await providerCall("llm_claude", { user_prompt: "q", force_web_search: true, web_search_country_iso_code: "US" }, IDS, off.deps);
    const ob = off.calls.bodies[0][0]; expect(["web_search" in ob, "force_web_search" in ob, "web_search_country_iso_code" in ob]).toEqual([false, false, false]);
  });
  it("Gemini carries web_search ONLY; Perplexity never sends web_search; the scraper is keyword-based with no token field", async () => {
    const gem = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("gemini-2.5-pro", true) }); await providerCall("llm_gemini", { user_prompt: "g", web_search: true }, IDS, gem.deps);
    const gb = gem.calls.bodies[0][0]; expect(gb).toMatchObject({ user_prompt: "g", model_name: "gemini-2.5-pro", max_output_tokens: 2048, web_search: true }); expect(["force_web_search" in gb, "web_search_country_iso_code" in gb]).toEqual([false, false]);
    const px = harness(perplexityLive, { modelsBody: modelsFor("sonar", false) }); await providerCall("llm_perplexity", { user_prompt: "p", web_search_country_iso_code: "US" }, IDS, px.deps);
    const pb = px.calls.bodies[0][0]; expect(pb).toMatchObject({ user_prompt: "p", model_name: "sonar", max_output_tokens: 2048, web_search_country_iso_code: "US" }); expect(pb.web_search).toBeUndefined();
    const sc = harness({ status_code: 20000, cost: 0.035, tasks: [{ status_code: 20100, id: "s1" }] }); await providerCall("llm_scraper_chatgpt", { keyword: "best crm", force_web_search: true, expand_citations: true }, IDS, sc.deps);
    expect(sc.calls.bodies[0][0]).toMatchObject({ keyword: "best crm", location_code: 2840, language_code: "en", force_web_search: true, expand_citations: true }); // the SEPARATE scraper API documents both: never collapse it into llm_responses
    expect(sc.calls.bodies[0][0].user_prompt).toBeUndefined(); expect(sc.calls.bodies[0][0].max_output_tokens).toBeUndefined(); // undocumented on llm_scraper: never sent
    const bad = harness({}); expect((await providerCall("llm_scraper_chatgpt", { keyword: "x", expand_citations: true }, IDS, bad.deps)).state).toBe("error"); expect(bad.calls.fetch).toHaveLength(0); // expand_citations without force_web_search rejected pre-network
  });
  it("rejects cross-engine fields and caller-chosen models at COMPILE time", () => {
    // @ts-expect-error a scraper is keyword-based; user_prompt is not its field
    const scraper = () => providerCall("llm_scraper_chatgpt", { user_prompt: "x" }, IDS);
    // @ts-expect-error the model is resolved, never caller-supplied
    const chosen = () => providerCall("llm_chatgpt", { user_prompt: "x", model_name: "gpt-4o" }, IDS);
    expect([typeof scraper, typeof chosen]).toEqual(["function", "function"]);
  });
});
describe("envelope parsing + method-aware resolution", () => {
  it("the Labs fixture through providerCall parses to nonempty keyword items, and a hit parses identically", async () => {
    const fresh = harness(labsKeywordsForSiteLive); const r1 = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, fresh.deps); if (r1.state !== "ok") throw new Error(r1.state);
    const parsed = parseCapability("labs_keywords_for_site", r1.envelope); expect(parsed?.length).toBe(2); expect(parsed![0]).toMatchObject({ keyword: "video editing app for ipad pro", searchVolume: 30, difficulty: 60, intent: "transactional" });
    const stored = fresh.calls.writes.find((w) => w.status === "ready")!.payload;
    const hit = harness(labsKeywordsForSiteLive, { claimEvidenceFetch: async () => ({ outcome: "ready", payload: stored, providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 }) });
    const r2 = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, hit.deps); if (r2.state !== "hit") throw new Error(r2.state);
    expect(hit.calls.fetch).toHaveLength(0); expect(parseCapability("labs_keywords_for_site", r2.envelope)).toEqual(parsed);
  });
  it("the SERP fixture yields organic, PAA, related, AI Overview; an LLM answer lists web citations", async () => {
    const serp = parseCapability("serp_organic", serpTaskGetAdvanced as unknown as ProviderEnvelope); expect(serp!.organic.map((o) => o.domain)).toEqual(["python.org", "w3schools.com"]);
    expect(serp!.paaQuestions).toHaveLength(2); expect(serp!.relatedSearches).toHaveLength(3); expect(serp!.aiOverview?.references.map((r) => r.domain)).toEqual(["python.org", "wikipedia.org"]);
    const { deps } = harness(llmResponsesTaskGet, { cacheRead: async () => taskRow("ai_optimization/chat_gpt/llm_responses/task_post", { cost_usd: 0 }) }); const res = await collectCapability("k", deps); if (res.state !== "ok") throw new Error(res.state); const ans = parseCapability("llm_chatgpt", res.envelope); expect([ans!.webSearchReported, ans!.citations?.map((c) => c.domain), ans!.fanOutQueries?.length]).toEqual([true, ["runnersworld.com", "wirecutter.com"], 2]);
  });
  it("resolution prefers Standard + web, fails closed when unavailable, and uses the labeled dry-run fallback", async () => {
    expect(await resolveEngineModel("chatgpt", harness(chatgptModels).deps)).toMatchObject({ model: "gpt-4o", method: "standard", webSearch: true }); // NOT gpt-5
    expect(await resolveEngineModel("perplexity", harness(perplexityModels).deps)).toMatchObject({ model: "sonar-reasoning-pro", method: "live", webSearch: true });
    expect(await resolveEngineModel("chatgpt", harness({}, { fetchImpl: vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch }).deps)).toBeNull(); // fail closed
    const dry = harness({}, { env: { ...ENV, DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv }); expect(await resolveEngineModel("gemini", dry.deps)).toMatchObject({ model: "gemini-2.5-flash", method: "live", webSearch: true }); expect(dry.calls.fetch).toHaveLength(0);
  });
  it("a model-cache READ FAILURE fails closed: no model, a bounded no-model result, and ZERO provider calls", async () => {
    const outage = harness(llmResponsesTaskPostAck, { modelsBody: STD, cacheRead: async () => { throw new Error("records down"); } });
    expect(await resolveEngineModel("chatgpt", outage.deps)).toBeNull(); // a records outage is NOT a cache miss
    const noModel = await providerCall("llm_chatgpt", { user_prompt: "hi", web_search: true }, IDS, outage.deps);
    expect([noModel.state, noModel.state === "not_configured" && noModel.detail.includes("usable chatgpt model"), outage.calls.fetch.length]).toEqual(["not_configured", true, 0]); // not even the FREE models GET
  });
});
