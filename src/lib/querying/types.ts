import "server-only";

export type CitationRef = {
  url: string;
  domain: string;
  title: string | null;
  position: number | null;
};

export type AnswerSnapshot = {
  id: string;
  prompt_id: string;
  prompt_text: string;
  platform: string;
  model: string;
  answer_text: string;
  citations: CitationRef[];
  entities_mentioned: string[];
  sampled_at: string;
  run_id: string;
  source_system: "beacon_native" | "profound_import";
};

export type SamplingRunConfig = {
  max_prompts: number;
  concurrency: number;
  delay_ms: number;
  platform: string;
  model: string;
};

export type SamplingRunResult = {
  run_id: string;
  started_at: string;
  completed_at: string;
  prompts_sampled: number;
  snapshots_created: number;
  errors: number;
};

/**
 * Sprint 6A.3a (2026-04-26) — optional usage metadata returned by every
 * `QueryClient.sample()` implementation. The polling adapter uses this to
 * estimate per-call cost via `src/lib/cost/pricing.ts`. Both fields are
 * optional so older mocks / future provider clients that don't (or can't)
 * surface usage continue to compile; the cost estimator returns `0` when
 * `usage` is missing — conservative fallback that never crashes the loop.
 *
 * NO behavior change to any caller in 6A.3a. The pollPerplexityForTenant
 * loop ignores `usage` until 6A.3c wires it into spend tracking.
 */
export type QueryUsage = {
  /** Provider-reported input/prompt tokens. */
  inputTokens: number;
  /** Provider-reported output/completion tokens. */
  outputTokens: number;
  /**
   * Number of `web_search_preview` (or equivalent) tool invocations the
   * provider performed for this call. OpenAI Responses API only —
   * undefined for Perplexity sonar (where search cost is bundled into
   * the per-token pricing). Counted by inspecting `output[].type` items.
   */
  webSearchCalls?: number;

  // ─ Sprint 6A.2g.D (2026-04-26) — max-extraction. ──────────────────
  // Every field below is optional. OpenAI Responses API populates them
  // when present; Perplexity Sonar does NOT expose them (no internal
  // queries surfaced to the API consumer) and continues to populate
  // only the original three fields above. Honest blind spot — when a
  // Perplexity row arrives with these undefined, the polling adapter
  // marks `metadata.blindSpot` so the operator knows it's by design.

  /**
   * Verbatim per-tool-invocation extraction from
   * `output[].type === "web_search_call"` items. Order preserved.
   * `status: "in_progress"` items are NOT filtered (Q3 — preserve
   * status verbatim). Empty array means the model made zero tool
   * calls for this prompt; `undefined` means the provider doesn't
   * surface this signal at all.
   */
  webSearchQueries?: Array<{
    /** OpenAI `ws_*` id when present. */
    id?: string;
    /** "completed" | "in_progress" | etc — verbatim from the API. */
    status: string;
    /** `action.type`, e.g. "search" or "open_page". */
    actionType?: string;
    /** Search query string when actionType === "search". */
    query?: string;
    /** Page URL when actionType === "open_page". */
    url?: string;
  }>;

  /**
   * Deduped list of `action.url` values where actionType === "open_page".
   * Order-preserving (first occurrence wins). Lets the recommendation
   * packet builder cite "the AI opened these pages" without scanning
   * the full webSearchQueries array.
   */
  openPageUrls?: string[];

  /** OpenAI `system_fingerprint` — the model snapshot identifier. */
  systemFingerprint?: string | null;
  /** OpenAI `service_tier` — "default" | "scale" | etc. */
  serviceTier?: string | null;
  /**
   * Tokens spent on reasoning (gpt-5-mini and reasoning-class models).
   * Sourced from `usage.output_tokens_details.reasoning_tokens`.
   */
  reasoningTokens?: number;
  /**
   * Cached input tokens — billed at the discounted rate. Sourced from
   * `usage.input_tokens_details.cached_tokens`.
   */
  cachedTokens?: number;
  /**
   * Refusal text when the model declined the prompt. Sourced from
   * the message's `content[].refusal` field. Null when the model
   * answered normally.
   */
  refusalText?: string | null;
  /**
   * Finish reason for the message. "stop" | "length" | "tool_calls"
   * | "content_filter" | "function_call" | etc. Null when the
   * provider doesn't surface it.
   */
  finishReason?: string | null;

  /**
   * Filtered + extracted forensic payload. Only the fields Beacon needs
   * for downstream re-fetch / debugging — NOT a copy of the full
   * `output[]` array (Q4 — answer text already lives in `answer_text`).
   * Capped at 20 tool calls to bound JSON-ledger row size.
   */
  providerRaw?: {
    /**
     * Up to 20 raw `web_search_call` items verbatim. When the provider
     * emits >20, the array is truncated (first 20) and `truncated`
     * flips to true. The cap is forensic — the extracted
     * `webSearchQueries` array carries the same data normalized.
     */
    toolCalls: Array<unknown>;
    /** True when the original `output[]` had more than 20 web_search_call items. */
    truncated: boolean;
    /**
     * Top-level `response.id` from the Responses API. Lets the operator
     * re-fetch the original payload via OpenAI's response API endpoint
     * for forensic inspection.
     */
    responseId: string | null;
  };
};

export interface QueryClient {
  platform: string;
  model: string;
  sample(prompt: string): Promise<{
    answer_text: string;
    citations: CitationRef[];
    model: string;
    /** Optional. Populated by 6A.3a; absent on legacy mocks. */
    usage?: QueryUsage;
  }>;
}

export const DEFAULT_SAMPLING_CONFIG: SamplingRunConfig = {
  max_prompts: 100,
  concurrency: 2,
  delay_ms: 1000,
  platform: "perplexity",
  model: "sonar",
};
