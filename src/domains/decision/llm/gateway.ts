import "server-only";

/**
 * llm/gateway (Slice 3, 2026-07-23) - THE single OpenAI egress, now a STRICT Structured-Outputs transport over the canonical Responses API.
 *
 * `openAIStructuredResponse` is the one door every internal-reasoning call uses. It converts the caller's Zod schema to a strict JSON Schema, POSTs to
 * `POST /v1/responses` with `text.format.{type:"json_schema", strict:true}`, and returns a typed outcome (ok / blocked_budget / blocked_credit / refusal /
 * incomplete / invalid_response / http_error / error). The caller still Zod-validates the returned `value` against its ORIGINAL schema - the gateway only guarantees the
 * value parsed as JSON and had its provider-nulls normalized away.
 *
 * ONE policy in one place, in this ORDER (unchanged intent from R16):
 *   1. perfCountExternal - every reach to the LLM transport is tallied so a page
 *      GET can be proven to fire ZERO LLM calls.
 *   2. CREDIT STOP (account level), FAIL-FAST. When the provider has said this
 *      account's balance is empty, the door itself refuses with `blocked_credit`
 *      before any network, so no lane has to carry that logic of its own.
 *   3. GLOBAL COST BREAKER (outer guard), FAIL-CLOSED, before any per-platform
 *      read. A trip refuses the call outright; it never loosens the inner cap.
 *   4. MONTHLY CAP (per-platform), FAIL-CLOSED. `budget: { mode: "gateway_check" }`
 *      consults the dual-write ledger BEFORE the call; `{ mode: "caller", note }`
 *      is a greppable, explicit exemption for call sites that gate spend
 *      themselves and record via `recordGatewaySpend` post-parse.
 *   5. SCHEMA CONVERSION - an unsupported schema fails closed as invalid_response
 *      BEFORE any network call (strictness is never weakened to force it through).
 *   6. REASONING TIMEOUT FLOOR - reasoning models are floored to >= 90s (the
 *      gpt-5-mini lesson: a sub-90s ceiling made every call silently fall back).
 *   7. REASONING EFFORT - reasoning models get `reasoning.effort: "low"`.
 *   8. LOUD FALLBACK - every non-ok outcome logs an unmissable warn line and
 *      (outside tests) lands in the error ledger via `recordAppError`.
 *
 * VITEST HERMETICS: under vitest, budget/breaker checks default to "allowed" and spend/error-ledger writes no-op UNLESS an impl is injected. Tests inject
 * `fetchImpl` (zero network), and pin the cap by injecting `budgetImpl` / `costBreakerImpl`; nothing touches the operator's real `.data/` ledgers.
 *
 * Pinned by tests/decision/gateway.test.ts (this file is the ONLY file that may reference api.openai.com).
 */

import { log } from "@/lib/logger";
import { recordAppError } from "@/lib/obs/error-ledger";
import { perfCountExternal } from "@/lib/obs/perf-log";
import { z } from "zod";
import { spendingClosed } from "@/lib/spend-scope";
import { checkBudget } from "./adjudicator-budget";
import { assertPaidCallAllowed } from "@/lib/cost/cost-breaker";
import { CREDIT_BREAKER } from "@/lib/cost/credit-breaker";
import type { PromptId } from "./prompt-registry";
import {
  classifyResponsesEnvelope,
  normalizeStructuredValue,
  readProvenanceFields,
  strictJsonSchemaFor,
} from "./responses-envelope";

export { strictJsonSchemaFor, normalizeStructuredValue };
/** THE account-level credit stop, read here and re-exported so every lane asks the same question of the same
 *  durable row: is this account held because the provider says its balance is empty. See lib/cost/credit-breaker.ts
 *  for the trip, the 15 minute probe, and the clear. */
/** IS THIS ACCOUNT HELD FOR CREDIT RIGHT NOW. The read orchestration uses, and it is PURE: a due probe reads as NOT
 *  held (the work may proceed) and is spent by the transport itself, on a real request, never by a precheck. */
export const creditBreakerHeld = async (tenantId: string): Promise<boolean> => (await CREDIT_BREAKER.peek(tenantId)) === "held";

/** The canonical structured-generation endpoint (verified against OpenAI docs 2026-07-23). */
const OPENAI_RESPONSES_API = "https://api.openai.com/v1/responses";

/** Reasoning models must never run with a sub-90s ceiling (the gpt-5-mini lesson). */
const REASONING_TIMEOUT_FLOOR_MS = 90_000;

/**
 * gpt-5 / o-series are REASONING models: they spend `reasoning` tokens before emitting output, so at low effort a small completion can still take 40-90s.
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
type LlmBudgetPosture =
  | { mode: "gateway_check"; projectedCostUsd: number; now?: Date }
  | { mode: "caller"; note: string };

type BudgetImpl = {
  check: (projectedCostUsd: number, now?: Date) => Promise<{ allowed: boolean; reason?: string }>;
  record: (costUsd: number, now?: Date) => Promise<void>;
};

/**
 * The GLOBAL cost breaker consulted BEFORE the per-platform budget check. Returns tripped=true to block. Tests inject this; production defaults to the
 * real cross-lane breaker (hermetically no-op under vitest unless injected).
 */
export type CostBreakerImpl = {
  check: (projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

/** The durable account-level credit stop as a seam. Production wires the ledger-backed breaker; tests inject. */
type CreditBreakerImpl = {
  /** PURE. Reports the stop; never stamps a probe, so any number of callers may ask. */ peek: (tenantId: string) => Promise<"clear" | "held" | "probe_due">;
  /** STAMPS. Called ONLY from here, immediately before network egress, so the one probe a cooldown grants is spent on a real provider request or on nothing. */ claimProbe: (tenantId: string) => Promise<boolean>;
  trip: (tenantId: string) => Promise<void>;
  clear: (tenantId: string) => Promise<void>;
};

/** OpenAI's own name for an empty balance is `insufficient_quota`; this is what Beacon calls it everywhere after. */
const CREDIT_EXHAUSTED = "credit_balance_exhausted";
/** A code is a machine identifier. Anything shaped otherwise is provider prose and is dropped, never carried. */
const CODE_SHAPE = /^[a-z0-9_.-]{1,64}$/i;
/** What the operator is told while the stop holds: what happened, what I am doing about it, what ends it. */
const CREDIT_STOP_REASON =
  "My OpenAI account is out of credit, so I am holding every call that needs it. I try one call every 15 minutes and pick straight back up the moment one goes through. Add credit to that account to end the hold now.";

/** Everything the transport needs to name and account for the failure. */
type GatewayIdentity = {
  promptId: PromptId;
  promptVersion: number;
  action: string;
  tenantId: string;
};

/** Provider provenance for the returned artifact (retryCount is the CALLER's).
 *  Carries the owning account so every ledger row and audit trail is attributable. */
export type LlmProvenance = {
  tenantId: string;
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
  /** The owning account. REQUIRED (validated non-empty before any check) so spend,
   *  provenance, and error-ledger rows are always attributable to one account. */
  tenantId: string;
  /** Test seam for the cap; hermetic under vitest otherwise. */
  budgetImpl?: BudgetImpl;
  /** Test seam for the global cost breaker; hermetic under vitest otherwise. */
  costBreakerImpl?: CostBreakerImpl;
  /** Test seam for the account-level credit stop; hermetic under vitest otherwise. */
  creditBreakerImpl?: CreditBreakerImpl;
};

type StructuredCallOutcome =
  | { kind: "ok"; value: unknown; provenance: LlmProvenance }
  | { kind: "blocked_budget"; reason: string }
  | { kind: "refusal"; provenance: LlmProvenance }
  | { kind: "incomplete"; reason: string; provenance: LlmProvenance }
  // provenance present ONLY for a POST-network invalid (the envelope supplied real usage/cost); a PRE-network invalid (unsupported schema, missing tenant) has none, and no cost either.
  | { kind: "invalid_response"; reason: string; provenance?: LlmProvenance }
  // `code` is the provider's OWN machine code (`credit_balance_exhausted`, `rate_limit_exceeded`, ...), never its prose: a caller tells an empty balance from a busy minute, no body text escaping.
  | { kind: "http_error"; status: number; code?: string; retryAfterMs?: number }
  // The account is held for credit. No network, no cost, and every caller inherits the stop without its own logic.
  | { kind: "blocked_credit"; reason: string }
  // `timedOut` is my OWN deadline firing and nothing more: no response and no usage receipt came back, so it proves
  // neither that generation began nor that anything was charged. Only the error's own NAME may set it, never wording.
  | { kind: "error"; reason: string; timedOut: boolean };

/**
 * WHOSE FAILURE IT WAS, AS A TYPE. THE one name for a call that produced no usable value, decided HERE at the transport
 * boundary and carried by every caller, because reading it back out of an error string is how an ordinary throttle
 * became a permanent verdict on somebody's answer. Each name answers two questions: did a RECEIPT come back (so is it
 * honest to settle on it), and does the pass go on. `budget` is my own allowance saying no, before any call.
 * `credit_exhausted` is the PROVIDER saying this account's balance is empty. `transient` is a call that came back with
 * nothing and was billed nothing (a busy minute, a server fault, a dead socket, a request the provider would not take),
 * so the work stays owed rather than being settled on a failure of mine. `client_timeout` is me abandoning the call at
 * my own deadline: no body and no usage receipt came back, so nothing proves generation began or that the provider
 * charged, and it is a distinct transport fact for telemetry that NEVER settles an answer. `provider_refused` is the
 * reader refusing the content, `incomplete` is an answer cut off or left out, `schema_invalid` a body I could not use.
 */
export type LlmFailure =
  | "budget" | "credit_exhausted" | "transient" | "client_timeout" | "provider_refused" | "incomplete" | "schema_invalid";

/** PURE. The one classification of a gateway outcome, so no caller ever has to read a name out of a sentence. `ok`
 *  never reaches here. An `invalid_response` is a returned body I could not use; its two BEFORE-network reasons
 *  (an unsupported schema, a missing account) cannot occur on a registered kind, because every registered schema is
 *  proven convertible by test and no lane calls without an account. */
export function llmFailureOf(outcome: StructuredCallOutcome): LlmFailure {
  switch (outcome.kind) {
    case "blocked_budget": return "budget";
    case "blocked_credit": return "credit_exhausted";
    case "refusal": return "provider_refused";
    case "incomplete": return "incomplete";
    case "invalid_response": return "schema_invalid";
    // A 402 and OpenAI's own insufficient_quota are an empty balance; every other status returned no usable body and no
    // receipt, so it is transient however permanent its cause: nothing settles on a call that bought nothing.
    case "http_error": return outcome.code === CREDIT_EXHAUSTED || outcome.status === 402 ? "credit_exhausted" : "transient";
    case "error": return outcome.timedOut ? "client_timeout" : "transient";
    default: return "schema_invalid";
  }
}

/** PURE. WHAT A THROW ON THE WIRE WAS, and the answer is the same whether the connection never opened or the envelope stopped arriving half read: ONLY the error's own NAME says my deadline fired
 *  (AbortSignal.timeout aborts with a DOMException named TimeoutError), because a message sniff made every socket abort a deadline. Neither case read a usage receipt, so neither may settle an answer. */
const threwOnTheWire = (e: unknown, fallback: string) => ({ reason: (e instanceof Error ? e.message.slice(0, 80) : "") || fallback, timedOut: e instanceof Error && e.name === "TimeoutError" });
function underVitest(): boolean {
  return process.env.VITEST === "true";
}

/** The enforced ceiling: reasoning models are floored to 90s. Pure. */
export function effectiveTimeoutMs(model: string, requestedMs: number): number {
  return isReasoningModel(model) ? Math.max(requestedMs, REASONING_TIMEOUT_FLOOR_MS) : requestedMs;
}

/**
 * GLOBAL cost breaker (OUTER guard). Consulted BEFORE the per-platform budget check on every call regardless of posture, because real money is spent in
 * both cases. It never LOOSENS the per-platform cap; a trip refuses outright. Hermetic under vitest unless a costBreakerImpl is injected.
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
  tenantId: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (posture.mode === "caller") return { allowed: true };
  if (budgetImpl) {
    const r = await budgetImpl
      .check(posture.projectedCostUsd, posture.now)
      .catch(() => ({ allowed: false as const, reason: "budget check unavailable, failing closed" }));
    return r.allowed ? { allowed: true } : { allowed: false, reason: r.reason ?? "cap reached" };
  }
  // Hermetic under vitest: never read the operator's real ledger from a test run; tests that pin the cap inject budgetImpl.
  if (underVitest()) return { allowed: true };
  try {
    const b = await checkBudget({ tenantId, projectedCostUsd: posture.projectedCostUsd, now: posture.now });
    return b.allowed ? { allowed: true } : { allowed: false, reason: b.reason };
  } catch {
    return { allowed: false, reason: "budget check unavailable, failing closed" };
  }
}

/** The credit stop as one object: the injected seam, or the durable ledger-backed one. */
function creditBreaker(impl: CreditBreakerImpl | undefined): CreditBreakerImpl {
  return impl ?? CREDIT_BREAKER;
}

/**
 * THE PROVIDER'S OWN MACHINE CODE, AND NOTHING ELSE. The error body may carry a whole billing sentence, an org id,
 * or a sales address; only `error.code` / `error.type` are read, and only when they are shaped like a code, so no
 * provider prose can reach a log line, an exception message, or an operator surface. An empty balance (`insufficient_quota`) is named apart from ordinary throttling, because retrying one buys nothing.
 */
async function providerErrorCode(response: Response): Promise<string | undefined> {
  let body: unknown;
  try { body = await response.json(); } catch { return undefined; }
  const err = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  const named = [err?.code, err?.type].find((v): v is string => typeof v === "string" && CODE_SHAPE.test(v.trim()));
  const code = named?.trim().toLowerCase();
  if (code === "insufficient_quota") return CREDIT_EXHAUSTED;
  if (!code && response.status === 429) return "rate_limit_exceeded";
  return code;
}

/** Retry-After in ms: seconds or an HTTP date, floored at zero and capped at an hour so a bad header can never
 *  park a lane for a day. Absent header, absent claim. */
function retryAfterMs(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(Math.round(ms), 0), 3_600_000);
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
 * THE OpenAI structured-generation transport over the Responses API. Enforces the guard order in the module doc, converts the Zod schema to a strict JSON Schema, and returns a typed outcome. Never throws.
 */
export async function openAIStructuredResponse(args: StructuredCallArgs): Promise<StructuredCallOutcome> {
  // Account identity is required BEFORE any check: no spend, provenance, or ledger row may be unattributable. A caller that cannot name its account is a bug, not
  // a license for a global call - fail closed with no cost, no network.
  const tenantId = (args.tenantId ?? "").trim();
  if (!tenantId) return { kind: "invalid_response", reason: "missing_tenant" };
  // THE PAUSE IS ENFORCED HERE, NOT BY WHOEVER CALLED. A paused account still publishes its surface, and the
  // surface rebuild runs the producer, so the drafter kept buying while research was off (operator, 2026-08-19).
  // Refused BEFORE the model, the schema and the budget are touched: no client, no network, no ledger row, and
  // the outcome is the one every caller already treats as "did not buy", never as a failure.
  if (await spendingClosed(tenantId)) return { kind: "blocked_budget", reason: "research is paused for this account, so nothing is bought on this pass" };
  const id: GatewayIdentity = {
    promptId: args.promptId,
    promptVersion: args.promptVersion,
    action: args.action,
    tenantId,
  };
  const reasoning = isReasoningModel(args.model);

  // 1. Tally every reach to the LLM transport (page-GET zero-LLM invariant).
  perfCountExternal("llm", args.model || undefined);

  // 2. NO CREDIT, NO CALL. A durable account-level stop, tripped by the provider's own credit_balance_exhausted and
  //    cleared by the next call that goes through. It sits HERE, in the one door, so answer readback, competitor
  //    verdicts and every drafter inherit the same stop instead of each re-storming a dead account on every pass.
  //    The hold logs but does NOT write an error-ledger row: the trip that caused it already wrote one, and a row
  //    per held call would spend a store round trip on repeating a fact already on file.
  //    IT ONLY ASKS HERE. The probe the cooldown grants is CLAIMED at step 8, one line above the fetch, because every gate below can still refuse this call: claiming it here spent the account's one recovery attempt on a request that never left the process, which is how a tripped account could never recover through a replenish drive.
  const credit = creditBreaker(args.creditBreakerImpl);
  const stop = await credit.peek(tenantId).catch(() => "clear" as const);
  if (stop === "held") {
    log.warn(`[llm-gateway] ${id.promptId} v${id.promptVersion} blocked_credit`, { action: id.action, tenantId });
    return { kind: "blocked_credit", reason: CREDIT_STOP_REASON };
  }

  // 3. Global breaker (outer guard): refuse before the per-platform cap is read.
  const breaker = await checkGatewayCostBreaker(args.budget, args.costBreakerImpl);
  if (!breaker.allowed) {
    await reportGatewayFailure(id, "blocked_budget", breaker.reason);
    return { kind: "blocked_budget", reason: breaker.reason };
  }

  // 4. Per-platform monthly cap, fail-closed (scoped to the explicit account).
  const budget = await checkGatewayBudget(args.budget, args.budgetImpl, tenantId);
  if (!budget.allowed) {
    await reportGatewayFailure(id, "blocked_budget", budget.reason);
    return { kind: "blocked_budget", reason: budget.reason };
  }

  // 5. Schema conversion - fail closed BEFORE any network call on an unsupported schema.
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
  // 7. Reasoning effort default (only for reasoning models; older models reject it).
  if (reasoning) requestBody.reasoning = { effort: "low" };

  // 6. Reasoning timeout floor.
  const timeoutMs = effectiveTimeoutMs(args.model, args.timeoutMs);
  const fetchImpl = args.fetchImpl ?? fetch;

  // 8. THE PROBE IS CLAIMED HERE, past every gate that could still refuse. During a cooldown nothing reaches this line (step 2 already returned), so a held account makes zero network calls; when a probe is due, exactly this request receives it. A stamp that will not write keeps the hold.
  if (stop === "probe_due" && !(await credit.claimProbe(tenantId).catch(() => false))) {
    log.warn(`[llm-gateway] ${id.promptId} v${id.promptVersion} blocked_credit (the recovery attempt could not be recorded)`, { action: id.action, tenantId });
    return { kind: "blocked_credit", reason: CREDIT_STOP_REASON };
  }
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const { reason, timedOut } = threwOnTheWire(e, "fetch_failed");
    await reportGatewayFailure(id, timedOut ? "client_timeout" : "network_failed", reason);
    return { kind: "error", reason, timedOut };
  }

  if (!response.ok) {
    // A FAILED CALL IS NOT A PURCHASE AND IT IS NOT A MYSTERY EITHER: the status alone made an empty balance and a
    // busy minute the same event to every caller, so the drafter retried the one that can never succeed. No usage came back, so no cost is claimed anywhere on this path.
    const code = await providerErrorCode(response);
    const retryMs = retryAfterMs(response.headers?.get?.("retry-after"));
    await reportGatewayFailure(id, `openai_http_${response.status}`, code);
    if (code === CREDIT_EXHAUSTED) await credit.trip(tenantId).catch(() => {});
    return { kind: "http_error", status: response.status, ...(code ? { code } : {}), ...(retryMs === undefined ? {} : { retryAfterMs: retryMs }) };
  }
  // The provider answered, so the balance is not empty: lift any stop on file before the envelope is even read.
  await credit.clear(tenantId).catch(() => {});

  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    // AN ENVELOPE THAT STOPPED ARRIVING IS NOT A SHAPE I COULD NOT USE, and it was read as one, so a deadline or a socket reset mid body came back as schema_invalid and was stamped on somebody's answer as a permanent refusal. NOTHING THROWN HERE MAY SETTLE ANYTHING: no usage receipt was ever readable, and that covers a complete body that is not JSON too.
    const { reason, timedOut } = threwOnTheWire(e, "body_read_failed");
    await reportGatewayFailure(id, timedOut ? "client_timeout" : "body_read_failed", reason);
    return { kind: "error", reason, timedOut };
  }

  const fields = readProvenanceFields(json);
  const usagePresent = fields.inputTokens !== null || fields.outputTokens !== null;
  const provenance: LlmProvenance = {
    tenantId,
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
    // POST-network: the envelope supplied real usage, so its cost is genuine spend. Return the provenance so the ledger counts it (it was under-counting before).
    await reportGatewayFailure(id, `invalid_response_${classified.reason}`);
    return { kind: "invalid_response", reason: classified.reason, provenance };
  }

  // 8. Structured text present. With strict:true a JSON.parse failure signals a
  //    provider malfunction; never substring-hunt for JSON in prose.
  let parsed: unknown;
  try {
    parsed = JSON.parse(classified.text);
  } catch {
    // Also POST-network: keep the provenance so the real cost is not discarded.
    await reportGatewayFailure(id, "invalid_response_structured_parse");
    return { kind: "invalid_response", reason: "structured output was not valid JSON", provenance };
  }

  const value = normalizeStructuredValue(parsed, args.zodSchema);
  return { kind: "ok", value, provenance };
}
