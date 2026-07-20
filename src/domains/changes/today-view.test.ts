import { describe, it, expect, afterAll } from "vitest";
import { buildTodayView, dynamicOpportunityCount, type TodayPlanSummary } from "./today-view";
import type { CanonicalChange, EvidenceStrength } from "./canonical-change";
import { countLedgerLifecycle } from "./lifecycle-counts";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

/** FP3 - buildTodayView takes the canonical ledger pair; zero for tests that don't
 *  exercise the counts. */
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
  it("a measuring change is never a next opportunity", () => {
    const changes = [
      ch({ id: "a", status: "measuring", pageLabel: "Cities", measurementHeadline: "Early negative signal", nextCheckpoint: "2026-07-04" }),
      ch({ id: "b", status: "suggested", pageLabel: "Flags" }),
    ];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
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
      const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan });
      expect(v.nextOpportunities.map((o) => o.changeId).sort()).toEqual(["b", "c"]);
    }
  });

  it("still excludes items already selected in tonight's plan (no duplication with the plan panel)", () => {
    const changes = [ch({ id: "sel", status: "ready", selectedForToday: true }), ch({ id: "free", status: "suggested" })];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: { status: "accepted", selectedCount: 1, leftToApply: 1 } });
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
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
    const ids = v.nextOpportunities.map((o) => o.changeId);
    expect(ids).toEqual(["ok"]);
  });

  // P1-6 (2026-07-10, visual audit HARD BLOCKER) - build-canonical-changes.ts demotes a flagged
  // (off-topic) ready item back to "suggested" instead of blocking it, so status alone let it
  // through as a next opportunity - meaning the Today command could say "Do this next" for the
  // SAME item /changes routes to decideChangeAction's "watch" and keeps off its command path. The
  // two surfaces must agree: only an act-decision item may become a next opportunity.
  it("a flagged (off-topic) item never becomes a next opportunity, even though its status is suggested", () => {
    const changes = [
      ch({ id: "flagged", status: "suggested", qualityDecision: "flagged" }),
      ch({ id: "ok", status: "suggested" }),
    ];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
    expect(v.nextOpportunities.map((o) => o.changeId)).toEqual(["ok"]);
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

  it("the command's target is always in the actionable queue: a flagged item never wins nextOpportunities[0]", () => {
    // Even when the flagged item would otherwise rank first (higher impact), it must never
    // become the Today command's topOpportunity - the two surfaces (Today, /changes) must agree.
    const changes = [
      ch({ id: "flagged-high-impact", status: "suggested", qualityDecision: "flagged", impactScore: 999 }),
      ch({ id: "ok", status: "suggested", impactScore: 10 }),
    ];
    const v = buildTodayView({ ledgerCounts: LC0, changes, strategy: "balanced", plan: null });
    expect(v.nextOpportunities[0]?.changeId).toBe("ok");
  });

  it("Clean strategy filters next opportunities to strong-evidence only", () => {
    const changes = [
      ch({ id: "strong", status: "suggested", evidenceStrength: "strong" }),
      ch({ id: "tracking", status: "suggested", evidenceStrength: "tracking", changeFamily: "new_page", changeType: "create_new_page" }),
    ];
    const clean = buildTodayView({ ledgerCounts: LC0, changes, strategy: "clean", plan: null });
    expect(clean.nextOpportunities.map((o) => o.changeId)).toEqual(["strong"]);
  });

  it("needsAttention: preview plan → +1; accepted with leftToApply → +1; canonical decided → +1 (each condition counted once)", () => {
    // FP3 - the "results ready" condition counts off the CANONICAL decided count (the
    // ledger's Wins + What we learned), never a status === "result" recount of the
    // worklist slice.
    const changes = [ch({ id: "res", status: "result" })];
    const decidedOne = { measuring: 0, decided: 1 };
    const preview = buildTodayView({ ledgerCounts: decidedOne, changes, strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0 } });
    // review_plan condition (preview + selectedCount>0) + results_ready condition (decided>0)
    expect(preview.counts.needsAttention).toBe(2);
    const accepted = buildTodayView({ ledgerCounts: decidedOne, changes, strategy: "balanced", plan: { status: "accepted", selectedCount: 6, leftToApply: 3 } });
    // apply_pending condition (accepted + leftToApply>0) + results_ready condition
    expect(accepted.counts.needsAttention).toBe(2);
  });

  it("a stale/refreshed plan counts toward needsAttention", () => {
    const v = buildTodayView({ ledgerCounts: LC0, changes: [], strategy: "balanced", plan: { status: "preview", selectedCount: 6, leftToApply: 0, wasRefreshed: true } });
    // refresh_plan condition + review_plan condition (preview + selectedCount>0)
    expect(v.counts.needsAttention).toBe(2);
  });

  it("normal collecting is NOT an alert; header stays calm", () => {
    const changes = [ch({ id: "a", status: "measuring", measurementHeadline: "Collecting data" })];
    const v = buildTodayView({ ledgerCounts: { measuring: 1, decided: 0 }, changes, strategy: "balanced", plan: null });
    expect(v.counts.needsAttention).toBe(0);
    expect(v.headerSentence).toMatch(/collecting data|No action is required/i);
  });

  it("counts.readyToday reflects the plan's selected count regardless of the worklist status slice", () => {
    // The worklist slice says 2 measuring + 1 result; the canonical ledger says 5 / 3.
    // Neither raw ledger number is exposed on counts (FP3 ONE-COUNT RULE keeps them off
    // Today's persisted blob); readyToday is a Today-only derived number.
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
  // The exact "25 vs 7" class: a change's snapshot status still says "measuring" while
  // the ledger already classifies the SAME page's shipped change as decided (auto-measure
  // matured it between rebuilds). Today's rendered counts must side with the ledger.
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
    // Decided in the ledger, but the stale CanonicalChange below still says "measuring".
    { id: "l-divergent", path: "/divergent", shippedAt: "2026-05-01T00:00:00.000Z", verdict: "won", windows: MATURE, baseline: { impressions: 1000 }, actionType: "edit_title", calibrationVersion: TEST_CALIBRATED_VERSION },
    // Genuinely still measuring; its page fell OUT of the ranked worklist pool, so no
    // CanonicalChange row exists for it at all (the substrate half of the divergence).
    { id: "l-open", path: "/gone-from-worklist", shippedAt: "2026-06-25T00:00:00.000Z", verdict: "measuring", windows: OPEN, baseline: { impressions: 1000 }, actionType: "edit_meta", calibrationVersion: TEST_CALIBRATED_VERSION },
  ];

  it("headerSentence and needsAttention side with the ledger classifier, not the stale status slice", () => {
    // 2026-07-20: buildTodayView no longer exposes the raw measuring/decided ledger numbers
    // on `counts` at all (they rendered nowhere and were the exact fields a stale persisted
    // Today blob could diverge on), so this pin now covers the two places the ledger pair
    // still reaches a rendered surface: the greeting sentence (measuring) and the
    // needsAttention tile (decided, via the results-ready condition).
    const canonical = countLedgerLifecycle(ledger, NOW);
    expect(canonical).toEqual({ measuring: 1, decided: 1, won: 1 });

    const changes = [ch({ id: "divergent", status: "measuring", pagePath: "/divergent" })];
    const v = buildTodayView({
      changes,
      strategy: "balanced",
      plan: null,
      ledgerCounts: { measuring: canonical.measuring, decided: canonical.decided },
    });
    // The greeting sentence reads the canonical measuring count (1), not the status slice.
    expect(v.headerSentence).toBe("Your recent changes are collecting data.");
    // The results-ready condition fires off the canonical decided count (1), and the status
    // recount would have disagreed (0 result rows in the slice vs 1 decided in the ledger) -
    // the divergence this pin exists to catch.
    expect(changes.filter((c) => c.status === "result")).toHaveLength(0);
    expect(v.counts.needsAttention).toBe(1);
  });
});

describe("dynamicOpportunityCount, B-8 (operator spec 2026-07-09): move count is dynamic by quality, never a fixed 6", () => {
  function items(...strengths: EvidenceStrength[]): { evidenceStrength: EvidenceStrength }[] {
    return strengths.map((evidenceStrength) => ({ evidenceStrength }));
  }

  it("(a) 20 strong items caps at 10, the ceiling", () => {
    expect(dynamicOpportunityCount(items(...Array(20).fill("strong")))).toBe(10);
  });

  it("(b) fewer than 3 available shows all of them (2 items -> 2)", () => {
    expect(dynamicOpportunityCount(items("strong", "strong"))).toBe(2);
  });

  it("(c) 3 strong then 7 tracking -> 3 (stops at the first tracking item after position 3, none of the tracking items are shown)", () => {
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "tracking", "tracking", "tracking", "tracking", "tracking", "tracking", "tracking"))).toBe(3);
  });

  it("(d) 6 strong, then 1 tracking, then 3 more strong -> 6 (extends past the guaranteed 3 while evidence stays strong, stops the moment it hits the tracking item, never resumes for the strong items after it)", () => {
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "strong", "strong", "strong", "tracking", "strong", "strong", "strong"))).toBe(6);
  });

  it("directional evidence extends the list just like strong does", () => {
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "directional", "directional"))).toBe(5);
  });

  it("an empty list returns 0", () => {
    expect(dynamicOpportunityCount([])).toBe(0);
  });

  it("never exceeds the available items even between the min and max bounds", () => {
    expect(dynamicOpportunityCount(items("strong", "strong", "strong", "strong"))).toBe(4);
  });
});
