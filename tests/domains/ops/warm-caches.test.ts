/**
 * Nightly precompute warm pass (2026-07-02, BEACON 500 item 13; displacement
 * step added by BEACON 500 item 82).
 *
 * Pins the composition contract with injected deps (no Supabase, no graph
 * build, no filesystem):
 *   - step ORDER: demand-graph -> worklist-surface -> plan-preview ->
 *     today-surface -> coverage-map -> displacement-check (Today is warmed
 *     AFTER the plan so the morning open shows tonight's picks; the
 *     displacement check runs LAST since it is the one step that can spend
 *     real money and must never block the free cache warms above it),
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
    ...overrides,
  };
  return { deps, calls };
}

describe("warmTenantCaches", () => {
  it("runs the steps in the pinned order (plan BEFORE today-surface, displacement-check LAST)", async () => {
    const { deps, calls } = makeDeps();
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    expect(calls).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "today-surface",
      "displacement-check",
    ]);
    expect(receipt.steps.map((s) => s.name)).toEqual([
      "demand-graph",
      "worklist-surface",
      "plan-preview",
      "today-surface",
      "coverage-map",
      "displacement-check",
    ]);
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
    expect(calls).toEqual(["worklist-surface", "plan-preview", "today-surface", "displacement-check"]);
    expect(receipt.ok).toBe(false);
    expect(receipt.steps.filter((s) => s.ok)).toHaveLength(5);
  });

  it("displacement-check failure is isolated and never affects the warm steps above it", async () => {
    const { deps, calls } = makeDeps({
      runDisplacementChecks: vi.fn(async () => { throw new Error("dataforseo blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    // The 4 free warm steps + coverage-map all ran and succeeded.
    expect(calls).toEqual(["demand-graph", "worklist-surface", "plan-preview", "today-surface"]);
    const warmSteps = receipt.steps.filter((s) => s.name !== "displacement-check");
    expect(warmSteps.every((s) => s.ok)).toBe(true);
    const displacement = receipt.steps.find((s) => s.name === "displacement-check");
    expect(displacement?.ok).toBe(false);
    expect(displacement?.note).toContain("dataforseo blew up");
    expect(receipt.ok).toBe(false);
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
    expect(step?.note).toContain("skipped 1 past the nightly cap");
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

  it("skip-when-open: an accepted batch still open means NO build call", async () => {
    const { deps } = makeDeps({
      getAcceptedPlan: vi.fn(async () => plan({ status: "accepted" })),
    });
    const receipt = await warmTenantCaches(TENANT, NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.ok).toBe(true);
    expect(step?.skipped).toBe(true);
    expect(deps.buildPreview).not.toHaveBeenCalled();
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
