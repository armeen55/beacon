/**
 * ai-visibility engine types (2026-07-01, master plan item 4) - the shared
 * vocabulary for running the tenant prompt library across 4 AI engines
 * nightly and diffing per-engine gaps. PURE module (no server-only) so the
 * gap math, the candidate feed, and client-safe copy can all import it.
 *
 * Engine reality on this deployment:
 *   - chatgpt    -> native OpenAI key (OPENAI_API_KEY)
 *   - perplexity -> native Perplexity key (PERPLEXITY_API_KEY) when present
 *   - gemini     -> DataForSEO ai_optimization/gemini/llm_responses (~$0.03/call)
 *   - claude     -> DataForSEO ai_optimization/claude/llm_responses (~$0.03/call)
 * Engines without a usable path are SKIPPED and every downstream surface says
 * which engines were actually checked - no pretend coverage, ever.
 */

/** The four engines the nightly poll can cover. Platform values written to
 *  prompt_answer_observations use these exact strings; "chatgpt" and
 *  "perplexity" intentionally match the existing native-poll platform labels
 *  so historical reads keep working unchanged. */
export type EngineId = "chatgpt" | "perplexity" | "gemini" | "claude";

export const ALL_ENGINES: readonly EngineId[] = ["chatgpt", "perplexity", "gemini", "claude"];

/** Operator-facing engine names (plain business language). */
export const ENGINE_PLAIN_NAME: Record<EngineId, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};

/** `source` stamped on observation_runs + observation metadata, one per
 *  engine. NEW values (additive): the legacy chunked pipeline's
 *  "openai-native-poll" / "perplexity-native-poll" sources and poll-health's
 *  4-chunk contract are left untouched - poll-health simply does not count
 *  these runs, which is correct (different pipeline, different shape). */
export const ENGINE_OBSERVATION_SOURCE: Record<EngineId, string> = {
  chatgpt: "ai-engines-openai",
  perplexity: "ai-engines-perplexity",
  gemini: "ai-engines-dataforseo-gemini",
  claude: "ai-engines-dataforseo-claude",
};

// ---------------------------------------------------------------------------
// COST DISCIPLINE CONSTANTS (nightly ceilings). The DataForSEO calls ALSO ride
// the shared fail-closed monthly cap in dataforseo-serp.ts ($50/mo default),
// which is the real backstop; these bound the worst single night.
// ---------------------------------------------------------------------------

/** Top-N tracked prompts per night, in prompt-library order. */
export const NIGHTLY_PROMPT_CAP = 25;

/** Engines that go through the paid DataForSEO llm_responses path. */
export const DATAFORSEO_ENGINES: readonly EngineId[] = ["gemini", "claude"];

/** How many engine-gap findings may feed the daily candidate builder per
 *  night. Bounded so gaps season the plan instead of flooding it. */
export const MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT = 3;
