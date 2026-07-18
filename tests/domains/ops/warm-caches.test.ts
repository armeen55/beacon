/**
 * Nightly precompute warm pass (2026-07-02, BEACON 500 item 13; displacement
 * step added by BEACON 500 item 82; serp-steal-lane step added by DREAM SITE
 * V1 item D3; native-teardown step added by DREAM SITE V1 item D2).
 *
 * Pins the composition contract with injected deps (no Supabase, no graph
 * build, no filesystem):
 *   - step ORDER: demand-graph -> worklist-surface -> plan-preview ->
 *     coverage-map -> displacement-check -> serp-steal-lane -> native-teardown
 *     -> prepare-ahead -> today-surface. Today runs last so newly acquired
 *     evidence and prepared drafts are visible in the first completed surface.
 *   - fail-soft isolation: one failed step never stops the next,
 *   - skip-when-fresh: an existing preview for the Pacific day (or an open
 *     accepted batch) means the builder is NEVER invoked (no double spend),
 *   - ambient-tenant guard: a mismatch warms NOTHING (no cache pollution),
 *   - receipt shape: {steps: [{name, ok, ms}], totalMs} plus honest ok,
 *   - dash guard: no em/en dashes in any receipt string.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { warmTenantCaches, pacificDay, type WarmCachesDeps } from "@/domains/ops/warm-caches";
import type { DailyExperimentPlanRecord } from "@/domains/experiments/daily-plan-types";

const TENANT = "tenant-iranopedia";
// 12:00 UTC = 5:00am Pacific (PDT) on the SAME calendar day.
const NOW = new Date("2026-07-02T12:00:00Z");
const TODAY = "2026-07-02";

function plan(partial: Partial<DailyExperimentPlanRecord>): DailyExperimentPlanRecord {
  return {
    id: "plan-1",
    tenantId: TENANT,
    date: TODAY,
    status: "preview",
    selected: [],
    backups: [],
    ...partial,
  } as unknown as DailyExperimentPlanRecord;
}

function makeDeps(overrides: Partial<WarmCachesDeps> = {}) {
  const calls: string[] = [];
  const deps: WarmCachesDeps = {
    ambientTenantId: async () => TENANT,
    refreshDemandGraph: vi.fn(async () => { calls.push("demand-graph"); }),
    refreshWorklist: vi.fn(async () => { calls.push("worklist-surface"); }),
    refreshToday: vi.fn(async () => { calls.push("today-surface"); }),
    getLatestPreviewPlan: vi.fn(async () => { calls.push("plan-preview"); return null; }),
    getAcceptedPlan: vi.fn(async () => null),
    completeAcceptedPlan: vi.fn(async () => { calls.push("complete-accepted"); return true; }),
    expirePlans: vi.fn(async () => 0),
    buildPreview: vi.fn(async () => ({
      record: { ...plan({}), selected: [{ id: "e1" }] } as unknown as DailyExperimentPlanRecord,
      candidatesEvaluated: 1,
      excludedByReason: {},
      leverRetirementLines: [],
    })),
    persistPreview: vi.fn(async () => {}),
    today: pacificDay,
    runDisplacementChecks: vi.fn(async () => {
      calls.push("displacement-check");
      return { checked: 0, cached: 0, skippedRecent: 0, skippedNoBudget: 0, costUsd: 0, verdicts: [] };
    }),
    runStealLane: vi.fn(async () => {
      calls.push("serp-steal-lane");
      return {
        beatenKeywordsFound: 0,
        storedSerpHits: 0,
        livePullsUsed: 0,
        liveCostUsd: 0,
        briefsBuilt: 0,
        teardownsTorndown: 0,
        briefs: [],
      };
    }),
    runNativeTeardown: vi.fn(async () => {
      calls.push("native-teardown");
      return { promptsAnalyzed: 0, torndownPages: 0, fromCache: 0, verdicts: [], results: [] };
    }),
    // R20: prepare-ahead defaults OFF in these deps, so it is a byte-identical skip (runPrepareAhead
    // is never invoked) unless a test flips isPrepareAheadEnabled on. This mirrors the DEFAULT_
    // AUTOPILOT_CONFIG default (prepareAheadOvernight: false).
    isPrepareAheadEnabled: vi.fn(async () => false),
    runPrepareAhead: vi.fn(async () => {
      calls.push("prepare-ahead");
      return {
        considered: 0,
        prepared: 0,
        readyToReview: 0,
        draftReady: 0,
        cached: 0,
        failed: 0,
        regenerated: 0,
        stoppedForBudget: false,
        llmCostUsd: 0,
        winnabilityHeld: 0,
        serpCostUsd: 0,
        outcomes: [],
      };
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe("warmTenantCaches", () => {
  it("runs research and preparation before the final Today surface", async () => {
    const { deps, calls } = makeDeps();
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(calls).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "displacement-check",
      "serp-steal-lane",
      "native-teardown",
      "today-surface",
    ]);
    expect(receipt.steps.map((s) => s.name)).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "coverage-map",
      "displacement-check",
      "serp-steal-lane",
      "native-teardown",
      "prepare-ahead",
      "today-surface",
    ]);
    // R20: prepare-ahead is OFF by default, so runPrepareAhead is never invoked (not in `calls`)
    // and the step records an honest skip - the nightly work is byte-identical to before.
    const prep = receipt.steps.find((s) => s.name === "prepare-ahead");
    expect(prep?.skipped).toBe(true);
    expect(prep?.note).toContain("prepare-ahead is off");
    expect(receipt.ok).toBe(true);
    expect(receipt.date).toBe(TODAY);
  });

  it("fail-soft isolation: a failed step is recorded and the rest still run", async () => {
    const { deps, calls } = makeDeps({
      refreshDemandGraph: vi.fn(async () => { throw new Error("graph build blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const graph = receipt.steps.find((s) => s.name === "demand-graph");
    expect(graph?.ok).toBe(false);
    expect(graph?.note).toContain("graph build blew up");
    // Every later step still ran.
    expect(calls).toEqual([
      "worklist-surface",
      "plan-preview",
      "displacement-check",
      "serp-steal-lane",
      "native-teardown",
      "today-surface",
    ]);
    expect(receipt.ok).toBe(false);
    // 9 steps total (incl. the R20 prepare-ahead skip); only demand-graph failed, so 8 are ok.
    expect(receipt.steps.filter((s) => s.ok)).toHaveLength(8);
  });

  it("displacement-check failure is isolated and never affects the warm steps above it", async () => {
    const { deps, calls } = makeDeps({
      runDisplacementChecks: vi.fn(async () => { throw new Error("dataforseo blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    // The 4 free warm steps + coverage-map all ran and succeeded, and the
    // steps AFTER the failing one still ran too.
    expect(calls).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "serp-steal-lane",
      "native-teardown",
      "today-surface",
    ]);
    const warmSteps = receipt.steps.filter((s) => s.name !== "displacement-check");
    expect(warmSteps.every((s) => s.ok)).toBe(true);
    const displacement = receipt.steps.find((s) => s.name === "displacement-check");
    expect(displacement?.ok).toBe(false);
    expect(displacement?.note).toContain("dataforseo blew up");
    expect(receipt.ok).toBe(false);
  });

  it("serp-steal-lane failure is isolated and never affects the steps above or after it", async () => {
    const { deps, calls } = makeDeps({
      runStealLane: vi.fn(async () => { throw new Error("serp steal lane blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(calls).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "displacement-check",
      "native-teardown",
      "today-surface",
    ]);
    const otherSteps = receipt.steps.filter((s) => s.name !== "serp-steal-lane");
    expect(otherSteps.every((s) => s.ok)).toBe(true);
    const steal = receipt.steps.find((s) => s.name === "serp-steal-lane");
    expect(steal?.ok).toBe(false);
    expect(steal?.note).toContain("serp steal lane blew up");
    expect(receipt.ok).toBe(false);
  });

  it("native-teardown failure is isolated and never affects the steps above it", async () => {
    const { deps, calls } = makeDeps({
      runNativeTeardown: vi.fn(async () => { throw new Error("native teardown blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(calls).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "displacement-check",
      "serp-steal-lane",
      "today-surface",
    ]);
    const otherSteps = receipt.steps.filter((s) => s.name !== "native-teardown");
    expect(otherSteps.every((s) => s.ok)).toBe(true);
    const native = receipt.steps.find((s) => s.name === "native-teardown");
    expect(native?.ok).toBe(false);
    expect(native?.note).toContain("native teardown blew up");
    expect(receipt.ok).toBe(false);
  });

  it("native-teardown reports an honest note summarizing prompts/pages/verdicts", async () => {
    const { deps } = makeDeps({
      runNativeTeardown: vi.fn(async () => ({
        promptsAnalyzed: 3,
        torndownPages: 6,
        fromCache: 2,
        verdicts: [
          { promptId: "p1", outcome: "atomic_edit" as const },
          { promptId: "p2", outcome: "new_page" as const },
          { promptId: "p3", outcome: "no_verdict" as const },
        ],
        results: [],
      })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "native-teardown");
    expect(step?.ok).toBe(true);
    expect(step?.note).toContain("analyzed 3 native prompt");
    expect(step?.note).toContain("read 6 competitor page");
    expect(step?.note).toContain("1 atomic edit");
    expect(step?.note).toContain("1 new page");
  });

  it("native-teardown with nothing to do reports an honest skip", async () => {
    const { deps } = makeDeps();
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "native-teardown");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBe(true);
    expect(step?.note).toContain("no native-poll prompts");
  });

  // R20 (D6 dynamic auto-mode): prepare-ahead-overnight gates the nightly prepare path and
  // stays publish-safe (it only PREPARES, it never publishes).
  it("prepare-ahead OFF: byte-identical skip, runPrepareAhead is NEVER invoked, no spend", async () => {
    const { deps, calls } = makeDeps({ isPrepareAheadEnabled: vi.fn(async () => false) });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(deps.runPrepareAhead).not.toHaveBeenCalled();
    expect(calls).not.toContain("prepare-ahead");
    const step = receipt.steps.find((s) => s.name === "prepare-ahead");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBe(true);
    expect(step?.note).toContain("prepare-ahead is off");
  });

  it("prepare-ahead ON: runs the capped prepare pass and reports an honest note", async () => {
    const { deps, calls } = makeDeps({
      isPrepareAheadEnabled: vi.fn(async () => true),
      runPrepareAhead: vi.fn(async () => {
        calls.push("prepare-ahead");
        return {
          considered: 8,
          prepared: 5,
          readyToReview: 4,
          draftReady: 1,
          cached: 3,
          failed: 0,
          regenerated: 0,
          stoppedForBudget: false,
          llmCostUsd: 0.042,
          winnabilityHeld: 0,
          serpCostUsd: 0,
          outcomes: [],
        };
      }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(deps.runPrepareAhead).toHaveBeenCalledWith(TENANT, NOW);
    expect(calls).toContain("prepare-ahead");
    // Today runs after prepare so the completed surface includes the new drafts.
    expect(calls.slice(-2)).toEqual(["prepare-ahead", "today-surface"]);
    const step = receipt.steps.find((s) => s.name === "prepare-ahead");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBeUndefined();
    expect(step?.note).toContain("prepared 5 Move");
    expect(step?.note).toContain("3 already prepared");
    expect(step?.note).toContain("4 ready to review");
    expect(step?.note).toContain("$0.042");
  });

  it("prepare-ahead failure is isolated and never affects the steps above it", async () => {
    const { deps, calls } = makeDeps({
      isPrepareAheadEnabled: vi.fn(async () => true),
      runPrepareAhead: vi.fn(async () => { throw new Error("prepare ahead blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    // Every warm/native step above it still ran and succeeded.
    expect(calls).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "displacement-check",
      "serp-steal-lane",
      "native-teardown",
      "today-surface",
    ]);
    const otherSteps = receipt.steps.filter((s) => s.name !== "prepare-ahead");
    expect(otherSteps.every((s) => s.ok)).toBe(true);
    const step = receipt.steps.find((s) => s.name === "prepare-ahead");
    expect(step?.ok).toBe(false);
    expect(step?.note).toContain("prepare ahead blew up");
    expect(receipt.ok).toBe(false);
  });

  it("serp-steal-lane reports an honest note summarizing what it found and read", async () => {
    const { deps } = makeDeps({
      runStealLane: vi.fn(async () => ({
        beatenKeywordsFound: 3,
        storedSerpHits: 2,
        livePullsUsed: 1,
        liveCostUsd: 0.003,
        briefsBuilt: 3,
        teardownsTorndown: 3,
        briefs: [],
      })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "serp-steal-lane");
    expect(step?.ok).toBe(true);
    expect(step?.note).toContain("found 3 beaten keyword");
    expect(step?.note).toContain("read 3 competitor page");
    expect(step?.note).toContain("built 3 steal brief");
  });

  it("serp-steal-lane with nothing to do reports an honest skip", async () => {
    const { deps } = makeDeps();
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "serp-steal-lane");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBe(true);
    expect(step?.note).toContain("no beaten keywords");
  });

  it("displacement-check reports an honest note summarizing checks/skips", async () => {
    const { deps } = makeDeps({
      runDisplacementChecks: vi.fn(async () => ({
        checked: 1,
        cached: 0,
        skippedRecent: 2,
        skippedNoBudget: 1,
        costUsd: 0.003,
        verdicts: [
          {
            query: "persian rugs",
            page: "https://example.com/rugs",
            recentPosition: 8.9,
            priorPosition: 4.2,
            positionDrop: 4.7,
            clicksAtRiskPerWeek: 40,
            displacers: [],
            fellOffPage: false,
            checkedAt: NOW.toISOString(),
            costUsd: 0.003,
          },
        ],
      })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "displacement-check");
    expect(step?.ok).toBe(true);
    expect(step?.note).toContain("1 still displaced");
    expect(step?.note).toContain("skipped 1 past the per-run cap");
  });

  it("skip-when-fresh: a preview for today's Pacific day means NO build call", async () => {
    const { deps } = makeDeps({
      getLatestPreviewPlan: vi.fn(async () => plan({ date: TODAY })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBe(true);
    expect(deps.buildPreview).not.toHaveBeenCalled();
    expect(deps.persistPreview).not.toHaveBeenCalled();
    expect(deps.expirePlans).not.toHaveBeenCalled();
  });

  it("skip-when-open: TODAY's accepted batch still open means NO build call", async () => {
    const { deps } = makeDeps({
      getAcceptedPlan: vi.fn(async () => plan({ status: "accepted", date: TODAY })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBe(true);
    expect(deps.buildPreview).not.toHaveBeenCalled();
    expect(deps.completeAcceptedPlan).not.toHaveBeenCalled();
  });

  // 2026-07-08 regression: a PRIOR-day accepted batch the operator never clicked "Finish for
  // today" on used to block new plans indefinitely ("same 6 changes every day for 9 days").
  // It must now auto-complete (its proof rows measure on independently) and TODAY's plan builds.
  it("prior-day accepted batch is completed (not left blocking) and today's plan is built", async () => {
    const { deps } = makeDeps({
      getAcceptedPlan: vi.fn(async () => plan({ status: "accepted", date: "2026-06-30", id: "stale-plan" })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.skipped).toBeUndefined(); // did NOT skip - the stale batch no longer blocks
    expect(deps.completeAcceptedPlan).toHaveBeenCalledWith(TENANT, "stale-plan", expect.any(Date));
    expect(deps.buildPreview).toHaveBeenCalled();
    expect(deps.persistPreview).toHaveBeenCalled();
  });

  it("stale preview (yesterday) -> expire + build + persist tonight's plan", async () => {
    const { deps } = makeDeps({
      getLatestPreviewPlan: vi.fn(async () => plan({ date: "2026-07-01" })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBeUndefined();
    expect(deps.expirePlans).toHaveBeenCalledWith(TENANT, NOW);
    expect(deps.buildPreview).toHaveBeenCalledWith(TENANT, NOW);
    expect(deps.persistPreview).toHaveBeenCalledTimes(1);
  });

  it("empty build (nothing eligible) persists NOTHING but stays ok", async () => {
    const { deps } = makeDeps({
      buildPreview: vi.fn(async () => ({
        record: plan({}),
        candidatesEvaluated: 0,
        excludedByReason: {},
        leverRetirementLines: [],
      })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.ok).toBe(true);
    expect(deps.persistPreview).not.toHaveBeenCalled();
  });

  it("ambient-tenant mismatch warms NOTHING (cross-tenant cache safety)", async () => {
    const { deps, calls } = makeDeps({ ambientTenantId: async () => "tenant-ritz-founder" });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(calls).toEqual([]);
    expect(receipt.ok).toBe(false);
    expect(receipt.steps).toHaveLength(1);
    expect(receipt.steps[0].name).toBe("tenant-guard");
    expect(deps.buildPreview).not.toHaveBeenCalled();
  });

  it("ambient-tenant resolution failure also warms nothing", async () => {
    const { deps, calls } = makeDeps({
      ambientTenantId: async () => { throw new Error("no context"); },
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(calls).toEqual([]);
    expect(receipt.ok).toBe(false);
  });

  it("receipt shape: steps carry {name, ok, ms}; totalMs and date are set", async () => {
    const { deps } = makeDeps();
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(receipt.tenant_id).toBe(TENANT);
    expect(typeof receipt.totalMs).toBe("number");
    expect(typeof receipt.ran_at).toBe("string");
    for (const s of receipt.steps) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.ok).toBe("boolean");
      expect(typeof s.ms).toBe("number");
    }
    // Coverage map has no store -> honest skip, never a fake warm.
    const coverage = receipt.steps.find((s) => s.name === "coverage-map");
    expect(coverage?.skipped).toBe(true);
    expect(coverage?.ok).toBe(true);
  });

  it("dash guard: no em/en dashes in any receipt string (success or failure)", async () => {
    const failing = makeDeps({
      refreshWorklist: vi.fn(async () => { throw new Error("boom"); }),
      getLatestPreviewPlan: vi.fn(async () => plan({ date: TODAY, selected: [{ id: "e1" }] as never })),
    });
    const mismatch = makeDeps({ ambientTenantId: async () => "tenant-other" });
    const receipts = [
      await warmTenantCaches(TENANT, NOW, makeDeps().deps),
      await warmTenantCaches(TENANT, NOW, failing.deps),
      await warmTenantCaches(TENANT, NOW, mismatch.deps),
    ];
    for (const r of receipts) {
      expect(JSON.stringify(r)).not.toMatch(/[–—]/);
    }
  });

  it("pacificDay maps 12:00 UTC to the same Pacific calendar day", () => {
    expect(pacificDay(new Date("2026-07-02T12:00:00Z"))).toBe("2026-07-02");
    // 01:00 UTC is the PREVIOUS Pacific evening.
    expect(pacificDay(new Date("2026-07-03T01:00:00Z"))).toBe("2026-07-02");
  });
});
