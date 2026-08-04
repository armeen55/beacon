/**
 * Strict OpenAI Responses gateway: fail-closed-before-network (breaker, budget,
 * unsupported schema, missing tenant), exact request contract (Responses fields
 * present, Chat-Completions fields absent), and every envelope outcome.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  openAIStructuredResponse, effectiveTimeoutMs, isReasoningModel, estimateCost,
  type StructuredCallArgs, type CostBreakerImpl,
} from "@/domains/decision/llm/gateway";
// note = optional-not-nullable (provider null must be stripped); score = genuinely nullable (null kept).
const SCHEMA = z.object({ title: z.string(), note: z.string().optional(), score: z.number().nullable() });
/** A completed Responses envelope carrying `structuredText` as the output_text. */
function completedEnvelope(structuredText: string, over: Record<string, unknown> = {}) {
  return {
    id: "resp_abc123", model: "gpt-5-mini", status: "completed", created_at: 1_753_000_000,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: structuredText }] }],
    output_text: structuredText, usage: { input_tokens: 1200, output_tokens: 300 }, ...over,
  };
}
type FetchCapture = { calls: number; url: string | null; body: any };
/** A fake fetch that records the call and returns the given envelope/status. */
function fakeFetch(envelope: unknown, opts: { ok?: boolean; status?: number; throwErr?: Error; notJson?: boolean } = {}): { impl: typeof fetch; capture: FetchCapture } {
  const capture: FetchCapture = { calls: 0, url: null, body: null };
  const impl = (async (url: string, init: RequestInit) => {
    capture.calls += 1; capture.url = url; capture.body = init?.body ? JSON.parse(init.body as string) : null;
    if (opts.throwErr) throw opts.throwErr;
    return { ok: opts.ok ?? true, status: opts.status ?? 200, json: async () => { if (opts.notJson) throw new Error("not json"); return envelope; } } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, capture };
}
function baseArgs(over: Partial<StructuredCallArgs> = {}): StructuredCallArgs {
  return {
    promptId: "draft.answer_block", promptVersion: 6, action: "gateway-test", apiKey: "sk-test", model: "gpt-5-mini",
    instructions: "You are a strict JSON generator.", input: "Make a title.", schemaName: "test_schema", zodSchema: SCHEMA,
    maxOutputTokens: 512, timeoutMs: 30_000, budget: { mode: "caller", note: "test" }, tenantId: "tenant-fixture", ...over,
  };
}
const allowBreaker: CostBreakerImpl = { check: async () => ({ tripped: false }) };
// Schema conversion + null-normalization promises live in the committed all-kinds
// sweep (schema-strict-conversion.test.ts); the unsupported-schema fail-closed
// promise is pinned behaviorally below (zero-fetch invalid_response).
describe("openAIStructuredResponse — fails closed before any fetch", () => {
  it("blocks on a tripped global cost breaker without calling fetch", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(baseArgs({ budget: { mode: "gateway_check", projectedCostUsd: 0.01 }, costBreakerImpl: { check: async () => ({ tripped: true, reason: "ceiling reached" }) }, fetchImpl: impl }));
    expect([res.kind, res.kind === "blocked_budget" && res.reason, capture.calls]).toEqual(["blocked_budget", "ceiling reached", 0]);
  });
  it("blocks on the per-platform budget cap without calling fetch", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(baseArgs({ budget: { mode: "gateway_check", projectedCostUsd: 0.01 }, costBreakerImpl: allowBreaker, budgetImpl: { check: async () => ({ allowed: false, reason: "cap reached" }), record: async () => {} }, fetchImpl: impl }));
    expect([res.kind, capture.calls]).toEqual(["blocked_budget", 0]);
  });
  it("returns invalid_response for an unsupported schema without calling fetch", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(baseArgs({ zodSchema: z.object({ a: z.any() }), fetchImpl: impl }));
    expect([res.kind, res.kind === "invalid_response" && res.reason.includes("unsupported_schema"), capture.calls]).toEqual(["invalid_response", true, 0]);
  });
});
describe("openAIStructuredResponse — request body", () => {
  it("sends EXACT Responses fields and omits Chat-Completions fields", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", note: null, score: 1 })));
    await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(capture.url).toBe("https://api.openai.com/v1/responses");
    const body = capture.body;
    expect([body.instructions, body.input, body.max_output_tokens]).toEqual(["You are a strict JSON generator.", "Make a title.", 512]);
    expect([body.text.format.type, body.text.format.name, body.text.format.strict]).toEqual(["json_schema", "test_schema", true]);
    expect(body.text.format.schema.additionalProperties).toBe(false); // reasoning model gets reasoning.effort default
    expect(body.reasoning).toEqual({ effort: "low" });
    // Chat-Completions fields MUST be absent.
    for (const k of ["messages", "max_completion_tokens", "reasoning_effort", "response_format"]) expect(body[k]).toBeUndefined();
  });
});
describe("openAIStructuredResponse — envelope outcomes", () => {
  it("parses a completed valid response to ok with provenance and normalized nulls", async () => {
    const { impl } = fakeFetch(completedEnvelope(JSON.stringify({ title: "Hello", note: null, score: null })));
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const value = res.value as Record<string, unknown>;
    expect([value.title, "note" in value, value.score, SCHEMA.safeParse(value).success]).toEqual(["Hello", false, null, true]); // optional-not-nullable null stripped, nullable kept
    const p = res.provenance; // provenance carries the account
    expect([p.tenantId, p.responseId, p.servedModel, p.requestedModel, p.status]).toEqual(["tenant-fixture", "resp_abc123", "gpt-5-mini", "gpt-5-mini", "completed"]);
    expect([p.inputTokens, p.outputTokens, p.costUsd, p.retryCount]).toEqual([1200, 300, estimateCost("gpt-5-mini", 1200, 300), 0]);
  });
  it("returns refusal (no value) when the message carries a refusal part", async () => {
    const env = completedEnvelope("ignored");
    env.output = [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I can't." }] }] as any;
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env).impl }));
    expect([res.kind, res.kind === "refusal" && res.provenance.responseId]).toEqual(["refusal", "resp_abc123"]);
  });
  it("returns incomplete (no value) when status is incomplete", async () => {
    const env = completedEnvelope("partial", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env).impl }));
    expect([res.kind, res.kind === "incomplete" && res.reason]).toEqual(["incomplete", "max_output_tokens"]);
  });
  it("returns invalid_response for a failed status, RETAINING the real usage cost (post-network)", async () => {
    const env = completedEnvelope("x", { status: "failed", output: [] });
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env).impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind !== "invalid_response") return;
    // A POST-network invalid supplied usage, so its cost is real spend and must not be discarded.
    expect([res.reason, res.provenance?.tenantId, res.provenance?.costUsd]).toEqual(["failed_status", "tenant-fixture", estimateCost("gpt-5-mini", 1200, 300)]);
  });
  it("a missing tenantId fails closed with NO fetch and NO provenance (pre-network)", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(baseArgs({ tenantId: "  ", fetchImpl: impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind === "invalid_response") { expect(res.reason).toBe("missing_tenant"); expect(res.provenance).toBeUndefined(); } // no provenance, no cost
    expect(capture.calls).toBe(0);
  });
  it("returns invalid_response when a completed response has no structured output", async () => {
    const env = completedEnvelope("x", { output: [], output_text: "" });
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(env).impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind === "invalid_response") expect(res.reason).toBe("no_structured_output");
  });
  it("returns invalid_response when the structured text is not valid JSON", async () => { // never substring-hunt for JSON inside prose
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: fakeFetch(completedEnvelope("this is prose, not json")).impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind === "invalid_response") expect(res.reason).toBe("structured output was not valid JSON"); });
  it("returns http_error(status) on a non-2xx response", async () => {
    const { impl } = fakeFetch(completedEnvelope("{}"), { ok: false, status: 429 });
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("http_error");
    if (res.kind === "http_error") expect(res.status).toBe(429);
  });
  it("returns error on a fetch throw / abort", async () => {
    const { impl } = fakeFetch(completedEnvelope("{}"), { throwErr: new Error("The operation was aborted") });
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.reason).toContain("aborted");
  });
});
describe("gateway pure helpers", () => {
  it("floors reasoning-model timeouts to 90s and leaves others alone", () => {
    expect([isReasoningModel("gpt-5-mini"), isReasoningModel("gpt-4o-mini")]).toEqual([true, false]);
    expect([effectiveTimeoutMs("gpt-5-mini", 1_000), effectiveTimeoutMs("gpt-5-mini", 120_000), effectiveTimeoutMs("gpt-4o-mini", 1_000)]).toEqual([90_000, 120_000, 1_000]);
  });
});
