import "server-only";
import type { PageIntersectionAsk, ParsedPageIntersection } from "../page-intersection";
import type { ResearchPageExtract } from "../funnel/research-evidence";

/**
 * funnel-boundary (Slice 6 + integrity closure) - THE frozen seam between the
 * DataForSEO transport/cache/money core (dataforseo/) and the research funnel.
 *
 * Frozen rules:
 *   - No caller constructs provider URLs or request bodies. Every provider call names a CAPABILITY from
 *     the typed registry; the registry owns the exact POST/Live path, the GET derivation, the request
 *     builder with the provider's REQUIRED fields, the parser, cache dimensions, freshness, reservation.
 *   - ENVELOPE RULE: the boundary caches and returns the FULL bounded provider envelope ({ status_code,
 *     cost?, tasks: [...] }); ONLY registry parsers read inside it. Hits and fresh results normalize alike.
 *   - CACHE identity is PUBLIC (endpoint + version + normalized input + location + language + device +
 *     model). PAID-ATTEMPT identity is account-scoped (tenantId + unitKey). A hit reserves and records $0.
 *   - Money order is reserve -> network -> reconcile, atomic in Postgres.
 *   - "waiting" is durable and resumable; never an error, never completion.
 *   - Standard task posts carry the deterministic cacheKey as the provider `tag`, and a pre-post attempt
 *     receipt is persisted so an uncertain post outcome is never silently reposted.
 */

// ── capability registry (frozen keys + shape; entries live in capabilities.ts) ──

export type CapabilityKey =
  | "labs_keywords_for_site"
  | "labs_ranked_keywords"
  | "labs_related_keywords"
  | "labs_keyword_suggestions"
  | "labs_keyword_overview"
  | "labs_keyword_ideas"
  | "labs_serp_competitors"
  | "labs_page_intersection"
  | "onpage_content_parsing"
  | "serp_organic"
  | "serp_ai_mode"
  | "llm_chatgpt"
  | "llm_gemini"
  | "llm_claude"
  | "llm_perplexity"
  | "llm_scraper_chatgpt";

/** The full bounded provider envelope the boundary caches and returns. */
export type ProviderEnvelope = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{
    id?: string;
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: unknown;
  }>;
};

/** Typed parser outputs (frozen; the funnel consumes ONLY these shapes). */
export type ParsedKeywordItem = {
  keyword: string;
  searchVolume: number | null;
  cpcUsd: number | null;
  competition: number | null;
  /** The provider's OWN competition label, kept because a band we derive from the numeric score is a
   *  guess and this one is not. null = the provider sent none. */
  competitionLevel: "low" | "medium" | "high" | null;
  difficulty: number | null;
  intent: string | null;
  /** ranked_keywords only: the page that ACTUALLY ranks for this keyword and its ORGANIC position
   *  (rank_group; rank_absolute counts ads and packs). null on every other endpoint, and null rather
   *  than a guess when the provider sent no element. */
  rankedUrl: string | null;
  rankedRank: number | null;
  /** The 12-month trend, ONLY when the provider actually returned it. null = no
   *  trend on this response; [] = an empty trend it really sent. A month whose
   *  volume is absent stays null, because "unknown" is not "zero searches". */
  monthlySearches: { year: number; month: number; volume: number | null }[] | null;
};
export type ParsedSerp = {
  organic: { rank: number; domain: string; url: string; title: string | null }[];
  aiOverview: { present: boolean; references: { url: string; domain: string; title: string | null }[]; excerpt: string | null } | null;
  paaQuestions: { question: string; answeringDomain: string | null }[];
  relatedSearches: string[];
};
export type ParsedAiAnswer = {
  answerText: string | null;
  modelServed: string | null;
  /** Provider-REPORTED web-search state; null = not reported. */
  webSearchReported: boolean | null;
  /** null = citations not observable on this path; [] = observed zero. */
  citations: { url: string; domain: string; title: string | null }[] | null;
  /** null = not observable on this path. */
  fanOutQueries: string[] | null;
  /** Pages the engine RETRIEVED and did NOT cite (llm_scraper search_results). Kept
   *  strictly apart from citations: "it read this" and "it credited this" are
   *  different claims. null = not observable on this path; [] = observed zero. */
  retrievedResults: { url: string; domain: string; title: string | null }[] | null;
  /** Brands the provider itself named in the answer (llm_scraper brand_entities),
   *  never a name we matched ourselves. null = not observable; [] = observed zero. */
  brandMentions: string[] | null;
};
/** ONE domain that keeps coming up across a case's whole keyword set, from serp_competitors. `rating` is the
 *  provider's own composite, NOT a rank; `avgPosition` is its average organic position over those keywords;
 *  `keywordsCount` is how many of them it comes up for. A metric the provider did not send stays null. */
type ParsedSerpCompetitor = { domain: string; avgPosition: number | null; rating: number | null; keywordsCount: number | null };

export type ParsedByCapability = {
  labs_keywords_for_site: ParsedKeywordItem[];
  labs_ranked_keywords: ParsedKeywordItem[];
  labs_related_keywords: ParsedKeywordItem[];
  labs_keyword_suggestions: ParsedKeywordItem[];
  labs_keyword_overview: ParsedKeywordItem[];
  labs_keyword_ideas: ParsedKeywordItem[];
  labs_serp_competitors: ParsedSerpCompetitor[];
  labs_page_intersection: ParsedPageIntersection;
  /** Parsed DIRECTLY into the ONE extract shape every winner already carries: no second extract model. */
  onpage_content_parsing: ResearchPageExtract;
  serp_organic: ParsedSerp;
  serp_ai_mode: ParsedSerp;
  llm_chatgpt: ParsedAiAnswer;
  llm_gemini: ParsedAiAnswer;
  llm_claude: ParsedAiAnswer;
  llm_perplexity: ParsedAiAnswer;
  llm_scraper_chatgpt: ParsedAiAnswer;
};

/** TYPED capability inputs: the ONLY shapes a caller may hand the boundary.
 *  Every field is a real provider field for that endpoint (web_search flags are
 *  engine-specific; the scraper is KEYWORD-based, never user_prompt). The model
 *  is NEVER caller-supplied: providerCall resolves the one method-compatible
 *  model, so a Live-only model can never ride a Standard route. A wrong or
 *  cross-engine field fails TypeScript, not production.
 *  ChatGPT and Claude are DIFFERENT contracts (live-verified 2026-07-25):
 *  ChatGPT llm_responses rejects force_web_search on reasoning models (in-body
 *  40501) and every current ChatGPT model reports reasoning true, so ChatGPT
 *  accepts web_search ONLY, never force or country. Claude documents force +
 *  country and conflicts only with use_reasoning, which Beacon never sends. The
 *  dedicated ChatGPT SCRAPER is a separate API where force is documented. */
export type ChatGptWebInput = { user_prompt: string; web_search?: boolean };
export type ClaudeWebInput = { user_prompt: string; web_search?: boolean; force_web_search?: boolean; web_search_country_iso_code?: string };
/** THE observation identity every LLM ask carries: which reporting day this reading belongs to, and which
 *  deliberate sample of that day it is. NEITHER is ever sent to the provider (no builder emits them); they
 *  exist so the cache identity tells three different questions apart. Without them a second sample was a
 *  byte-identical $0 replay of the first, and a 23:00 Monday answer could be re-served as Tuesday's. */
export type ObservationIdentity = { observation_day?: string; sample_slot?: number };
export type CapabilityInputByKey = {
  labs_keywords_for_site: { target: string; limit?: number };
  labs_ranked_keywords: { target: string; limit?: number };
  labs_related_keywords: { keyword: string; depth?: number; limit?: number };
  labs_keyword_suggestions: { keyword: string; limit?: number };
  labs_keyword_overview: { keywords: string[] };
  /** keyword_ideas takes SEED keywords (documented maximum 200 per request) and
   *  returns ideas that share their topic. limit defaults to 700 and the provider
   *  caps it at 1000. Callers use keywordIdeasBatched, never one request per seed. */
  labs_keyword_ideas: { keywords: string[]; limit?: number };
  /** The domains that recur across a WHOLE keyword set (documented maximum 200 keywords per
   *  request, limit default 100 and maximum 1000). One request per case, never one per keyword. */
  labs_serp_competitors: { keywords: string[]; limit?: number };
  /** ONE request carries the WHOLE page set (documented maximum 20 pages, 10
   *  excludes): one call per page or per keyword is a defect, never a fallback. The
   *  registry normalizes the ask BEFORE it becomes a cache identity. */
  labs_page_intersection: PageIntersectionAsk;
  /** ONE public page read of a body my own fetch could not get. NEVER used after a robots denial. */
  onpage_content_parsing: { url: string };
  serp_organic: { keyword: string; device?: "desktop" | "mobile" };
  serp_ai_mode: { keyword: string; device?: "desktop" | "mobile" };
  llm_chatgpt: ChatGptWebInput & ObservationIdentity;
  llm_claude: ClaudeWebInput & ObservationIdentity;
  /** Gemini supports web_search only; never send ChatGPT/Claude-only fields. */
  llm_gemini: { user_prompt: string; web_search?: boolean } & ObservationIdentity;
  llm_perplexity: { user_prompt: string; web_search_country_iso_code?: string } & ObservationIdentity;
  llm_scraper_chatgpt: { keyword: string; force_web_search?: boolean; expand_citations?: boolean } & ObservationIdentity;
};

/** Method-aware model resolution: the exact current model, the retrieval method it supports, and whether
 *  it can do web search, from the FREE models endpoint. Routing is CAPABILITY DRIVEN per engine: a
 *  web-capable task_post_supported model -> resumable Standard; else a valid Live model -> Live. Null =
 *  fail closed. providerCall is the ONE resolution point; the requested model travels back on the result. */
export type EngineModelResolution = { model: string; method: "standard" | "live"; webSearch: boolean };

/** THE structured lifecycle vocabulary. Callers NEVER parse detail strings or treat every error
 *  identically; the disposition alone decides retry behavior.
 *    retry_free  - an exactly documented temporary provider failure on a FREE collect: the task id is
 *                  PRESERVED; retry later; ZERO reposts.
 *    repost_once - the task is proven missing/expired by an EXACT in-body 40401/40403 on a collect (never
 *                  a raw HTTP status, never a POST response): identity cleared; at most ONE clean repost.
 *    blocked     - a terminal, malformed, auth/payment, or unknown outcome. On a PAID response the
 *                  refusal is held DURABLY (refunded when the provider reported cost 0) and nothing
 *                  automatic retries it; on a FREE collect the task id is kept and re-checked for free.
 *                  The funnel surfaces it as explicit unavailable coverage.
 *    quarantined - an uncertain POST or an accepted task whose id could not be persisted: ZERO automatic
 *                  reposts ever; recovery ONLY via the FREE tasks_ready listing matched by tag=cacheKey.
 *    none        - a plain recoverable failure (claim/reserve/persist): retry the whole call later.
 *    daily_limit - the account's own daily spend ceiling refused the call at zero charge. It stops the
 *                  batch for the day like a refusal, but holds nothing and clears itself. */
export type FailureDisposition = "retry_free" | "repost_once" | "blocked" | "quarantined" | "daily_limit" | "none";

export type CachedCallResult =
  | { state: "hit"; envelope: ProviderEnvelope; costUsd: 0; cacheKey: string; modelServed: string | null }
  | { state: "ok"; envelope: ProviderEnvelope; costUsd: number; cacheKey: string; modelServed: string | null; modelRequested?: string | null }
  /** waiting = GENUINE queue/in-flight work only (40601/40602, a live claim, or
   *  a transport blip on the free GET): the task id is preserved and the next
   *  visit collects for free. costUsd on waiting = the provider-reported cost of
   *  a NEWLY accepted task POST, contributed exactly once; 0 otherwise. */
  | { state: "waiting"; cacheKey: string; providerTaskId: string | null; costUsd: number; modelRequested?: string | null; detail: string }
  | { state: "not_configured" | "capped"; cacheKey: string | null; detail: string }
  | { state: "error"; cacheKey: string | null; disposition: FailureDisposition; detail: string };

export type FunnelBoundaryDeps = Record<string, unknown>;

/**
 * THE one cached, money-safe provider call, by capability. Implemented in cached-call.ts +
 * capabilities.ts; these re-exports are the frozen import path for the funnel.
 *   providerCall<K> - resolve/claim/pay/persist one capability request; input is
 *     CapabilityInputByKey[K], enforced at compile time.
 *   keywordIdeasBatched - the SAME providerCall, run once per batch of at most 200 seed keywords (the
 *     provider's documented ceiling). Buying one request per keyword is a defect, so no caller does.
 *   collectCapability - free GET resumption for a waiting Standard task row. Queue codes (40601/40602)
 *     stay waiting; terminal codes (40401/40403, auth/payment/contract) are bounded errors.
 *   parseCapability - envelope -> the capability's typed parse output.
 *   resolveEngineModel - EngineModelResolution (model + supported method) from the FREE models endpoint
 *     (cached); null = fail closed.
 *   readPublicPageExtract / writePublicPageExtract - content-hash-aware reuse of read public competitor
 *     pages on the SAME evidence cache (no second crawler subsystem, no re-read inside freshness).
 */
export {
  providerCall, keywordIdeasBatched, collectCapability, parseCapability, resolveEngineModel,
} from "./capabilities";
export { readPublicPageExtract, writePublicPageExtract } from "./page-extract-cache";

// ── funnel phase executor contract (consumed by Runtime via the facade) ─────

export type FunnelCounters = {
  rawKeywords?: number;
  normalizedKeywords?: number;
  retainedKeywords?: number;
  rejectedKeywords?: number;
  promptsChecked?: number;
  enginePairsDone?: number;
  enginePairsIntended?: number;
  serpsAnalyzed?: number;
  /** Pages I actually went out and read this cycle, successes and failures alike. */
  pageReadsAttempted?: number;
  cacheHits?: number;
  spendUsd?: number;
};

export type FunnelUnitOutcome = {
  /** advanced = real progress persisted; waiting = durable provider work pending
   *  (resume later, NOT failure/completion); done = phase complete; failed =
   *  bounded recoverable failure (Runtime pauses the run honestly). */
  status: "advanced" | "waiting" | "done" | "failed";
  cursor: Record<string, unknown> | null;
  progress: FunnelCounters;
  detail?: string;
  /** STRUCTURED failure discriminant, set ONLY where an executor catches a state
   *  conflict: the research notes moved underneath this writer, so NOTHING was
   *  persisted and these counters are a stale snapshot (the per-run receipt reads
   *  zero). Runtime decides on this CODE and never parses the customer copy. */
  code?: "state_conflict";
};

/** Runtime injects the account's CURRENT onboarding basis into the cursor as
 *  `basis` (computed from the one Account fingerprint); executors fail closed
 *  without it and scope every derived read/write to it. */
export type FunnelUnitFn = (
  tenantId: string,
  cursor: Record<string, unknown> | null,
  budgetMs: number,
) => Promise<FunnelUnitOutcome>;
