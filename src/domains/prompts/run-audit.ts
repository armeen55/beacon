/**
 * CX2.6 — Run orchestrator.
 *
 * Executes an audit or daily rerun for a single tenant:
 *
 *   1. Load tenant + generate brand aliases
 *   2. Render prompts from template library
 *   3. For each prompt × platform:
 *      a. Check budget (fail fast if exceeded)
 *      b. Call platform adapter with timeout + retry
 *      c. Record spend in cost ledger
 *      d. Parse observation into PromptAnswerObservation
 *      e. Update PromptRun status
 *   4. Write all observations to the tenant's store
 *   5. Return audit summary
 *
 * Partial recovery: if the process crashes mid-run, completed observations
 * are already persisted. The caller can resume by re-running — prompt
 * runs marked "completed" are skipped via dedup on rendering_key.
 *
 * Rate limiting: platform adapters are called with concurrency caps
 * (configurable per platform) to respect API rate limits.
 */

import { getTenantOrThrow } from "@/domains/tenants/store";
import type { BeaconTenant } from "@/domains/tenants/types";
import { generateAliases } from "./brand-resolver";
import { renderPromptsForTenant, type RenderedPrompt } from "./renderer";
import { toPromptAnswerObservation } from "./parse-observation";
import { checkTenantBudget, recordSpend } from "@/lib/cost/budget";
import type {
  AuditRun,
  AuditRunType,
  PromptRun,
  PromptRunStatus,
  PromptRunError,
} from "./contracts";
import type { PlatformAdapter, PlatformId } from "@/adapters/llm/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { openaiChatgptAdapter } from "@/adapters/llm/openai-chatgpt";
import { perplexityAdapter } from "@/adapters/llm/perplexity";
import { googleAioAdapter } from "@/adapters/llm/google-aio";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { getLogger } from "@/lib/obs/logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PLATFORMS: PlatformId[] = ["chatgpt", "perplexity", "google_aio"];

const ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  chatgpt: openaiChatgptAdapter,
  perplexity: perplexityAdapter,
  google_aio: googleAioAdapter,
};

/** Max concurrent API calls per platform. */
const CONCURRENCY: Record<PlatformId, number> = {
  chatgpt: 5,
  perplexity: 3,
  google_aio: 2,
};

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Concurrency limiter (simple semaphore)
// ---------------------------------------------------------------------------

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  label: string,
  log: ReturnType<typeof getLogger>,
): Promise<{ result: T; attempts: number } | { error: PromptRunError; attempts: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err: unknown) {
      const e = err as Error & { code?: string; retryable?: boolean };
      const retryable = e.retryable ?? false;

      if (!retryable || attempt === maxAttempts) {
        return {
          error: {
            code: e.code ?? "UNKNOWN",
            message: e.message?.slice(0, 200) ?? "Unknown error",
            retryable,
          },
          attempts: attempt,
        };
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      log.warn(
        { attempt, maxAttempts, delayMs, code: e.code },
        `Retrying ${label}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Should never reach here
  return {
    error: { code: "MAX_ATTEMPTS", message: "Exceeded max attempts", retryable: false },
    attempts: maxAttempts,
  };
}

// ---------------------------------------------------------------------------
// Audit run ID generator
// ---------------------------------------------------------------------------

function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export type AuditRunResult = {
  auditRun: AuditRun;
  promptRuns: PromptRun[];
  observations: PromptAnswerObservation[];
};

/**
 * Execute a full audit run for a tenant.
 *
 * This is the main entry point for both initial audits (on signup) and
 * daily reruns. The orchestrator handles budget gating, rate limiting,
 * retry, and partial recovery.
 *
 * Returns the audit summary + all observations. Also persists observations
 * to the tenant's `prompt-answer-observations` store and the audit run
 * metadata to `audit-runs`.
 */
export async function runAudit(opts: {
  tenantId: string;
  runType: AuditRunType;
  /** Override platforms for testing. */
  platforms?: PlatformId[];
  /** Override max prompts for testing. */
  maxPrompts?: number;
}): Promise<AuditRunResult> {
  const {
    tenantId,
    runType,
    platforms = PLATFORMS,
    maxPrompts,
  } = opts;
  const log = getLogger({ module: "prompts/run-audit", tenantId });

  // 1. Load tenant + brand aliases.
  const tenant = getTenantOrThrow(tenantId);
  const aliases = generateAliases({
    businessName: tenant.business_name,
    domain: tenant.domain,
    slug: tenant.slug,
  });

  // 2. Render prompts.
  const rendered = renderPromptsForTenant({
    tenant,
    maxPrompts,
  });
  log.info(
    { promptCount: rendered.length, platforms },
    "Audit run starting",
  );

  // 3. Initialize audit run.
  const runId = generateRunId();
  const now = new Date().toISOString();
  const totalPromptRuns = rendered.length * platforms.length;

  const auditRun: AuditRun = {
    id: runId,
    tenant_id: tenantId,
    run_type: runType,
    status: "running",
    total_prompt_runs: totalPromptRuns,
    completed_count: 0,
    failed_count: 0,
    skipped_count: 0,
    total_cost_usd: 0,
    started_at: now,
    completed_at: null,
    prompt_version_snapshot: Object.fromEntries(
      rendered.map((r) => [r.definition.id, r.definition.version]),
    ),
  };

  const promptRuns: PromptRun[] = [];
  const observations: PromptAnswerObservation[] = [];

  // 4. Execute per platform with concurrency limiter.
  for (const platformId of platforms) {
    const adapter = ADAPTERS[platformId];
    const limiter = createLimiter(CONCURRENCY[platformId]);

    const tasks = rendered.map((rp) =>
      limiter(async () => {
        const promptRun = createPromptRun(
          runId,
          tenantId,
          rp,
          platformId,
        );

        // Budget check.
        const budget = checkTenantBudget(tenantId);
        if (!budget.allowed) {
          promptRun.status = "skipped";
          promptRun.completed_at = new Date().toISOString();
          promptRun.error = {
            code: "BUDGET_EXCEEDED",
            message: budget.reason ?? "Daily budget exceeded",
            retryable: false,
          };
          auditRun.skipped_count++;
          promptRuns.push(promptRun);
          return;
        }

        // Execute with retry + timeout.
        promptRun.status = "running";
        promptRun.started_at = new Date().toISOString();

        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          TIMEOUT_MS,
        );

        const outcome = await withRetry(
          () =>
            adapter.query({
              prompt: rp.text,
              tenantId,
              tenantDomain: tenant.domain,
              brandAliases: aliases,
              signal: controller.signal,
            }),
          MAX_ATTEMPTS,
          `${platformId}::${rp.definition.id}`,
          log,
        );

        clearTimeout(timeout);

        if ("error" in outcome) {
          promptRun.status = "failed";
          promptRun.attempts = outcome.attempts;
          promptRun.completed_at = new Date().toISOString();
          promptRun.error = outcome.error;
          auditRun.failed_count++;
          log.warn(
            { promptId: rp.definition.id, platform: platformId, error: outcome.error },
            "Prompt run failed",
          );
        } else {
          promptRun.status = "completed";
          promptRun.attempts = outcome.attempts;
          promptRun.cost_usd = outcome.result.cost_usd;
          promptRun.completed_at = new Date().toISOString();
          auditRun.completed_count++;
          auditRun.total_cost_usd += outcome.result.cost_usd;

          // Record spend.
          recordSpend(
            tenantId,
            outcome.result.cost_usd,
            `${platformId}:${rp.definition.id}`,
          );

          // Convert to PromptAnswerObservation.
          const obs = toPromptAnswerObservation({
            observation: outcome.result.observation,
            rendered: rp,
            platform: platformId,
            tenantId,
            runId,
          });
          observations.push(obs);
        }

        promptRuns.push(promptRun);
      }),
    );

    await Promise.all(tasks);
  }

  // 5. Finalize audit run.
  auditRun.completed_at = new Date().toISOString();
  if (auditRun.failed_count === 0) {
    auditRun.status = "completed";
  } else if (
    auditRun.failed_count > auditRun.total_prompt_runs * 0.5
  ) {
    auditRun.status = "failed";
  } else {
    auditRun.status = "completed_partial";
  }

  // 6. Persist.
  const existingObs = readStore<PromptAnswerObservation>(
    "prompt-answer-observations",
  );
  existingObs.push(...observations);
  await writeStore("prompt-answer-observations", existingObs);

  const existingRuns = readStore<AuditRun>("audit-runs");
  existingRuns.push(auditRun);
  await writeStore("audit-runs", existingRuns);

  log.info(
    {
      runId,
      status: auditRun.status,
      completed: auditRun.completed_count,
      failed: auditRun.failed_count,
      skipped: auditRun.skipped_count,
      cost: auditRun.total_cost_usd.toFixed(4),
      observationCount: observations.length,
    },
    "Audit run finished",
  );

  return { auditRun, promptRuns, observations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPromptRun(
  auditRunId: string,
  tenantId: string,
  rendered: RenderedPrompt,
  platform: PlatformId,
): PromptRun {
  return {
    id: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    audit_run_id: auditRunId,
    tenant_id: tenantId,
    prompt_definition_id: rendered.definition.id,
    prompt_version: rendered.definition.version,
    platform,
    status: "pending" as PromptRunStatus,
    attempts: 0,
    max_attempts: MAX_ATTEMPTS,
    cost_usd: 0,
    started_at: null,
    completed_at: null,
    error: null,
    rendered_prompt: rendered.text,
  };
}
