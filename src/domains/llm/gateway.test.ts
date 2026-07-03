import { describe, it, expect, vi } from "vitest";
import {
  effectiveTimeoutMs,
  estimateCost,
  isReasoningModel,
  openAIChatCompletion,
  recordGatewaySpend,
  OPENAI_CHAT_API,
  REASONING_TIMEOUT_FLOOR_MS,
  type BudgetImpl,
} from "./gateway";

function okResponse(body: unknown = { choices: [] }): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const BASE = {
  promptId: "draft.answer_block" as const,
  promptVersion: 1,
  action: "gateway-test",
  apiKey: "k",
  timeoutMs: 10_000,
};

const allowAll: BudgetImpl = {
  check: async () => ({ allowed: true }),
  record: async () => {},
};

describe("gateway - reasoning model policy", () => {
  it("floors the timeout to 90s for reasoning models, leaves others alone", () => {
    expect(effectiveTimeoutMs("gpt-5-mini", 45_000)).toBe(REASONING_TIMEOUT_FLOOR_MS);
    expect(effectiveTimeoutMs("gpt-5-mini", 120_000)).toBe(120_000);
    expect(effectiveTimeoutMs("o3", 10_000)).toBe(REASONING_TIMEOUT_FLOOR_MS);
    expect(effectiveTimeoutMs("gpt-4o-mini-search-preview", 45_000)).toBe(45_000);
  });

  it("isReasoningModel matches gpt-5 family + o-series only", () => {
    expect(isReasoningModel("gpt-5-mini")).toBe(true);
    expect(isReasoningModel("o3")).toBe(true);
    expect(isReasoningModel("gpt-4o-mini")).toBe(false);
  });

  it("pins reasoning_effort low when a reasoning-model body omits it", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return okResponse();
    }) as unknown as typeof fetch;
    await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "caller", note: "test" },
      fetchImpl,
    });
    expect(sent.reasoning_effort).toBe("low");
  });

  it("does NOT inject reasoning_effort for non-reasoning models and never mutates a set value", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return okResponse();
    }) as unknown as typeof fetch;
    await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-4o-mini-search-preview", messages: [] },
      budget: { mode: "caller", note: "test" },
      fetchImpl,
    });
    await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [], reasoning_effort: "low" },
      budget: { mode: "caller", note: "test" },
      fetchImpl,
    });
    expect(bodies[0]!.reasoning_effort).toBeUndefined();
    expect(bodies[1]!.reasoning_effort).toBe("low");
  });
});

describe("gateway - transport", () => {
  it("calls the ONE chat endpoint and returns the raw response (even non-2xx: the caller decides)", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      expect(url).toBe(OPENAI_CHAT_API);
      return new Response("rate limited", { status: 429 });
    }) as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "caller", note: "test" },
      fetchImpl,
    });
    expect(outcome.kind).toBe("response");
    if (outcome.kind === "response") expect(outcome.response.status).toBe(429);
  });

  it("returns a loud error outcome on network failure, never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "caller", note: "test" },
      fetchImpl,
    });
    expect(outcome).toEqual({ kind: "error", reason: "boom" });
  });
});

describe("gateway - monthly cap (fail-closed)", () => {
  it("gateway_check: blocked budget stops the call before any network egress", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      budgetImpl: { check: async () => ({ allowed: false, reason: "cap reached" }), record: async () => {} },
      fetchImpl,
    });
    expect(outcome).toEqual({ kind: "blocked_budget", reason: "cap reached" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gateway_check: an UNREADABLE ledger fails closed (no call)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      budgetImpl: {
        check: async () => {
          throw new Error("supabase down");
        },
        record: async () => {},
      },
      fetchImpl,
    });
    expect(outcome.kind).toBe("blocked_budget");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gateway_check: an allowed budget proceeds to the call", async () => {
    const fetchImpl = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      budgetImpl: allowAll,
      fetchImpl,
    });
    expect(outcome.kind).toBe("response");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caller mode never consults the gateway budget (the caller's own orchestration gates)", async () => {
    const check = vi.fn();
    const fetchImpl = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "caller", note: "caller checks + records" },
      budgetImpl: { check: check as unknown as BudgetImpl["check"], record: async () => {} },
      fetchImpl,
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("recordGatewaySpend records via the injected impl (and skips non-positive amounts)", async () => {
    const record = vi.fn(async () => {});
    await recordGatewaySpend(0.0123, { budgetImpl: { check: async () => ({ allowed: true }), record } });
    await recordGatewaySpend(0, { budgetImpl: { check: async () => ({ allowed: true }), record } });
    await recordGatewaySpend(Number.NaN, { budgetImpl: { check: async () => ({ allowed: true }), record } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(0.0123, undefined);
  });
});

describe("gateway - cost estimation (moved from providers/openai)", () => {
  it("prices gpt-5-mini usage and falls back to gpt-5-mini rates for unknown models", () => {
    expect(estimateCost("gpt-5-mini", 1_000_000, 0)).toBe(0.25);
    expect(estimateCost("gpt-5-mini", 0, 1_000_000)).toBe(2);
    expect(estimateCost("unknown-model", 1_000_000, 0)).toBe(0.25);
  });
});
