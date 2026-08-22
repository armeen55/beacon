/** Provider-contract proof: the capability registry composed with the money-safe core, bound to BOUNDED official DataForSEO fixtures. No network, no Supabase, no spend. Pins the exact paths (post, FREE task_get, FREE tasks_ready), the
 *  PER-ENGINE request body with its documented output-token bound, DYNAMIC Standard-vs-Live routing, the envelope rule, and method-aware resolution. */
import { describe, it, expect, vi } from "vitest";
import { providerCall, keywordIdeasBatched, collectCapability, parseCapability, resolveEngineModel } from "@/domains/evidence/dataforseo/capabilities";
import { identityCacheKey } from "@/domains/evidence/dataforseo/cached-call";
import { comparePageCoverage, parsePageIntersection } from "@/domains/evidence/page-intersection";
import type { ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { classifyTaskStatus, classifyPaidResponse, type TaskStatusClass, type PaidResponseAction } from "@/domains/evidence/dataforseo/status-contract";
import { labsKeywordsForSiteLive, serpTaskGetAdvanced, llmResponsesTaskPostAck, llmResponsesTaskGet, perplexityLive, chatgptModels, perplexityModels } from "../fixtures/dataforseo-envelopes";
const ENV = { DATAFORSEO_AUTH_B64: "abc" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z"); const IDS = { tenantId: "t", unitKey: "u" }; const BASE = "https://api.dataforseo.com/v3/";
const modelsEnv = (...models: Record<string, unknown>[]): ProviderEnvelope => ({ status_code: 20000, tasks: [{ status_code: 20000, result: models as unknown[] }] } as ProviderEnvelope);
const modelsFor = (name: string, post: boolean) => modelsEnv({ model_name: name, web_search_supported: true, task_post_supported: post });
const STD = modelsFor("gpt-4o", true);
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
      ["transient", [50000, 50001, 50301, 50302, 50303]], ["limited", [40203]], // transient = FREE collect, id preserved; limited = the account's OWN daily ceiling, which resets
      ["blocked", [40000, 40100, 40103, 40200, 40202, 40400, 40402, 40404, 40405, 40406, 40407, 40408, 40501, 40506, 50100, 50304, 50401, 50402, 44999, 61234]]]; // never missing, never a paid repost: contract, account, duplicate, terminal, unknown
    for (const [cls, codes] of groups) for (const code of codes) expect([code, classifyTaskStatus(code)]).toEqual([code, cls]); });
  it("judges a PAID response on REPORTED cost first, then on BOTH statuses: every non-success status must be exact-temporary at a reported 0", () => {
    const paid: [number | null, number | null, number | null, PaidResponseAction][] = [ [20000, null, null, "uncertain"], [50301, null, null, "uncertain"], [20000, 50301, 0.02, "uncertain"], [20000, 50303, 0.001, "uncertain"], // unreported or nonzero cost: the provider may have charged
      [50301, null, 0, "retry_free_release"], [20000, 50000, 0, "retry_free_release"], [20000, 50303, 0, "retry_free_release"], [50303, null, 0, "retry_free_release"], [50301, 50303, 0, "retry_free_release"], // every non-success status exact-temporary + a REPORTED zero
      [40100, 50303, 0, "blocked"], [87654, 50303, 0, "blocked"], // a conflicting auth or unknown TOP status fails closed even beside a temporary task status
      [20000, null, 0, "blocked"], [null, null, 0, "blocked"], // a rejected paid response carrying no non-success status proves nothing temporary
      [50100, null, 0, "blocked"], [20000, 50100, 0, "blocked"], [20000, 50401, 0, "blocked"], [20000, 50402, 0, "blocked"], // terminal, or live-only where any retry is a NEW charge
      [40401, null, 0, "blocked"], [20000, 40403, 0, "blocked"], // a POST/Live reply can never prove a task is missing
      [20000, 61234, 0, "blocked"], // undocumented: fails closed
      [40203, null, 0, "daily_limit_release"], [20000, 40203, 0, "daily_limit_release"], // a ceiling that RESETS releases, never a hold needing an operator
      [40203, null, 0.01, "uncertain"], [40203, 50303, 0, "blocked"]]; // ...unless it may have charged, or is mixed with another refusal
    for (const c of paid) expect([c[0], c[1], c[2], classifyPaidResponse(c[0], c[1], c[2])]).toEqual(c); });
});
describe("exact provider paths + DYNAMIC method routing", () => {
  it("a Standard AI POST hits /task_post, the tag carries the cacheKey, and the model rides back; Perplexity is Live", async () => {
    const chat = harness(llmResponsesTaskPostAck, { modelsBody: STD }); const res = await providerCall("llm_chatgpt", { user_prompt: "hi", web_search: true }, IDS, chat.deps);
    if (res.state !== "waiting") throw new Error(res.state); expect(res.modelRequested).toBe("gpt-4o"); expect(chat.task()[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_responses/task_post"); expect(chat.calls.bodies[0][0].tag).toBe(res.cacheKey);
    const px = harness(perplexityLive, { modelsBody: modelsFor("sonar", false) }); await providerCall("llm_perplexity", { user_prompt: "hi" }, IDS, px.deps); expect(px.task()[0]).toBe(BASE + "ai_optimization/perplexity/llm_responses/live"); });
  it("routes the SAME engine to Standard or to Live purely from the model resolution", async () => {
    for (const [post, path] of [[true, "task_post"], [false, "live"]] as [boolean, string][]) {
      const g = harness(post ? llmResponsesTaskPostAck : perplexityLive, { modelsBody: modelsFor("gemini-2.5-pro", post) }); await providerCall("llm_gemini", { user_prompt: "g", web_search: true }, IDS, g.deps); expect(g.task()[0]).toBe(`${BASE}ai_optimization/gemini/llm_responses/${path}`);
    } });
  it("resumes Standard via /task_get/{id}, scraper via /task_get/advanced/{id}, and a raw 404 fails closed", async () => {
    const a = harness(llmResponsesTaskGet, { cacheRead: async () => taskRow("ai_optimization/chat_gpt/llm_responses/task_post") }); expect((await collectCapability("k", a.deps)).state).toBe("ok"); expect(a.calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_responses/task_get/abc-123"); const b = harness({ status_code: 20000, tasks: [{ status_code: 20000, id: "sc-1", result: [{ items: [] }] }] }, { cacheRead: async () => taskRow("ai_optimization/chat_gpt/llm_scraper/task_post", { provider_task_id: "sc-1" }) }); expect((await collectCapability("k", b.deps)).state).toBe("ok"); expect(b.calls.fetch[0]).toBe(BASE + "ai_optimization/chat_gpt/llm_scraper/task_get/advanced/sc-1");
    const c = harness({}, { cacheRead: async () => taskRow("serp/google/organic/task_post"), fetchImpl: vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch }); const dead = await collectCapability("k", c.deps); expect(dead.state === "error" && dead.disposition).toBe("blocked"); // a raw HTTP 404 never reposts
  });
  it("derives every family's FREE tasks_ready path and recovers a quarantined task by tag", async () => {
    for (const family of ["serp/google/organic", "serp/google/ai_mode", "ai_optimization/chat_gpt/llm_responses", "ai_optimization/claude/llm_responses", "ai_optimization/gemini/llm_responses", "ai_optimization/chat_gpt/llm_scraper"]) {
      const g = harness(serpTaskGetAdvanced, { cacheRead: async () => taskRow(`${family}/task_post`, { provider_task_id: null, quarantined_at: NOW.toISOString() }) }); g.deps.fetchImpl = vi.fn(async (u: string) => { g.calls.fetch.push(u); return new Response(JSON.stringify(u.includes("tasks_ready") ? { status_code: 20000, tasks: [{ status_code: 20000, result: [{ id: "found-1", tag: "k" }] }] } : serpTaskGetAdvanced), { status: 200 }); }) as unknown as typeof fetch;
      expect((await collectCapability("k", g.deps)).state).toBe("ok"); expect([g.calls.fetch[0], g.calls.fetch.some((u) => u.includes("task_post"))]).toEqual([`${BASE}${family}/tasks_ready`, false]); // FREE GET per family, never a paid repost
    } });
});
describe("web-enabled request bodies per engine (only documented fields)", () => {
  it("ChatGPT sends web_search ONLY: force_web_search draws an in-body 40501 on its reasoning models, and no web field rides an unasked or unsupported search", async () => {
    const chat = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("o4-mini", true) }); const r1 = await providerCall("llm_chatgpt", { user_prompt: "q", web_search: true }, IDS, chat.deps); const cb = chat.calls.bodies[0][0]; expect(cb).toMatchObject({ user_prompt: "q", model_name: "o4-mini", max_output_tokens: 2048, web_search: true });
    expect(["force_web_search" in cb, "web_search_country_iso_code" in cb]).toEqual([false, false]); // structurally ABSENT, not merely falsy: the provider rejects the pair
    const off = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("o4-mini", true) }); await providerCall("llm_chatgpt", { user_prompt: "q" }, IDS, off.deps); const nw = harness(llmResponsesTaskPostAck, { modelsBody: modelsEnv({ model_name: "o1", web_search_supported: false, task_post_supported: true }) }); await providerCall("llm_chatgpt", { user_prompt: "q", web_search: true }, IDS, nw.deps);
    expect(["web_search" in off.calls.bodies[0][0], "web_search" in nw.calls.bodies[0][0]]).toEqual([false, false]);
    const key = (publicInput: Record<string, unknown>) => identityCacheKey({ endpoint: "ai_optimization/chat_gpt/llm_responses/task_post", publicInput, locationCode: 2840, languageCode: "en", device: null, modelRequested: "o4-mini" });
    expect([("cacheKey" in r1 ? r1.cacheKey : null) === key({ user_prompt: "q", web_search: true }), key({ user_prompt: "q", web_search: true }) === key({ user_prompt: "q", web_search: true, force_web_search: true, web_search_country_iso_code: "US" })]).toEqual([true, false]); // the REAL call derives this exact identity, and rejected rows never serve the corrected ask
  });
  it("Claude sends force_web_search + country when asked (documented; conflicts only with use_reasoning, which we never send) and neither when web search is off", async () => {
    const on = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("claude-sonnet-4-20250514", true) }); await providerCall("llm_claude", { user_prompt: "q", web_search: true, force_web_search: true, web_search_country_iso_code: "US" }, IDS, on.deps); expect(on.calls.bodies[0][0]).toMatchObject({ user_prompt: "q", model_name: "claude-sonnet-4-20250514", max_output_tokens: 2048, web_search: true, force_web_search: true, web_search_country_iso_code: "US" });
    const off = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("claude-sonnet-4-20250514", true) }); await providerCall("llm_claude", { user_prompt: "q", force_web_search: true, web_search_country_iso_code: "US" }, IDS, off.deps); const ob = off.calls.bodies[0][0]; expect(["web_search" in ob, "force_web_search" in ob, "web_search_country_iso_code" in ob]).toEqual([false, false, false]); });
  it("Gemini carries web_search ONLY; Perplexity never sends web_search; the scraper is keyword-based with no token field", async () => {
    const gem = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("gemini-2.5-pro", true) }); await providerCall("llm_gemini", { user_prompt: "g", web_search: true }, IDS, gem.deps); const gb = gem.calls.bodies[0][0]; expect(gb).toMatchObject({ user_prompt: "g", model_name: "gemini-2.5-pro", max_output_tokens: 2048, web_search: true }); expect(["force_web_search" in gb, "web_search_country_iso_code" in gb]).toEqual([false, false]);
    const px = harness(perplexityLive, { modelsBody: modelsFor("sonar", false) }); await providerCall("llm_perplexity", { user_prompt: "p", web_search_country_iso_code: "US" }, IDS, px.deps); const pb = px.calls.bodies[0][0]; expect(pb).toMatchObject({ user_prompt: "p", model_name: "sonar", max_output_tokens: 2048, web_search_country_iso_code: "US" }); expect(pb.web_search).toBeUndefined();
    const sc = harness({ status_code: 20000, cost: 0.035, tasks: [{ status_code: 20100, id: "s1" }] }); await providerCall("llm_scraper_chatgpt", { keyword: "best crm", force_web_search: true, expand_citations: true }, IDS, sc.deps); expect(sc.calls.bodies[0][0]).toMatchObject({ keyword: "best crm", location_code: 2840, language_code: "en", force_web_search: true, expand_citations: true }); // the SEPARATE scraper API documents both: never collapse it into llm_responses
    expect(sc.calls.bodies[0][0].user_prompt).toBeUndefined(); expect(sc.calls.bodies[0][0].max_output_tokens).toBeUndefined(); // undocumented on llm_scraper: never sent
    const bad = harness({}); expect((await providerCall("llm_scraper_chatgpt", { keyword: "x", expand_citations: true }, IDS, bad.deps)).state).toBe("error"); expect(bad.calls.fetch).toHaveLength(0); // expand_citations without force_web_search rejected pre-network
  });
  it("keys an AI reading on the day it belongs to and the sample slot it is, and sends NEITHER to the provider", async () => {
    const day = "2026-07-25", next = "2026-07-26";
    const post = async (over: Record<string, unknown>) => {
      const h = harness(llmResponsesTaskPostAck, { modelsBody: modelsFor("gpt-4o", true) });
      const r = await providerCall("llm_gemini", { user_prompt: "q", web_search: true, ...over }, IDS, h.deps);
      return { key: "cacheKey" in r ? r.cacheKey : null, body: h.calls.bodies[0]![0]! };
    };
    const slot0 = await post({ observation_day: day, sample_slot: 0 });
    const slot1 = await post({ observation_day: day, sample_slot: 1 });
    const tomorrow = await post({ observation_day: next, sample_slot: 0 });
    const retry = await post({ observation_day: day, sample_slot: 0 });
    expect(slot0.key).toBe(retry.key);           // the same reading retried the same day is ONE ask and stays $0
    expect(slot0.key).not.toBe(slot1.key);       // a second sample is a SECOND question, never a free replay of the first
    expect(slot0.key).not.toBe(tomorrow.key);    // and tomorrow is a new question, so a 23:00 answer is never served as tomorrow's
    // Neither field is a provider field: the request body is identical to one asked without them (the only difference is `tag`, which IS the cache identity and is how a quarantined task is recovered for free).
    expect([slot1.body.observation_day, slot1.body.sample_slot]).toEqual([undefined, undefined]);
    const plain = (b: Record<string, unknown>) => ({ ...b, tag: undefined });
    expect(plain(slot1.body)).toEqual(plain((await post({})).body));
    // Slot 0 is not merely ignored, it is ABSENT from the identity, so an omitted slot and an explicit 0 agree.
    expect(slot0.key).toBe((await post({ observation_day: day })).key);
    const key = (publicInput: Record<string, unknown>) => identityCacheKey({ endpoint: "ai_optimization/gemini/llm_responses/task_post", publicInput, locationCode: 2840, languageCode: "en", device: null, modelRequested: "gpt-4o" });
    expect(slot0.key).toBe(key({ user_prompt: "q", web_search: true, observation_day: day }));
  });
  it("reads the brands the consumer answer named itself, however the provider shaped the list, and never turns unreadable into none", () => {
    const scraped = (brand_entities: unknown): ProviderEnvelope => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ markdown: "an answer", brand_entities }] }] } as unknown as ProviderEnvelope);
    expect(parseCapability("llm_scraper_chatgpt", scraped([{ title: "Acme" }, { title: "Rival" }]))!.brandMentions).toEqual(["Acme", "Rival"]);
    expect(parseCapability("llm_scraper_chatgpt", scraped(["Acme", "Rival"]))!.brandMentions).toEqual(["Acme", "Rival"]); // a plain string list is the same claim
    expect(parseCapability("llm_scraper_chatgpt", scraped([]))!.brandMentions).toEqual([]); // it looked and named none
    expect(parseCapability("llm_scraper_chatgpt", scraped([{ name: "Acme" }]))!.brandMentions).toBeNull(); // unreadable is "I do not know", never "it named none"
    expect(parseCapability("llm_scraper_chatgpt", scraped(undefined))!.brandMentions).toBeNull();
  });
  it("rejects cross-engine fields and caller-chosen models at COMPILE time", () => {
    // @ts-expect-error a scraper is keyword-based; user_prompt is not its field
    const scraper = () => providerCall("llm_scraper_chatgpt", { user_prompt: "x" }, IDS);
    // @ts-expect-error the model is resolved, never caller-supplied
    const chosen = () => providerCall("llm_chatgpt", { user_prompt: "x", model_name: "gpt-4o" }, IDS);
    expect([typeof scraper, typeof chosen]).toEqual(["function", "function"]); });
});
describe("keyword ideas: one request per 200 seeds, and nothing missing turned into a zero", () => {
  const rich = { keyword: "saffron price", keyword_info: { search_volume: 1200, competition: 0.21, competition_level: "LOW", cpc: 0.9, monthly_searches: [{ year: 2026, month: 6, search_volume: 1100 }, { year: 2026, month: 5 }] }, keyword_properties: { keyword_difficulty: 34 }, search_intent_info: { main_intent: "commercial" } }, ranked = { ranked_serp_element: { serp_item: { rank_group: 4, rank_absolute: 7, url: "https://mysite.example/saffron-price" } } };
  const sparse = { keyword: "saffron threads", keyword_info: {}, keyword_properties: {}, search_intent_info: {} }; // the provider knows nothing about this one
  const ideas = { status_code: 20000, cost: 0.096, tasks: [{ status_code: 20000, id: "i1", cost: 0.096, result: [{ items: [{ ...rich, ...ranked }, sparse] }] }] }; // a ranked row carries the page that ACTUALLY ranks beside the metrics
  const seeds = (n: number) => Array.from({ length: n }, (_, i) => `theme ${String(i).padStart(3, "0")}`);
  it("batches 250 seeds into 2 paid requests at the documented 200 ceiling, never one per keyword", async () => {
    const h = harness(ideas); const results = await keywordIdeasBatched(seeds(250), IDS, h.deps); expect([results.length, h.calls.fetch.length]).toEqual([2, 2]); expect(h.calls.fetch.every((u) => u === BASE + "dataforseo_labs/google/keyword_ideas/live")).toBe(true);
    expect(h.calls.bodies.map((b) => (b[0].keywords as string[]).length)).toEqual([200, 50]); // ONE request per batch, not 250 requests
    expect(h.calls.bodies[0][0]).toMatchObject({ location_code: 2840, language_code: "en", limit: 700 }); // the documented default, under the provider's 1000 ceiling
    const capped = harness(ideas); await keywordIdeasBatched(seeds(3), IDS, capped.deps, 5000); expect(capped.calls.bodies[0][0].limit).toBe(1000); // a caller cannot ask past what the provider allows
  });
  it("keeps every metric the provider sent and leaves every one it did not as null, never 0", async () => {
    const h = harness(ideas); const r = (await keywordIdeasBatched(["saffron"], IDS, h.deps))[0]!; if (r.state !== "ok") throw new Error(r.state); const [got, blank] = parseCapability("labs_keyword_ideas", r.envelope)!; expect(got).toMatchObject({ keyword: "saffron price", searchVolume: 1200, competition: 0.21, competitionLevel: "low", cpcUsd: 0.9, difficulty: 34, intent: "commercial", rankedUrl: "https://mysite.example/saffron-price", rankedRank: 4 }); // rank_group IS the position; rank_absolute (7) counts ads and packs and is never read
    expect(got!.monthlySearches).toEqual([{ year: 2026, month: 6, volume: 1100 }, { year: 2026, month: 5, volume: null }]); // the trend survives; a month with no figure is unknown, not zero searches
    expect([blank!.searchVolume, blank!.difficulty, blank!.intent, blank!.competition, blank!.competitionLevel, blank!.rankedUrl, blank!.rankedRank, blank!.monthlySearches]).toEqual([null, null, null, null, null, null, null, null]); // no trend returned reads null, never an empty trend and never zeros
  });
  it("reserves BEFORE the call, reconciles down to the provider's actual, and reuses a cached equivalent instead of buying it twice", async () => {
    const order: string[] = []; let reserved = 0, delta = 0; const h = harness(ideas, { reserveProviderSpend: async (_t: string, _p: string, amount: number) => { order.push("reserve"); reserved = amount; return true; }, adjustProviderSpend: async (_t: string, _p: string, d: number) => { order.push("reconcile"); delta = d; return true; } });
    h.deps.fetchImpl = vi.fn(async () => { order.push("call"); return new Response(JSON.stringify(ideas), { status: 200 }); }) as unknown as typeof fetch; await keywordIdeasBatched(["saffron"], IDS, h.deps);
    expect(order).toEqual(["reserve", "call", "reconcile"]); expect(reserved).toBeGreaterThanOrEqual(0.132); // never held under the biggest charge this endpoint has ever produced
    expect(reserved + delta).toBeCloseTo(0.096, 5); // the reservation drops to what was actually charged
    const keys: string[] = []; const hit = harness(ideas, { claimEvidenceFetch: async (p: { cacheKey: string }) => { keys.push(p.cacheKey); return { outcome: "ready", payload: ideas, providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 }; } }); const same = await keywordIdeasBatched([" Saffron ", "rosewater", "saffron"], IDS, hit.deps); const flipped = await keywordIdeasBatched(["rosewater", "saffron"], IDS, hit.deps);
    expect([same[0]!.state, flipped[0]!.state, hit.calls.fetch.length]).toEqual(["hit", "hit", 0]); // a cached equivalent is served, nothing is re-bought
    expect(new Set(keys).size).toBe(1); // the same themes in any order, spelling or duplication are ONE identity
  });
});
describe("page intersection: ONE paid comparison for the whole page set", () => {
  const W1 = "https://alpha.example/guide", W2 = "https://beta.example/faq", W3 = "https://beta.example/guide", W4 = "https://beta.example/list", OWN = "https://mysite.example/saffron"; // canonical (sorted) slot order
  const at = (slot: string, rank: number, url: string) => ({ [slot]: { type: "organic", rank_group: rank, rank_absolute: rank + 2, url, title: "t", domain: new URL(url).hostname } });
  const kw = (keyword: string, info: Record<string, unknown>, intent: string | null, ranks: Record<string, unknown>) => ({ keyword_data: { keyword, keyword_info: info, search_intent_info: intent ? { main_intent: intent } : {} }, intersection_result: ranks });
  const answer = (items: unknown[] = []) => ({ status_code: 20000, cost: 0.024, tasks: [{ status_code: 20000, id: "pi-1", cost: 0.024, result: [{ items }] }] });
  it("sends ONE request numbering every page with the owner excluded, derives ONE identity from any order or unstated default, and re-serves it warm", async () => {
    const h = harness(answer()); const r1 = await providerCall("labs_page_intersection", { pages: [W2, W1, W3], exclude_pages: [OWN] }, IDS, h.deps);
    expect([h.calls.fetch.length, h.calls.fetch[0]]).toEqual([1, BASE + "dataforseo_labs/google/page_intersection/live"]); // the WHOLE set in ONE call: a request per page or per keyword is a defect, never a fallback
    expect(h.calls.bodies[0][0]).toMatchObject({ pages: { "1": W1, "2": W2, "3": W3 }, exclude_pages: [OWN], location_code: 2840, language_code: "en", intersection_mode: "union", item_types: ["organic"], limit: 100 });
    const f = harness(answer()); const r2 = await providerCall("labs_page_intersection", { pages: [W3, W1, W2, W1], exclude_pages: [OWN], intersection_mode: "union", limit: 100 }, IDS, f.deps); expect(("cacheKey" in r1 && r1.cacheKey) === ("cacheKey" in r2 && r2.cacheKey)).toBe(true); // a reorder, a duplicate and a spelled-out default are ONE identity, never two buys of the same rows
    const warm = harness(answer(), { claimEvidenceFetch: async () => ({ outcome: "ready", payload: answer(), providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 }) }); expect([(await providerCall("labs_page_intersection", { pages: [W1, W2] }, IDS, warm.deps)).state, warm.calls.fetch.length]).toEqual(["hit", 0]); // a warm repeat makes zero network calls
    const thin = harness(answer()); expect((await providerCall("labs_page_intersection", { pages: [W1, "mysite.example"] }, IDS, thin.deps)).state).toBe("error"); expect(thin.calls.fetch).toHaveLength(0); // fewer than two usable urls is refused BEFORE the money
    let reserved = 0; const cap = harness(answer(), { reserveProviderSpend: async (_t: string, _p: string, a: number) => { reserved = a; return true; } }); await providerCall("labs_page_intersection", { pages: [W1, W2], limit: 5000 }, IDS, cap.deps);
    expect([cap.calls.bodies[0][0].limit, reserved >= 0.132]).toEqual([1000, true]); // clamped to the documented ceiling, and never reserved under the biggest Labs live charge on file
  });
  it("keeps the slots, the excluded owner and every metric sent, nulls the rest, and counts one publisher holding three pages ONCE", async () => {
    const items = [kw("saffron grades", { search_volume: 2400, competition: 0.3, competition_level: "MEDIUM", cpc: 1.1, keyword_difficulty: 41 }, "informational", { ...at("1", 3, W1), ...at("2", 5, W2) }),
      kw("saffron price per gram", { search_volume: 9900 }, "informational", { ...at("2", 2, W2), ...at("3", 4, W3), ...at("4", 9, W4) }), // ONE publisher wearing three of the requested slots
      kw("buy saffron online", { search_volume: 1600 }, "transactional", { ...at("1", 6, W1), ...at("3", 7, W3) }), kw("saffron threads", {}, null, at("1", 8, W1))];
    const h = harness(answer(items)); const r = await providerCall("labs_page_intersection", { pages: [W1, W2, W3, W4], exclude_pages: [OWN] }, IDS, h.deps); if (r.state !== "ok") throw new Error(r.state);
    const p = parsePageIntersection(r.envelope, { pages: [W1, W2, W3, W4], exclude_pages: [OWN] }); expect(parseCapability("labs_page_intersection", r.envelope)!.keywords).toEqual(p.keywords); // the registry path reads the same rows; the ask is what names the slots
    expect([p.pages, p.excludePages, p.intersectionMode]).toEqual([[{ page: 1, url: W1 }, { page: 2, url: W2 }, { page: 3, url: W3 }, { page: 4, url: W4 }], [OWN], "union"]); expect(p.keywords[0]).toMatchObject({ keyword: "saffron grades", searchVolume: 2400, competition: 0.3, competitionLevel: "medium", difficulty: 41, mainIntent: "informational" });
    expect(p.keywords[0]!.ranks).toEqual([{ page: 1, url: W1, title: "t", rank: 3 }, { page: 2, url: W2, title: "t", rank: 5 }]); // rank_group IS the organic position; rank_absolute counts ads and packs
    expect([p.keywords[3]!.searchVolume, p.keywords[3]!.difficulty, p.keywords[3]!.mainIntent, p.keywords[3]!.competition, p.keywords[3]!.competitionLevel]).toEqual([null, null, null, null, null]); // unsent stays unknown, never 0
    const read = comparePageCoverage(p); expect([read.shared.map((s) => s.keyword), read.winnerPublishers, read.uncoveredByOwned.length]).toEqual([["saffron grades", "buy saffron online"], ["alpha.example", "beta.example"], 2]); // the three-slot publisher votes ONCE, so its 9,900 keyword never reads as shared
    expect([read.largestSearchVolume, read.keywordsWithVolume, read.ownedHost, read.ownedRepresentation, read.ownedCoverageShare, read.ownedHoldsMaterialShare, read.intent]).toEqual([2400, 2, "mysite.example", "excluded", null, null, "unknown"]); // the largest single figure plus a count, NEVER the 4,000 sum; an excluded owner is unmeasured, not zero
  });
});
describe("envelope parsing + method-aware resolution", () => {
  it("the Labs fixture through providerCall parses to nonempty keyword items, and a hit parses identically", async () => {
    const fresh = harness(labsKeywordsForSiteLive); const r1 = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, fresh.deps); if (r1.state !== "ok") throw new Error(r1.state); const parsed = parseCapability("labs_keywords_for_site", r1.envelope); expect(parsed?.length).toBe(2); expect(parsed![0]).toMatchObject({ keyword: "video editing app for ipad pro", searchVolume: 30, difficulty: 60, intent: "transactional" });
    const stored = fresh.calls.writes.find((w) => w.status === "ready")!.payload; const hit = harness(labsKeywordsForSiteLive, { claimEvidenceFetch: async () => ({ outcome: "ready", payload: stored, providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 }) });
    const r2 = await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, hit.deps); if (r2.state !== "hit") throw new Error(r2.state); expect(hit.calls.fetch).toHaveLength(0); expect(parseCapability("labs_keywords_for_site", r2.envelope)).toEqual(parsed);
    let reserved = 0; const ov = harness(labsKeywordsForSiteLive, { reserveProviderSpend: async (_t: string, _p: string, amount: number) => { reserved = amount; return true; } }); await providerCall("labs_keyword_overview", { keywords: ["a"] }, IDS, ov.deps); expect(reserved).toBeGreaterThanOrEqual(700 * 0.0003); }); // 150 keywords really charged $0.02988, so a FULL 700-keyword batch lands near $0.21: never reserved under it
  it("asks ranked_keywords for ORGANIC rankings only, so an ad this account bought is never one of its own pages", async () => {
    // The endpoint defaults to organic AND paid, so one page ranking once organically and once as an ad came back as two pages of mine, which is the whole arithmetic behind calling a search a consolidation.
    const rk = harness(labsKeywordsForSiteLive); await providerCall("labs_ranked_keywords", { target: "apple.com" }, IDS, rk.deps);
    expect(rk.calls.bodies[0]![0]).toMatchObject({ target: "apple.com", location_code: 2840, language_code: "en", item_types: ["organic"] });
    const site = harness(labsKeywordsForSiteLive); await providerCall("labs_keywords_for_site", { target: "apple.com" }, IDS, site.deps);
    expect("item_types" in site.calls.bodies[0]![0]!).toBe(false); }); // the site pull claims no ranking of mine, so it sends no such filter
  it("the SERP fixture yields organic, PAA, related, AI Overview; an LLM answer lists web citations", async () => {
    const serp = parseCapability("serp_organic", serpTaskGetAdvanced as unknown as ProviderEnvelope); expect(serp!.organic.map((o) => o.domain)).toEqual(["python.org", "w3schools.com"]); expect(serp!.paaQuestions).toHaveLength(2); expect(serp!.relatedSearches).toHaveLength(3); expect(serp!.aiOverview?.references.map((r) => r.domain)).toEqual(["python.org", "wikipedia.org"]);
    const { deps } = harness(llmResponsesTaskGet, { cacheRead: async () => taskRow("ai_optimization/chat_gpt/llm_responses/task_post", { cost_usd: 0 }) }); const res = await collectCapability("k", deps); if (res.state !== "ok") throw new Error(res.state); const ans = parseCapability("llm_chatgpt", res.envelope); expect([ans!.webSearchReported, ans!.citations?.map((c) => c.domain), ans!.fanOutQueries?.length]).toEqual([true, ["runnersworld.com", "wirecutter.com"], 2]);
    // An annotation knows WHICH WORDS it backs, and the ask's own token and money receipt rides home with it.
    expect(ans!.citations![0]).toMatchObject({ startIndex: 4, endIndex: 20, passage: "Brand X Runner" }); expect(ans!.usage).toEqual({ inputTokens: 12, outputTokens: 88, reasoningTokens: 0, moneySpentUsd: 0.03 });
    const bare = parseCapability("llm_chatgpt", { status_code: 20000, tasks: [{ result: [{ items: [{ type: "message", sections: [{ type: "text", text: "hi", annotations: [{ url: "https://x.example/a" }] }] }] }] }] }); // an envelope reporting none of it stores absence, never a zero
    expect([bare!.usage, bare!.citations![0]!.startIndex, "passage" in bare!.citations![0]!]).toEqual([null, undefined, false]); });
  it("resolution prefers Standard + web, fails closed when unavailable, and uses the unconfigured fallback", async () => {
    expect(await resolveEngineModel("chatgpt", harness(chatgptModels).deps)).toMatchObject({ model: "gpt-4o", method: "standard", webSearch: true }); // NOT gpt-5
    expect(await resolveEngineModel("perplexity", harness(perplexityModels).deps)).toMatchObject({ model: "sonar-reasoning-pro", method: "live", webSearch: true }); expect(await resolveEngineModel("chatgpt", harness({}, { fetchImpl: vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch }).deps)).toBeNull(); // fail closed
    const off = harness({}, { env: {} }); expect(await resolveEngineModel("gemini", off.deps)).toMatchObject({ model: "gemini-2.5-flash", method: "live", webSearch: true }); expect(off.calls.fetch).toHaveLength(0); });
  it("a model-cache READ FAILURE fails closed: no model, a bounded no-model result, and ZERO provider calls", async () => {
    const outage = harness(llmResponsesTaskPostAck, { modelsBody: STD, cacheRead: async () => { throw new Error("records down"); } }); expect(await resolveEngineModel("chatgpt", outage.deps)).toBeNull(); // a records outage is NOT a cache miss
    const noModel = await providerCall("llm_chatgpt", { user_prompt: "hi", web_search: true }, IDS, outage.deps); expect([noModel.state, noModel.state === "not_configured" && noModel.detail.includes("usable chatgpt model"), outage.calls.fetch.length]).toEqual(["not_configured", true, 0]); // not even the FREE models GET
  });
});
