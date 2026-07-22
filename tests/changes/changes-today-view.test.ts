/**
 * buildTodayView + dynamicOpportunityCount (Core 100K Phase 6 trim of
 * src/domains/changes/today-view.test.ts).
 *
 * Pins: Today is a focused slice deduped from the canonical backlog; the
 * ranked undone backlog ALWAYS surfaces (no cron/plan gating; the "same 6
 * for 9 days" trap); flagged and non-act items never become opportunities
 * (Today and /changes must agree); Today's rendered counts side with the
 * ledger classifier (the "25 vs 7" divergence pin); the move count is
 * dynamic by evidence quality, never a fixed 6.
 */
import { describe, it, expect, afterAll } from "vitest";
import { buildTodayView, dynamicOpportunityCount, type TodayPlanSummary } from "@/domains/changes/today-view";
import type { CanonicalChange, EvidenceStrength } from "@/domains/changes/canonical-change";
import { countLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

const LC0 = { measuring: 0, decided: 0 };

function ch(over: Partial<CanonicalChange> & { id: string; status: CanonicalChange["status"] }): CanonicalChange {
  return {
    tenantId: "t", pagePath: "/p", pageUrl: "https://s.com/p", pageLabel: "Page", opportunityType: "Capture clicks",
    changeType: "edit_meta", changeFamily: "meta", recommendation: "Update the meta", exactInstructions: null,
    before: null, after: null, rationale: "why", estimatedEffortMinutes: 1, impactScore: 100, upside: 500, expectedOutcome: null,
    riskLevel: "low", evidenceStrength: "strong", measurementMethod: "Diff-in-diff", selectedForToday: false,
    activeExperiment: false, protectedControl: false, blockedReason: null, result: null, measurementHeadline: null,
    measurementDetail: null, nextCheckpoint: null, attributionLimited: false, sourceIds: ["m1"], alternateOpportunities: [],
    ...over,
  };
}

describe("buildTodayView — Today is a focused slice, deduped from the canonical backlog", () => {
  it("ALWAYS surfaces the ranked undone backlog regardless of plan status (no cron/plan gating)", () => {
    // 2026-07-08 operator directive: a stale/stuck/empty tonight's-plan must
    // NEVER hide the real backlog (the "same 6 for 9 days" trap).
    const changes = [ch({ id: "b", status: "suggested" }), ch({ id: "c", status: "ready" })];
    for (const status of ["none", "preview", "accepted", "in_progress", "completed"] as const) {
      const plan: TodayPlanSummary | null = status === "none" ? null : { status, selectedCount: 6, leftToApply: status === "accepted" ? 3 : 0 };
      const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan });
      expect(v.nextOpportunities.map((o) => o.changeId).sort()).toEqual(["b", "c"]);
    }
  });

  it("measuring / blocked / protected / result / plan-selected items never appear as next opportunities", () => {
    const changes = [
      ch({ id: "meas", status: "measuring", measurementHeadline: "Early negative signal" }),
      ch({ id: "blk", status: "blocked" }),
      ch({ id: "prot", status: "blocked", protectedControl: true }),
      ch({ id: "res", status: "result" }),
      ch({ id: "sel", status: "ready", selectedForToday: true }),
      ch({ id: "ok", status: "suggested" }),
    ];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
    expect(v.nextOpportunities.map((o) => o.changeId)).toEqual(["ok"]);
  });

  it("a flagged (off-topic) item never becomes a next opportunity, even at the biggest impact score", () => {
    // Today and /changes must agree: only an act-decision item may become an opportunity.
    const changes = [
      ch({ id: "flagged", status: "suggested", qualityDecision: "flagged", impactScore: 999 }),
      ch({ id: "ok", status: "suggested", impactScore: 10 }),
    ];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
    expect(v.nextOpportunities.map((o) => o.changeId)).toEqual(["ok"]);
    expect(v.nextOpportunities[0]?.changeId).toBe("ok");
  });

  it("an item whose already-refined server decision is a non-act decision (watch/do_nothing) never becomes a next opportunity", () => {
    const changes = [
      ch({ id: "watching", status: "ready", decision: "watch" }),
      ch({ id: "nothing", status: "suggested", decision: "do_nothing" }),
      ch({ id: "ok", status: "ready", decision: "edit_existing" }),
    ];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
    expect(v.nextOpportunities.map((o) => o.changeId)).toEqual(["ok"]);
  });

  it("Clean strategy filters next opportunities to strong-evidence only", () => {
    const changes = [
      ch({ id: "strong", status: "suggested", evidenceStrength: "strong" }),
      ch({ id: "tracking", status: "suggested", evidenceStrength: "tracking", changeFamily: "new_page", changeType: "create_new_page" }),
    ];
    const clean = buildTodayView({ ledgerCounts: LC0, changes, strategy: "clean", plan: null });
    expect(clean.nextOpportunities.map((o) => o.changeId)).toEqual(["strong"]);
  });

  it("needsAttention counts each condition once (review/apply/results/refresh); normal collecting is NOT an alert", () => {
    const changes = [ch({ id: "res", status: "result" })];
    const decidedOne = { measuring: 0, decided: 1 };
    const preview = buildTodayView({ ledgerCounts: decidedOne, changes, strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0 } });
    expect(preview.counts.needsAttention).toBe(2); // review_plan + results_ready
    const accepted = buildTodayView({ ledgerCounts: decidedOne, changes, strategy: "balanced", plan: { status: "accepted", selectedCount: 6, leftToApply: 3 } });
    expect(accepted.counts.needsAttention).toBe(2); // apply_pending + results_ready
    const refreshed = buildTodayView({ ledgerCounts: LC0, changes: [], strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0, wasRefreshed: true } });
    expect(refreshed.counts.needsAttention).toBe(2); // refresh_plan + review_plan
    const calm = buildTodayView({ ledgerCounts: { measuring: 1, decided: 0 }, changes: [ch({ id: "a", status: "measuring", measurementHeadline: "Collecting data" })], strategy: "balanced", plan: null });
    expect(calm.counts.needsAttention).toBe(0);
    expect(calm.headerSentence).toMatch(/collecting data|No action is required/i);
  });

  it("counts.readyToday reflects the plan's selected count; raw ledger numbers never reach counts", () => {
    const changes = [
      ch({ id: "a", status: "measuring" }), ch({ id: "b", status: "measuring" }),
      ch({ id: "r", status: "result" }),
    ];
    const v = buildTodayView({ ledgerCounts: { measuring: 5, decided: 3 }, changes, strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0 } });
    expect(v.counts.readyToday).toBe(6);
    expect(v.counts).not.toHaveProperty("measuring");
    expect(v.counts).not.toHaveProperty("resultsAvailable");
  });
});

describe("FP3 divergence pin - Today's counts equal countLedgerLifecycle for a release with a divergent row", () => {
  // The exact "25 vs 7" class: a change's snapshot status still says "measuring"
  // while the ledger already classifies the SAME page's shipped change as decided.
  registerTestCalibratedVersion();
  afterAll(clearTestCalibratedVersions);

  const NOW = new Date("2026-07-02T12:00:00Z");
  const MATURE = [
    { day: 7, ran: true, controlsUsed: 3 },
    { day: 14, ran: true, controlsUsed: 3 },
    { day: 28, ran: true, controlsUsed: 3 },
  ];
  const OPEN = [
    { day: 7, ran: false },
    { day: 14, ran: false },
    { day: 28, ran: false },
  ];
  const ledger = [
    { id: "l-divergent", path: "/divergent", shippedAt: "2026-05-01T00:00:00.000Z", verdict: "won", windows: MATURE, baseline: { impressions: 1000 }, actionType: "edit_title", calibrationVersion: TEST_CALIBRATED_VERSION },
    { id: "l-open", path: "/gone-from-worklist", shippedAt: "2026-06-25T00:00:00.000Z", verdict: "measuring", windows: OPEN, baseline: { impressions: 1000 }, actionType: "edit_meta", calibrationVersion: TEST_CALIBRATED_VERSION },
  ];

  it("headerSentence and needsAttention side with the ledger classifier, not the stale status slice", () => {
    const canonical = countLedgerLifecycle(ledger, NOW);
    expect(canonical).toEqual({ measuring: 1, decided: 1, won: 1 });

    const changes = [ch({ id: "divergent", status: "measuring", pagePath: "/divergent" })];
    const v = buildTodayView({
      changes,
      strategy: "balanced",
      plan: null,
      ledgerCounts: { measuring: canonical.measuring, decided: canonical.decided },
    });
    expect(v.headerSentence).toBe("Your recent changes are collecting data.");
    // The status recount would have disagreed (0 result rows in the slice vs 1 decided).
    expect(changes.filter((c) => c.status === "result")).toHaveLength(0);
    expect(v.counts.needsAttention).toBe(1);
  });
});

describe("dynamicOpportunityCount - move count is dynamic by quality, never a fixed 6", () => {
  function items(...strengths: EvidenceStrength[]): { evidenceStrength: EvidenceStrength }[] {
    return strengths.map((evidenceStrength) => ({ evidenceStrength }));
  }

  it("bounds: 20 strong caps at 10; fewer than 3 shows all; empty is 0; never exceeds available", () => {
    expect(dynamicOpportunityCount(items(...Array(20).fill("strong")))).toBe(10);
    expect(dynamicOpportunityCount(items("strong", "strong"))).toBe(2);
    expect(dynamicOpportunityCount([])).toBe(0);
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "strong"))).toBe(4);
  });

  it("stops at the first tracking item after position 3, and never resumes past it", () => {
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "tracking", "tracking", "tracking", "tracking", "tracking", "tracking", "tracking"))).toBe(3);
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "strong", "strong", "strong", "tracking", "strong", "strong", "strong"))).toBe(6);
  });

  it("directional evidence extends the list just like strong does", () => {
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "directional", "directional"))).toBe(5);
  });
});
