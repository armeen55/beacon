import "server-only";
import { createHash } from "node:crypto";
import { isDataForSeoConfigured, runDataForSeoTransport } from "./client";
import { collectResolvedTask, identityCacheKey, runResolvedCall, type ResolvedCall } from "./cached-call";
import { resolveDeps } from "./default-deps";
import { normalizePageIntersection, parsePageIntersection, MAX_INTERSECTION_PAGES } from "../page-intersection";
import { freshnessMsFor } from "../freshness";
import type {
  CachedCallResult, CapabilityInputByKey, CapabilityKey, EngineModelResolution, FunnelBoundaryDeps,
  ObservationIdentity, ParsedAiAnswer, ParsedByCapability, ParsedKeywordItem, ParsedSerp, ProviderEnvelope,
} from "./funnel-boundary";

/** capabilities - the typed DataForSEO provider registry behind the frozen funnel-boundary contract. ONE entry per CapabilityKey owns the EXACT request
 *  builder (only fields the docs document for that endpoint), the optional ask NORMALIZATION that runs BEFORE the cache identity, the reservation, the
 *  cache dimensions, the envelope parser, and its route (post + free task_get + free tasks_ready). providerCall is the ONE model-resolution point: it
 *  resolves the engine model ONCE, picks Standard vs Live from that resolution, and stamps the requested model back. The model is NEVER caller-supplied.
 *  Every field verified vs docs.dataforseo.com: 2026-07-26 for the llm_responses/llm_scraper/serp families and every family's tasks_ready; 2026-07-28 for
 *  page_intersection and on_page content_parsing. */

const DFS_API_BASE = "https://api.dataforseo.com/v3";
const LOCATION_US = 2840;
const LANG_EN = "en";
const DAY = 86_400_000;
const MAX_IDEAS_SEEDS = 200, IDEAS_DEFAULT_LIMIT = 700, IDEAS_MAX_LIMIT = 1000; // documented keyword_ideas seed ceiling, default and max limit, in ONE place so the ask and the built body agree
/** serp_competitors documents the SAME 200-keyword ceiling and a limit that defaults to 100 and maxes at 1000. Beacon asks for 50: a case wants the
 *  handful of domains that keep coming up, not a directory. (docs: dataforseo_labs/google/serp_competitors/live, read 2026-07-31) */
const COMPETITORS_SEEDS = 200, COMPETITORS_LIMIT = 50, COMPETITORS_MAX_LIMIT = 1000, MAX_COMPETITOR_ROWS = 50;
/** Bound the token-variable half of every LLM ask at the REQUEST. Documented on chat_gpt/claude/gemini llm_responses task_post AND live and on perplexity
 *  live ("maximum value: 4096; default value: 2048"), NOT on llm_scraper, so it is never sent there. Honest limit: with web_search or a reasoning model
 *  the output may exceed it, so this narrows the spend, it does not hard-cap it. */
const LLM_MAX_OUTPUT_TOKENS = 2048;

type LlmEngine = "chatgpt" | "gemini" | "claude" | "perplexity";
const ENGINE_SLUG: Record<LlmEngine, string> = { chatgpt: "chat_gpt", gemini: "gemini", claude: "claude", perplexity: "perplexity" };

/** tasksReady = the FREE GET listing of finished-but-uncollected tasks, the only AUTOMATIC recovery a quarantined row ever gets (the hold is otherwise
 *  indefinite). Null on Live routes (no task). */
type Route = { mode: "live" | "task"; postPath: string; getPath: ((id: string) => string) | null; tasksReady: string | null };

type Entry<K extends CapabilityKey> = {
  ttlMs: number;
  estCostUsd: number;
  dims: { device: boolean; model: boolean };
  /** Present = the call needs a resolved engine model (Standard vs Live routing). */
  engine?: LlmEngine;
  route: (r: EngineModelResolution | null) => Route;
  /** Canonicalize the ask BEFORE it becomes a cache identity, so two spellings of one request never buy the same rows twice. Registry-owned: no caller
   *  can skip it. */
  normalize?: (input: CapabilityInputByKey[K]) => CapabilityInputByKey[K];
  build: (input: CapabilityInputByKey[K], r: EngineModelResolution | null) => unknown[];
  parse: (env: ProviderEnvelope) => ParsedByCapability[K];
};
type Registry = { [K in CapabilityKey]: Entry<K> };

/** Thrown by a builder when a runtime-required field COMBINATION is absent. */
class MissingFieldsError extends Error { constructor(cap: string, missing: string[]) {
  super(`capability ${cap}: missing required field(s): ${missing.join(", ")}`); this.name = "MissingFieldsError"; } }

// ── request builders (emit ONLY documented fields per endpoint) ───────────────

/** ChatGPT llm_responses: user_prompt + model_name + max_output_tokens + web_search ONLY. force_web_search is NEVER sent here and neither is a country:
 *  the endpoint rejects force on a reasoning model with an in-body 40501, verified live 2026-07-25 on o4-mini, and the live models list that day reported
 *  reasoning true for EVERY ChatGPT model. (docs: chat_gpt llm_responses task_post + live, 2026-07-26) */
function chatGptBuild(i: CapabilityInputByKey["llm_chatgpt"], r: EngineModelResolution | null): unknown[] {
  const web = r?.webSearch === true && i.web_search === true;
  return [clean({ user_prompt: i.user_prompt, model_name: r?.model, max_output_tokens: LLM_MAX_OUTPUT_TOKENS, web_search: web ? true : undefined })];
}
/** Claude llm_responses: a DIFFERENT contract from ChatGPT. force_web_search and web_search_country_iso_code are both documented here and conflict only
 *  with use_reasoning, which Beacon never sends. Both ride an ENABLED web search, so neither is emitted when it is off. (docs: claude task_post + live,
 *  2026-07-26) */
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
/** Perplexity Live: web_search is on by default (not a request field); only web_search_country_iso_code is documented. (docs: perplexity live,
 *  2026-07-26) */
function perplexityBuild(i: CapabilityInputByKey["llm_perplexity"], r: EngineModelResolution | null): unknown[] {
  return [clean({ user_prompt: i.user_prompt, model_name: r?.model, max_output_tokens: LLM_MAX_OUTPUT_TOKENS, web_search_country_iso_code: i.web_search_country_iso_code })];
}
/** Scraper is KEYWORD-based (never user_prompt/model_name) and REQUIRES location + language; expand_citations REQUIRES force_web_search. (docs: chat_gpt
 *  llm_scraper/task_post, 2026-07-24) */
function scraperBuild(i: CapabilityInputByKey["llm_scraper_chatgpt"]): unknown[] {
  const forceWeb = i.force_web_search === true;
  if (i.expand_citations === true && !forceWeb) throw new MissingFieldsError("llm_scraper_chatgpt", ["force_web_search (required to enable expand_citations)"]);
  return [clean({ keyword: i.keyword, location_code: LOCATION_US, language_code: LANG_EN,
    force_web_search: forceWeb ? true : undefined,
    expand_citations: forceWeb && i.expand_citations === true ? true : undefined })];
}

/** THE LLM OBSERVATION IDENTITY, applied BEFORE the cache identity and to the LLM capabilities ONLY (no builder ever emits it). The plan's reporting day
 *  always rides the identity, so tomorrow's reading is a new question and not a replay of tonight's answer out of the one-day cache; a deliberate second
 *  sample rides it too, so slot 1 is a real second opinion at real cost. Slot 0 is left OUT, so a same-day retry is still a $0 replay of one identical
 *  ask. No day is ever invented: an ask without one keys exactly as it did before. */
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
function serpEntry<K extends "serp_organic" | "serp_ai_mode">(base: string, estCostUsd: number): Entry<K> {
  return {
    ttlMs: 1 * DAY, estCostUsd, dims: { device: true, model: false },
    route: () => ({ mode: "task", postPath: `${base}/task_post`, getPath: (id) => `${base}/task_get/advanced/${id}`, tasksReady: `${base}/tasks_ready` }),
    build: (i) => [{ keyword: i.keyword, location_code: LOCATION_US, language_code: LANG_EN, device: i.device ?? "desktop" }],
    parse: parseSerp,
  };
}
/** DYNAMIC routing: a Standard-capable resolution posts a resumable task_post (free task_get resume); otherwise the Live endpoint. Both paths are carried
 *  per engine; providerCall picks by the resolution. */
function llmDynamicRoute(engine: LlmEngine): (r: EngineModelResolution | null) => Route {
  const slug = ENGINE_SLUG[engine];
  const standard: Route = { mode: "task", postPath: `ai_optimization/${slug}/llm_responses/task_post`, getPath: (id) => `ai_optimization/${slug}/llm_responses/task_get/${id}`, tasksReady: `ai_optimization/${slug}/llm_responses/tasks_ready` };
  const live: Route = { mode: "live", postPath: `ai_optimization/${slug}/llm_responses/live`, getPath: null, tasksReady: null };
  return (r) => (r?.method === "standard" ? standard : live);
}
/** PRICING EVIDENCE for the 0.035 reservation (dataforseo.com/pricing/ai-optimization/llm-responses + the task_post docs, read 2026-07-26): a
 *  Standard-queue LLM task costs $0.0002 plus a $0.01 prepayment refunded down to the LLM's actual charge; Live adds $0.0006 plus the LLM charge,
 *  token-based and NOT capped by max_output_tokens when web_search is on. So 0.035 is a deliberate high estimate, not a proven bound. */
function llmDynamicEntry<K extends "llm_chatgpt" | "llm_gemini" | "llm_claude">(engine: LlmEngine, build: Entry<K>["build"]): Entry<K> {
  return { ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true }, engine, route: llmDynamicRoute(engine), normalize: llmIdentity, build, parse: parseLlmAnswer };
}

// ── the registry ─────────────────────────────────────────────────────────────

const REGISTRY: Registry = {
  // Labs live actually charged 0.018 for a 50-row suggestions call (live, 2026-07-25), so the reservation stays deliberately ABOVE that, never under it.
  // keywords_for_site and ranked_keywords each ACTUALLY charged $0.132 on file against the old $0.02 estimate: reserve above the observed worst case;
  // reconcile drops to actual.
  labs_keywords_for_site: labsEntry("dataforseo_labs/google/keywords_for_site/live", "target", 0.2),
  // item_types organic ONLY, the same doc-verified field serp_competitors sends: ranked_keywords defaults to
  // organic AND paid, so an ad this account bought came back as one of its own rankings and one page that
  // ranked once organically and once as an ad read as two pages, which is the arithmetic behind
  // "consolidation". A bought placement is not a page that wins a search.
  // (docs: dataforseo_labs/google/ranked_keywords/live, item_types, read 2026-07-31)
  labs_ranked_keywords: labsEntry("dataforseo_labs/google/ranked_keywords/live", "target", 0.2, { item_types: ["organic"] }),
  labs_related_keywords: labsEntry("dataforseo_labs/google/related_keywords/live", "keyword", 0.02),
  labs_keyword_suggestions: labsEntry("dataforseo_labs/google/keyword_suggestions/live", "keyword", 0.02),
  // RESERVATION arithmetic, NOT a flat price: a real keyword_overview call of at most 150 keywords charged $0.02988, about $0.0002 per keyword, so a FULL
  // 700-keyword request lands near 700 x 0.0003 = $0.21. Reserved at 0.25, rounded UP, so the ceiling is never held BELOW what the provider can charge;
  // reconcile drops the reservation to the actual cost.
  // The CACHE LIFETIME IS THE FRESHNESS MATRIX, not a number of its own: the provider reports volume and
  // difficulty monthly, so a seven-day ttl expired a row every side of the product still calls current and
  // bought the identical numbers back four times a month.
  labs_keyword_overview: {
    ttlMs: freshnessMsFor("keyword_volume"), estCostUsd: 0.25, dims: { device: false, model: false },
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/keyword_overview/live", getPath: null, tasksReady: null }),
    build: (i) => [{ keywords: i.keywords, location_code: LOCATION_US, language_code: LANG_EN }], parse: parseKeywords,
  },
  // RESERVATION arithmetic, NOT a price: the Labs live charges on file (50 rows $0.018, 150 rows $0.02988, 1000 rows $0.132) fit $0.012 per request plus
  // $0.00012 per returned row, so 700 rows lands near 0.012 + 700 x 0.00012 = $0.096 and the 1000-row ceiling near $0.132. Reserved at 0.2, rounded UP past
  // the largest response this endpoint can return; reconcile drops it to actual.
  labs_keyword_ideas: {
    ttlMs: freshnessMsFor("keyword_volume"), estCostUsd: 0.2, dims: { device: false, model: false },
    normalize: (i) => ({ ...i, keywords: [...new Set(i.keywords.map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean))].sort().slice(0, MAX_IDEAS_SEEDS), limit: Math.min(Math.max(1, Math.trunc(i.limit ?? IDEAS_DEFAULT_LIMIT)), IDEAS_MAX_LIMIT) }), // normalized BEFORE the identity: a direct call skipped the batched helper and re-bought the same rows
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/keyword_ideas/live", getPath: null, tasksReady: null }),
    build: (i) => [{ keywords: i.keywords.slice(0, MAX_IDEAS_SEEDS), location_code: LOCATION_US, language_code: LANG_EN, limit: Math.min(Math.max(1, Math.trunc(i.limit ?? IDEAS_DEFAULT_LIMIT)), IDEAS_MAX_LIMIT) }], parse: parseKeywords,
  },
  // THE RECURRING WINNING DOMAINS across a case's whole keyword set, in ONE request. Its consumer is the discovery unit's competitors stage: one bounded
  // request per case set, at most once a week per case, stored as DOMAIN evidence beside the case and never as a keyword. RESERVATION arithmetic, NOT a
  // price: the documented example response reports cost 0.0105,
  // and the Labs live charges on file (50 rows $0.018, 150 rows $0.02988) fit $0.012 per request plus $0.00012 per row, so 50 rows lands near $0.018.
  // Reserved at 0.05, rounded well past both; reconcile drops it to actual. (docs: dataforseo_labs/google/serp_competitors/live, verified 2026-07-31)
  labs_serp_competitors: {
    ttlMs: 7 * DAY, estCostUsd: 0.05, dims: { device: false, model: false },
    // Normalized BEFORE the identity, exactly like keyword_ideas: the provider lowercases the keywords itself, so two orderings or two spellings of one set
    // must never derive two cache identities.
    normalize: (i) => ({ keywords: [...new Set(i.keywords.map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean))].sort().slice(0, COMPETITORS_SEEDS), limit: Math.min(Math.max(1, Math.trunc(i.limit ?? COMPETITORS_LIMIT)), COMPETITORS_MAX_LIMIT) }),
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/serp_competitors/live", getPath: null, tasksReady: null }),
    // item_types organic ONLY: a paid placement is not a page that wins a search, and the default sends both.
    build: (i) => {
      if (i.keywords.length === 0) throw new MissingFieldsError("labs_serp_competitors", [`keywords (1 to ${COMPETITORS_SEEDS} keywords)`]);
      return [{ keywords: i.keywords, location_code: LOCATION_US, language_code: LANG_EN, item_types: ["organic"], limit: Math.min(Math.max(1, Math.trunc(i.limit ?? COMPETITORS_LIMIT)), COMPETITORS_MAX_LIMIT) }];
    },
    parse: parseSerpCompetitors,
  },
  // RESERVATION arithmetic, NOT a price: page_intersection has never been bought here, so it rides the Labs live charges on file (50 rows $0.018, 150 rows
  // $0.02988, 1000 rows $0.132), which fit $0.012 per request plus $0.00012 per row. Reserved at 0.2, rounded UP past the largest Labs live charge observed
  // here; reconcile drops it to actual. ONE request carries the WHOLE page set, never one per page.
  labs_page_intersection: {
    ttlMs: 7 * DAY, estCostUsd: 0.2, dims: { device: false, model: false }, normalize: normalizePageIntersection,
    route: () => ({ mode: "live", postPath: "dataforseo_labs/google/page_intersection/live", getPath: null, tasksReady: null }),
    build: (i) => {
      // A comparison of fewer than two pages is not a comparison: refuse it before the money, never after.
      if (i.pages.length < 2) throw new MissingFieldsError("labs_page_intersection", [`pages (2 to ${MAX_INTERSECTION_PAGES} absolute http/https urls)`]);
      return [clean({ pages: Object.fromEntries(i.pages.map((u, n) => [String(n + 1), u])), exclude_pages: i.exclude_pages?.length ? i.exclude_pages : undefined,
        location_code: LOCATION_US, language_code: LANG_EN, intersection_mode: i.intersection_mode, item_types: ["organic"], limit: i.limit })];
    },
    parse: parsePageIntersection,
  },
  // ONE public read of a body my own fetch could not get, US/English, never after a robots denial. Priced as Instant Pages and the documented example charges
  // $0.000125; reserved far above it at 0.002, so the cap is never held under one read, and reconcile drops it to actual. (docs: content_parsing/live 07-28)
  onpage_content_parsing: {
    ttlMs: 7 * DAY, estCostUsd: 0.002, dims: { device: false, model: false },
    normalize: (i) => ({ url: canonicalUrl(i.url) }), // one URL, one identity: a #fragment never buys twice
    route: () => ({ mode: "live", postPath: "on_page/content_parsing/live", getPath: null, tasksReady: null }),
    build: (i) => [{ url: i.url, enable_javascript: true, accept_language: LANG_EN, ip_pool_for_scan: "us" }], parse: parseContentParsing,
  },
  serp_organic: serpEntry("serp/google/organic", 0.0021),
  serp_ai_mode: serpEntry("serp/google/ai_mode", 0.01),
  llm_chatgpt: llmDynamicEntry("chatgpt", chatGptBuild),
  llm_gemini: llmDynamicEntry("gemini", geminiBuild),
  llm_claude: llmDynamicEntry("claude", claudeBuild),
  llm_perplexity: {
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true }, engine: "perplexity",
    // Perplexity models are Live-only (task_post_supported=false for all), so this stays Live-only; providerCall still resolves the model once for the id.
    route: () => ({ mode: "live", postPath: "ai_optimization/perplexity/llm_responses/live", getPath: null, tasksReady: null }),
    normalize: llmIdentity, build: perplexityBuild, parse: parseLlmAnswer,
  },
  llm_scraper_chatgpt: {
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: false },
    route: () => ({ mode: "task", postPath: "ai_optimization/chat_gpt/llm_scraper/task_post", getPath: (id) => `ai_optimization/chat_gpt/llm_scraper/task_get/advanced/${id}`, tasksReady: "ai_optimization/chat_gpt/llm_scraper/tasks_ready" }),
    normalize: llmIdentity, build: scraperBuild, parse: parseScraper,
  },
};

/** CAN THIS CAPABILITY BE ASKED AT ALL, read off the registry itself rather than off a second list somebody
 *  has to remember to update. A planner asks this so an engine the registry carries no way to reach is left
 *  out of every plan while that is true, and planned again the day it comes back. */
export const capabilityAskable = (capability: string): boolean => Object.hasOwn(REGISTRY, capability);

// ── composed provider call (the ONE model-resolution point) ───────────────────

export async function providerCall<K extends CapabilityKey>(
  capability: K, input: CapabilityInputByKey[K], ids: { tenantId: string; unitKey: string }, deps: FunnelBoundaryDeps = {},
): Promise<CachedCallResult> {
  const entry = REGISTRY[capability];
  let resolution: EngineModelResolution | null = null, modelRequested: string | null = null;
  if (entry.engine) { // ONE resolution: the method routes the call AND the model rides the request
    resolution = await resolveEngineModel(entry.engine, deps);
    if (!resolution) return { state: "not_configured", cacheKey: null, detail: `I could not find a usable ${entry.engine} model to ask right now. I will try again on the next pass.` };
    // The resolution is the ONLY source of the model: no caller override exists.
    modelRequested = resolution.model;
  }
  const route = entry.route(resolution);
  // The canonical ask is what gets built AND what gets keyed, so a reordered set or an omitted default can never derive a second identity for one and the
  // same request.
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
  const cacheKey = identityCacheKey({ endpoint: route.postPath, publicInput, locationCode: LOCATION_US, languageCode: LANG_EN, device, modelRequested: modelDim });
  const resolved: ResolvedCall = {
    cacheKey, endpoint: route.postPath, endpointVersion: "v3", postPath: route.postPath, getPath: route.getPath,
    tasksReadyPath: route.tasksReady,
    publicInput, locationCode: LOCATION_US, languageCode: LANG_EN, device, modelRequested: modelDim,
    payload, ttlMs: entry.ttlMs, estCostUsd: entry.estCostUsd, mode: route.mode, tenantId: ids.tenantId,
  };
  const result = await runResolvedCall(resolved, deps);
  // Stamp the requested model back so the executor records it without re-resolving.
  if (modelRequested && (result.state === "ok" || result.state === "waiting")) return { ...result, modelRequested };
  return result;
}

/** THE batched ideas ask: N seed themes cost ceil(N / 200) requests through the SAME providerCall (one transport, cache identity, reserve-then-reconcile
 *  spend path, tenant attribution and fail-closed cap), never one paid request per keyword. Seeds are trimmed, lowercased, deduped and ordered, so the
 *  same themes in any order derive the SAME cache identity and reuse what was already bought. One result per batch, in order. A refusal, the spend cap or
 *  the daily ceiling stops the remaining batches. */
export async function keywordIdeasBatched(
  seeds: string[], ids: { tenantId: string; unitKey: string }, deps: FunnelBoundaryDeps = {}, limit?: number,
): Promise<CachedCallResult[]> {
  const cleaned = [...new Set((seeds ?? []).map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean))].sort();
  const out: CachedCallResult[] = [];
  // NORMALIZE THE ASK BEFORE IT BECOMES AN IDENTITY: an omitted limit, an explicit 700 and a 5000 all build ONE request, so keying on the raw ask bought
  // identical rows three times.
  const asked = Math.min(Math.max(1, Math.trunc(limit ?? IDEAS_DEFAULT_LIMIT)), IDEAS_MAX_LIMIT);
  for (let i = 0; i < cleaned.length; i += MAX_IDEAS_SEEDS) {
    const input = { keywords: cleaned.slice(i, i + MAX_IDEAS_SEEDS), limit: asked };
    const r = await providerCall("labs_keyword_ideas", input, ids, deps);
    out.push(r);
    if (r.state === "capped" || (r.state === "error" && (r.disposition === "blocked" || r.disposition === "daily_limit"))) break;
  }
  return out;
}

/** Resume a waiting Standard task via the endpoint-derived FREE task_get path, or recover a quarantined row via the endpoint-derived FREE tasks_ready
 *  listing. */
export async function collectCapability(cacheKey: string, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  return collectResolvedTask(cacheKey, { getPath: getPathForEndpoint, tasksReadyPath: tasksReadyForEndpoint, ttlMsFor: ttlMsForEndpoint }, deps);
}
/** Ready-payload freshness for a collected task, by endpoint: every Standard family in the registry (SERP, AI Mode, llm_responses, llm_scraper) carries
 *  the 1-day ttl. Null = not a task endpoint. */
const ttlMsForEndpoint = (endpoint: string): number | null => (endpoint.endsWith("/task_post") ? DAY : null);
/** The free task_get derivation from a stored task_post endpoint: serp + scraper use /task_get/advanced, llm_responses uses the plain /task_get. */
function getPathForEndpoint(endpoint: string, id: string): string | null {
  if (!endpoint.endsWith("/task_post")) return null;
  const base = endpoint.slice(0, -"/task_post".length);
  if (endpoint.startsWith("serp/") || endpoint.includes("/llm_scraper/")) return `${base}/task_get/advanced/${id}`;
  if (endpoint.includes("/llm_responses/")) return `${base}/task_get/${id}`;
  return null;
}
/** The free tasks_ready derivation. ONE rule across every family we post to, each verified on docs.dataforseo.com 2026-07-26 as a free GET returning {id,
 *  tag} per finished task: serp/google/{organic,ai_mode}, ai_optimization/{chat_gpt,claude,gemini}/llm_responses and ai_optimization/chat_gpt/llm_scraper
 *  all expose <base>/tasks_ready. */
function tasksReadyForEndpoint(endpoint: string): string | null {
  return endpoint.endsWith("/task_post") ? `${endpoint.slice(0, -"/task_post".length)}/tasks_ready` : null;
}

/** Pure: the full bounded envelope -> the capability's frozen typed output. */
export function parseCapability<K extends CapabilityKey>(capability: K, envelope: ProviderEnvelope): ParsedByCapability[K] | null {
  try { return REGISTRY[capability].parse(envelope) as ParsedByCapability[K]; } catch { return null; } }

// ── model resolution (FREE models endpoint, method-aware, cached) ──────────────
/** Labeled fallbacks (docs, 2026-07-24), used only when credentials are absent: chatgpt/claude standard, gemini/perplexity live. */
const FALLBACK: Record<LlmEngine, EngineModelResolution> = {
  chatgpt: { model: "gpt-4o", method: "standard", webSearch: true },
  claude: { model: "claude-sonnet-4-20250514", method: "standard", webSearch: true },
  gemini: { model: "gemini-2.5-flash", method: "live", webSearch: true },
  perplexity: { model: "sonar", method: "live", webSearch: true },
};

export async function resolveEngineModel(engine: LlmEngine, deps: FunnelBoundaryDeps = {}): Promise<EngineModelResolution | null> {
  const d = resolveDeps(deps);
  // No credentials -> the labeled fallback, no network.
  if (!isDataForSeoConfigured(d.env)) return FALLBACK[engine];
  const path = `ai_optimization/${ENGINE_SLUG[engine]}/llm_responses/models`;
  const cacheKey = "dfsmodels_" + sha256(path).slice(0, 32);
  const now = d.now();
  let envelope: ProviderEnvelope | null = null;
  // A read FAILURE is not an absent row: our records are down, so fail closed here and make ZERO provider calls (not even the free models GET) rather than
  // walk on toward a paid one. An ABSENT row is a real miss and does fetch the free list.
  let row: Awaited<ReturnType<typeof d.cacheRead>>;
  try { row = await d.cacheRead(cacheKey); } catch { return null; }
  if (row && row.status === "ready" && row.payload != null && Date.parse(row.expires_at) > now.getTime()) {
    envelope = row.payload as ProviderEnvelope;
  } else {
    const t = await runDataForSeoTransport({ url: `${DFS_API_BASE}/${path}`, payload: [], estCostUsd: 0, env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-models", method: "GET" });
    if (t.ok && (t.body as { status_code?: number } | null)?.status_code === 20000) {
      envelope = t.body as ProviderEnvelope;
      await d.cacheUpsert(cacheKey, {
        endpoint: path, endpoint_version: "v3", input_hash: sha256(path).slice(0, 40), input_summary: `models:${engine}`,
        location_code: 0, language_code: "", status: "ready", payload: envelope, cost_usd: 0,
        ready_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * DAY).toISOString(), fetch_claimed_until: null,
      }).catch(() => {});
    }
  }
  // Configured + live but the list is unavailable -> FAIL CLOSED (null). providerCall turns a null resolution into a bounded no-model result and never posts
  // anything.
  if (!envelope) return null;
  return selectResolution(modelObjects(envelope));
}

/** Prefer Standard + web (resumable AND current); else web-only (Live); else any Standard; else any (Live). */
function selectResolution(models: Record<string, unknown>[]): EngineModelResolution | null {
  if (models.length === 0) return null;
  const web = (m: Record<string, unknown>) => m.web_search_supported === true;
  const post = (m: Record<string, unknown>) => m.task_post_supported === true;
  const chosen = models.find((m) => web(m) && post(m)) ?? models.find(web) ?? models.find(post) ?? models[0];
  const model = str(chosen.model_name);
  if (!model) return null;
  return { model, method: post(chosen) ? "standard" : "live", webSearch: web(chosen) };
}


// ── parsers (tolerant of provider variation; never invent data) ──────────────
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
/** serp_competitors -> the recurring domains, bounded, in the provider's OWN order (it sorts by rating descending by default, which is its composite of
 *  how often and how highly a domain comes up). Each item carries its metrics as flat fields, never a nested metrics object. A metric the provider did
 *  not send stays NULL: "I do not know its average position" and "its average position is 0" are different claims. (docs:
 *  dataforseo_labs/google/serp_competitors/live example response, verified 2026-07-31) */
function parseSerpCompetitors(env: ProviderEnvelope): ParsedByCapability["labs_serp_competitors"] {
  return resultBlock(env).items.slice(0, MAX_COMPETITOR_ROWS).map((it) => ({
    domain: String(it.domain ?? ""), avgPosition: num(it.avg_position), rating: num(it.rating), keywordsCount: num(it.keywords_count),
  })).filter((c) => c.domain.length > 0);
}
function parseSerp(env: ProviderEnvelope): ParsedSerp {
  const { items } = resultBlock(env);
  const sub = (t: string): Record<string, unknown>[] => { const b = items.find((i) => i.type === t); return Array.isArray(b?.items) ? (b!.items as Record<string, unknown>[]) : []; };
  const organic = items.filter((i) => i.type === "organic").map((i) => ({ // rank_group IS the organic position; rank_absolute counts ads and packs, so it read result 1 as "#2"
    rank: Number(i.rank_group ?? i.rank_absolute ?? 0), domain: String(i.domain ?? ""), url: String(i.url ?? ""), title: str(i.title),
  }));
  const paaQuestions = sub("people_also_ask").map((el) => ({ question: String(el.title ?? ""), answeringDomain: null as string | null })).filter((q) => q.question.length > 0);
  const relatedSearches = sub("related_searches").map((s) => String(s)).filter((s) => s.length > 0);
  const inner = sub("ai_overview");
  const references = inner.flatMap((el) => (Array.isArray(el.references) ? (el.references as Record<string, unknown>[]) : []))
    .map((r) => { const url = String(r.url ?? ""); return { url, domain: String(r.domain ?? hostname(url)), title: str(r.title) }; }).filter((r) => r.url.length > 0);
  const excerpt = inner.map((el) => str(el.text) ?? str(el.markdown)).find((t) => t != null) ?? null;
  const aiOverview = items.some((i) => i.type === "ai_overview") ? { present: true, references, excerpt } : null;
  return { organic, aiOverview, paaQuestions, relatedSearches };
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
      for (const a of sec.annotations as Record<string, unknown>[]) { const url = String(a.url ?? ""); if (url) citations.push({ url, domain: hostname(url), title: str(a.title) }); }
    }
  }
  // llm_responses documents NEITHER a retrieval list nor a brand list (llm_responses live + task_get, all four engines, 2026-07-31): not observable here reads null, never an observed empty.
  return { answerText: texts.length ? texts.join("\n") : null, modelServed: str(result0?.model_name), webSearchReported: web, citations, fanOutQueries: arrStr(result0?.fan_out_queries), retrievedResults: null, brandMentions: null };
}
/** llm_scraper carries the WHOLE consumer journey and keeps its three claims apart: `sources` are the CITED pages, `search_results` are the pages it reported
 *  RETRIEVING (stored as reported, because the endpoint nowhere promises they exclude the cited ones, so the not-cited half is DERIVED downstream by
 *  retrievedNotCitedLinks and never assumed here), `brand_entities` are the brands it named itself. It reports NO web_search field, so the only honest evidence the ask reached the web
 *  is web results actually in hand; nothing returned at all reads null, never a claimed false. (docs: task_get/advanced, 2026-07-31) */
function parseScraper(env: ProviderEnvelope): ParsedAiAnswer {
  const { result0 } = resultBlock(env);
  const citations = links(result0?.sources), retrievedResults = links(result0?.search_results);
  return {
    answerText: str(result0?.markdown), modelServed: str(result0?.model), citations, retrievedResults,
    webSearchReported: (citations?.length ?? 0) + (retrievedResults?.length ?? 0) > 0 ? true : null,
    fanOutQueries: arrStr(result0?.fan_out_queries),
    brandMentions: brandTitles(result0?.brand_entities),
  };
}
/** on_page content_parsing -> the SAME extract a directly read winner carries, so a page read through the provider is never a second extract model. What
 *  the provider did not send stays absent, never a fake zero, and the caller stamps fetchedAt. (docs: on_page/content_parsing/live, 2026-07-28) */
function parseContentParsing(env: ProviderEnvelope): ParsedByCapability["onpage_content_parsing"] {
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const pc = (resultBlock(env).items[0]?.page_content ?? {}) as Record<string, unknown>;
  const topics = [...arr(pc.main_topic), ...arr(pc.secondary_topic)];
  const body = topics.flatMap((t) => arr(t.primary_content).map((p) => str(p.text) ?? "")).join(" ").replace(/\s+/g, " ").trim();
  return {
    title: str(topics[0]?.main_title), h1: str(topics[0]?.h_title), wordCount: body ? body.split(" ").length : 0,
    headings: topics.map((t) => str(t.h_title) ?? "").filter(Boolean).slice(0, 20), faqCount: 0,
    openingSample: body.slice(0, 600) || null, hasTable: topics.some((t) => arr(t.table_content).length > 0),
  };
}
function modelObjects(env: ProviderEnvelope): Record<string, unknown>[] {
  const result = env.tasks?.[0]?.result;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}
// ── small pure helpers ──
function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
/** The provider's OWN low/medium/high label; null when it sent none (never a guess). */
function level(v: unknown): "low" | "medium" | "high" | null { const s = typeof v === "string" ? v.toLowerCase() : ""; return s === "low" || s === "medium" || s === "high" ? s : null; }
function str(v: unknown): string | null { return typeof v === "string" && v.length > 0 ? v : null; }
function arrStr(v: unknown): string[] | null { return Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.length > 0) : null; }
/** A provider list of web pages -> the ONE link shape every observation keeps. null = the provider sent no such list. */
function links(v: unknown): { url: string; domain: string; title: string | null }[] | null {
  return Array.isArray(v) ? (v as Record<string, unknown>[]).map((s) => { const url = String(s.url ?? ""); return { url, domain: String(s.domain ?? hostname(url)), title: str(s.title) }; }).filter((c) => c.url.length > 0) : null;
}
/** The brands the answer named itself, read whether the provider sent objects with a title or plain strings. An observed empty list is []; a list whose
 *  every element is unreadable is NULL, because "I do not know which brands it named" and "it named none" are different claims (mapping blindly to ""
 *  conflated them). */
function brandTitles(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const titles = v.map((b) => (typeof b === "string" ? str(b) : str((b as Record<string, unknown> | null)?.title))).filter((t): t is string => t != null);
  return titles.length > 0 || v.length === 0 ? titles : null;
}
function hostname(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
export function canonicalUrl(url: string): string { try { const u = new URL(url); u.hash = ""; return u.toString(); } catch { return url.trim(); } }
function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
