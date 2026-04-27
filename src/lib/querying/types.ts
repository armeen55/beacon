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
