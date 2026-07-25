import "server-only";
import { createHash } from "node:crypto";
import { isDataForSeoConfigured, isDryRun, runDataForSeoTransport } from "./client";
import { collectResolvedTask, identityCacheKey, resolveDeps, runResolvedCall, type ResolvedCall } from "./cached-call";
import type {
  CachedCallResult, CapabilityInput, CapabilityKey, FunnelBoundaryDeps, ParsedAiAnswer,
  ParsedByCapability, ParsedKeywordItem, ParsedModels, ParsedSerp, ProviderEnvelope,
} from "./funnel-boundary";

/**
 * capabilities - the typed DataForSEO provider registry behind the frozen
 * funnel-boundary contract. ONE entry per CapabilityKey owns the EXACT POST/Live
 * path, the free task_get derivation, the REQUIRED-field builder, the reservation,
 * the cache dimensions, and the envelope parser. providerCall composes an entry
 * with the money-safe cached core; collectCapability resumes a Standard task via
 * the registry getPath; parseCapability is pure. Verified vs docs 2026-07-24.
 */

const DFS_API_BASE = "https://api.dataforseo.com/v3";
const LOCATION_US = 2840;
const LANG_EN = "en";
const DAY = 86_400_000;

type Entry = {
  mode: "live" | "task";
  postPath: string;
  getPath?: (id: string) => string;
  ttlMs: number;
  estCostUsd: number;
  dims: { device: boolean; model: boolean };
  build: (input: CapabilityInput) => unknown[];
  parse: (env: ProviderEnvelope) => unknown;
};

/** Thrown by a builder when the provider's REQUIRED fields are absent. */
class MissingFieldsError extends Error {
  constructor(cap: string, missing: string[]) {
    super(`capability ${cap}: missing required field(s): ${missing.join(", ")}`);
    this.name = "MissingFieldsError";
  }
}
function req(cap: string, input: CapabilityInput, fields: string[]): void {
  const missing = fields.filter((f) => input[f] === undefined || input[f] === null || input[f] === "");
  if (missing.length) throw new MissingFieldsError(cap, missing);
}

// ── the registry ─────────────────────────────────────────────────────────────

const REGISTRY: Record<CapabilityKey, Entry> = {
  labs_keywords_for_site: labsEntry("dataforseo_labs/google/keywords_for_site/live", "target", 0.012),
  labs_ranked_keywords: labsEntry("dataforseo_labs/google/ranked_keywords/live", "target", 0.012),
  labs_related_keywords: labsEntry("dataforseo_labs/google/related_keywords/live", "keyword", 0.012),
  labs_keyword_suggestions: labsEntry("dataforseo_labs/google/keyword_suggestions/live", "keyword", 0.012),
  labs_keyword_overview: {
    mode: "live", postPath: "dataforseo_labs/google/keyword_overview/live", ttlMs: 7 * DAY, estCostUsd: 0.02,
    dims: { device: false, model: false },
    build: (i) => { req("labs_keyword_overview", i, ["keywords"]); return [{ keywords: i.keywords, location_code: loc(i), language_code: lang(i) }]; },
    parse: parseKeywords,
  },
  serp_organic: serpEntry("serp/google/organic", 0.0021),
  serp_ai_mode: serpEntry("serp/google/ai_mode", 0.01),
  llm_chatgpt: llmEntry("chat_gpt"),
  // Gemini is Live-only in practice: the official models endpoint reports
  // task_post_supported=false for EVERY gemini model (docs.dataforseo.com,
  // verified 2026-07-24), so Standard posts would always be rejected.
  llm_gemini: llmEntry("gemini", "live"),
  llm_claude: llmEntry("claude"),
  llm_perplexity: {
    mode: "live", postPath: "ai_optimization/perplexity/llm_responses/live", ttlMs: 1 * DAY, estCostUsd: 0.035,
    dims: { device: false, model: true },
    build: (i) => {
      req("llm_perplexity", i, ["user_prompt", "model_name"]);
      return [clean({ user_prompt: i.user_prompt, model_name: i.model_name, web_search_country_iso_code: i.web_search_country_iso_code })];
    },
    parse: parseLlmAnswer,
  },
  llm_scraper_chatgpt: {
    mode: "task", postPath: "ai_optimization/chat_gpt/llm_scraper/task_post",
    // Scraper retrieval is task_get/advanced/{id}; the plain task_get/{id}
    // variant does not exist for llm_scraper (docs verified 2026-07-24).
    getPath: (id) => `ai_optimization/chat_gpt/llm_scraper/task_get/advanced/${id}`,
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true },
    build: (i) => {
      // Scraper is KEYWORD-based (not user_prompt) and REQUIRES location + language.
      req("llm_scraper_chatgpt", i, ["keyword"]);
      const forceWeb = i.force_web_search === true;
      if (i.expand_citations === true && !forceWeb) {
        throw new MissingFieldsError("llm_scraper_chatgpt", ["force_web_search (required to enable expand_citations)"]);
      }
      return [clean({
        keyword: i.keyword, location_code: loc(i), language_code: lang(i),
        force_web_search: forceWeb, expand_citations: forceWeb && i.expand_citations === true ? true : undefined,
      })];
    },
    parse: parseScraper,
  },
  engine_models: {
    mode: "live", postPath: "ai_optimization/chat_gpt/llm_responses/models", ttlMs: 7 * DAY, estCostUsd: 0,
    dims: { device: false, model: false }, build: () => [], parse: parseModels,
  },
};

function labsEntry(postPath: string, keyField: "target" | "keyword", estCostUsd: number): Entry {
  return {
    mode: "live", postPath, ttlMs: 7 * DAY, estCostUsd, dims: { device: false, model: false },
    build: (i) => { req(postPath, i, [keyField]); return [{ [keyField]: i[keyField], location_code: loc(i), language_code: lang(i), limit: i.limit ?? 200 }]; },
    parse: parseKeywords,
  };
}
function serpEntry(base: string, estCostUsd: number): Entry {
  return {
    mode: "task", postPath: `${base}/task_post`, getPath: (id) => `${base}/task_get/advanced/${id}`,
    ttlMs: 1 * DAY, estCostUsd, dims: { device: true, model: false },
    build: (i) => { req(base, i, ["keyword"]); return [{ keyword: i.keyword, location_code: loc(i), language_code: lang(i), device: i.device ?? "desktop" }]; },
    parse: parseSerp,
  };
}
function llmEntry(engine: "chat_gpt" | "gemini" | "claude", mode: "task" | "live" = "task"): Entry {
  return mode === "live" ? {
    mode: "live", postPath: `ai_optimization/${engine}/llm_responses/live`,
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true },
    build: llmBuild(engine), parse: parseLlmAnswer,
  } : {
    mode: "task", postPath: `ai_optimization/${engine}/llm_responses/task_post`,
    getPath: (id) => `ai_optimization/${engine}/llm_responses/task_get/${id}`,
    ttlMs: 1 * DAY, estCostUsd: 0.035, dims: { device: false, model: true },
    build: llmBuild(engine), parse: parseLlmAnswer,
  };
}
function llmBuild(engine: string) {
  return (i: CapabilityInput): unknown[] => {
    req(`llm_${engine}`, i, ["user_prompt", "model_name"]);
    return [clean({
      user_prompt: i.user_prompt, model_name: i.model_name,
      web_search: i.web_search === true ? true : undefined,
      force_web_search: i.force_web_search === true ? true : undefined,
      web_search_country_iso_code: i.web_search_country_iso_code,
    })];
  };
}

// ── composed provider call ──
const LLM_ENGINE: Partial<Record<CapabilityKey, "chatgpt" | "gemini" | "claude" | "perplexity">> = {
  llm_chatgpt: "chatgpt", llm_gemini: "gemini", llm_claude: "claude", llm_perplexity: "perplexity",
};

export async function providerCall(
  capability: CapabilityKey, input: CapabilityInput, ids: { tenantId: string; unitKey: string }, deps: FunnelBoundaryDeps = {},
): Promise<CachedCallResult> {
  const entry = REGISTRY[capability];
  const resolvedInput: CapabilityInput = { ...input };
  let modelRequested: string | null = null;
  const engine = LLM_ENGINE[capability];
  if (engine) {
    modelRequested = typeof input.model_name === "string" && input.model_name ? input.model_name : await resolveEngineModel(engine, deps);
    if (!modelRequested) return { state: "not_configured", cacheKey: null, detail: `no method-compatible model resolved for ${engine}` };
    resolvedInput.model_name = modelRequested;
  }
  let payload: unknown[];
  try {
    payload = entry.build(resolvedInput);
  } catch (err) {
    return { state: "error", cacheKey: null, detail: err instanceof Error ? err.message : String(err) };
  }
  const device = entry.dims.device ? (typeof resolvedInput.device === "string" ? resolvedInput.device : "desktop") : null;
  const modelDim = entry.dims.model ? modelRequested : null;
  const publicInput = { ...resolvedInput };
  delete publicInput.model_name; // model is a cache DIMENSION, not part of the input hash
  const cacheKey = identityCacheKey({ endpoint: entry.postPath, publicInput, locationCode: loc(resolvedInput), languageCode: lang(resolvedInput), device, modelRequested: modelDim });
  const resolved: ResolvedCall = {
    cacheKey, endpoint: entry.postPath, endpointVersion: "v3", postPath: entry.postPath, getPath: entry.getPath ?? null,
    publicInput, locationCode: loc(resolvedInput), languageCode: lang(resolvedInput), device, modelRequested: modelDim,
    payload, ttlMs: entry.ttlMs, estCostUsd: entry.estCostUsd, mode: entry.mode, tenantId: ids.tenantId,
  };
  return runResolvedCall(resolved, deps);
}

/** Resume a waiting Standard task using the REGISTRY's exact getPath. */
export async function collectCapability(cacheKey: string, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  return collectResolvedTask(cacheKey, (endpoint, id) => entryByPostPath(endpoint)?.getPath?.(id) ?? null, deps);
}

/** Pure: the full bounded envelope -> the capability's frozen typed output. */
export function parseCapability<K extends CapabilityKey>(capability: K, envelope: ProviderEnvelope): ParsedByCapability[K] | null {
  try {
    return REGISTRY[capability].parse(envelope) as ParsedByCapability[K];
  } catch {
    return null;
  }
}

function entryByPostPath(postPath: string): Entry | null {
  for (const key of Object.keys(REGISTRY) as CapabilityKey[]) if (REGISTRY[key].postPath === postPath) return REGISTRY[key];
  return null;
}

// ── model resolution (FREE models endpoint, method-compatible, cached) ──
/** DELIBERATELY VALIDATED fallback ids (docs.dataforseo.com, 2026-07-24).
 *  chatgpt/claude report task_post_supported models; gemini lists NONE for
 *  Standard (so the registry routes it Live) and perplexity is Live-only.
 *  Fallbacks are used ONLY in not_configured/dry_run. */
const FALLBACK_MODEL: Record<string, string> = { chatgpt: "gpt-4o", gemini: "gemini-2.5-flash", claude: "claude-sonnet-4-20250514", perplexity: "sonar" };
const ENGINE_SLUG: Record<string, string> = { chatgpt: "chat_gpt", gemini: "gemini", claude: "claude", perplexity: "perplexity" };

export async function resolveEngineModel(engine: "chatgpt" | "gemini" | "claude" | "perplexity", deps: FunnelBoundaryDeps = {}): Promise<string | null> {
  const d = resolveDeps(deps);
  const method: "standard" | "live" = engine === "perplexity" || engine === "gemini" ? "live" : "standard";
  // not_configured OR dry_run -> the validated fallback (labeled), no network.
  if (!isDataForSeoConfigured(d.env) || isDryRun(d.env)) return FALLBACK_MODEL[engine] ?? null;
  const path = `ai_optimization/${ENGINE_SLUG[engine]}/llm_responses/models`;
  const cacheKey = "dfsmodels_" + sha256(path).slice(0, 32);
  const now = d.now();
  let envelope: ProviderEnvelope | null = null;
  const row = await d.cacheRead(cacheKey).catch(() => null);
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
  // Configured + live but the list is unavailable -> FAIL CLOSED (null).
  if (!envelope) return null;
  return selectModel(modelObjects(envelope), method);
}

/** Select a model that supports the REQUIRED method (Standard = task_post_supported;
 *  Live = any listed model), preferring web-search capability. Null = none. */
function selectModel(models: Record<string, unknown>[], method: "standard" | "live"): string | null {
  const compatible = models.filter((m) => (method === "standard" ? m.task_post_supported === true : true));
  const preferred = compatible.find((m) => m.web_search_supported === true) ?? compatible[0];
  return preferred ? str(preferred.model_name) : null;
}

// ── content-hash-aware public page-extract reuse (same evidence_cache table) ──
const PAGE_EXTRACT_ENDPOINT = "public/page_extract";
function pageExtractKey(url: string): string {
  return identityCacheKey({ endpoint: PAGE_EXTRACT_ENDPOINT, publicInput: { url: canonicalUrl(url) }, locationCode: 0, languageCode: "" });
}

export async function readPublicPageExtract(url: string, deps: FunnelBoundaryDeps = {}): Promise<{ extract: Record<string, unknown>; contentHash: string; fetchedAt: string } | null> {
  const d = resolveDeps(deps);
  const row = await d.cacheRead(pageExtractKey(url)).catch(() => null);
  if (!row || row.status !== "ready" || row.payload == null || Date.parse(row.expires_at) <= d.now().getTime()) return null;
  const p = row.payload as { extract?: Record<string, unknown>; content_hash?: string; fetched_at?: string };
  return { extract: p.extract ?? {}, contentHash: p.content_hash ?? "", fetchedAt: p.fetched_at ?? "" };
}

export async function writePublicPageExtract(url: string, extract: Record<string, unknown>, contentHash: string, deps: FunnelBoundaryDeps = {}): Promise<void> {
  const d = resolveDeps(deps);
  const now = d.now();
  await d.cacheUpsert(pageExtractKey(url), {
    endpoint: PAGE_EXTRACT_ENDPOINT, endpoint_version: "v3", input_hash: sha256(canonicalUrl(url)).slice(0, 40),
    input_summary: canonicalUrl(url).slice(0, 200), location_code: 0, language_code: "", status: "ready",
    payload: { extract, content_hash: contentHash, fetched_at: now.toISOString() }, content_hash: contentHash, cost_usd: 0,
    ready_at: now.toISOString(), expires_at: new Date(now.getTime() + 7 * DAY).toISOString(), fetch_claimed_until: null,
  }).catch(() => {});
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
    const ms = Array.isArray(ki.monthly_searches) ? (ki.monthly_searches as Record<string, unknown>[]) : [];
    return {
      keyword: String(it.keyword ?? raw.keyword ?? ""),
      searchVolume: num(ki.search_volume), cpcUsd: num(ki.cpc), competition: num(ki.competition),
      difficulty: num(kp.keyword_difficulty), intent: str(si.main_intent),
      monthlySearches: ms.map((m) => ({ year: Number(m.year), month: Number(m.month), volume: Number(m.search_volume ?? 0) })).filter((m) => Number.isFinite(m.year) && Number.isFinite(m.month)),
    };
  }).filter((k) => k.keyword.length > 0);
}
function parseSerp(env: ProviderEnvelope): ParsedSerp {
  const { items } = resultBlock(env);
  const organic = items.filter((i) => i.type === "organic").map((i) => ({
    rank: Number(i.rank_absolute ?? i.rank_group ?? 0), domain: String(i.domain ?? ""), url: String(i.url ?? ""), title: str(i.title),
  }));
  const paaBlock = items.find((i) => i.type === "people_also_ask");
  const paaQuestions = (Array.isArray(paaBlock?.items) ? (paaBlock!.items as Record<string, unknown>[]) : [])
    .map((el) => ({ question: String(el.title ?? ""), answeringDomain: null as string | null })).filter((q) => q.question.length > 0);
  const relBlock = items.find((i) => i.type === "related_searches");
  const relatedSearches = (Array.isArray(relBlock?.items) ? (relBlock!.items as unknown[]) : []).map((s) => String(s)).filter((s) => s.length > 0);
  const fs = items.find((i) => i.type === "featured_snippet");
  const snippetOwner = fs && fs.url ? { domain: String(fs.domain ?? hostname(String(fs.url))), url: String(fs.url) } : null;

  const aiBlock = items.find((i) => i.type === "ai_overview");
  let aiOverview: ParsedSerp["aiOverview"] = null;
  if (aiBlock) {
    const inner = Array.isArray(aiBlock.items) ? (aiBlock.items as Record<string, unknown>[]) : [];
    const references: { url: string; domain: string; title: string | null }[] = [];
    let excerpt: string | null = null;
    for (const el of inner) {
      if (excerpt === null) excerpt = str(el.text) ?? str(el.markdown);
      for (const r of Array.isArray(el.references) ? (el.references as Record<string, unknown>[]) : []) {
        const url = String(r.url ?? "");
        if (url) references.push({ url, domain: String(r.domain ?? hostname(url)), title: str(r.title) });
      }
    }
    aiOverview = { present: true, references, excerpt };
  }
  return { organic, aiOverview, snippetOwner, paaQuestions, relatedSearches };
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
      if (Array.isArray(sec.annotations)) {
        citations = citations ?? [];
        for (const a of sec.annotations as Record<string, unknown>[]) {
          const url = String(a.url ?? "");
          if (url) citations.push({ url, domain: hostname(url), title: str(a.title) });
        }
      }
    }
  }
  return {
    answerText: texts.length ? texts.join("\n") : null, modelServed: str(result0?.model_name),
    webSearchReported: web, citations, fanOutQueries: arrStr(result0?.fan_out_queries), brands: null,
  };
}
function parseScraper(env: ProviderEnvelope): ParsedAiAnswer {
  const { result0 } = resultBlock(env);
  const sources = Array.isArray(result0?.sources) ? (result0!.sources as Record<string, unknown>[]) : null;
  const citations = sources
    ? sources.map((s) => ({ url: String(s.url ?? ""), domain: String(s.domain ?? hostname(String(s.url ?? ""))), title: str(s.title) })).filter((c) => c.url.length > 0)
    : null;
  return {
    answerText: str(result0?.markdown), modelServed: str(result0?.model), webSearchReported: null,
    citations, fanOutQueries: arrStr(result0?.fan_out_queries), brands: brandNames(result0?.brand_entities),
  };
}
function parseModels(env: ProviderEnvelope): ParsedModels {
  return { models: modelObjects(env).map((m) => str(m.model_name)).filter((s): s is string => s !== null) };
}
function modelObjects(env: ProviderEnvelope): Record<string, unknown>[] {
  const result = env.tasks?.[0]?.result;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}
// ── small pure helpers ──
function loc(i: CapabilityInput): number { return typeof i.location_code === "number" ? i.location_code : LOCATION_US; }
function lang(i: CapabilityInput): string { return typeof i.language_code === "string" && i.language_code ? i.language_code : LANG_EN; }
function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function str(v: unknown): string | null { return typeof v === "string" && v.length > 0 ? v : null; }
function arrStr(v: unknown): string[] | null { return Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.length > 0) : null; }
function brandNames(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((b) => (typeof b === "string" ? b : String((b as Record<string, unknown>)?.name ?? (b as Record<string, unknown>)?.entity ?? ""))).filter((s) => s.length > 0);
}
function hostname(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function canonicalUrl(url: string): string { try { const u = new URL(url); u.hash = ""; return u.toString(); } catch { return url.trim(); } }
function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
