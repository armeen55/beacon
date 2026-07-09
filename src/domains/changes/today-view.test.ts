import { describe, it, expect } from "vitest";
import { buildTodayView, type TodayPlanSummary } from "./today-view";
import type { CanonicalChange } from "./canonical-change";

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
  it("measuring items surface (cap 5) with maturity headline; a measuring change is never a next opportunity", () => {
    const changes = [
      ch({ id: "a", status: "measuring", pageLabel: "Cities", measurementHeadline: "Early negative signal", nextCheckpoint: "2026-07-04" }),
      ch({ id: "b", status: "suggested", pageLabel: "Flags" }),
    ];
    const v = buildTodayView({ changes, strategy: "balanced", plan: null });
    expect(v.measuring.map((m) => m.changeId)).toEqual(["a"]);
    expect(v.measuring[0].headline).toBe("Early negative signal");
    // no plan → opportunities show, but the measuring item must NOT appear there
    expect(v.nextOpportunities.map((o) => o.changeId)).not.toContain("a");
    expect(v.nextOpportunities.map((o) => o.changeId)).toContain("b");
  });

  it("ALWAYS surfaces the ranked undone backlog regardless of plan status (no cron/plan gating)", () => {
    // 2026-07-08 operator directive: "it should just be the next best moves I haven't done yet,
    // refresh or not - it doesn't even need a cron." A stale/stuck/empty tonight's-plan must
    // NEVER hide the real backlog again (that was the "same 6 for 9 days" trap).
    const changes = [ch({ id: "b", status: "suggested" }), ch({ id: "c", status: "ready" })];
    for (const status of ["none", "preview", "accepted", "in_progress", "completed"] as const) {
      const plan = status === "none" ? null : { status, selectedCount: 6, leftToApply: status === "accepted" ? 3 : 0 };
      const v = buildTodayView({ changes, strategy: "balanced", plan });
      expect(v.nextOpportunities.map((o) => o.changeId).sort()).toEqual(["b", "c"]);
    }
  });

  it("still excludes items already selected in tonight's plan (no duplication with the plan panel)", () => {
    const changes = [ch({ id: "sel", status: "ready", selectedForToday: true }), ch({ id: "free", status: "suggested" })];
    const v = buildTodayView({ changes, strategy: "balanced", plan: { status: "accepted", selectedCount: 1, leftToApply: 1 } });
    expect(v.nextOpportunities.map((o) => o.changeId)).toEqual(["free"]);
  });

  it("blocked / protected / result / selected items never appear as next opportunities", () => {
    const changes = [
      ch({ id: "blk", status: "blocked" }),
      ch({ id: "prot", status: "blocked", protectedControl: true }),
      ch({ id: "res", status: "result" }),
      ch({ id: "sel", status: "ready", selectedForToday: true }),
      ch({ id: "ok", status: "suggested" }),
    ];
    const v = buildTodayView({ changes, strategy: "balanced", plan: null });
    const ids = v.nextOpportunities.map((o) => o.changeId);
    expect(ids).toEqual(["ok"]);
  });

  it("Clean strategy filters next opportunities to strong-evidence only", () => {
    const changes = [
      ch({ id: "strong", status: "suggested", evidenceStrength: "strong" }),
      ch({ id: "tracking", status: "suggested", evidenceStrength: "tracking", changeFamily: "new_page", changeType: "create_new_page" }),
    ];
    const clean = buildTodayView({ changes, strategy: "clean", plan: null });
    expect(clean.nextOpportunities.map((o) => o.changeId)).toEqual(["strong"]);
  });

  it("attention: preview plan → review; accepted with leftToApply → apply; mature result → results", () => {
    const changes = [ch({ id: "res", status: "result" })];
    const preview = buildTodayView({ changes, strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0 } });
    expect(preview.attention.some((a) => a.kind === "review_plan")).toBe(true);
    expect(preview.attention.some((a) => a.kind === "results_ready")).toBe(true);
    // apply is more urgent than review is more urgent than results (priority order)
    const accepted = buildTodayView({ changes, strategy: "balanced", plan: { status: "accepted", selectedCount: 6, leftToApply: 3 } });
    expect(accepted.attention[0].kind).toBe("apply_pending");
  });

  it("a stale/refreshed plan is the top attention item", () => {
    const v = buildTodayView({ changes: [], strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0, wasRefreshed: true } });
    expect(v.attention[0].kind).toBe("refresh_plan");
  });

  it("normal collecting is NOT an alert; header stays calm", () => {
    const changes = [ch({ id: "a", status: "measuring", measurementHeadline: "Collecting data" })];
    const v = buildTodayView({ changes, strategy: "balanced", plan: null });
    expect(v.attention).toEqual([]);
    expect(v.headerSentence).toMatch(/collecting data|No action is required/i);
  });

  it("counts reflect the slice", () => {
    const changes = [
      ch({ id: "a", status: "measuring" }), ch({ id: "b", status: "measuring" }),
      ch({ id: "r", status: "result" }),
    ];
    const v = buildTodayView({ changes, strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0 } });
    expect(v.counts.measuring).toBe(2);
    expect(v.counts.resultsAvailable).toBe(1);
    expect(v.counts.readyToday).toBe(6);
  });
});
