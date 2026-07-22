/**
 * LLM gateway spend-cap boundaries (Core 100K Phase 6 trim of
 * src/domains/llm/gateway.test.ts).
 *
 * Deliberate deviation from the "llm -> 4 files" plan: the platform lane's
 * tests/platform/llm-budget-ledger.test.ts pins the LEDGER, but nothing else
 * pins the gateway's own fail-closed posture (the money boundary: a blocked
 * or unreadable budget and a tripped/throwing global cost breaker must all
 * stop the call BEFORE any network egress). Kept as one small file.
 */
import { describe, it, expect, vi } from "vitest";
import {
  effectiveTimeoutMs,
  estimateCost,
  openAIChatCompletion,
  REASONING_TIMEOUT_FLOOR_MS,
  type BudgetImpl,
} from "@/domains/llm/gateway";

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
  it("floors the timeout to 90s for reasoning models and pins reasoning_effort low when omitted", async () => {
    expect(effectiveTimeoutMs("gpt-5-mini", 45_000)).toBe(REASONING_TIMEOUT_FLOOR_MS);
    expect(effectiveTimeoutMs("gpt-5-mini", 120_000)).toBe(120_000);
    expect(effectiveTimeoutMs("gpt-4o-mini-search-preview", 45_000)).toBe(45_000);
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

  it("gateway_check: an UNREADABLE ledger fails closed (no call); an allowed budget proceeds", async () => {
    const blockedFetch = vi.fn() as unknown as typeof fetch;
    const blocked = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      budgetImpl: {
        check: async () => {
          throw new Error("supabase down");
        },
        record: async () => {},
      },
      fetchImpl: blockedFetch,
    });
    expect(blocked.kind).toBe("blocked_budget");
    expect(blockedFetch).not.toHaveBeenCalled();

    const okFetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const allowed = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      budgetImpl: allowAll,
      fetchImpl: okFetch,
    });
    expect(allowed.kind).toBe("response");
    expect(okFetch).toHaveBeenCalledTimes(1);
  });
});

describe("gateway - N43 global cost breaker (outer guard)", () => {
  it("a tripped breaker blocks BEFORE any per-platform budget check or egress, in caller mode too", async () => {
    const budgetCheck = vi.fn(async () => ({ allowed: true }));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      budgetImpl: { check: budgetCheck as unknown as BudgetImpl["check"], record: async () => {} },
      costBreakerImpl: { check: async () => ({ tripped: true, reason: "global ceiling reached" }) },
      fetchImpl,
    });
    expect(outcome).toEqual({ kind: "blocked_budget", reason: "global ceiling reached" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(budgetCheck).not.toHaveBeenCalled();

    const callerMode = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "caller", note: "caller gates its own per-platform spend" },
      costBreakerImpl: { check: async () => ({ tripped: true, reason: "global ceiling reached" }) },
      fetchImpl,
    });
    expect(callerMode.kind).toBe("blocked_budget");
  });

  it("a breaker that THROWS fails closed (no call)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await openAIChatCompletion({
      ...BASE,
      body: { model: "gpt-5-mini", messages: [] },
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      costBreakerImpl: {
        check: async () => {
          throw new Error("breaker read down");
        },
      },
      fetchImpl,
    });
    expect(outcome.kind).toBe("blocked_budget");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("gateway - cost estimation", () => {
  it("prices gpt-5-mini usage and falls back to gpt-5-mini rates for unknown models", () => {
    expect(estimateCost("gpt-5-mini", 1_000_000, 0)).toBe(0.25);
    expect(estimateCost("gpt-5-mini", 0, 1_000_000)).toBe(2);
    expect(estimateCost("unknown-model", 1_000_000, 0)).toBe(0.25);
  });
});
