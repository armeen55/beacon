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
const ENGINE_PLAIN_NAME: Record<EngineId, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};

// ---------------------------------------------------------------------------
// COST DISCIPLINE CONSTANTS (nightly ceilings). The DataForSEO calls ALSO ride
// the shared fail-closed monthly cap in dataforseo-serp.ts ($50/mo default),
// which is the real backstop; these bound the worst single night.
// ---------------------------------------------------------------------------

