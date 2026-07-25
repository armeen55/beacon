import "server-only";

/**
 * funnel-boundary (Slice 6 + integrity closure) - THE frozen seam between the
 * DataForSEO transport/cache/money core (dataforseo/) and the research funnel.
 *
 * Frozen rules:
 *   - No caller constructs provider URLs or request bodies. Every provider call
 *     names a CAPABILITY from the typed registry; the registry owns the exact
 *     POST/Live path, the GET derivation, the request builder with the
 *     provider's REQUIRED fields (model_name where the endpoint demands it),
 *     the response parser, cache dimensions, freshness, and the conservative
 *     reservation.
 *   - ENVELOPE RULE: the boundary caches and returns the FULL bounded provider
 *     envelope ({ status_code, cost?, tasks: [...] }); ONLY registry parsers
 *     read inside it. Cache hits and fresh results normalize identically.
 *   - CACHE identity is PUBLIC (endpoint + version + normalized input +
 *     location + language + device + model). PAID-ATTEMPT identity is
 *     account-scoped (tenantId + unitKey). A hit reserves and records $0.
 *   - Money order is reserve -> network -> reconcile, atomic in Postgres.
 *   - "waiting" is durable and resumable; never an error, never completion.
 *   - Standard task posts carry the deterministic cacheKey as the provider
 *     `tag`, and a pre-post attempt receipt is persisted so an uncertain post
 *     outcome is never silently reposted.
 */

// ── capability registry (frozen keys + shape; entries live in capabilities.ts) ──

export type CapabilityKey =
  | "labs_keywords_for_site"
  | "labs_ranked_keywords"
  | "labs_related_keywords"
  | "labs_keyword_suggestions"
  | "labs_keyword_overview"
  | "serp_organic"
  | "serp_ai_mode"
  | "llm_chatgpt"
  | "llm_gemini"
  | "llm_claude"
  | "llm_perplexity"
  | "llm_scraper_chatgpt"
  | "engine_models";

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
  difficulty: number | null;
  intent: string | null;
  monthlySearches: { year: number; month: number; volume: number }[];
};
export type ParsedSerp = {
  organic: { rank: number; domain: string; url: string; title: string | null }[];
  aiOverview: { present: boolean; references: { url: string; domain: string; title: string | null }[]; excerpt: string | null } | null;
  snippetOwner: { domain: string; url: string } | null;
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
  brands: string[] | null;
};
export type ParsedModels = { models: string[] };

export type ParsedByCapability = {
  labs_keywords_for_site: ParsedKeywordItem[];
  labs_ranked_keywords: ParsedKeywordItem[];
  labs_related_keywords: ParsedKeywordItem[];
  labs_keyword_suggestions: ParsedKeywordItem[];
  labs_keyword_overview: ParsedKeywordItem[];
  serp_organic: ParsedSerp;
  serp_ai_mode: ParsedSerp;
  llm_chatgpt: ParsedAiAnswer;
  llm_gemini: ParsedAiAnswer;
  llm_claude: ParsedAiAnswer;
  llm_perplexity: ParsedAiAnswer;
  llm_scraper_chatgpt: ParsedAiAnswer;
  engine_models: ParsedModels;
};

/** Capability inputs are PUBLIC identity fields; the registry builder turns them
 *  into the exact provider body (adding location/language/model as the endpoint
 *  REQUIRES) and they double as the cache-identity input hash. */
export type CapabilityInput = Record<string, unknown>;

export type CachedCallResult =
  | { state: "hit"; envelope: ProviderEnvelope; costUsd: 0; cacheKey: string; modelServed: string | null }
  | { state: "ok"; envelope: ProviderEnvelope; costUsd: number; cacheKey: string; modelServed: string | null }
  | { state: "waiting"; cacheKey: string; providerTaskId: string | null; detail: string }
  | { state: "not_configured" | "dry_run" | "capped" | "error"; cacheKey: string | null; detail: string };

export type FunnelBoundaryDeps = Record<string, unknown>;

/**
 * THE one cached, money-safe provider call, by capability. Implemented in
 * cached-call.ts + capabilities.ts (Agent A); these re-exports are the frozen
 * import path for the funnel.
 *   providerCall    - resolve/claim/pay/persist one capability request.
 *   collectCapability - free GET resumption for a waiting Standard task row.
 *   parseCapability - envelope -> the capability's typed parse output.
 *   resolveEngineModel - the exact full model id for an engine, from the FREE
 *     models endpoint (cached), method-compatible, with a validated fallback.
 *   readPublicPageExtract / writePublicPageExtract - content-hash-aware reuse
 *     of fetched public competitor pages on the SAME evidence cache (no second
 *     crawler subsystem, no refetch inside freshness).
 */
export {
  providerCall,
  collectCapability,
  parseCapability,
  resolveEngineModel,
  readPublicPageExtract,
  writePublicPageExtract,
} from "./capabilities";

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
  winningPagesFetched?: number;
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
};

/** Runtime injects the account's CURRENT onboarding basis into the cursor as
 *  `basis` (computed from the one Account fingerprint); executors fail closed
 *  without it and scope every derived read/write to it. */
export type FunnelUnitFn = (
  tenantId: string,
  cursor: Record<string, unknown> | null,
  budgetMs: number,
) => Promise<FunnelUnitOutcome>;
