import "server-only";

/**
 * llm/gateway (2026-07-03, BEACON 500 R16 / P6) - THE single OpenAI chat egress.
 *
 * Every chat-completions call in the product routes through
 * `openAIChatCompletion` below. The scattered `fetch("https://api.openai.com/...")`
 * call sites (drafters, strategist, critic, judge, adjudicator, SERP hypothesis,
 * cluster factory, engine poll, specific-edit provider) now build their request
 * BODY exactly as before (adapter-preserving; their parsing and outputs are
 * byte-identical) but the transport enforces one policy in one place:
 *
 *   1. MONTHLY CAP, FAIL-CLOSED. `budget: { mode: "gateway_check" }` consults the
 *      dual-write ledger (`adjudicator-budget`: file + Supabase `llm_budget_ledger`)
 *      BEFORE the call and blocks when the cap is hit or the ledger is unreadable.
 *      Call sites whose own pinned orchestration already gates spend declare
 *      `{ mode: "caller", note }` - a greppable, explicit exemption, never a
 *      silent one.
 *   2. REASONING TIMEOUT FLOOR. gpt-5-family models routinely need 40-90s before
 *      emitting output (the 2026-06-18 lesson: a 40s ceiling made EVERY judge call
 *      silently fall back). Any reasoning-model call is floored to >= 90s.
 *   3. REASONING EFFORT. A reasoning-model body without `reasoning_effort` gets
 *      "low" pinned (defensive; every caller already sets it).
 *   4. LOUD FALLBACK. Every non-response outcome logs an unmissable warn line
 *      naming the promptId, and (outside tests) lands in the error ledger via
 *      `recordAppError` with the calling action - a failing LLM feature is never
 *      a mystery again.
 *   5. PROMPT IDENTITY. Every call carries a registered promptId + version
 *      (see prompt-registry.ts) so the regression harness can pin each prompt's
 *      parse path against recorded fixtures.
 *
 * The gateway returns the RAW `Response` on any HTTP-level completion so each
 * call site keeps its exact status handling, JSON parsing, refusal handling,
 * and fallback semantics - consolidation without behavioral drift.
 *
 * VITEST HERMETICS: under vitest, budget checks default to "allowed" and spend/
 * error-ledger writes no-op UNLESS a budgetImpl is injected. Tests that pin the
 * cap inject `budgetImpl`; everything else stays deterministic and never touches
 * the operator's real `.data/` ledgers (the llm-budget-test-isolation contract).
 *
 * Pinned by gateway.test.ts + tests/architecture/llm-safety-invariants.test.ts
 * (this file and the embeddings client are the only files allowed to reference
 * api.openai.com).
 */

import { log } from "@/lib/logger";
import { recordAppError } from "@/lib/obs/error-ledger";
import { checkBudget, recordSpend } from "@/domains/recommendations/adjudicator-budget";
import { assertPaidCallAllowed } from "@/domains/safety/cost-breaker";
import type { PromptId } from "./prompt-registry";

export const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";

/** Reasoning models must never run with a sub-90s ceiling (the gpt-5-mini lesson). */
export const REASONING_TIMEOUT_FLOOR_MS = 90_000;

/**
 * gpt-5 / o-series are REASONING models: they spend `reasoning_tokens` before
 * emitting output, so at the default reasoning effort a small completion can
 * still take 40-90s. They accept the `reasoning_effort` request param; older
 * non-reasoning chat models 400 on it. (Moved here from providers/openai.ts,
 * which re-exports it - the gateway is the transport authority now.)
 */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

/** Per-million-token rates (USD). Verified against OpenAI pricing 2026-04-23. */
const COST_PER_MILLION = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
} as const;

/** Usage-based cost estimate (moved here from providers/openai.ts, re-exported there). */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates =
    (COST_PER_MILLION as Record<string, { input: number; output: number }>)[model] ??
    COST_PER_MILLION["gpt-5-mini"];
  const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * How this call is protected by the monthly cap:
 *  - "gateway_check": the gateway consults the fail-closed dual-write ledger
 *    BEFORE the call (blocked / unreadable -> no call). The caller records the
 *    actual spend post-parse via `recordGatewaySpend` (usage tokens are only
 *    known after JSON parsing, which stays in the caller).
 *  - "caller": the call site's own pinned orchestration checks AND records
 *    (structured-drafter, strategist, why-narrative, adjudicator, draft-gateway,
 *    engine poll's nightly prompt cap). The note documents where.
 */
export type LlmBudgetPosture =
  | { mode: "gateway_check"; projectedCostUsd: number; now?: Date }
  | { mode: "caller"; note: string };

export type BudgetImpl = {
  check: (projectedCostUsd: number, now?: Date) => Promise<{ allowed: boolean; reason?: string }>;
  record: (costUsd: number, now?: Date) => Promise<void>;
};

/**
 * N43 outer guard seam: the GLOBAL cost breaker consulted BEFORE the
 * per-platform budget check. Returns tripped=true to block the call. Tests
 * inject this; production defaults to the real cross-lane breaker (hermetically
 * no-op under vitest unless injected, same posture as the budget check).
 */
export type CostBreakerImpl = {
  check: (projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

export type OpenAIChatArgs = {
  /** Registered prompt identity (prompt-registry.ts) - versioned + fixture-pinned. */
  promptId: PromptId;
  promptVersion: number;
  /** The calling action for the error ledger (e.g. "page-surgeon-judge"). */
  action: string;
  apiKey: string;
  /** The FULL request body, built by the caller - byte-identical to its legacy fetch. */
  body: Record<string, unknown>;
  /** Requested ceiling; floored to REASONING_TIMEOUT_FLOOR_MS for reasoning models. */
  timeoutMs: number;
  budget: LlmBudgetPosture;
  fetchImpl?: typeof fetch;
  tenantId?: string | null;
  /** Test seam for the cap; see VITEST hermetics in the module doc. */
  budgetImpl?: BudgetImpl;
  /** Test seam for the N43 global cost breaker; hermetic under vitest otherwise. */
  costBreakerImpl?: CostBreakerImpl;
};

export type OpenAIChatOutcome =
  | { kind: "response"; response: Response }
  | { kind: "blocked_budget"; reason: string }
  | { kind: "error"; reason: string };

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

/** The enforced ceiling: reasoning models are floored to 90s (the gpt-5-mini
 *  lesson - sub-90s ceilings made every call silently fall back). Pure. */
export function effectiveTimeoutMs(model: string, requestedMs: number): number {
  return isReasoningModel(model) ? Math.max(requestedMs, REASONING_TIMEOUT_FLOOR_MS) : requestedMs;
}

/**
 * N43 GLOBAL cost breaker (OUTER guard). Consulted BEFORE the per-platform
 * budget check on every chat call regardless of posture, because real money is
 * spent in both cases and this is belt-and-suspenders over the inner caps. It
 * never LOOSENS the per-platform cap; a trip here refuses the call outright.
 * Hermetic under vitest (never reads the operator's real ledger) unless a
 * costBreakerImpl is injected, same posture as checkGatewayBudget.
 */
async function checkGatewayCostBreaker(
  posture: LlmBudgetPosture,
  impl: CostBreakerImpl | undefined,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const projected = posture.mode === "gateway_check" ? posture.projectedCostUsd : 0;
  if (impl) {
    const r = await impl
      .check(projected)
      .catch(() => ({ tripped: true as const, reason: "global spend breaker unavailable, failing closed" }));
    return r.tripped ? { allowed: false, reason: r.reason ?? "global monthly ceiling reached" } : { allowed: true };
  }
  if (underVitest()) return { allowed: true };
  try {
    const v = await assertPaidCallAllowed({ projectedCostUsd: projected });
    return v.tripped ? { allowed: false, reason: v.reason } : { allowed: true };
  } catch {
    return { allowed: false, reason: "global spend breaker unavailable, failing closed" };
  }
}

async function checkGatewayBudget(
  posture: LlmBudgetPosture,
  budgetImpl: BudgetImpl | undefined,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (posture.mode === "caller") return { allowed: true };
  if (budgetImpl) {
    const r = await budgetImpl
      .check(posture.projectedCostUsd, posture.now)
      .catch(() => ({ allowed: false as const, reason: "budget check unavailable, failing closed" }));
    return r.allowed ? { allowed: true } : { allowed: false, reason: r.reason ?? "cap reached" };
  }
  // Hermetic under vitest: never read the operator's real ledger from a test
  // run; tests that pin the cap inject budgetImpl.
  if (underVitest()) return { allowed: true };
  try {
    const b = await checkBudget({ projectedCostUsd: posture.projectedCostUsd, now: posture.now });
    return b.allowed ? { allowed: true } : { allowed: false, reason: b.reason };
  } catch {
    return { allowed: false, reason: "budget check unavailable, failing closed" };
  }
}

/**
 * Record real spend for a gateway_check call AFTER the caller parsed usage.
 * Never throws. No-ops under vitest unless a budgetImpl is injected.
 */
export async function recordGatewaySpend(
  costUsd: number,
  opts: { now?: Date; budgetImpl?: BudgetImpl } = {},
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  if (opts.budgetImpl) {
    await opts.budgetImpl.record(costUsd, opts.now).catch(() => {});
    return;
  }
  if (underVitest()) return;
  await recordSpend(costUsd, { now: opts.now }).catch(() => {});
}

/** LOUD, durable failure reporting - warn line always; error ledger outside tests. */
async function reportGatewayFailure(
  args: OpenAIChatArgs,
  reason: string,
  detail?: string,
): Promise<void> {
  log.warn(`[llm-gateway] ${args.promptId} v${args.promptVersion} ${reason}`, {
    action: args.action,
    ...(detail ? { detail } : {}),
  });
  if (underVitest()) return;
  await recordAppError({
    route: "llm/gateway",
    tenantId: args.tenantId ?? null,
    action: args.action,
    message: `${args.promptId} v${args.promptVersion}: ${reason}${detail ? ` (${detail})` : ""}`,
    context: { promptId: args.promptId, promptVersion: args.promptVersion },
  });
}

/**
 * THE OpenAI chat-completions transport. Enforces the budget posture, the
 * reasoning timeout floor, and reasoning_effort defaulting; returns the raw
 * Response on any HTTP completion (callers keep their exact parsing), a
 * blocked_budget outcome when the cap fails closed, or an error outcome on
 * network/timeout failure. Never throws.
 */
export async function openAIChatCompletion(args: OpenAIChatArgs): Promise<OpenAIChatOutcome> {
  const model = typeof args.body.model === "string" ? args.body.model : "";
  const reasoning = isReasoningModel(model);

  // N43 OUTER guard first: the global cross-lane ceiling refuses before the
  // per-platform cap is even read (belt-and-suspenders, never a loosening).
  const breaker = await checkGatewayCostBreaker(args.budget, args.costBreakerImpl);
  if (!breaker.allowed) {
    await reportGatewayFailure(args, "blocked_budget", breaker.reason);
    return { kind: "blocked_budget", reason: breaker.reason };
  }

  const budget = await checkGatewayBudget(args.budget, args.budgetImpl);
  if (!budget.allowed) {
    await reportGatewayFailure(args, "blocked_budget", budget.reason);
    return { kind: "blocked_budget", reason: budget.reason };
  }

  const body: Record<string, unknown> = { ...args.body };
  if (reasoning && body.reasoning_effort === undefined) body.reasoning_effort = "low";

  const timeoutMs = effectiveTimeoutMs(model, args.timeoutMs);
  const fetchImpl = args.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(OPENAI_CHAT_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // The caller decides what a non-2xx means for its fallback; the gateway
      // just makes sure the failure is never silent.
      await reportGatewayFailure(args, `openai_http_${response.status}`);
    }
    return { kind: "response", response };
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 80) : "fetch_failed";
    await reportGatewayFailure(args, "network_or_timeout", reason);
    return { kind: "error", reason: reason || "fetch_failed" };
  }
}
