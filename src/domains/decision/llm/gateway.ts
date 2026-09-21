import "server-only";
import { log } from "@/lib/logger";
import { createHash } from "node:crypto";
import { recordAppError } from "@/lib/obs/error-ledger";
import { perfCountExternal } from "@/lib/obs/perf-log";
import { z } from "zod";
import { PROOF_SPEND, spendingClosed } from "@/lib/spend-scope";
import { assertPaidCallAllowed, globalMonthlyCapUsd } from "@/lib/cost/cost-breaker";
import { CREDIT_BREAKER } from "@/lib/cost/credit-breaker";
import spendReservations from "@/lib/cost/spend-reservations";
import type { PromptId } from "./prompt-registry";
import {
  classifyResponsesEnvelope,
  normalizeStructuredValue,
  readProvenanceFields,
  strictJsonSchemaFor,
} from "./responses-envelope";

export { strictJsonSchemaFor, normalizeStructuredValue };
export const creditBreakerHeld = async (tenantId: string): Promise<boolean> => (await CREDIT_BREAKER.peek(tenantId)) === "held";
const OPENAI_RESPONSES_API = "https://api.openai.com/v1/responses";
const REASONING_TIMEOUT_FLOOR_MS = 90_000;
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

const COST_PER_MILLION = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
} as const;

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates =
    (COST_PER_MILLION as Record<string, { input: number; output: number }>)[model] ??
    COST_PER_MILLION["gpt-5-mini"];
  const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

type SpendReservationContext = {
  platform: "adjudicator-openai" | "onboarding-openai";
  purpose: "bulk" | "fact_check" | "onboarding";
  logicalKey: string;
  proposalWorkKey?: string | null;
  estimatedUsd: number;
  monthlyCapUsd?: number | null;
  lifetimeCapUsd?: number | null;
};

type ReservationImpl = Pick<typeof spendReservations, "reserve" | "claimTransmission" | "markAmbiguous" | "release" | "reconcile">;
async function reconcileRetried(write: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) { try { if (await write()) return true; } catch { /* retry the idempotent RPC */ } }
  return false;
}

export type CostBreakerImpl = {
  check: (projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

type CreditBreakerImpl = {
  peek: (tenantId: string) => Promise<"clear" | "held" | "probe_due">;
  claimProbe: (tenantId: string) => Promise<boolean>;
  trip: (tenantId: string) => Promise<void>;
  clear: (tenantId: string) => Promise<void>;
};

const CREDIT_EXHAUSTED = "credit_balance_exhausted";
const OPENAI_ACCOUNT_HOLDS = new Set([CREDIT_EXHAUSTED, "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "billing_gate_unknown", "invalid_api_key"]);
const CODE_SHAPE = /^[a-z0-9_.-]{1,64}$/i;
const CREDIT_STOP_REASON =
  "OpenAI account access is unavailable (credit, a project or organization limit, or credentials), so every call that needs it is paused. One recovery probe runs every 15 minutes; work resumes only after OpenAI accepts it.";

type GatewayIdentity = {
  promptId: PromptId;
  promptVersion: number;
  action: string;
  tenantId: string;
};

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
  accountedCostUsd?: number | null;
  costBasis?: "usage_estimate" | "reservation_estimate";
  retryCount: number;
};

export type StructuredCallArgs = {
  promptId: PromptId;
  promptVersion: number;
  action: string;
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  zodSchema: z.ZodTypeAny;
  maxOutputTokens: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /** The owning account. REQUIRED (validated non-empty before any check) so spend,
   *  provenance, and error-ledger rows are always attributable to one account. */
  tenantId: string;
  costBreakerImpl?: CostBreakerImpl;
  creditBreakerImpl?: CreditBreakerImpl;
  spend: SpendReservationContext;
  reservationImpl?: ReservationImpl;
};

/** THE ONE HONEST TRANSPORT FACT, on every outcome: how many requests actually LEFT this process for the
 *  provider. It is 0 for every refusal decided before the fetch (missing tenant, research paused, credit held,
 *  breaker, budget, an unconvertible schema, a probe that could not be recorded) and 1 once the request is on
 *  the wire, whatever comes back. Counting at the caller instead was how a pre-network refusal was reported to
 *  the operator as a charged provider call (Codex, 2026-08-23); the only place that can answer this honestly is
 *  the line either side of `fetch`, so the answer is stamped here and carried, never inferred. */
type Attempted = { httpAttempts: 0 | 1 };
type StructuredCallOutcome = Attempted & (
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
  | { kind: "error"; reason: string; timedOut: boolean });

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
    case "http_error": return OPENAI_ACCOUNT_HOLDS.has(outcome.code ?? "") || outcome.status === 402 ? "credit_exhausted" : "transient";
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
  projected: number,
  impl: CostBreakerImpl | undefined,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
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
  const exact = typeof err?.code === "string" && CODE_SHAPE.test(err.code.trim()) ? err.code.trim().toLowerCase() : undefined;
  if (exact) return exact === "insufficient_quota" ? "billing_gate_unknown" : exact;
  const broad = typeof err?.type === "string" && CODE_SHAPE.test(err.type.trim()) ? err.type.trim().toLowerCase() : undefined;
  if (broad === "insufficient_quota") return "billing_gate_unknown";
  if (response.status === 401) return "invalid_api_key";
  return broad ?? (response.status === 429 ? "rate_limit_exceeded" : undefined);
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

async function interpretEnvelope(
  json: unknown,
  provenance: LlmProvenance,
  schema: z.ZodTypeAny,
  id: GatewayIdentity,
  httpAttempts: 0 | 1,
): Promise<StructuredCallOutcome> {
  const classified = classifyResponsesEnvelope(json);
  if (classified.kind === "refusal") {
    await reportGatewayFailure(id, "refusal");
    return { httpAttempts, kind: "refusal", provenance };
  }
  if (classified.kind === "incomplete") {
    await reportGatewayFailure(id, "incomplete", classified.reason);
    return { httpAttempts, kind: "incomplete", reason: classified.reason, provenance };
  }
  if (classified.kind === "invalid") {
    await reportGatewayFailure(id, `invalid_response_${classified.reason}`);
    return { httpAttempts, kind: "invalid_response", reason: classified.reason, provenance };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(classified.text); }
  catch {
    await reportGatewayFailure(id, "invalid_response_structured_parse");
    return { httpAttempts, kind: "invalid_response", reason: "structured output was not valid JSON", provenance };
  }
  return { httpAttempts, kind: "ok", value: normalizeStructuredValue(parsed, schema), provenance };
}

/**
 * THE OpenAI structured-generation transport over the Responses API. Enforces the guard order in the module doc, converts the Zod schema to a strict JSON Schema, and returns a typed outcome. Never throws.
 */
export async function openAIStructuredResponse(args: StructuredCallArgs): Promise<StructuredCallOutcome> {
  // Account identity is required BEFORE any check: no spend, provenance, or ledger row may be unattributable. A caller that cannot name its account is a bug, not
  // a license for a global call - fail closed with no cost, no network.
  const tenantId = (args.tenantId ?? "").trim();
  if (!tenantId) return { httpAttempts: 0, kind: "invalid_response", reason: "missing_tenant" };
  // A normal paused call stops here; a named proof is charged against its private allowance below.
  const proof = PROOF_SPEND.activeFor(tenantId);
  if (proof === false || proof == null && await spendingClosed(tenantId)) return { httpAttempts: 0, kind: "blocked_budget", reason: "research is paused for this account, so nothing is bought on this pass" };
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
    return { httpAttempts: 0, kind: "blocked_credit", reason: CREDIT_STOP_REASON };
  }

  // 3. Global breaker (outer guard): refuse before the per-platform cap is read.
  const projectedCostUsd = Math.max(0.02, args.spend.estimatedUsd,
    estimateCost(args.model, Buffer.byteLength(args.instructions + args.input), args.maxOutputTokens));
  const breaker = await checkGatewayCostBreaker(projectedCostUsd, args.costBreakerImpl);
  if (!breaker.allowed) {
    await reportGatewayFailure(id, "blocked_budget", breaker.reason);
    return { httpAttempts: 0, kind: "blocked_budget", reason: breaker.reason };
  }

  // 5. Schema conversion - fail closed BEFORE any network call on an unsupported schema.
  const converted = strictJsonSchemaFor(args.zodSchema, args.schemaName);
  if ("unsupported" in converted) {
    await reportGatewayFailure(id, "invalid_response_unsupported_schema", converted.unsupported);
    return { httpAttempts: 0, kind: "invalid_response", reason: `unsupported_schema: ${converted.unsupported}` };
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

  // ONE durable spend lifecycle. The byte count is a conservative input-token ceiling; caller projections may
  // raise it, never lower it. The exact request identity resumes only its own unresolved operation for this day.
  const computedEstimate = Math.max(projectedCostUsd, estimateCost(args.model, Buffer.byteLength(JSON.stringify(requestBody)), args.maxOutputTokens));
  if (proof === true && PROOF_SPEND.authorize(tenantId, "model", computedEstimate) !== false) return { httpAttempts: 0, kind: "blocked_budget", reason: "the one-candidate proof reached its explicit OpenAI call or USD ceiling" };
  const context = args.spend;
  const reservations = args.reservationImpl ?? spendReservations;
  const requestFingerprint = createHash("sha256").update(`${OPENAI_RESPONSES_API}\n${JSON.stringify(requestBody)}`).digest("hex");
  let reservation;
  try { reservation = await reservations.reserve({ tenantId, ...context, requestFingerprint,
    recoveryKind: "none", estimatedUsd: Math.max(context.estimatedUsd, computedEstimate),
    globalMonthlyCapUsd: globalMonthlyCapUsd() }); }
  catch { reservation = null; }
  if (!reservation?.attemptId || !["reserved", "resumed", "replayed"].includes(reservation.outcome)) {
    const reason = reservation?.outcome ?? "spend reservation unavailable, failing closed";
    await reportGatewayFailure(id, "blocked_budget", reason);
    return { httpAttempts: 0, kind: "blocked_budget", reason };
  }
  const attemptId = reservation.attemptId;
  const ambiguous = () => reservations.markAmbiguous(attemptId).catch(() => false);
  // A provider refusal can prove zero cost only for an attempt that had never
  // crossed the transport boundary before this invocation. A resumed
  // transmitted/ambiguous attempt may already have been charged; a new 402/429
  // says nothing about that earlier transmission and must not erase its hold.
  const zeroCostCanStillBeProven = reservation.state === "reserved";
  if (reservation.outcome === "replayed") {
    const json = reservation.resultPayload;
    const fields = readProvenanceFields(json);
    if (json == null) return { httpAttempts: 0, kind: "error", reason: "stored_provider_result_incomplete", timedOut: false };
    const provenance: LlmProvenance = { tenantId, responseId: fields.responseId, requestedModel: args.model,
      servedModel: fields.servedModel, status: fields.status, createdAt: fields.createdAt,
      inputTokens: fields.inputTokens, outputTokens: fields.outputTokens,
      costUsd: 0, accountedCostUsd: reservation.accountedUsd ?? null,
      costBasis: reservation.accountingBasis === "reservation_estimate" ? "reservation_estimate" : "usage_estimate", retryCount: 0 };
    return interpretEnvelope(json, provenance, args.zodSchema, id, 0);
  }

  // 6. Reasoning timeout floor.
  const timeoutMs = effectiveTimeoutMs(args.model, args.timeoutMs);
  const fetchImpl = args.fetchImpl ?? fetch;

  // The Responses create endpoint does not promise idempotent POST replay. If a
  // prior transmission became ambiguous, repeating the same bytes could buy the
  // same answer twice. Only an attempt that is still durably `reserved` may
  // cross the wire; transmitted/ambiguous work remains held for reconciliation.
  const transmission = reservation.state === "reserved"
    ? await reservations.claimTransmission(attemptId)
    : "already_started" as const;
  if (transmission !== "claimed") {
    const reason = transmission === "cap_refused"
      ? "the spending door closed before this request reached the provider"
      : transmission === "stale_day"
        ? "the reporting day changed before this request reached the provider"
      : transmission === "work_retired"
        ? "the operator retired this exact work before the request reached the provider"
      : transmission === "run_inactive"
        ? "the research run no longer owns its lease, so no provider request was made"
      : "this paid operation already started and remains unresolved";
    await reportGatewayFailure(id, "blocked_budget", reason);
    return { httpAttempts: 0, kind: "blocked_budget", reason };
  }
  // Claim only after the final transactional transmission gate. A cap/day/retirement/lease refusal did not reach
  // OpenAI and therefore must not consume the account's one recovery probe.
  if (stop === "probe_due" && !(await credit.claimProbe(tenantId).catch(() => false))) {
    if (zeroCostCanStillBeProven) await reservations.release(attemptId, true).catch(() => false);
    log.warn(`[llm-gateway] ${id.promptId} v${id.promptVersion} blocked_credit (the recovery attempt could not be recorded)`, { action: id.action, tenantId });
    return { httpAttempts: 0, kind: "blocked_credit", reason: CREDIT_STOP_REASON };
  }
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": attemptId, "X-Client-Request-Id": attemptId },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    await ambiguous();
    const { reason, timedOut } = threwOnTheWire(e, "fetch_failed");
    await reportGatewayFailure(id, timedOut ? "client_timeout" : "network_failed", reason);
    return { httpAttempts: 1, kind: "error", reason, timedOut };
  }

  if (!response.ok) {
    // A FAILED CALL IS NOT A PURCHASE AND IT IS NOT A MYSTERY EITHER: the status alone made an empty balance and a
    // busy minute the same event to every caller, so the drafter retried the one that can never succeed. No usage came back, so no cost is claimed anywhere on this path.
    const code = await providerErrorCode(response);
    // A quota/rate response is the provider refusing BEFORE generation, so the
    // reservation returns to the day. Keeping it ambiguous permanently bound
    // this exact draft identity even after credit was restored. A server error
    // remains ambiguous because the request may have reached generation before
    // the provider failed. If the release receipt itself cannot land, fall back
    // to the conservative hold.
    const refusedBeforeGeneration = zeroCostCanStillBeProven && [401, 402, 403, 429].includes(response.status);
    const accounted = refusedBeforeGeneration
      ? await reservations.release(attemptId, true).catch(() => false)
      : false;
    if (!accounted) await ambiguous();
    const retryMs = retryAfterMs(response.headers?.get?.("retry-after"));
    await reportGatewayFailure(id, `openai_http_${response.status}`, code);
    if (OPENAI_ACCOUNT_HOLDS.has(code ?? "")) await credit.trip(tenantId).catch(() => {});
    return { httpAttempts: 1, kind: "http_error", status: response.status, ...(code ? { code } : {}), ...(retryMs === undefined ? {} : { retryAfterMs: retryMs }) };
  }
  // The provider answered, so the balance is not empty: lift any stop on file before the envelope is even read.
  await credit.clear(tenantId).catch(() => {});

  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    // AN ENVELOPE THAT STOPPED ARRIVING IS NOT A SHAPE I COULD NOT USE, and it was read as one, so a deadline or a socket reset mid body came back as schema_invalid and was stamped on somebody's answer as a permanent refusal. NOTHING THROWN HERE MAY SETTLE ANYTHING: no usage receipt was ever readable, and that covers a complete body that is not JSON too.
    const { reason, timedOut } = threwOnTheWire(e, "body_read_failed");
    await ambiguous();
    await reportGatewayFailure(id, timedOut ? "client_timeout" : "body_read_failed", reason);
    return { httpAttempts: 1, kind: "error", reason, timedOut };
  }

  const fields = readProvenanceFields(json);
  const usagePresent = fields.inputTokens !== null && fields.outputTokens !== null;
  const accountedCost = usagePresent ? estimateCost(args.model, fields.inputTokens ?? 0, fields.outputTokens ?? 0) : reservation.estimatedUsd;
  const costBasis = usagePresent ? "usage_estimate" as const : "reservation_estimate" as const;
  const provenance: LlmProvenance = {
    tenantId,
    responseId: fields.responseId,
    requestedModel: args.model,
    servedModel: fields.servedModel,
    status: fields.status,
    createdAt: fields.createdAt,
    inputTokens: fields.inputTokens,
    outputTokens: fields.outputTokens,
    costUsd: accountedCost,
    costBasis,
    retryCount: 0,
  };
  if (!(await reconcileRetried(() => reservations.reconcile(attemptId, accountedCost,
    provenance.responseId, costBasis, json)))) {
    await ambiguous();
    await reportGatewayFailure(id, "spend_reconciliation_failed");
    return { httpAttempts: 1, kind: "error", reason: "spend_reconciliation_failed", timedOut: false };
  }

  return interpretEnvelope(json, provenance, args.zodSchema, id, 1);
}
