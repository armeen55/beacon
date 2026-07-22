/**
 * PLATFORM — pipeline invariants + nightly warm pass (Core 100K terminal
 * suite; merged from src/domains/ops/pipeline-invariants.test.ts and
 * tests/domains/ops/warm-caches.test.ts; the warm-caches step-order pins are
 * preserved in the exact form lane T left them after the loader
 * consolidation).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  checkPipelineInvariants,
  describeAgeHours,
  FRESHNESS_LIMIT_HOURS,
  RECENT_WINDOW_HOURS,
  type PipelineReadings,
} from "@/domains/ops/pipeline-invariants";
import { warmTenantCaches, pacificDay, type WarmCachesDeps } from "@/domains/ops/warm-caches";
import type { DailyExperimentPlanRecord } from "@/domains/experiments/daily-plan-types";

// ── checkPipelineInvariants ─────────────────────────────────────────────────

const NOW = "2026-07-02T12:00:00.000Z";
const FRESH = "2026-07-02T09:00:00.000Z"; // 3h ago
const STALE = "2026-06-29T09:00:00.000Z"; // ~75h ago

function healthyReadings(over: Partial<PipelineReadings> = {}): PipelineReadings {
  return {
    tenantId: "tenant-test",
    checkedAt: NOW,
    recentWindowHours: RECENT_WINDOW_HOURS,
    connectors: {
      gsc: { connected: true, lastSyncedAt: FRESH },
      ga4: { connected: true, lastSyncedAt: FRESH },
      profound: { connected: true, lastSyncedAt: FRESH },
    },
    tables: {
      gsc_daily_rows: { recentRows: 1200, latestRowAt: FRESH },
      ga4_url_traffic: { recentRows: 300, latestRowAt: FRESH },
      ga4_ai_referral_daily: { recentRows: 4, latestRowAt: FRESH },
      profound_citation_rows: { recentRows: 900, latestRowAt: FRESH },
      prompt_answer_observations: { recentRows: 40, latestRowAt: FRESH },
    },
    dailyPlan: { hasPlan: true, candidateCount: 5, planCreatedAt: FRESH },
    demandGraph: { nodes: 214, moves: 237 },
    ...over,
  };
}

describe("checkPipelineInvariants", () => {
  it("stays silent for a healthy tenant AND for a fully-disconnected unknown tenant", () => {
    expect(checkPipelineInvariants(healthyReadings())).toEqual([]);
    const nothingConnected = healthyReadings({
      connectors: {
        gsc: { connected: false, lastSyncedAt: null },
        ga4: { connected: false, lastSyncedAt: null },
        profound: { connected: null, lastSyncedAt: null },
      },
      tables: {
        gsc_daily_rows: { recentRows: null, latestRowAt: null },
        ga4_url_traffic: { recentRows: null, latestRowAt: null },
        ga4_ai_referral_daily: { recentRows: null, latestRowAt: null },
        profound_citation_rows: { recentRows: null, latestRowAt: null },
        prompt_answer_observations: { recentRows: null, latestRowAt: null },
      },
      dailyPlan: null,
      demandGraph: null,
    });
    expect(checkPipelineInvariants(nothingConnected)).toEqual([]);
  });

  it("a connected fresh GSC that wrote a confirmed 0 rows is broken-pipe; a failed count read is not", () => {
    const readings = healthyReadings();
    readings.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: "2026-07-01T02:00:00.000Z" };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["gsc_sync"]);
    expect(violations[0]!.sentence).toContain("broken at the Search Console stage");

    const nullRead = healthyReadings();
    nullRead.tables.gsc_daily_rows = { recentRows: null, latestRowAt: FRESH };
    expect(checkPipelineInvariants(nullRead)).toEqual([]);
  });

  it("an OPTIONAL source that synced fine but wrote 0 rows is INFO (quiet, not broken)", () => {
    const readings = healthyReadings();
    readings.tables.profound_citation_rows = { recentRows: 0, latestRowAt: "2026-07-01T02:00:00.000Z" };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["profound_sync"]);
    expect(violations[0]!.severity).toBe("info");
    expect(violations[0]!.sentence).not.toContain("broken at the");
  });

  it("staleness is amber (warn) and subsumes volume; a never-synced GSC demand spine stays a red alarm", () => {
    const stale = healthyReadings();
    stale.connectors.gsc = { connected: true, lastSyncedAt: STALE };
    stale.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: STALE };
    const staleViolations = checkPipelineInvariants(stale);
    expect(staleViolations.map((v) => v.stage)).toEqual(["gsc_freshness"]);
    expect(staleViolations[0]!.severity).toBe("warn");
    expect(staleViolations[0]!.sentence).toContain(`past my ${FRESHNESS_LIMIT_HOURS} hour limit`);

    const neverSynced = healthyReadings();
    neverSynced.connectors.gsc = { connected: true, lastSyncedAt: null };
    neverSynced.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: null };
    const neverViolations = checkPipelineInvariants(neverSynced);
    expect(neverViolations.map((v) => v.stage)).toEqual(["gsc_freshness"]);
    expect(neverViolations[0]!.severity).toBe("alarm");
    expect(neverViolations[0]!.actual).toBe("no completed sync ever");
  });

  it("planning + graph invariants: 0 candidates with demand fires; 0 moves with nodes fires; empty states stay quiet", () => {
    const noCandidates = healthyReadings();
    noCandidates.dailyPlan = { hasPlan: true, candidateCount: 0, planCreatedAt: FRESH };
    expect(checkPipelineInvariants(noCandidates).map((v) => v.stage)).toEqual(["daily_candidates"]);
    expect(checkPipelineInvariants(healthyReadings({ dailyPlan: null }))).toEqual([]);

    const noMoves = healthyReadings({ demandGraph: { nodes: 214, moves: 0 } });
    expect(checkPipelineInvariants(noMoves).map((v) => v.stage)).toEqual(["demand_graph_moves"]);
    expect(checkPipelineInvariants(healthyReadings({ demandGraph: { nodes: 0, moves: 0 } }))).toEqual([]);
  });

  it("copy discipline: every producible sentence is first person and free of em/en dashes", () => {
    const broken = healthyReadings({
      connectors: {
        gsc: { connected: true, lastSyncedAt: FRESH },
        ga4: { connected: true, lastSyncedAt: STALE },
        profound: { connected: true, lastSyncedAt: null },
      },
      tables: {
        gsc_daily_rows: { recentRows: 0, latestRowAt: FRESH },
        ga4_url_traffic: { recentRows: 0, latestRowAt: STALE },
        ga4_ai_referral_daily: { recentRows: 0, latestRowAt: null },
        profound_citation_rows: { recentRows: 0, latestRowAt: null },
        prompt_answer_observations: { recentRows: 0, latestRowAt: null },
      },
      dailyPlan: { hasPlan: true, candidateCount: 0, planCreatedAt: FRESH },
      demandGraph: { nodes: 10, moves: 0 },
    });
    const violations = checkPipelineInvariants(broken);
    expect(violations.length).toBe(5);
    for (const v of violations) {
      expect(v.sentence).not.toMatch(/[–—]/);
      expect(v.actual).not.toMatch(/[–—]/);
    }
    expect(violations.some((v) => /\bI\b|\bmy\b/.test(v.sentence))).toBe(true);
    expect(describeAgeHours(75)).toBe("about 3 days");
  });
});

// ── warmTenantCaches (step-order pins preserved from lane T) ────────────────

const TENANT = "tenant-iranopedia";
// 12:00 UTC = 5:00am Pacific (PDT) on the SAME calendar day.
const WARM_NOW = new Date("2026-07-02T12:00:00Z");
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
    const receipt = await warmTenantCaches(TENANT, WARM_NOW, deps);
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
    // R20: prepare-ahead is OFF by default, so runPrepareAhead is never invoked
    // and the step records an honest skip.
    const prep = receipt.steps.find((s) => s.name === "prepare-ahead");
    expect(prep?.skipped).toBe(true);
    expect(receipt.ok).toBe(true);
    expect(receipt.date).toBe(TODAY);
    for (const s of receipt.steps) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.ok).toBe("boolean");
      expect(typeof s.ms).toBe("number");
    }
  });

  it("fail-soft isolation: a failed step is recorded and every later step still runs", async () => {
    const { deps, calls } = makeDeps({
      refreshDemandGraph: vi.fn(async () => { throw new Error("graph build blew up"); }),
    });
    const receipt = await warmTenantCaches(TENANT, WARM_NOW, deps);
    const graph = receipt.steps.find((s) => s.name === "demand-graph");
    expect(graph?.ok).toBe(false);
    expect(graph?.note).toContain("graph build blew up");
    expect(calls).toEqual([
      "worklist-surface",
      "plan-preview",
      "displacement-check",
      "serp-steal-lane",
      "native-teardown",
      "today-surface",
    ]);
    expect(receipt.ok).toBe(false);
    expect(receipt.steps.filter((s) => s.ok)).toHaveLength(8);
  });

  it("skip-when-fresh: a preview for today's Pacific day (or an open accepted batch) means NO build call", async () => {
    const fresh = makeDeps({ getLatestPreviewPlan: vi.fn(async () => plan({ date: TODAY })) });
    await warmTenantCaches(TENANT, WARM_NOW, fresh.deps);
    expect(fresh.deps.buildPreview).not.toHaveBeenCalled();
    expect(fresh.deps.persistPreview).not.toHaveBeenCalled();

    const open = makeDeps({ getAcceptedPlan: vi.fn(async () => plan({ status: "accepted", date: TODAY })) });
    await warmTenantCaches(TENANT, WARM_NOW, open.deps);
    expect(open.deps.buildPreview).not.toHaveBeenCalled();
    expect(open.deps.completeAcceptedPlan).not.toHaveBeenCalled();
  });

  // 2026-07-08 regression: a PRIOR-day accepted batch the operator never clicked
  // "Finish for today" on used to block new plans indefinitely.
  it("prior-day accepted batch is completed (not left blocking) and today's plan is built", async () => {
    const { deps } = makeDeps({
      getAcceptedPlan: vi.fn(async () => plan({ status: "accepted", date: "2026-06-30", id: "stale-plan" })),
    });
    const receipt = await warmTenantCaches(TENANT, WARM_NOW, deps);
    const step = receipt.steps.find((s) => s.name === "plan-preview");
    expect(step?.skipped).toBeUndefined();
    expect(deps.completeAcceptedPlan).toHaveBeenCalledWith(TENANT, "stale-plan", expect.any(Date));
    expect(deps.buildPreview).toHaveBeenCalled();
    expect(deps.persistPreview).toHaveBeenCalled();
  });

  it("ambient-tenant mismatch (or resolution failure) warms NOTHING (cross-tenant cache safety)", async () => {
    const mismatch = makeDeps({ ambientTenantId: async () => "tenant-ritz-founder" });
    const receipt = await warmTenantCaches(TENANT, WARM_NOW, mismatch.deps);
    expect(mismatch.calls).toEqual([]);
    expect(receipt.ok).toBe(false);
    expect(receipt.steps[0]!.name).toBe("tenant-guard");
    expect(mismatch.deps.buildPreview).not.toHaveBeenCalled();

    const failing = makeDeps({ ambientTenantId: async () => { throw new Error("no context"); } });
    const failedReceipt = await warmTenantCaches(TENANT, WARM_NOW, failing.deps);
    expect(failing.calls).toEqual([]);
    expect(failedReceipt.ok).toBe(false);
  });

  it("dash guard: no em/en dashes in any receipt string (success, failure, or mismatch)", async () => {
    const failing = makeDeps({
      refreshWorklist: vi.fn(async () => { throw new Error("boom"); }),
      getLatestPreviewPlan: vi.fn(async () => plan({ date: TODAY, selected: [{ id: "e1" }] as never })),
    });
    const mismatch = makeDeps({ ambientTenantId: async () => "tenant-other" });
    const receipts = [
      await warmTenantCaches(TENANT, WARM_NOW, makeDeps().deps),
      await warmTenantCaches(TENANT, WARM_NOW, failing.deps),
      await warmTenantCaches(TENANT, WARM_NOW, mismatch.deps),
    ];
    for (const r of receipts) {
      expect(JSON.stringify(r)).not.toMatch(/[–—]/);
    }
  });

  it("pacificDay maps 12:00 UTC to the same Pacific calendar day", () => {
    expect(pacificDay(new Date("2026-07-02T12:00:00Z"))).toBe("2026-07-02");
    expect(pacificDay(new Date("2026-07-03T01:00:00Z"))).toBe("2026-07-02");
  });
});
