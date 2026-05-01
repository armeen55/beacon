import { describe, expect, it, vi, beforeEach } from "vitest";
import type { QueryClient } from "@/lib/querying/types";

/**
 * Step 1.5 (master plan) — integration tests for the resilient polling
 * loop. Mocks the QueryClient + cost helpers + repository so each test
 * runs in <1s with no I/O.
 *
 * The cases the operator brief explicitly required:
 *   1. transient first failure then success → completed, retry_count=1
 *   2. budget block → no retry, skipped_budget_count++, PER_RUN_BLOCKED log
 *   3. auth error → no retry, surfaced
 *   4. parse error → no retry by default
 *   5. two failures → error_count++, prompt marked failed, chunk continues
 *   6. chunk summary truthful (status="partial" when partial)
 */

// ─── Hoisted mocks ──────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  // Budget helpers — overridable per test.
  checkTenantBudget: vi.fn(() => ({
    allowed: true,
    spent_usd: 0,
    cap_usd: 10,
    percent: 0,
  })),
  checkPerRunBudget: vi.fn(() => ({
    allowed: true,
    spent_usd: 0,
    cap_usd: 8,
    percent: 0,
  })),
  recordSpend: vi.fn(),
  checkMonthlyBudget: vi.fn(() => ({
    allowed: true,
    spent_usd: 0,
    cap_usd: 200,
    percent: 0,
    month_key: "2026-04",
  })),
  // Pricing — return a flat $0.001 per call so we can do clean math.
  estimatePromptCost: vi.fn(() => ({
    totalUsd: 0.001,
    inputTokens: 100,
    outputTokens: 200,
    webSearchCalls: 0,
  })),
  // Repository — owned brand + 1 competitor.
  trackedPrompts: [
    {
      id: "prompt-1",
      account_id: "acct",
      text: "best builder in Atherton",
      topic_id: null,
      location_scope: null,
      service_scope: null,
      intent_type: null,
      platforms: [],
      tags: [],
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    },
    {
      id: "prompt-2",
      account_id: "acct",
      text: "best custom home builder Bay Area",
      topic_id: null,
      location_scope: null,
      service_scope: null,
      intent_type: null,
      platforms: [],
      tags: [],
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    },
    {
      id: "prompt-3",
      account_id: "acct",
      text: "luxury home builders Los Altos",
      topic_id: null,
      location_scope: null,
      service_scope: null,
      intent_type: null,
      platforms: [],
      tags: [],
      is_active: true,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    },
  ],
  trackedEntities: [
    {
      id: "own",
      account_id: "acct",
      entity_type: "brand" as const,
      name: "Ritz Builders",
      domain: "ritzbuilders.com",
      url: null,
      location_scope: null,
      service_scope: null,
      is_owned: true,
      is_active: true,
      metadata: {},
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    },
  ],
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getTrackedPrompts: async () => mocks.trackedPrompts,
    getTrackedEntities: async () => mocks.trackedEntities,
    forTenant: () => ({
      getTrackedPrompts: async () => mocks.trackedPrompts,
      getTrackedEntities: async () => mocks.trackedEntities,
    }),
  }),
}));

vi.mock("@/lib/cost/budget", () => ({
  checkTenantBudget: mocks.checkTenantBudget,
  checkPerRunBudget: mocks.checkPerRunBudget,
  recordSpend: mocks.recordSpend,
}));

vi.mock("@/lib/cost/monthly", () => ({
  checkMonthlyBudget: mocks.checkMonthlyBudget,
}));

vi.mock("@/lib/cost/pricing", () => ({
  estimatePromptCost: mocks.estimatePromptCost,
}));

// Real perplexity client never instantiated (we always pass opts.client).
vi.mock("@/lib/querying/perplexity-client", () => ({
  createPerplexityClient: () => ({
    platform: "perplexity",
    model: "sonar",
    sample: async () => {
      throw new Error("real client should not be called in tests");
    },
  }),
}));

import { pollPerplexityForTenant } from "./poll";

// ─── Helpers ─────────────────────────────────────────────────────────────
type SampleOutcome =
  | { kind: "ok"; answerText?: string }
  | { kind: "throw"; error: unknown };

function makeClient(outcomes: SampleOutcome[]): QueryClient & {
  callCount: () => number;
} {
  let i = 0;
  return {
    platform: "perplexity",
    model: "sonar",
    callCount: () => i,
    async sample(_prompt: string) {
      const outcome = outcomes[i++];
      if (!outcome) {
        throw new Error("test ran out of outcomes");
      }
      if (outcome.kind === "throw") throw outcome.error;
      return {
        answer_text: outcome.answerText ?? "Ritz Builders is great.",
        citations: [],
        model: "sonar",
        usage: {
          inputTokens: 100,
          outputTokens: 200,
        },
      };
    },
  };
}

function captureLogs() {
  const logs: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  return {
    logs,
    warns,
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // Reset budget mocks to "allowed" defaults.
  mocks.checkTenantBudget.mockReturnValue({
    allowed: true,
    spent_usd: 0,
    cap_usd: 10,
    percent: 0,
  });
  mocks.checkPerRunBudget.mockReturnValue({
    allowed: true,
    spent_usd: 0,
    cap_usd: 8,
    percent: 0,
  });
  mocks.checkMonthlyBudget.mockReturnValue({
    allowed: true,
    spent_usd: 0,
    cap_usd: 200,
    percent: 0,
    month_key: "2026-04",
  });
  mocks.estimatePromptCost.mockReturnValue({
    totalUsd: 0.001,
    inputTokens: 100,
    outputTokens: 200,
    webSearchCalls: 0,
  });
});

describe("pollPerplexityForTenant — Step 1.5 resilience", () => {
  it("transient first failure then success: prompt completes, retry_count=1, no double bill", async () => {
    const client = makeClient([
      // prompt-1 first attempt: ECONNRESET (transient)
      { kind: "throw", error: Object.assign(new Error("reset"), { code: "ECONNRESET" }) },
      // prompt-1 retry: success
      { kind: "ok" },
      // prompt-2: success
      { kind: "ok" },
      // prompt-3: success
      { kind: "ok" },
    ]);
    const cap = captureLogs();
    try {
      const r = await pollPerplexityForTenant("tenant-test", { client });
      expect(r.observations).toHaveLength(3);
      expect(r.errorCount).toBe(0);
      expect(r.reliability.retryCount).toBe(1);
      expect(r.reliability.dominantFailureType).toBeNull();
      expect(r.observationRun.status).toBe("completed");
      // Cost: only 3 successful calls billed, not 4. The retry doesn't
      // double-count the failed first attempt.
      expect(mocks.recordSpend).toHaveBeenCalledTimes(3);
      expect(r.cost.totalUsd).toBeCloseTo(0.003, 6);
      // Retry log emitted.
      expect(cap.warns.some((w) => w.includes("SAMPLE_RETRY"))).toBe(true);
      expect(cap.warns.some((w) => w.includes("kind=transient_network"))).toBe(
        true,
      );
    } finally {
      cap.restore();
    }
  });

  it("budget block (pre-flight tenant cap): no retry, skipped_budget_count = total, PER_RUN log absent", async () => {
    mocks.checkTenantBudget.mockReturnValue({
      allowed: false,
      spent_usd: 10.5,
      cap_usd: 10,
      percent: 105,
      reason: "tenant cap exhausted",
    } as ReturnType<typeof mocks.checkTenantBudget>);
    const client = makeClient([]); // no calls expected
    const cap = captureLogs();
    try {
      const r = await pollPerplexityForTenant("tenant-test", { client });
      expect(client.callCount()).toBe(0);
      expect(r.skipReason).toBe("budget_blocked");
      expect(r.cost.promptsSkippedBudget).toBe(3);
      expect(r.reliability.retryCount).toBe(0);
      expect(r.observationRun.status).toBe("failed");
      expect(cap.warns.some((w) => w.includes("BUDGET_BLOCKED"))).toBe(true);
      // Sanity: no SAMPLE_RETRY because no calls were made.
      expect(cap.warns.some((w) => w.includes("SAMPLE_RETRY"))).toBe(false);
    } finally {
      cap.restore();
    }
  });

  it("per-run budget cap mid-run: no retry on the next prompt, PER_RUN_BLOCKED logged", async () => {
    // First prompt allowed, then per-run cap trips.
    let calls = 0;
    mocks.checkPerRunBudget.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return { allowed: true, spent_usd: 0, cap_usd: 8, percent: 0 };
      }
      return {
        allowed: false,
        reason: "per-run cap reached",
        spent_usd: 7.99,
        cap_usd: 8,
        percent: 100,
      };
    });
    const client = makeClient([{ kind: "ok" }]);
    const cap = captureLogs();
    try {
      const r = await pollPerplexityForTenant("tenant-test", { client });
      expect(r.skipReason).toBe("per_run_blocked");
      expect(r.observations).toHaveLength(1);
      expect(r.cost.promptsSkippedBudget).toBe(2);
      expect(r.reliability.retryCount).toBe(0);
      expect(r.observationRun.status).toBe("partial");
      expect(cap.warns.some((w) => w.includes("PER_RUN_BLOCKED"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it("auth error: no retry, error_count=1, dominant_failure_type='auth'", async () => {
    const client = makeClient([
      { kind: "throw", error: Object.assign(new Error("Unauthorized"), { status: 401 }) },
      { kind: "ok" },
      { kind: "ok" },
    ]);
    const cap = captureLogs();
    try {
      const r = await pollPerplexityForTenant("tenant-test", { client });
      expect(r.errorCount).toBe(1);
      expect(r.reliability.retryCount).toBe(0); // no retry on auth
      expect(r.reliability.failureCountsByKind.auth).toBe(1);
      expect(r.reliability.dominantFailureType).toBe("auth");
      expect(r.observationRun.status).toBe("partial"); // 1 of 3 errored
      expect(cap.warns.some((w) => w.includes("kind=auth"))).toBe(true);
      expect(cap.warns.some((w) => w.includes("retryable=false"))).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it("parse error from sample throw: no retry, error_count=1, kind='parse_error'", async () => {
    const client = makeClient([
      {
        kind: "throw",
        error: new SyntaxError("Unexpected token } in JSON at position 47"),
      },
      { kind: "ok" },
      { kind: "ok" },
    ]);
    const r = await pollPerplexityForTenant("tenant-test", { client });
    expect(r.reliability.retryCount).toBe(0);
    expect(r.reliability.failureCountsByKind.parse_error).toBe(1);
    expect(r.errorCount).toBe(1);
  });

  it("two consecutive failures (retried once): error_count=1, retry_count=1, prompt failed, chunk continues", async () => {
    const client = makeClient([
      { kind: "throw", error: Object.assign(new Error("reset"), { code: "ECONNRESET" }) },
      { kind: "throw", error: Object.assign(new Error("reset again"), { code: "ECONNRESET" }) },
      { kind: "ok" }, // prompt-2
      { kind: "ok" }, // prompt-3
    ]);
    const cap = captureLogs();
    try {
      const r = await pollPerplexityForTenant("tenant-test", { client });
      expect(r.errorCount).toBe(1);
      expect(r.reliability.retryCount).toBe(1); // attempted once
      expect(r.reliability.failureCountsByKind.transient_network).toBe(1);
      expect(r.observations).toHaveLength(2); // prompts 2 and 3 succeeded
      expect(r.observationRun.status).toBe("partial");
      // Retry was attempted then failed.
      expect(cap.warns.some((w) => w.includes("SAMPLE_RETRY"))).toBe(true);
      expect(
        cap.warns.some(
          (w) => w.includes("SAMPLE_FAILED") && w.includes("retried=true"),
        ),
      ).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it("CHUNK_SUMMARY structured log carries every required field truthfully", async () => {
    const client = makeClient([
      { kind: "ok" },
      { kind: "throw", error: Object.assign(new Error("Unauthorized"), { status: 401 }) },
      { kind: "ok" },
    ]);
    const cap = captureLogs();
    try {
      await pollPerplexityForTenant("tenant-test", { client });
      const summaryLine = cap.logs.find((l) => l.includes("CHUNK_SUMMARY"));
      expect(summaryLine).toBeTruthy();
      // Extract the JSON payload from the line.
      const jsonStart = summaryLine!.indexOf("{");
      const summary = JSON.parse(summaryLine!.slice(jsonStart));
      expect(summary).toMatchObject({
        tag: "CHUNK_SUMMARY",
        platform: "perplexity",
        status: "partial",
        prompts_attempted: 3,
        prompts_completed: 2,
        retry_count: 0,
        error_count: 1,
        skipped_budget_count: 0,
        dominant_failure_type: "auth",
      });
      expect(summary.failure_counts_by_kind.auth).toBe(1);
      expect(summary.confirmed_cost_usd).toBeGreaterThan(0);
      expect(summary.estimated_unconfirmed_cost_usd).toBe(0);
    } finally {
      cap.restore();
    }
  });

  it("rate_limit (HTTP 429): no retry, kind='rate_limit', errors surface", async () => {
    const client = makeClient([
      { kind: "throw", error: Object.assign(new Error("Too Many Requests"), { status: 429 }) },
      { kind: "ok" },
      { kind: "ok" },
    ]);
    const r = await pollPerplexityForTenant("tenant-test", { client });
    expect(r.reliability.retryCount).toBe(0);
    expect(r.reliability.failureCountsByKind.rate_limit).toBe(1);
    expect(r.reliability.dominantFailureType).toBe("rate_limit");
  });

  it("server_5xx: retried once and recovers", async () => {
    const client = makeClient([
      { kind: "throw", error: Object.assign(new Error("Internal"), { status: 500 }) },
      { kind: "ok" }, // retry succeeds
      { kind: "ok" },
      { kind: "ok" },
    ]);
    const r = await pollPerplexityForTenant("tenant-test", { client });
    expect(r.reliability.retryCount).toBe(1);
    expect(r.errorCount).toBe(0);
    expect(r.observations).toHaveLength(3);
    expect(r.observationRun.status).toBe("completed");
  });
});
