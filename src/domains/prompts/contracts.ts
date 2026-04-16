/**
 * CX2 Design Lock — prompt identity, normalized result, run contract.
 *
 * These three types are the data integrity backbone of the native prompt
 * runner. They were locked BEFORE CX2 implementation began to prevent:
 *
 *   1. Prompt drift — changing prompt wording silently corrupts the
 *      pattern engine because outcomes shift without attribution. The
 *      PromptDefinition carries (id, version, content_hash) so every
 *      observation traces back to the exact prompt text that produced it.
 *
 *   2. Platform divergence — OpenAI, Perplexity, and SerpAPI return
 *      different response shapes. NormalizedObservation is the TARGET
 *      CONTRACT that every adapter maps into. Downstream code never
 *      touches raw platform responses.
 *
 *   3. Lost work — a partial run (3 of 100 prompts fail) must record
 *      what succeeded. PromptRun tracks per-prompt status so the
 *      orchestrator can resume or dead-letter individual failures
 *      without rerunning the whole audit.
 *
 * Rules:
 *   - These types are IMMUTABLE once CX2 ships. Additive fields only.
 *   - Every PromptAnswerObservation written by CX2 MUST reference a
 *     PromptDefinition (id + version) and a PromptRun (id).
 *   - NormalizedObservation is the adapter output — it feeds into the
 *     existing PromptAnswerObservation + DailyMetricSnapshot pipeline.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// 1. Prompt identity
// ---------------------------------------------------------------------------

export type PromptStrata =
  | "brand_category"   // "who are the best X builders in Y"
  | "geography"        // "builders in {city} for {project_type}"
  | "project_type"     // "which builder specializes in {project_type}"
  | "long_tail"        // budget, lot, timeline, permits
  | "comparative";     // "X vs Y" or "compare builders for Z"

export type PromptDefinition = {
  /** Stable slug-like identifier. Never changes even when text changes. */
  id: string;
  /** Bumps every time `template` text changes. Starts at 1. */
  version: number;
  /** SHA-256 of the raw template text. Detects drift between code and data. */
  content_hash: string;
  /** The prompt text with {variables}: {city}, {service}, {budget}, etc. */
  template: string;
  /** Topic cluster this prompt targets (e.g., "custom_home_builder"). */
  topic_cluster: string;
  /** Stratification bucket for sampling. */
  strata: PromptStrata;
  /** Whether this prompt is included in audit runs. */
  is_active: boolean;
};

/**
 * Compute the content hash for a prompt template. Uses SHA-256 truncated
 * to 16 hex chars — enough to detect text drift, short enough to store.
 */
export function hashPromptTemplate(template: string): string {
  return createHash("sha256").update(template.trim()).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// 2. Normalized observation — the target contract for all adapters
// ---------------------------------------------------------------------------

export type NormalizedCitation = {
  /** Full URL as returned by the platform. */
  url: string;
  /** Page title from the citation, if available. */
  title: string | null;
  /** Position in the answer's citation list (1-based), if available. */
  position: number | null;
  /** True when the URL's domain matches the tenant's domain. */
  is_owned: boolean;
};

export type NormalizedEntity = {
  /** Name as it appeared in the answer text. */
  name: string;
  /** Classification. */
  type: "brand" | "competitor" | "other";
  /** How many times this entity appeared in the answer. */
  mention_count: number;
};

/**
 * The shape every platform adapter MUST return. Downstream code never
 * touches raw platform-specific response objects — only this contract.
 *
 * The parser (CX2.5) converts NormalizedObservation into the existing
 * PromptAnswerObservation + DailyMetricSnapshot pipeline, preserving
 * backward compat with all existing routes and domain modules.
 */
export type NormalizedObservation = {
  /** The full answer text from the platform. */
  answer_text: string;
  /** All citations extracted from the response. */
  citations: NormalizedCitation[];
  /** All entities (brands/competitors) detected in the answer. */
  entities_mentioned: NormalizedEntity[];
  /** Whether the tenant's brand was mentioned anywhere in the answer. */
  brand_mentioned: boolean;
  /** Whether the tenant's domain appeared in the citations. */
  brand_cited: boolean;
  /** SHA-256 of the raw response for dedup and audit trail. */
  raw_response_hash: string;
};

// ---------------------------------------------------------------------------
// 3. Run contract — tracks per-prompt execution status
// ---------------------------------------------------------------------------

export type PromptRunStatus =
  | "pending"     // queued, not started
  | "running"     // adapter call in flight
  | "completed"   // adapter returned, observation written
  | "failed"      // all retries exhausted or non-retryable error
  | "skipped";    // budget cap hit or cache hit (no API call made)

export type PromptRunError = {
  code: string;       // platform error code or "TIMEOUT" / "BUDGET_EXCEEDED"
  message: string;
  retryable: boolean;
};

/**
 * One row per (prompt × platform) in an audit run. The orchestrator
 * writes "pending" rows at run start, updates to "running" / "completed"
 * / "failed" / "skipped" as each call resolves.
 *
 * Partial recovery: on resume, the orchestrator queries for rows still
 * in "pending" or "running" (with stale timestamps) and retries them.
 * Already-"completed" rows are untouched.
 */
export type PromptRun = {
  /** Unique per execution (uuid). */
  id: string;
  /** The audit/rerun this belongs to. */
  audit_run_id: string;
  /** Owning tenant. */
  tenant_id: string;
  /** Which prompt was executed. */
  prompt_definition_id: string;
  /** Version of the prompt AT THE TIME OF EXECUTION. Immutable once set. */
  prompt_version: number;
  /** Which platform this execution targets. */
  platform: "chatgpt" | "perplexity" | "google_aio";
  /** Lifecycle status. */
  status: PromptRunStatus;
  /** How many adapter calls were attempted (including retries). */
  attempts: number;
  /** Max retries before marking failed. */
  max_attempts: number;
  /** Cumulative API cost for this prompt×platform. */
  cost_usd: number;
  /** When the first attempt started. Null if still pending. */
  started_at: string | null;
  /** When the final status was set. Null if not terminal. */
  completed_at: string | null;
  /** Last error, if any. Null on success or skip. */
  error: PromptRunError | null;
  /** The rendered prompt text that was sent (after variable substitution). */
  rendered_prompt: string;
};

// ---------------------------------------------------------------------------
// Audit run — the parent container for all prompt runs in one pass
// ---------------------------------------------------------------------------

export type AuditRunType = "audit" | "daily_rerun";

export type AuditRunStatus =
  | "running"
  | "completed"
  | "completed_partial"  // some prompts failed but most succeeded
  | "failed";            // >50% of prompts failed

export type AuditRun = {
  id: string;
  tenant_id: string;
  run_type: AuditRunType;
  status: AuditRunStatus;
  /** Total prompt×platform pairs in this run. */
  total_prompt_runs: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  /** Cumulative cost across all prompt runs. */
  total_cost_usd: number;
  started_at: string;
  completed_at: string | null;
  /** Prompt definition versions used (for reproducibility). */
  prompt_version_snapshot: Record<string, number>; // prompt_id → version
};
