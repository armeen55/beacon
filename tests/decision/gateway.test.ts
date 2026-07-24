/**
 * llm/gateway — canonical strict OpenAI Responses transport (Slice 3).
 *
 * Every test injects `fetchImpl`; ZERO network. Budget/breaker seams are
 * injected so the cap logic is exercised without touching the operator's real
 * `.data/` ledgers. Proves: fail-closed BEFORE network (breaker, budget,
 * unsupported schema), the exact Responses request body, and every envelope
 * classification (ok / refusal / incomplete / failed / missing / http / abort)
 * plus provider-null normalization and provenance.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  openAIStructuredResponse,
  strictJsonSchemaFor,
  normalizeStructuredValue,
  effectiveTimeoutMs,
  isReasoningModel,
  estimateCost,
  type StructuredCallArgs,
  type BudgetImpl,
  type CostBreakerImpl,
} from "@/domains/decision/llm/gateway";

// ── helpers ──────────────────────────────────────────────────────────────────

const SCHEMA = z.object({
  title: z.string(),
  note: z.string().optional(), // optional-not-nullable: provider null must be stripped
  score: z.number().nullable(), // genuinely nullable: null must be kept
});

/** A completed Responses envelope carrying `structuredText` as the output_text. */
function completedEnvelope(structuredText: string, over: Record<string, unknown> = {}) {
  return {
    id: "resp_abc123",
    model: "gpt-5-mini",
    status: "completed",
    created_at: 1_753_000_000,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: structuredText }],
      },
    ],
    output_text: structuredText,
    usage: { input_tokens: 1200, output_tokens: 300 },
    ...over,
  };
}

type FetchCapture = { calls: number; url: string | null; body: any };

/** A fake fetch that records the call and returns the given envelope/status. */
function fakeFetch(
  envelope: unknown,
  opts: { ok?: boolean; status?: number; throwErr?: Error; notJson?: boolean } = {},
): { impl: typeof fetch; capture: FetchCapture } {
  const capture: FetchCapture = { calls: 0, url: null, body: null };
  const impl = (async (url: string, init: RequestInit) => {
    capture.calls += 1;
    capture.url = url;
    capture.body = init?.body ? JSON.parse(init.body as string) : null;
    if (opts.throwErr) throw opts.throwErr;
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => {
        if (opts.notJson) throw new Error("not json");
        return envelope;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, capture };
}

function baseArgs(over: Partial<StructuredCallArgs> = {}): StructuredCallArgs {
  return {
    promptId: "draft.answer_block",
    promptVersion: 6,
    action: "gateway-test",
    apiKey: "sk-test",
    model: "gpt-5-mini",
    instructions: "You are a strict JSON generator.",
    input: "Make a title.",
    schemaName: "test_schema",
    zodSchema: SCHEMA,
    maxOutputTokens: 512,
    timeoutMs: 30_000,
    budget: { mode: "caller", note: "test" },
    tenantId: "tenant-fixture",
    ...over,
  };
}

const allowBreaker: CostBreakerImpl = { check: async () => ({ tripped: false }) };
const allowBudget: BudgetImpl = { check: async () => ({ allowed: true }), record: async () => {} };

// ── strictJsonSchemaFor ───────────────────────────────────────────────────────

describe("strictJsonSchemaFor", () => {
  it("makes every property required, sets additionalProperties:false, and nullifies optionals", () => {
    const out = strictJsonSchemaFor(SCHEMA, "s");
    expect("unsupported" in out).toBe(false);
    if ("unsupported" in out) return;
    const schema = out.schema as any;
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(new Set(["title", "note", "score"]));
    // optional `note` becomes anyOf[string,null]
    expect(schema.properties.note.anyOf).toEqual(expect.arrayContaining([{ type: "string" }, { type: "null" }]));
    // strip validation keywords the strict subset does not guarantee
    expect(JSON.stringify(schema)).not.toContain("$schema");
    expect(JSON.stringify(schema)).not.toContain("minLength");
  });

  it("returns { unsupported } for a construct outside the strict subset (z.any)", () => {
    const out = strictJsonSchemaFor(z.object({ a: z.any() }), "s");
    expect("unsupported" in out).toBe(true);
  });
});

// ── normalizeStructuredValue ──────────────────────────────────────────────────

describe("normalizeStructuredValue", () => {
  it("drops optional-not-nullable nulls but keeps genuinely-nullable nulls", () => {
    const v = normalizeStructuredValue({ title: "Hi", note: null, score: null }, SCHEMA) as Record<string, unknown>;
    expect("note" in v).toBe(false); // optional-not-nullable null stripped
    expect(v.score).toBeNull(); // nullable null kept
    expect(SCHEMA.safeParse(v).success).toBe(true); // original schema now parses
  });
});

// ── fail-closed BEFORE network ────────────────────────────────────────────────

describe("openAIStructuredResponse — fails closed before any fetch", () => {
  it("blocks on a tripped global cost breaker without calling fetch", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(
      baseArgs({
        budget: { mode: "gateway_check", projectedCostUsd: 0.01 },
        costBreakerImpl: { check: async () => ({ tripped: true, reason: "ceiling reached" }) },
        fetchImpl: impl,
      }),
    );
    expect(res.kind).toBe("blocked_budget");
    if (res.kind === "blocked_budget") expect(res.reason).toBe("ceiling reached");
    expect(capture.calls).toBe(0);
  });

  it("blocks on the per-platform budget cap without calling fetch", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(
      baseArgs({
        budget: { mode: "gateway_check", projectedCostUsd: 0.01 },
        costBreakerImpl: allowBreaker,
        budgetImpl: { check: async () => ({ allowed: false, reason: "cap reached" }), record: async () => {} },
        fetchImpl: impl,
      }),
    );
    expect(res.kind).toBe("blocked_budget");
    expect(capture.calls).toBe(0);
  });

  it("returns invalid_response for an unsupported schema without calling fetch", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(
      baseArgs({ zodSchema: z.object({ a: z.any() }), fetchImpl: impl }),
    );
    expect(res.kind).toBe("invalid_response");
    if (res.kind === "invalid_response") expect(res.reason).toContain("unsupported_schema");
    expect(capture.calls).toBe(0);
  });
});

// ── request body shape ────────────────────────────────────────────────────────

describe("openAIStructuredResponse — request body", () => {
  it("sends EXACT Responses fields and omits Chat-Completions fields", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", note: null, score: 1 })));
    await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));

    expect(capture.url).toBe("https://api.openai.com/v1/responses");
    const body = capture.body;
    expect(body.instructions).toBe("You are a strict JSON generator.");
    expect(body.input).toBe("Make a title.");
    expect(body.max_output_tokens).toBe(512);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.name).toBe("test_schema");
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.additionalProperties).toBe(false);
    // reasoning model gets reasoning.effort default
    expect(body.reasoning).toEqual({ effort: "low" });

    // Chat-Completions fields MUST be absent.
    expect(body.messages).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it("omits reasoning for a non-reasoning model", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope(JSON.stringify({ title: "T", note: null, score: 1 })));
    await openAIStructuredResponse(baseArgs({ model: "gpt-4o-mini", fetchImpl: impl }));
    expect(capture.body.reasoning).toBeUndefined();
  });
});

// ── envelope classification ───────────────────────────────────────────────────

describe("openAIStructuredResponse — envelope outcomes", () => {
  it("parses a completed valid response to ok with provenance and normalized nulls", async () => {
    const { impl } = fakeFetch(completedEnvelope(JSON.stringify({ title: "Hello", note: null, score: null })));
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    const value = res.value as Record<string, unknown>;
    expect(value.title).toBe("Hello");
    expect("note" in value).toBe(false); // optional-not-nullable null stripped
    expect(value.score).toBeNull(); // nullable kept
    expect(SCHEMA.safeParse(value).success).toBe(true);
    expect(res.provenance.tenantId).toBe("tenant-fixture"); // provenance carries the account
    expect(res.provenance.responseId).toBe("resp_abc123");
    expect(res.provenance.servedModel).toBe("gpt-5-mini");
    expect(res.provenance.requestedModel).toBe("gpt-5-mini");
    expect(res.provenance.status).toBe("completed");
    expect(res.provenance.inputTokens).toBe(1200);
    expect(res.provenance.outputTokens).toBe(300);
    expect(res.provenance.costUsd).toBe(estimateCost("gpt-5-mini", 1200, 300));
    expect(res.provenance.retryCount).toBe(0);
  });

  it("returns refusal (no value) when the message carries a refusal part", async () => {
    const env = completedEnvelope("ignored");
    env.output = [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I can't." }] }] as any;
    const { impl } = fakeFetch(env);
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("refusal");
    if (res.kind === "refusal") expect(res.provenance.responseId).toBe("resp_abc123");
  });

  it("returns incomplete (no value) when status is incomplete", async () => {
    const env = completedEnvelope("partial", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    const { impl } = fakeFetch(env);
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("incomplete");
    if (res.kind === "incomplete") expect(res.reason).toBe("max_output_tokens");
  });

  it("returns invalid_response for a failed status, RETAINING the real usage cost (post-network)", async () => {
    const env = completedEnvelope("x", { status: "failed", output: [] });
    const { impl } = fakeFetch(env);
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind !== "invalid_response") return;
    expect(res.reason).toBe("failed_status");
    // A POST-network invalid supplied usage, so its cost is real spend and must not be discarded.
    expect(res.provenance?.tenantId).toBe("tenant-fixture");
    expect(res.provenance?.costUsd).toBe(estimateCost("gpt-5-mini", 1200, 300));
  });

  it("a missing tenantId fails closed with NO fetch and NO provenance (pre-network)", async () => {
    const { impl, capture } = fakeFetch(completedEnvelope("{}"));
    const res = await openAIStructuredResponse(baseArgs({ tenantId: "  ", fetchImpl: impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind === "invalid_response") {
      expect(res.reason).toBe("missing_tenant");
      expect(res.provenance).toBeUndefined(); // no provider provenance, no cost
    }
    expect(capture.calls).toBe(0);
  });

  it("returns invalid_response when a completed response has no structured output", async () => {
    const env = completedEnvelope("x", { output: [], output_text: "" });
    const { impl } = fakeFetch(env);
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("invalid_response");
    if (res.kind === "invalid_response") expect(res.reason).toBe("no_structured_output");
  });

  it("returns invalid_response when the structured text is not valid JSON", async () => {
    const { impl } = fakeFetch(completedEnvelope("this is prose, not json"));
    const res = await openAIStructuredResponse(baseArgs({ fetchImpl: impl }));
    expect(res.kind).toBe("invalid_response");
  });

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

// ── pure helpers still honored ────────────────────────────────────────────────

describe("gateway pure helpers", () => {
  it("floors reasoning-model timeouts to 90s and leaves others alone", () => {
    expect(isReasoningModel("gpt-5-mini")).toBe(true);
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);
    expect(effectiveTimeoutMs("gpt-5-mini", 1_000)).toBe(90_000);
    expect(effectiveTimeoutMs("gpt-5-mini", 120_000)).toBe(120_000);
    expect(effectiveTimeoutMs("gpt-4o-mini", 1_000)).toBe(1_000);
  });
});
