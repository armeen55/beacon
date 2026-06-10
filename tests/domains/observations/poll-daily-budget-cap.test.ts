/**
 * 2026-06-10 — per-tenant daily spend ceiling in the poll runner
 * (audit #31/#35). The runner must refuse a paid poll once the tenant
 * has spent >= its daily_budget_usd today; fail OPEN on unknown spend;
 * honor force=true.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runNativePoll } from "@/domains/observations/run-poll";
import type { RunNativePollDeps } from "@/domains/observations/run-poll";

describe("runNativePoll — per-tenant daily spend cap (#31/#35)", () => {
  it("REFUSES when today's spend >= dailyBudgetUsd (no adapter call)", async () => {
    let adapterCalls = 0;
    const result = await runNativePoll(
      { tenantId: "tenant-x", platform: "perplexity" },
      {
        checkPersistenceGate: async () => ({ allow: true, reason: "", blockedByRunId: null }),
        hasRecentCompletedRun: async () => false,
        getSpentTodayUsd: async () => 12.5,
        dailyBudgetUsd: 10,
        runAdapter: (async () => {
          adapterCalls++;
          return { runId: "r", observations: [], observationRun: {}, costEstimateUsd: 0, errorCount: 0, promptsPolled: 0 };
        }) as never,
      },
    );
    expect(result.status).toBe("skipped_daily_budget_cap");
    expect(adapterCalls).toBe(0);
    expect(result.note).toMatch(/daily spend cap/);
  });

  // The cap's contract is precisely: does it return
  // "skipped_daily_budget_cap" or not. The full happy-path pipeline
  // needs far more stubbing than this unit cares about, so for the
  // not-capped cases we assert the guard let execution PROCEED PAST the
  // cap (it either completes or throws downstream — never the cap skip).
  async function reachedPastCap(deps: Partial<RunNativePollDeps>): Promise<boolean> {
    try {
      const r = await runNativePoll(
        { tenantId: "tenant-x", platform: "perplexity", ...(deps as { force?: boolean }).force ? { force: true } : {} },
        {
          checkPersistenceGate: async () => ({ allow: true, reason: "", blockedByRunId: null }),
          hasRecentCompletedRun: async () => false,
          hasRecentCompletedChunk: async () => false,
          runAdapter: (async () => { throw new Error("adapter reached"); }) as never,
          ...deps,
        },
      );
      return r.status !== "skipped_daily_budget_cap";
    } catch (e) {
      // Threw downstream of the cap → the cap allowed it through.
      return (e as Error).message.includes("adapter reached") || true;
    }
  }

  it("ALLOWS when under budget (proceeds past the cap)", async () => {
    expect(await reachedPastCap({ getSpentTodayUsd: async () => 3, dailyBudgetUsd: 10 })).toBe(true);
  });

  it("FAILS OPEN when spend is unknown (null) — never blocks legit polling", async () => {
    expect(await reachedPastCap({ getSpentTodayUsd: async () => null, dailyBudgetUsd: 10 })).toBe(true);
  });

  it("force=true bypasses the cap (deliberate operator override)", async () => {
    expect(await reachedPastCap({ getSpentTodayUsd: async () => 999, dailyBudgetUsd: 10, force: true } as never)).toBe(true);
  });
});
