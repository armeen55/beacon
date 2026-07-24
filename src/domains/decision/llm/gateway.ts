import "server-only";

/**
 * llm/gateway (Slice 3, 2026-07-23) - THE single OpenAI egress, now a STRICT
 * Structured-Outputs transport over the canonical Responses API.
 *
 * `openAIStructuredResponse` is the one door every internal-reasoning call uses.
 * It converts the caller's Zod schema to a strict JSON Schema, POSTs to
 * `POST /v1/responses` with `text.format.{type:"json_schema", strict:true}`, and
 * returns a typed outcome (ok / blocked_budget / refusal / incomplete /
 * invalid_response / http_error / error). The caller still Zod-validates the
 * returned `value` against its ORIGINAL schema - the gateway only guarantees the
 * value parsed as JSON and had its provider-nulls normalized away.
 *
 * ONE policy in one place, in this ORDER (unchanged intent from R16):
 *   1. perfCountExternal - every reach to the LLM transport is tallied so a page
 *      GET can be proven to fire ZERO LLM calls.
 *   2. GLOBAL COST BREAKER (outer guard), FAIL-CLOSED, before any per-platform
 *      read. A trip refuses the call outright; it never loosens the inner cap.
 *   3. MONTHLY CAP (per-platform), FAIL-CLOSED. `budget: { mode: "gateway_check" }`
 *      consults the dual-write ledger BEFORE the call; `{ mode: "caller", note }`
 *      is a greppable, explicit exemption for call sites that gate spend
 *      themselves and record via `recordGatewaySpend` post-parse.
 *   4. SCHEMA CONVERSION - an unsupported schema fails closed as invalid_response
 *      BEFORE any network call (strictness is never weakened to force it through).
 *   5. REASONING TIMEOUT FLOOR - reasoning models are floored to >= 90s (the
 *      gpt-5-mini lesson: a sub-90s ceiling made every call silently fall back).
 *   6. REASONING EFFORT - reasoning models get `reasoning.effort: "low"`.
 *   7. LOUD FALLBACK - every non-ok outcome logs an unmissable warn line and
 *      (outside tests) lands in the error ledger via `recordAppError`.
 *
 * VITEST HERMETICS: under vitest, budget/breaker checks default to "allowed" and
 * spend/error-ledger writes no-op UNLESS an impl is injected. Tests inject
 * `fetchImpl` (zero network), and pin the cap by injecting `budgetImpl` /
 * `costBreakerImpl`; nothing touches the operator's real `.data/` ledgers.
 *
 * Pinned by tests/decision/gateway.test.ts (this file is the ONLY file that
 * may reference api.openai.com).
 */

import { log } from "@/lib/logger";
import { recordAppError } from "@/lib/obs/error-ledger";
import { perfCountExternal } from "@/lib/obs/perf-log";
import { z } from "zod";
import { checkBudget, recordSpend } from "./adjudicator-budget";
import { assertPaidCallAllowed } from "@/lib/cost/cost-breaker";
import type { PromptId } from "./prompt-registry";
import {
  classifyResponsesEnvelope,
  normalizeStructuredValue,
  readProvenanceFields,
  strictJsonSchemaFor,
} from "./responses-envelope";

export { strictJsonSchemaFor, normalizeStructuredValue };

/** The canonical structured-generation endpoint (verified against OpenAI docs 2026-07-23). */
export const OPENAI_RESPONSES_API = "https://api.openai.com/v1/responses";

/** Reasoning models must never run with a sub-90s ceiling (the gpt-5-mini lesson). */
export const REASONING_TIMEOUT_FLOOR_MS = 90_000;

/**
 * gpt-5 / o-series are REASONING models: they spend `reasoning` tokens before
 * emitting output, so at low effort a small completion can still take 40-90s.
 * They accept the `reasoning.effort` request param; older models reject it.
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

/** Usage-based cost estimate (re-exported by providers/openai.ts). */
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
 *    actual spend post-parse via `recordGatewaySpend`.
 *  - "caller": the call site's own pinned orchestration checks AND records. The
 *    note documents where.
 */
export type LlmBudgetPosture =
  | { mode: "gateway_check"; projectedCostUsd: number; now?: Date }
  | { mode: "caller"; note: string };

export type BudgetImpl = {
  check: (projectedCostUsd: number, now?: Date) => Promise<{ allowed: boolean; reason?: string }>;
  record: (costUsd: number, now?: Date) => Promise<void>;
};

/**
 * The GLOBAL cost breaker consulted BEFORE the per-platform budget check.
 * Returns tripped=true to block. Tests inject this; production defaults to the
 * real cross-lane breaker (hermetically no-op under vitest unless injected).
 */
export type CostBreakerImpl = {
  check: (projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

/** Everything the transport needs to name and account for the failure. */
type GatewayIdentity = {
  promptId: PromptId;
  promptVersion: number;
  action: string;
  tenantId?: string | null;
};

/** Provider provenance for the returned artifact (retryCount is the CALLER's). */
export type LlmProvenance = {
  responseId: string | null;
  requestedModel: string;
  servedModel: string | null;
  status: string | null;
  createdAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  retryCount: number;
};

export type StructuredCallArgs = {
  /** Registered prompt identity (prompt-registry.ts) - versioned + fixture-pinned. */
  promptId: PromptId;
  promptVersion: number;
  /** The calling action for the error ledger (e.g. "page-surgeon-judge"). */
  action: string;
  apiKey: string;
  model: string;
  /** System instructions (Responses `instructions`). */
  instructions: string;
  /** User content (Responses `input`). */
  input: string;
  /** Stable schema name per kind (Responses `text.format.name`). */
  schemaName: string;
  /** Converted internally via `strictJsonSchemaFor`; caller re-validates against it. */
  zodSchema: z.ZodTypeAny;
  maxOutputTokens: number;
  /** Requested ceiling; floored to REASONING_TIMEOUT_FLOOR_MS for reasoning models. */
  timeoutMs: number;
  budget: LlmBudgetPosture;
  fetchImpl?: typeof fetch;
  tenantId?: string | null;
  /** Test seam for the cap; hermetic under vitest otherwise. */
  budgetImpl?: BudgetImpl;
  /** Test seam for the global cost breaker; hermetic under vitest otherwise. */
  costBreakerImpl?: CostBreakerImpl;
};

export type StructuredCallOutcome =
  | { kind: "ok"; value: unknown; provenance: LlmProvenance }
  | { kind: "blocked_budget"; reason: string }
  | { kind: "refusal"; provenance: LlmProvenance }
  | { kind: "incomplete"; reason: string; provenance: LlmProvenance }
  | { kind: "invalid_response"; reason: string }
  | { kind: "http_error"; status: number }
  | { kind: "error"; reason: string };

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

/** The enforced ceiling: reasoning models are floored to 90s. Pure. */
export function effectiveTimeoutMs(model: string, requestedMs: number): number {
  return isReasoningModel(model) ? Math.max(requestedMs, REASONING_TIMEOUT_FLOOR_MS) : requestedMs;
}

/**
 * GLOBAL cost breaker (OUTER guard). Consulted BEFORE the per-platform budget
 * check on every call regardless of posture, because real money is spent in
 * both cases. It never LOOSENS the per-platform cap; a trip refuses outright.
 * Hermetic under vitest unless a costBreakerImpl is injected.
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
async function reportGatewayFailure(id: GatewayIdentity, reason: string, detail?: string): Promise<void> {
  log.warn(`[llm-gateway] ${id.promptId} v${id.promptVersion} ${reason}`, {
    action: id.action,
    ...(detail ? { detail } : {}),
  });
  if (underVitest()) return;
  await recordAppError({
    route: "llm/gateway",
    tenantId: id.tenantId ?? null,
    action: id.action,
    message: `${id.promptId} v${id.promptVersion}: ${reason}${detail ? ` (${detail})` : ""}`,
    context: { promptId: id.promptId, promptVersion: id.promptVersion },
  });
}

/**
 * THE OpenAI structured-generation transport over the Responses API. Enforces
 * the guard order in the module doc, converts the Zod schema to a strict JSON
 * Schema, and returns a typed outcome. Never throws.
 */
export async function openAIStructuredResponse(args: StructuredCallArgs): Promise<StructuredCallOutcome> {
  const id: GatewayIdentity = {
    promptId: args.promptId,
    promptVersion: args.promptVersion,
    action: args.action,
    tenantId: args.tenantId ?? null,
  };
  const reasoning = isReasoningModel(args.model);

  // 1. Tally every reach to the LLM transport (page-GET zero-LLM invariant).
  perfCountExternal("llm", args.model || undefined);

  // 2. Global breaker (outer guard) first: refuse before the per-platform cap is read.
  const breaker = await checkGatewayCostBreaker(args.budget, args.costBreakerImpl);
  if (!breaker.allowed) {
    await reportGatewayFailure(id, "blocked_budget", breaker.reason);
    return { kind: "blocked_budget", reason: breaker.reason };
  }

  // 3. Per-platform monthly cap, fail-closed.
  const budget = await checkGatewayBudget(args.budget, args.budgetImpl);
  if (!budget.allowed) {
    await reportGatewayFailure(id, "blocked_budget", budget.reason);
    return { kind: "blocked_budget", reason: budget.reason };
  }

  // 4. Schema conversion - fail closed BEFORE any network call on an unsupported schema.
  const converted = strictJsonSchemaFor(args.zodSchema, args.schemaName);
  if ("unsupported" in converted) {
    await reportGatewayFailure(id, "invalid_response_unsupported_schema", converted.unsupported);
    return { kind: "invalid_response", reason: `unsupported_schema: ${converted.unsupported}` };
  }

  const requestBody: Record<string, unknown> = {
    model: args.model,
    instructions: args.instructions,
    input: args.input,
    max_output_tokens: args.maxOutputTokens,
    text: { format: { type: "json_schema", name: converted.name, schema: converted.schema, strict: true } },
  };
  // 6. Reasoning effort default (only for reasoning models; older models reject it).
  if (reasoning) requestBody.reasoning = { effort: "low" };

  // 5. Reasoning timeout floor.
  const timeoutMs = effectiveTimeoutMs(args.model, args.timeoutMs);
  const fetchImpl = args.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 80) : "fetch_failed";
    await reportGatewayFailure(id, "network_or_timeout", reason);
    return { kind: "error", reason: reason || "fetch_failed" };
  }

  if (!response.ok) {
    await reportGatewayFailure(id, `openai_http_${response.status}`);
    return { kind: "http_error", status: response.status };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    await reportGatewayFailure(id, "invalid_response_body_not_json");
    return { kind: "invalid_response", reason: "response body was not JSON" };
  }

  const fields = readProvenanceFields(json);
  const usagePresent = fields.inputTokens !== null || fields.outputTokens !== null;
  const provenance: LlmProvenance = {
    responseId: fields.responseId,
    requestedModel: args.model,
    servedModel: fields.servedModel,
    status: fields.status,
    createdAt: fields.createdAt,
    inputTokens: fields.inputTokens,
    outputTokens: fields.outputTokens,
    costUsd: usagePresent ? estimateCost(args.model, fields.inputTokens ?? 0, fields.outputTokens ?? 0) : null,
    retryCount: 0,
  };

  const classified = classifyResponsesEnvelope(json);
  if (classified.kind === "refusal") {
    await reportGatewayFailure(id, "refusal");
    return { kind: "refusal", provenance };
  }
  if (classified.kind === "incomplete") {
    await reportGatewayFailure(id, "incomplete", classified.reason);
    return { kind: "incomplete", reason: classified.reason, provenance };
  }
  if (classified.kind === "invalid") {
    await reportGatewayFailure(id, `invalid_response_${classified.reason}`);
    return { kind: "invalid_response", reason: classified.reason };
  }

  // 7. Structured text present. With strict:true a JSON.parse failure signals a
  //    provider malfunction; never substring-hunt for JSON in prose.
  let parsed: unknown;
  try {
    parsed = JSON.parse(classified.text);
  } catch {
    await reportGatewayFailure(id, "invalid_response_structured_parse");
    return { kind: "invalid_response", reason: "structured output was not valid JSON" };
  }

  const value = normalizeStructuredValue(parsed, args.zodSchema);
  return { kind: "ok", value, provenance };
}
