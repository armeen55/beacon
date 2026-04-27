/**
 * Sprint 6A.3d (2026-04-26) — `/api/poll/run` route tests.
 *
 * Pins the kill switch + the cost-summary surface in the response
 * payload. NO real network calls — `runNativePoll` is mocked at the
 * module boundary.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the underlying poll runner. Tests configure the per-call return
// or set assertions on whether it was invoked at all.
const runNativePollMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);

vi.mock("@/domains/observations/run-poll", () => ({
  runNativePoll: runNativePollMock,
}));

// Helper to build a NextRequest-shaped object the route handler accepts.
async function makeReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/poll/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.CRON_SECRET = "test-secret";
  delete process.env.BEACON_POLL_DISABLED;
  runNativePollMock.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── Auth gate (regression check that 6A.3d doesn't bypass auth) ────────

describe("/api/poll/run — auth still enforced when BEACON_POLL_DISABLED is set", () => {
  it("returns 401 with unauthorized even when kill switch is on", async () => {
    process.env.BEACON_POLL_DISABLED = "1";
    const { POST } = await import("@/app/api/poll/run/route");
    const req = (await makeReq(
      { platform: "perplexity", tenantId: "tenant-test" },
      {}, // no authorization header
    )) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
    expect(runNativePollMock).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong bearer token", async () => {
    const { POST } = await import("@/app/api/poll/run/route");
    const req = (await makeReq(
      { platform: "perplexity", tenantId: "tenant-test" },
      { Authorization: "Bearer wrong" },
    )) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── Kill switch behavior ───────────────────────────────────────────────

describe("/api/poll/run — BEACON_POLL_DISABLED kill switch", () => {
  const ALL_TRUTHY = ["1", "true", "yes", "on", "TRUE", "Yes", "ON"];
  it.each(ALL_TRUTHY)(
    `returns 200 + status=disabled when BEACON_POLL_DISABLED=%s`,
    async (val) => {
      process.env.BEACON_POLL_DISABLED = val;
      const { POST } = await import("@/app/api/poll/run/route");
      const req = (await makeReq(
        { platform: "perplexity", tenantId: "tenant-test" },
        { Authorization: "Bearer test-secret" },
      )) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        reason: string;
      };
      expect(body.status).toBe("disabled");
      expect(body.reason).toMatch(/BEACON_POLL_DISABLED/);
      expect(runNativePollMock).not.toHaveBeenCalled();
    },
  );

  const ALL_FALSY = ["", "0", "false", "no", "off", "anything-else"];
  it.each(ALL_FALSY)(
    `does NOT disable when BEACON_POLL_DISABLED=%s`,
    async (val) => {
      process.env.BEACON_POLL_DISABLED = val;
      runNativePollMock.mockResolvedValue({
        platform: "perplexity",
        promptsCompleted: 0,
      });
      const { POST } = await import("@/app/api/poll/run/route");
      const req = (await makeReq(
        { platform: "perplexity", tenantId: "tenant-test" },
        { Authorization: "Bearer test-secret" },
      )) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status?: string };
      expect(body.status).not.toBe("disabled");
      expect(runNativePollMock).toHaveBeenCalledTimes(1);
    },
  );

  it("unset BEACON_POLL_DISABLED does not disable", async () => {
    delete process.env.BEACON_POLL_DISABLED;
    runNativePollMock.mockResolvedValue({
      platform: "perplexity",
      promptsCompleted: 0,
    });
    const { POST } = await import("@/app/api/poll/run/route");
    const req = (await makeReq(
      { platform: "perplexity", tenantId: "tenant-test" },
      { Authorization: "Bearer test-secret" },
    )) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(runNativePollMock).toHaveBeenCalledTimes(1);
  });
});

// ── Response shape: cost / skipReason / budgetReason / promptsDeduped ──

describe("/api/poll/run — response surface (Sprint 6A.3c/d contract)", () => {
  it("normal run includes cost block + skipReason + budgetReason fields", async () => {
    runNativePollMock.mockResolvedValue({
      platform: "perplexity",
      tenantId: "tenant-test",
      status: "ok",
      cost: {
        totalUsd: 0.71,
        inputTokens: 4123,
        outputTokens: 8742,
        webSearchCalls: 4,
        promptsCompleted: 25,
        promptsSkippedBudget: 0,
        promptsDeduped: 0,
      },
      skipReason: null,
      budgetReason: null,
    });
    const { POST } = await import("@/app/api/poll/run/route");
    const req = (await makeReq(
      { platform: "perplexity", tenantId: "tenant-test" },
      { Authorization: "Bearer test-secret" },
    )) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("cost");
    expect(body).toHaveProperty("skipReason", null);
    expect(body).toHaveProperty("budgetReason", null);
    expect(body).toHaveProperty("elapsedMs");
    const cost = body.cost as Record<string, number>;
    expect(cost.totalUsd).toBe(0.71);
    expect(cost.promptsCompleted).toBe(25);
    expect(cost.promptsDeduped).toBe(0);
    expect(cost.promptsSkippedBudget).toBe(0);
  });

  it("budget_blocked run surfaces skipReason + budgetReason in response", async () => {
    runNativePollMock.mockResolvedValue({
      platform: "perplexity",
      tenantId: "tenant-test",
      status: "ok",
      cost: {
        totalUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        webSearchCalls: 0,
        promptsCompleted: 0,
        promptsSkippedBudget: 100,
        promptsDeduped: 0,
      },
      skipReason: "budget_blocked",
      budgetReason: "Tenant tenant-test daily budget exhausted: $10.04 of $10.00 used",
    });
    const { POST } = await import("@/app/api/poll/run/route");
    const req = (await makeReq(
      { platform: "perplexity", tenantId: "tenant-test" },
      { Authorization: "Bearer test-secret" },
    )) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.skipReason).toBe("budget_blocked");
    expect(body.budgetReason).toMatch(/daily budget exhausted/);
    const cost = body.cost as Record<string, number>;
    expect(cost.promptsSkippedBudget).toBe(100);
  });

  it("dedupe-heavy run surfaces promptsDeduped in response", async () => {
    runNativePollMock.mockResolvedValue({
      platform: "perplexity",
      tenantId: "tenant-test",
      status: "ok",
      cost: {
        totalUsd: 0.42,
        inputTokens: 2000,
        outputTokens: 4000,
        webSearchCalls: 0,
        promptsCompleted: 23,
        promptsSkippedBudget: 0,
        promptsDeduped: 2,
      },
      skipReason: null,
      budgetReason: null,
    });
    const { POST } = await import("@/app/api/poll/run/route");
    const req = (await makeReq(
      { platform: "perplexity", tenantId: "tenant-test" },
      { Authorization: "Bearer test-secret" },
    )) as unknown as Parameters<typeof POST>[0];
    const res = await POST(req);
    const body = (await res.json()) as Record<string, unknown>;
    const cost = body.cost as Record<string, number>;
    expect(cost.promptsDeduped).toBe(2);
    expect(cost.promptsCompleted).toBe(23);
  });
});
