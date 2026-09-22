import "server-only";
import { PROOF_SPEND, spendingClosed } from "@/lib/spend-scope"; import { CREDIT_BREAKER } from "@/lib/cost/credit-breaker";
import { createHash } from "node:crypto";
import { isDataForSeoConfigured, runDataForSeoTransport } from "./client";
import { collectResolvedTask, identityCacheKey, runResolvedCall, type ResolvedCall } from "./cached-call";
import { resolveDeps } from "./default-deps";
import { normalizePageIntersection, parsePageIntersection, MAX_INTERSECTION_PAGES } from "../page-intersection";
import { freshnessMsFor } from "../freshness";
import { mainOf } from "../funnel/research-evidence";
import type { CachedCallResult, CapabilityInputByKey, CapabilityKey, EngineModelResolution, FunnelBoundaryDeps, ObservationIdentity, ParsedAiAnswer, ParsedByCapability, ParsedKeywordItem, ParsedSerp, ProviderEnvelope } from "./funnel-boundary";
const DFS_API_BASE = "https://api.dataforseo.com/v3";
const LOCATION_US = 2840, LANG_EN = "en", DAY = 86_400_000;
const MAX_IDEAS_SEEDS = 200, IDEAS_DEFAULT_LIMIT = 700, IDEAS_MAX_LIMIT = 1000; // documented keyword_ideas seed ceiling, default and max limit, in ONE place so the ask and the built body agree
/** serp_competitors documents the SAME 200-keyword ceiling and a limit defaulting to 100, maxing at 1000. Beacon asks for 50: a case wants the handful of domains that keep coming up, not a directory. (docs: serp_competitors/live, 2026-07-31) */
const COMPETITORS_SEEDS = 200, COMPETITORS_LIMIT = 50, COMPETITORS_MAX_LIMIT = 1000, MAX_COMPETITOR_ROWS = 50;
/** Documented llm_responses output bound; reasoning/search can exceed it, so this is not a spend guarantee. */
const LLM_MAX_OUTPUT_TOKENS = 2048;
type LlmEngine = "chatgpt" | "gemini" | "claude" | "perplexity";
const ENGINE_SLUG: Record<LlmEngine, string> = { chatgpt: "chat_gpt", gemini: "gemini", claude: "claude", perplexity: "perplexity" };
/** tasksReady = the FREE GET listing of finished-but-uncollected tasks, the only AUTOMATIC recovery a quarantined row ever gets. Null on Live routes. */
type Route = { mode: "live" | "task"; postPath: string; getPath: ((id: string) => string) | null; tasksReady: string | null };

type Entry<K extends CapabilityKey> = {
  ttlMs: number;
  estCostUsd: number;
  requestTimeoutMs?: number;
  dims: { device: boolean; model: boolean };
  engine?: LlmEngine;
  route: (r: EngineModelResolution | null) => Route;
  normalize?: (input: CapabilityInputByKey[K]) => CapabilityInputByKey[K];
  build: (input: CapabilityInputByKey[K], r: EngineModelResolution | null) => unknown[];
  parse: (env: ProviderEnvelope) => ParsedByCapability[K];
};
type Registry = { [K in CapabilityKey]: Entry<K> };
class MissingFieldsError extends Error { constructor(cap: string, missing: string[]) {
  super(`capability ${cap}: missing required field(s): ${missing.join(", ")}`); this.name = "MissingFieldsError"; } }
/** ChatGPT supports web_search, not force_web_search or country (llm_responses docs, 2026-07-26). */
function chatGptBuild(i: CapabilityInputByKey["llm_chatgpt"], r: EngineModelResolution | null): unknown[] {
  const web = r?.webSearch === true && i.web_search === true;
  return [clean({ user_prompt: i.user_prompt, model_name: r?.model, max_output_tokens: LLM_MAX_OUTPUT_TOKENS, web_search: web ? true : undefined })];
}
/** Claude supports force and country only with web search enabled (llm_responses docs, 2026-07-26). */
function claudeBuild(i: CapabilityInputByKey["llm_claude"], r: EngineModelResolution | null): unknown[] {
  const web = r?.webSearch === true && i.web_search === true;
  return [clean({ user_prompt: i.user_prompt, model_name: r?.model, max_output_tokens: LLM_MAX_OUTPUT_TOKENS,
    web_search: web ? true : undefined, force_web_search: web && i.force_web_search === true ? true : undefined,
    web_search_country_iso_code: web ? i.web_search_country_iso_code : undefined })];
}
/** Gemini: web_search ONLY; never force_web_search/country (undocumented for Gemini). (docs: gemini llm_responses/task_post + /live, 2026-07-26) */
function geminiBuild(i: CapabilityInputByKey["llm_gemini"], r: EngineModelResolution | null): unknown[] {
  const web = r?.webSearch === true && i.web_search === true;
  return [clean({ user_prompt: i.user_prompt, model_name: r?.model, max_output_tokens: LLM_MAX_OUTPUT_TOKENS, web_search: web ? true : undefined })];
}
/** Perplexity Live: web_search is on by default (not a request field); only web_search_country_iso_code is documented. (docs: perplexity live 2026-07-26) */
function perplexityBuild(i: CapabilityInputByKey["llm_perplexity"], r: EngineModelResolution | null): unknown[] {
  return [clean({ user_prompt: i.user_prompt, model_name: r?.model, max_output_tokens: LLM_MAX_OUTPUT_TOKENS, web_search_country_iso_code: i.web_search_country_iso_code })];
}
/** Scraper is KEYWORD-based (never user_prompt/model_name), REQUIRES location + language, and expand_citations REQUIRES force_web_search. (docs: chat_gpt llm_scraper/task_post, 2026-07-24) */
function scraperBuild(i: CapabilityInputByKey["llm_scraper_chatgpt"]): unknown[] {
  const forceWeb = i.force_web_search === true;
  if (i.expand_citations === true && !forceWeb) throw new MissingFieldsError("llm_scraper_chatgpt", ["force_web_search (required to enable expand_citations)"]);
  return [clean({ keyword: i.keyword, location_code: LOCATION_US, language_code: LANG_EN,
    force_web_search: forceWeb ? true : undefined,
    expand_citations: forceWeb && i.expand_citations === true ? true : undefined })];
}
function llmIdentity<T extends ObservationIdentity>(i: T): T {
  const { observation_day: day, sample_slot: slot, ...rest } = i;
  return { ...rest, ...(typeof day === "string" && day.length > 0 ? { observation_day: day } : {}),
    ...(typeof slot === "number" && slot > 0 ? { sample_slot: Math.trunc(slot) } : {}) } as T;
}

function labsEntry<K extends "labs_keywords_for_site" | "labs_ranked_keywords" | "labs_related_keywords" | "labs_keyword_suggestions">(
  postPath: string, keyField: "target" | "keyword", estCostUsd: number, fixed: Record<string, unknown> = {}): Entry<K> {
  return {
    ttlMs: 7 * DAY, estCostUsd, dims: { device: false, model: false },
    route: () => ({ mode: "live", postPath, getPath: null, tasksReady: null }),
    build: (i) => [{ [keyField]: (i as Record<string, unknown>)[keyField], location_code: LOCATION_US, language_code: LANG_EN, limit: (i as { limit?: number }).limit ?? 200, ...fixed }],
    parse: parseKeywords,
  };
}
const SERP_DEPTH = 20; // how far down one results page is read: two full pages, enough to decide an owned position in the teens, still one billed request
function serpEntry<K extends "serp_organic" | "serp_ai_mode">(base: string, estCostUsd: number, depth?: number): Entry<K> {
  return {
    ttlMs: 1 * DAY, estCostUsd, dims: { device: true, model: false },
    route: () => ({ mode: "task", postPath: `${base}/task_post`, getPath: (id) => `${base}/task_get/advanced/${id}`, tasksReady: `${base}/tasks_ready` }),
    build: (i) => [{ keyword: i.keyword, location_code: LOCATION_US, language_code: LANG_EN, device: i.device ?? "desktop", ...(depth ? { depth: (i as { depth?: number }).depth ?? depth } : {}),
      // THE OVERVIEW IS ASYNCHRONOUS UNLESS IT IS ASKED FOR. Without this flag the ai_overview block comes back an empty stub, so the reference list and the text it cites were never in the payload at all.
      ...((i as { loadAiOverview?: boolean }).loadAiOverview ? { load_async_ai_overview: true } : {}) }],
    parse: parseSerp,
  };
}
function llmDynamicRoute(engine: LlmEngine): (r: EngineModelResolution | null) => Route {
  const slug = ENGINE_SLUG[engine];
  const standard: Route = { mode: "task", postPath: `ai_optimization/${slug}/llm_responses/task_post`, getPath: (id) => `ai_optimization/${slug}/llm_responses/task_get/${id}`, tasksReady: `ai_optimization/${slug}/llm_responses/tasks_ready` };
  const live: Route = { mode: "live", postPath: `ai_optimization/${slug}/llm_responses/live`, getPath: null, tasksReady: null };
  return (r) => (r?.method === "standard" ? standard : live);
}
/** LLM pricing (DataForSEO, 2026-07-26): Standard $0.0002 + $0.01 refundable prepayment; Live $0.0006 + tokens. $0.035 estimates, not a guaranteed search/token cap. */
function llmDynamicEntry<K extends "llm_chatgpt" | "llm_gemini" | "llm_claude">(engine: LlmEngine, build: Entry<K>["build"]): Entry<K> {
  return { ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true }, engine, route: llmDynamicRoute(engine), normalize: llmIdentity, build, parse: parseLlmAnswer };
}
/** Labs receipts (2026-07-25): 50 rows $0.018, 150 $0.02988, 1000 $0.132. Reserve above observed maximum; reconcile actual cost. */
const REGISTRY: Registry = {
  labs_keywords_for_site: labsEntry("dataforseo_labs/google/keywords_for_site/live", "target", 0.2),
  // Organic only: paid placements are not winning pages (ranked_keywords/live docs, 2026-07-31).
  labs_ranked_keywords: labsEntry("dataforseo_labs/google/ranked_keywords/live", "target", 0.2, { item_types: ["organic"] }),
  labs_related_keywords: labsEntry("dataforseo_labs/google/related_keywords/live", "keyword", 0.2),
  labs_keyword_suggestions: labsEntry("dataforseo_labs/google/keyword_suggestions/live", "keyword", 0.2),
  // Reserve $0.25 for 700 keywords (~$0.21); monthly freshness follows the canonical matrix.
  labs_keyword_overview: {
    ttlMs: freshnessMsFor("keyword_volume"), estCostUsd: 0.25, dims: { device: false, model: false },
    normalize: (i) => ({ keywords: [...new Set(i.keywords.map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean))].sort().slice(0, 700) }),
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/keyword_overview/live", getPath: null, tasksReady: null }),
    build: (i) => [{ keywords: i.keywords.slice(0, 700), location_code: LOCATION_US, language_code: LANG_EN }], parse: parseKeywords,
  },
  // Reserved at 0.2 on the arithmetic above: 700 rows lands near $0.096 and the 1000-row ceiling near $0.132.
  labs_keyword_ideas: {
    ttlMs: freshnessMsFor("keyword_volume"), estCostUsd: 0.2, dims: { device: false, model: false },
    normalize: (i) => ({ ...i, keywords: [...new Set(i.keywords.map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean))].sort().slice(0, MAX_IDEAS_SEEDS), limit: Math.min(Math.max(1, Math.trunc(i.limit ?? IDEAS_DEFAULT_LIMIT)), IDEAS_MAX_LIMIT) }), // normalized BEFORE the identity: a direct call skipped the batched helper and re-bought the same rows
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/keyword_ideas/live", getPath: null, tasksReady: null }),
    build: (i) => [{ keywords: i.keywords.slice(0, MAX_IDEAS_SEEDS), location_code: LOCATION_US, language_code: LANG_EN, limit: Math.min(Math.max(1, Math.trunc(i.limit ?? IDEAS_DEFAULT_LIMIT)), IDEAS_MAX_LIMIT) }], parse: parseKeywords,
  },
  // Weekly domain evidence per case's keyword set; reserve $0.05 above the documented $0.0105 example (serp_competitors/live, 2026-07-31).
  labs_serp_competitors: {
    ttlMs: 7 * DAY, estCostUsd: 0.05, dims: { device: false, model: false },
    normalize: (i) => ({ keywords: [...new Set(i.keywords.map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean))].sort().slice(0, COMPETITORS_SEEDS), limit: Math.min(Math.max(1, Math.trunc(i.limit ?? COMPETITORS_LIMIT)), COMPETITORS_MAX_LIMIT) }),
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/serp_competitors/live", getPath: null, tasksReady: null }),
    build: (i) => {
      if (i.keywords.length === 0) throw new MissingFieldsError("labs_serp_competitors", [`keywords (1 to ${COMPETITORS_SEEDS} keywords)`]);
      return [{ keywords: i.keywords, location_code: LOCATION_US, language_code: LANG_EN, item_types: ["organic"], limit: Math.min(Math.max(1, Math.trunc(i.limit ?? COMPETITORS_LIMIT)), COMPETITORS_MAX_LIMIT) }];
    },
    parse: parseSerpCompetitors,
  },
  // One request for the whole page set; reserve $0.2 above the largest observed Labs charge.
  labs_page_intersection: {
    ttlMs: 7 * DAY, estCostUsd: 0.2, dims: { device: false, model: false }, normalize: normalizePageIntersection,
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/page_intersection/live", getPath: null, tasksReady: null }),
    build: (i) => {
      if (i.pages.length < 2) throw new MissingFieldsError("labs_page_intersection", [`pages (2 to ${MAX_INTERSECTION_PAGES} absolute http/https urls)`]);
      return [clean({ pages: Object.fromEntries(i.pages.map((u, n) => [String(n + 1), u])), exclude_pages: i.exclude_pages?.length ? i.exclude_pages : undefined,
        location_code: LOCATION_US, language_code: LANG_EN, intersection_mode: i.intersection_mode, item_types: ["organic"], limit: i.limit })];
    },
    parse: parsePageIntersection,
  },
  // Public competitor text fallback; owned-page structure uses the separate DOM capability below.
  onpage_content_parsing: {
    ttlMs: 7 * DAY, estCostUsd: 0.002, dims: { device: false, model: false },
    normalize: (i) => ({ url: canonicalUrl(i.url) }), // one URL, one identity: a #fragment never buys twice
    route: () => ({ mode: "live", postPath: "on_page/content_parsing/live", getPath: null, tasksReady: null }),
    build: (i) => [{ url: i.url, enable_javascript: true, accept_language: LANG_EN, ip_pool_for_scan: "us" }], parse: parseContentParsing,
  },
  onpage_rendered_html: {
    ttlMs: freshnessMsFor("owned_page"), estCostUsd: 0.002, requestTimeoutMs: 45_000, dims: { device: false, model: false },
    normalize: (i) => ({ url: canonicalUrl(i.url), ...(i.revision ? { revision: i.revision } : {}) }),
    route: () => ({ mode: "live", postPath: "on_page/instant_pages", getPath: null, tasksReady: null }),
    // JS pricing: $0.0015/page (DataForSEO OnPage pricing, 2026-09-22); reserve above it.
    build: (i) => [{ url: i.url, enable_javascript: true, enable_xhr: true, return_despite_timeout: false,
      accept_language: LANG_EN, ip_pool_for_scan: "us",
      custom_js: String.raw`(function () {
        var root = document.documentElement.cloneNode(true), nodes = root.querySelectorAll('script,style');
        for (var i = nodes.length - 1; i >= 0; i--) {
          var node = nodes[i];
          if (node.tagName.toLowerCase() !== 'script' || (node.getAttribute('type') || '').trim().toLowerCase() !== 'application/ld+json') node.parentNode.removeChild(node);
        }
        var html = root.outerHTML, dictionary = [], counts = Object.create(null), ids = Object.create(null), indices = '', alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var result = { url: document.URL, readyState: document.readyState, capturedAt: new Date().toISOString(), complete: false, codec: 'tokens-ascii-v1', dictionary: dictionary, indices: '', htmlChars: html.length };
        if (!html.length || html.length > 2000000) return result;
        var tokens = /[A-Za-z0-9_$-]+|[^A-Za-z0-9_$-]+/g, match; // Jint doubles backing arrays: 8192 is the last capacity below its 10000 ceiling.
        while ((match = tokens.exec(html)) !== null) {
          var word = match[0];
          if (counts[word] === undefined) { if (dictionary.length === 8192) { result.dictionary = []; return result; } counts[word] = 0; dictionary.push(word); }
          counts[word]++;
        }
        dictionary.sort(function (a, b) { return counts[b] - counts[a]; });
        for (i = 0; i < dictionary.length; i++) ids[dictionary[i]] = i;
        tokens.lastIndex = 0;
        while ((match = tokens.exec(html)) !== null) {
          var id = ids[match[0]];
          while (id >= 32) { indices += alphabet.charAt(id % 32 + 32); id = Math.floor(id / 32); }
          indices += alphabet.charAt(id);
        }
        result.indices = indices; result.complete = true;
        if (JSON.stringify(result).length > 100000) { result.dictionary = []; result.indices = ''; result.complete = false; }
        return result;
      })()` }],
    parse: parseRenderedHtml,
  },
  serp_organic: serpEntry("serp/google/organic", 0.0021, SERP_DEPTH),
  serp_ai_mode: serpEntry("serp/google/ai_mode", 0.01),
  llm_chatgpt: llmDynamicEntry("chatgpt", chatGptBuild),
  llm_gemini: llmDynamicEntry("gemini", geminiBuild),
  llm_claude: llmDynamicEntry("claude", claudeBuild),
  llm_perplexity: {
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true }, engine: "perplexity",
    route: () => ({ mode: "live", postPath: "ai_optimization/perplexity/llm_responses/live", getPath: null, tasksReady: null }),
    normalize: llmIdentity, build: perplexityBuild, parse: parseLlmAnswer,
  },
  llm_scraper_chatgpt: {
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: false },
    route: () => ({ mode: "task", postPath: "ai_optimization/chat_gpt/llm_scraper/task_post", getPath: (id) => `ai_optimization/chat_gpt/llm_scraper/task_get/advanced/${id}`, tasksReady: "ai_optimization/chat_gpt/llm_scraper/tasks_ready" }),
    normalize: llmIdentity, build: scraperBuild, parse: parseScraper,
  },
};
export const capabilityAskable = (capability: string): boolean => Object.hasOwn(REGISTRY, capability);
export async function providerCall<K extends CapabilityKey>(
  capability: K, input: CapabilityInputByKey[K], ids: { tenantId: string; unitKey: string; runId?: string; caseKey?: string; promptId?: string }, deps: FunnelBoundaryDeps = {},
): Promise<CachedCallResult> {
  const proof = PROOF_SPEND.externalClosed(ids.tenantId, { capability, url: String((input as { url?: string }).url ?? "") });
  if (proof === true || proof == null && await spendingClosed(ids.tenantId)) return { state: "capped", cacheKey: null, detail: "Research is paused for this account, so nothing was bought. This is owed, not failed." };
  const peek = (deps as { creditPeek?: typeof CREDIT_BREAKER.peek }).creditPeek ?? CREDIT_BREAKER.peek; // AND NO PAID POST WHILE THE MODEL DOOR IS HELD (2026-09-14): research bought with no credit to reason on it is money spent on a queue nobody can read. The free GET collects never pass here.
  if (await peek(ids.tenantId).catch(() => "clear" as const) === "held") return { state: "capped", cacheKey: null, detail: CREDIT_BREAKER.sentence("openai") };
  if (await peek(ids.tenantId, {}, "dataforseo").catch(() => "clear" as const) === "held") return { state: "capped", cacheKey: null, detail: CREDIT_BREAKER.sentence("dataforseo") }; // AND NO POST WHILE THE SEARCH PROVIDER ITSELF IS DRY (2026-09-15): every search answered 402 for an hour, each refusal was refunded and counted, and no surface said the balance was empty
  const entry = REGISTRY[capability];
  let resolution: EngineModelResolution | null = null, modelRequested: string | null = null;
  if (entry.engine) { // ONE resolution: the method routes the call AND the model rides the request
    resolution = await resolveEngineModel(entry.engine, deps);
    if (!resolution) return { state: "not_configured", cacheKey: null, detail: `No usable ${entry.engine} model is available to ask right now. It is tried again on the next pass.` };
    modelRequested = resolution.model;
  }
  const route = entry.route(resolution);
  const ask = (entry.normalize ? entry.normalize(input) : input) as CapabilityInputByKey[K];
  let payload: unknown[];
  try {
    payload = entry.build(ask, resolution);
  } catch (err) {
    return { state: "error", cacheKey: null, disposition: "none", detail: err instanceof Error ? err.message : String(err) };
  }
  const device = entry.dims.device ? ((ask as { device?: string }).device ?? "desktop") : null;
  const modelDim = entry.dims.model ? modelRequested : null;
  const publicInput = (ask ?? {}) as Record<string, unknown>;
  const cacheKey = identityCacheKey({ endpoint: route.postPath, publicInput, providerPayload: payload, locationCode: LOCATION_US, languageCode: LANG_EN, device, modelRequested: modelDim });
  const resolved: ResolvedCall = {
    capability,
    cacheKey, endpoint: route.postPath, endpointVersion: "v3", postPath: route.postPath, getPath: route.getPath,
    tasksReadyPath: route.tasksReady,
    publicInput, locationCode: LOCATION_US, languageCode: LANG_EN, device, modelRequested: modelDim,
    payload, ttlMs: entry.ttlMs, estCostUsd: entry.estCostUsd, mode: route.mode, tenantId: ids.tenantId,
    requestTimeoutMs: entry.requestTimeoutMs,
    purpose: ids.unitKey.startsWith("fact-check:") ? "fact_check" : "bulk", // the daily gate holds the fact-check reserve on it
    who: { unitKey: ids.unitKey, ...(ids.runId ? { runId: ids.runId } : {}), ...(ids.caseKey ? { caseKey: ids.caseKey } : {}), ...(ids.promptId ? { promptId: ids.promptId } : {}) },
  };
  const result = await runResolvedCall(resolved, deps);
  if (modelRequested && (result.state === "ok" || result.state === "waiting")) return { ...result, modelRequested };
  return result;
}
/** Normalized seeds share cached requests of up to 200; refusal or a ceiling stops the batch. */
export async function keywordIdeasBatched(
  seeds: string[], ids: { tenantId: string; unitKey: string }, deps: FunnelBoundaryDeps = {}, limit?: number,
): Promise<CachedCallResult[]> {
  const cleaned = [...new Set((seeds ?? []).map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean))].sort();
  const out: CachedCallResult[] = [];
  const asked = Math.min(Math.max(1, Math.trunc(limit ?? IDEAS_DEFAULT_LIMIT)), IDEAS_MAX_LIMIT);
  for (let i = 0; i < cleaned.length; i += MAX_IDEAS_SEEDS) {
    const input = { keywords: cleaned.slice(i, i + MAX_IDEAS_SEEDS), limit: asked };
    const r = await providerCall("labs_keyword_ideas", input, ids, deps);
    out.push(r);
    if (r.state === "capped" || (r.state === "error" && (r.disposition === "blocked" || r.disposition === "daily_limit"))) break;
  }
  return out;
}
export async function collectCapability(cacheKey: string, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  return collectResolvedTask(cacheKey, { getPath: getPathForEndpoint, tasksReadyPath: tasksReadyForEndpoint, ttlMsFor: ttlMsForEndpoint }, deps);
}
const ttlMsForEndpoint = (endpoint: string): number | null => (endpoint.endsWith("/task_post") ? DAY : null);
function getPathForEndpoint(endpoint: string, id: string): string | null {
  if (!endpoint.endsWith("/task_post")) return null;
  const base = endpoint.slice(0, -"/task_post".length);
  if (endpoint.startsWith("serp/") || endpoint.includes("/llm_scraper/")) return `${base}/task_get/advanced/${id}`;
  if (endpoint.includes("/llm_responses/")) return `${base}/task_get/${id}`;
  return null;
}
/** Every Standard family exposes free <base>/tasks_ready (DataForSEO docs, 2026-07-26). */
function tasksReadyForEndpoint(endpoint: string): string | null {
  return endpoint.endsWith("/task_post") ? `${endpoint.slice(0, -"/task_post".length)}/tasks_ready` : null;
}
export function parseCapability<K extends CapabilityKey>(capability: K, envelope: ProviderEnvelope): ParsedByCapability[K] | null {
  try { return REGISTRY[capability].parse(envelope) as ParsedByCapability[K]; } catch { return null; } }
/** Labeled fallbacks (docs, 2026-07-24), used only when credentials are absent: chatgpt/claude standard, gemini/perplexity live. */
const FALLBACK: Record<LlmEngine, EngineModelResolution> = {
  chatgpt: { model: "gpt-4o", method: "standard", webSearch: true },
  claude: { model: "claude-sonnet-4-20250514", method: "standard", webSearch: true },
  gemini: { model: "gemini-2.5-flash", method: "live", webSearch: true },
  perplexity: { model: "sonar", method: "live", webSearch: true },
};
export async function resolveEngineModel(engine: LlmEngine, deps: FunnelBoundaryDeps = {}): Promise<EngineModelResolution | null> {
  const d = resolveDeps(deps);
  if (!isDataForSeoConfigured(d.env)) return FALLBACK[engine];
  const path = `ai_optimization/${ENGINE_SLUG[engine]}/llm_responses/models`;
  const cacheKey = "dfsmodels_" + sha256(path).slice(0, 32);
  const now = d.now();
  let envelope: ProviderEnvelope | null = null;
  // Store failure closes spending, including free models GET; a confirmed cache miss may fetch.
  let row: Awaited<ReturnType<typeof d.cacheRead>>;
  try { row = await d.cacheRead(cacheKey); } catch { return null; }
  if (row && row.status === "ready" && row.payload != null && Date.parse(row.expires_at) > now.getTime()) {
    envelope = row.payload as ProviderEnvelope;
  } else {
    const t = await runDataForSeoTransport({ url: `${DFS_API_BASE}/${path}`, payload: [], env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-models", method: "GET" });
    if (t.ok && (t.body as { status_code?: number } | null)?.status_code === 20000) {
      envelope = t.body as ProviderEnvelope;
      await d.cacheUpsert(cacheKey, {
        endpoint: path, endpoint_version: "v3", input_hash: sha256(path).slice(0, 40), input_summary: `models:${engine}`,
        location_code: 0, language_code: "", status: "ready", payload: envelope, cost_usd: 0,
        ready_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * DAY).toISOString(), fetch_claimed_until: null,
      }).catch(() => {});
    }
  }
  if (!envelope) return null;
  return selectResolution(modelObjects(envelope));
}
function selectResolution(models: Record<string, unknown>[]): EngineModelResolution | null {
  if (models.length === 0) return null;
  const web = (m: Record<string, unknown>) => m.web_search_supported === true;
  const post = (m: Record<string, unknown>) => m.task_post_supported === true;
  const chosen = models.find((m) => web(m) && post(m)) ?? models.find(web) ?? models.find(post) ?? models[0];
  const model = str(chosen.model_name);
  if (!model) return null;
  return { model, method: post(chosen) ? "standard" : "live", webSearch: web(chosen) };
}

function resultBlock(env: ProviderEnvelope): { result0: Record<string, unknown> | null; items: Record<string, unknown>[] } {
  const result = env.tasks?.[0]?.result;
  const result0 = (Array.isArray(result) ? (result[0] as Record<string, unknown> | undefined) : (result as Record<string, unknown> | undefined)) ?? null;
  const items = Array.isArray(result0?.items) ? (result0!.items as Record<string, unknown>[]) : [];
  return { result0, items };
}
function parseKeywords(env: ProviderEnvelope): ParsedKeywordItem[] {
  return resultBlock(env).items.map((raw) => {
    const it = (raw.keyword_data ?? raw) as Record<string, unknown>;
    const ki = (it.keyword_info ?? {}) as Record<string, unknown>;
    const kp = (it.keyword_properties ?? {}) as Record<string, unknown>;
    const si = (it.search_intent_info ?? {}) as Record<string, unknown>;
    // A metric the provider did not send stays NULL: "I do not know the difficulty" and "the difficulty is 0" are different claims and the second is a lie. An absent trend reads null rather than empty.
    const ms = Array.isArray(ki.monthly_searches) ? (ki.monthly_searches as Record<string, unknown>[]) : null;
    // ranked_keywords carries the page that ACTUALLY ranks in ranked_serp_element.serp_item. rank_group is the organic position; rank_absolute counts ads and packs. Absent elsewhere -> null.
    const rse = ((raw.ranked_serp_element ?? {}) as Record<string, unknown>).serp_item as Record<string, unknown> | undefined;
    return {
      keyword: String(it.keyword ?? raw.keyword ?? ""),
      searchVolume: num(ki.search_volume), cpcUsd: num(ki.cpc), competition: num(ki.competition),
      competitionLevel: level(ki.competition_level), rankedUrl: str(rse?.url), rankedRank: num(rse?.rank_group),
      difficulty: num(kp.keyword_difficulty), intent: str(si.main_intent),
      monthlySearches: ms === null ? null : ms.map((m) => ({ year: Number(m.year), month: Number(m.month), volume: num(m.search_volume) })).filter((m) => Number.isFinite(m.year) && Number.isFinite(m.month)),
    };
  }).filter((k) => k.keyword.length > 0);
}
function parseSerpCompetitors(env: ProviderEnvelope): ParsedByCapability["labs_serp_competitors"] {
  return resultBlock(env).items.slice(0, MAX_COMPETITOR_ROWS).map((it) => ({
    domain: String(it.domain ?? ""), avgPosition: num(it.avg_position), rating: num(it.rating), keywordsCount: num(it.keywords_count),
  })).filter((c) => c.domain.length > 0);
}
/** WHAT EACH BLOCK ACTUALLY SAYS IS BOUNDED WHERE IT IS PARSED, so no unbounded provider prose can ever reach a stored row: a result snippet at 400 characters, an answer box or a People Also Ask answer at 600, the AI Overview's own words at 1,200. Whitespace collapses first, and a string that empties out reads null rather than "". */
const SNIPPET_MAX = 400, ANSWER_MAX = 600, OVERVIEW_MAX = 1200;
const cut = (v: unknown, n: number): string | null => { const s = str(v); return s ? s.replace(/\s+/g, " ").trim().slice(0, n) || null : null; };
function parseSerp(env: ProviderEnvelope): ParsedSerp {
  const { result0, items } = resultBlock(env);
  const sub = (t: string): Record<string, unknown>[] => { const b = items.find((i) => i.type === t); return Array.isArray(b?.items) ? (b!.items as Record<string, unknown>[]) : []; };
  const organic = items.filter((i) => i.type === "organic").map((i) => ({ // rank_group IS the organic position; rank_absolute counts ads and packs, so it read result 1 as "#2"
    rank: Number(i.rank_group ?? i.rank_absolute ?? 0), domain: String(i.domain ?? ""), url: String(i.url ?? ""), title: str(i.title), snippet: cut(i.description ?? i.snippet, SNIPPET_MAX),
  }));
  // Preserve SERP structure and snippet ownership; unreported blocks stay unknown, never absent.
  const itemTypes = Array.isArray(result0?.item_types) ? (result0!.item_types as unknown[]).map((t) => String(t)).filter(Boolean) : null;
  const snip = items.find((i) => i.type === "featured_snippet");
  const featuredSnippet = snip ? { url: String(snip.url ?? ""), domain: String(snip.domain ?? hostname(String(snip.url ?? ""))), title: str(snip.title), text: cut(snip.description ?? snip.text, ANSWER_MAX) } : itemTypes == null ? undefined : null;
  // WHOSE PAGE ANSWERS THE FOLLOW-UP QUESTION AND WHAT THE ANSWER SAYS, off the expanded element the provider sends inside each row (docs: serp/google/organic task_get/advanced, people_also_ask_expanded_element).
  const paaQuestions = sub("people_also_ask").map((el) => { const ex = (Array.isArray(el.expanded_element) ? (el.expanded_element as Record<string, unknown>[]) : [])[0];
    const url = String(ex?.url ?? ""); return { question: String(el.title ?? ""), answeringDomain: str(ex?.domain) ?? (url ? hostname(url) : null), answer: cut(ex?.description ?? ex?.text, ANSWER_MAX) }; }).filter((q) => q.question.length > 0);
  const relatedSearches = sub("related_searches").map((s) => String(s)).filter((s) => s.length > 0);
  const inner = sub("ai_overview");
  const references = inner.flatMap((el) => (Array.isArray(el.references) ? (el.references as Record<string, unknown>[]) : []))
    .map((r) => { const url = String(r.url ?? ""); return { url, domain: String(r.domain ?? hostname(url)), title: str(r.title) }; }).filter((r) => r.url.length > 0);
  const excerpt = cut(inner.map((el) => str(el.text) ?? str(el.markdown)).find((t) => t != null), OVERVIEW_MAX);
  // AN OVERVIEW STILL BEING FETCHED IS NOT AN OVERVIEW GOOGLE DOES NOT SHOW: the provider marks that block `asynchronous_ai_overview` and sends its words on the follow-up load, so the stub travels as outstanding.
  const ovb = items.find((i) => i.type === "ai_overview"), aiOverview = ovb ? { present: true, references, excerpt, asynchronous: ovb.asynchronous_ai_overview === true } : null;
  return { organic, aiOverview, paaQuestions, relatedSearches, itemTypes, ...(featuredSnippet === undefined ? {} : { featuredSnippet }) };
}
function parseLlmAnswer(env: ProviderEnvelope): ParsedAiAnswer {
  const { result0, items } = resultBlock(env);
  const web = typeof result0?.web_search === "boolean" ? (result0.web_search as boolean) : null;
  const texts: string[] = [];
  let citations: ParsedAiAnswer["citations"] = null;
  for (const it of items) {
    if (it.type !== "message") continue;
    for (const sec of Array.isArray(it.sections) ? (it.sections as Record<string, unknown>[]) : []) {
      if (sec.type === "text" && typeof sec.text === "string") texts.push(sec.text);
      if (!Array.isArray(sec.annotations)) continue;
      citations = citations ?? [];
      // Preserve provider-reported annotation offsets and passage text; never infer missing values.
      for (const a of sec.annotations as Record<string, unknown>[]) {
        const url = String(a.url ?? "");
        if (!url) continue;
        const s = num(a.start_index), e = num(a.end_index), t = str(a.text);
        citations.push({ url, domain: hostname(url), title: str(a.title), ...(s != null ? { startIndex: s } : {}), ...(e != null ? { endIndex: e } : {}), ...(t != null ? { passage: t } : {}) });
      }
    }
  }
  // llm_responses documents NEITHER a retrieval list nor a brand list (llm_responses live + task_get, all four engines, 2026-07-31): not observable here reads null, never an observed empty.
  return { answerText: texts.length ? texts.join("\n") : null, modelServed: str(result0?.model_name), webSearchReported: web, citations, fanOutQueries: arrStr(result0?.fan_out_queries), usage: usageOf(result0), retrievedResults: null, brandMentions: null };
}
/** Provider-reported token/money usage; missing stays null and never substitutes for the spend ledger. */
function usageOf(r: Record<string, unknown> | null): ParsedAiAnswer["usage"] {
  const u = { inputTokens: num(r?.input_tokens), outputTokens: num(r?.output_tokens), reasoningTokens: num(r?.reasoning_tokens), moneySpentUsd: num(r?.money_spent) };
  return Object.values(u).every((v) => v == null) ? null : u;
}
/** Scraper citations, retrieved results and named brands are separate; unreported web-search state stays unknown. */
function parseScraper(env: ProviderEnvelope): ParsedAiAnswer {
  const { result0 } = resultBlock(env);
  const citations = links(result0?.sources), retrievedResults = links(result0?.search_results);
  return {
    answerText: str(result0?.markdown), modelServed: str(result0?.model), citations, retrievedResults,
    webSearchReported: (citations?.length ?? 0) + (retrievedResults?.length ?? 0) > 0 ? true : null,
    fanOutQueries: arrStr(result0?.fan_out_queries), usage: usageOf(result0),
    brandMentions: brandTitles(result0?.brand_entities),
  };
}
/** Decode only a complete, bounded, lossless transport; token references never become HTML authority on their own. */
function unpackRenderedHtml(dom: Record<string, unknown>): string {
  const { dictionary, indices, htmlChars } = dom, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (dom.codec !== "tokens-ascii-v1" || dom.complete !== true || "html" in dom || !Array.isArray(dictionary) || dictionary.length > 55_040
    || typeof indices !== "string" || indices.length > 100_000 || typeof htmlChars !== "number" || !Number.isInteger(htmlChars) || htmlChars < 1 || htmlChars > 2_000_000) throw new Error("invalid rendered transport");
  let dictionaryChars = 0, decodedChars = 0, cursor = 0;
  const pieces: string[] = [];
  for (const token of dictionary) {
    if (typeof token !== "string" || !token.length || (dictionaryChars += token.length) > 2_000_000) throw new Error("invalid rendered dictionary");
  }
  while (cursor < indices.length) {
    let id = 0, shift = 0, digit: number;
    do {
      if (cursor >= indices.length || shift > 15) throw new Error("unterminated rendered reference");
      digit = alphabet.indexOf(indices[cursor++]!);
      if (digit < 0) throw new Error("invalid rendered reference");
      id += (digit % 32) * 2 ** shift; shift += 5;
    } while (digit >= 32);
    if (id >= dictionary.length) throw new Error("missing rendered token");
    const token = dictionary[id] as string;
    if ((decodedChars += token.length) > htmlChars) throw new Error("rendered expansion exceeds declared size");
    pieces.push(token);
  }
  if (decodedChars !== htmlChars) throw new Error("incomplete rendered transport");
  return pieces.join("");
}
/** Completed DOM observation, not proof that every delayed application request finished. */
function parseRenderedHtml(env: ProviderEnvelope): ParsedByCapability["onpage_rendered_html"] {
  const { result0, items } = resultBlock(env), item = items[0];
  const dom = item?.custom_js_response as Record<string, unknown> | undefined;
  if (result0?.crawl_progress !== "finished" || item?.status_code !== 200 || item?.custom_js_client_exception
    || dom?.readyState !== "complete" || (dom.complete !== undefined && dom.complete !== true) || JSON.stringify(dom).length > 100_000
    || typeof dom.url !== "string" || !/^https?:\/\//i.test(dom.url)
    || typeof dom.capturedAt !== "string" || !Number.isFinite(Date.parse(dom.capturedAt))) throw new Error("rendered document unavailable or incomplete");
  const html = dom.codec === undefined && !["dictionary", "indices", "htmlChars"].some((key) => key in dom) ? dom.html : unpackRenderedHtml(dom);
  if (typeof html !== "string" || !html.trim() || html.length > 2_000_000) throw new Error("rendered document unavailable or incomplete");
  return { html, url: dom.url, httpStatus: 200, capturedAt: dom.capturedAt };
}
function parseContentParsing(env: ProviderEnvelope): ParsedByCapability["onpage_content_parsing"] {
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const pc = (resultBlock(env).items[0]?.page_content ?? {}) as Record<string, unknown>;
  // MAIN AND SECONDARY TOPIC ONLY, WHICH IS THE MAIN CONTENT: the endpoint keeps the page's chrome in its own header and footer blocks and neither is read here, so what comes back is the same de-chromed reading the free crawl builds. An empty parse stays a zero-word gap and is never banked as a body.
  const topics = [...arr(pc.main_topic), ...arr(pc.secondary_topic)], body = topics.flatMap((t) => arr(t.primary_content).map((p) => str(p.text) ?? "")).join(" ").replace(/\s+/g, " ").trim();
  const sections = topics.map((t) => ({ heading: str(t.h_title), text: arr(t.primary_content).map((p) => str(p.text) ?? "").join(" ").replace(/\s+/g, " ").trim() })).filter((s) => s.text); return { title: str(topics[0]?.main_title), h1: str(topics[0]?.h_title), wordCount: body ? body.split(" ").length : 0, ...(sections.length > 0 ? { sections } : {}), /* each heading with the words under it, so a reader can open on the section the requirement named */
    /* WHAT THIS ENDPOINT DOES NOT SEND IS NOT CAPTURED, NEVER NONE (Build Queue E-039). `page_content` carries the page's header, its footer and its topics, each topic a title, its paragraphs and its tables, and nothing else: no meta description, no entity list, no list flag and no link counts. A question-entry count of 0 stood here and it is a claim this payload cannot make, so a provider-read winner read as a page with no question entries beside a crawled one that really had none. Every field this parse does not fill is left ABSENT, which the extract and the comparison both read as unknown. */ headings: topics.map((t) => str(t.h_title) ?? "").filter(Boolean).slice(0, 20),
    openingSample: body.slice(0, 600) || null, hasTable: topics.some((t) => arr(t.table_content).length > 0),
    ...mainOf(body, 0, 100_000) };
}
function modelObjects(env: ProviderEnvelope): Record<string, unknown>[] {
  const result = env.tasks?.[0]?.result;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}
function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function level(v: unknown): "low" | "medium" | "high" | null { const s = typeof v === "string" ? v.toLowerCase() : ""; return s === "low" || s === "medium" || s === "high" ? s : null; }
function str(v: unknown): string | null { return typeof v === "string" && v.length > 0 ? v : null; }
function arrStr(v: unknown): string[] | null { return Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.length > 0) : null; }
/** A provider list of web pages -> the ONE link shape every observation keeps. null = the provider sent no such list. */
function links(v: unknown): { url: string; domain: string; title: string | null }[] | null {
  return Array.isArray(v) ? (v as Record<string, unknown>[]).map((s) => { const url = String(s.url ?? ""); return { url, domain: String(s.domain ?? hostname(url)), title: str(s.title) }; }).filter((c) => c.url.length > 0) : null;
}
function brandTitles(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const titles = v.map((b) => (typeof b === "string" ? str(b) : str((b as Record<string, unknown> | null)?.title))).filter((t): t is string => t != null);
  return titles.length > 0 || v.length === 0 ? titles : null;
}
function hostname(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
export function canonicalUrl(url: string): string { try { const u = new URL(url); u.hash = ""; return u.toString(); } catch { return url.trim(); } }
function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
