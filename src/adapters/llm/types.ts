/**
 * Shared types for all LLM platform adapters.
 *
 * Every adapter exports a single `query()` function that:
 *   1. Sends a rendered prompt to the platform
 *   2. Returns a NormalizedObservation (or throws on unrecoverable error)
 *   3. Records spend via the cost ledger
 *
 * Platform-specific raw responses are NEVER leaked to callers.
 */

import type { NormalizedObservation } from "@/domains/prompts/contracts";

export type PlatformId = "chatgpt" | "perplexity" | "google_aio";

export type AdapterQueryOpts = {
  /** Fully rendered prompt text. */
  prompt: string;
  /** Tenant ID (for cost tracking and brand resolution). */
  tenantId: string;
  /** Tenant domain (for owned-citation detection). */
  tenantDomain: string;
  /** Brand aliases (for mention detection in answer text). */
  brandAliases: string[];
  /** Abort signal for timeout enforcement. */
  signal?: AbortSignal;
};

export type AdapterResult = {
  observation: NormalizedObservation;
  cost_usd: number;
  latency_ms: number;
};

/**
 * Every platform adapter must implement this interface.
 * The orchestrator calls `query()` and handles retry/timeout/budget.
 */
export type PlatformAdapter = {
  platform: PlatformId;
  /** Estimated cost in USD for one query. Used by budget check. */
  estimateCostUsd(): number;
  /** Execute the prompt and return normalized observation. */
  query(opts: AdapterQueryOpts): Promise<AdapterResult>;
};
