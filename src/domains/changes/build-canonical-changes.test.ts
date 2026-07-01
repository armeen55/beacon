import { describe, it, expect } from "vitest";
import { buildCanonicalChanges, type CanonicalMoveInput } from "./build-canonical-changes";
import { deriveStatus, statusView, changeTypeFamily } from "./canonical-change";
import { rankChanges, goalMatches, statusCounts } from "./strategy";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ExperimentLever, ControlReservationRecord } from "@/domains/experiments/daily-plan-types";
import type { PlanExecutionState } from "@/domains/experiments/execution-state";

function mv(over: Partial<CanonicalMoveInput> & { id: string; targetUrl: string }): CanonicalMoveInput {
  return { actionType: "edit_meta", actionTone: "clicks", query: "q", pageLabel: "p", why: "do it", ...over };
}

function planItem(id: string, url: string, lever: ExperimentLever): PlannedExperimentRecord {
  return {
    id, candidateId: id, url, canonicalUrl: url, pageLabel: url.split("/").pop()!, pageFamily: "f", lever,
    targetQuery: "q", currentText: "old", proposedText: "new", placement: "head", leaveUnchanged: [], rollbackText: "old",
    effortMinutes: lever === "meta" ? 1 : 3, risk: "low",
    controls: [{ controlUrl: "https://s.com/c1", controlPath: "/c1", score: 0.6, pageFamilyMatch: true, why: "x" }, { controlUrl: "https://s.com/c2", controlPath: "/c2", score: 0.6, pageFamilyMatch: true, why: "x" }, { controlUrl: "https://s.com/c3", controlPath: "/c3", score: 0.6, pageFamilyMatch: true, why: "x" }],
    influencedUrls: [], evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g",
    detail: lever === "meta" ? { kind: "meta", source: "p" } : { kind: "answer_block", question: "Q?", operation: "move", exactInstruction: "x", paragraphIndex: 1 },
  };
}
function plan(selected: PlannedExperimentRecord[], execution?: PlanExecutionState): DailyExperimentPlanRecord {
  return {
    version: 1, id: "t::2026-07-01::abc", tenantId: "t", date: "2026-07-01", status: execution ? "accepted" : "preview",
    createdAt: "t", expiresAt: "t", inputHash: "h", plannerVersion: "v",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: "t" },
    selected, backups: [], distribution: { byLever: {}, byPageFamily: {} }, estimatedMinutes: 10, execution,
  };
}
function res(controlPath: string): ControlReservationRecord {
  return { version: 1, id: `t::p::e::${controlPath}`, tenantId: "t", planId: "t::2026-07-01::abc", plannedExperimentId: "e", treatedUrl: "u", controlUrl: `https://s.com${controlPath}`, controlPath, status: "active", reservedAt: "t", reservedUntil: "t", similarity: { score: 0.5, pageFamilyMatch: true } };
}

describe("changeTypeFamily", () => {
  it("collapses raw action types into families", () => {
    expect(changeTypeFamily("edit_meta")).toBe("meta");
    expect(changeTypeFamily("edit_title")).toBe("title");
    expect(changeTypeFamily("add_internal_link")).toBe("link");
    expect(changeTypeFamily("add_answer_block")).toBe("answer");
    expect(changeTypeFamily("create_new_page")).toBe("new_page");
    expect(changeTypeFamily("fix_ux")).toBe("cro");
  });
});

describe("deriveStatus — most-settled wins; preview ≠ measuring", () => {
  it("a preview-selected item is READY, not measuring", () => {
    expect(deriveStatus({ selectedForToday: true, planItemStatus: "ready_to_apply" })).toBe("apply");
    expect(deriveStatus({ selectedForToday: true })).toBe("ready");
  });
  it("acceptance (ready_to_apply) does NOT become measuring", () => {
    expect(deriveStatus({ planItemStatus: "ready_to_apply" })).toBe("apply");
  });
  it("verification without proof activation is VERIFY, not measuring", () => {
    expect(deriveStatus({ planItemStatus: "verified_live" })).toBe("verify");
    expect(deriveStatus({ planItemStatus: "verification_pending" })).toBe("verify");
  });
  it("active proof / active execution is MEASURING", () => {
    expect(deriveStatus({ proofStatus: "measuring" })).toBe("measuring");
    expect(deriveStatus({ planItemStatus: "active" })).toBe("measuring");
    expect(deriveStatus({ planItemStatus: "gsc_submitted" })).toBe("measuring");
  });
  it("a mature proof outcome is RESULT", () => {
    expect(deriveStatus({ proofStatus: "won" })).toBe("result");
    expect(deriveStatus({ proofStatus: "no_lift" })).toBe("result");
  });
  it("a page mid-measurement (other change) is BLOCKED, not actionable", () => {
    expect(deriveStatus({ pageMeasuring: true })).toBe("blocked");
    expect(statusView("blocked")).toBe("todo");
  });
  it("a bare prepared/recommendation maps to ready/suggested", () => {
    expect(deriveStatus({ preparedReady: true })).toBe("ready");
    expect(deriveStatus({})).toBe("suggested");
  });
});

describe("buildCanonicalChanges — one identity per page+lever, no duplicates", () => {
  it("a plan-selected page does NOT also appear as a separate move card (same lever collapses)", () => {
    const p = plan([planItem("t::2026-07-01::abc::/finglish", "https://s.com/finglish", "answer_block")]);
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/finglish", actionType: "add_answer_block", actionTone: "citation" })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: p, reservations: [] });
    const finglish = out.filter((c) => c.pagePath === "/finglish" && c.changeFamily === "answer");
    expect(finglish.length).toBe(1);
    expect(finglish[0].selectedForToday).toBe(true); // the plan item wins
  });
  it("keeps genuinely different levers on the same page as separate changes", () => {
    const moves = [
      mv({ id: "m1", targetUrl: "https://s.com/iran-flag", actionType: "edit_meta" }),
      mv({ id: "m2", targetUrl: "https://s.com/iran-flag", actionType: "add_internal_link" }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out.filter((c) => c.pagePath === "/iran-flag").length).toBe(2);
  });
  it("marks a reserved control page blocked + protected (never a clean action)", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/c1", actionType: "edit_meta" })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [res("/c1")] });
    expect(out[0].protectedControl).toBe(true);
    expect(out[0].status).toBe("blocked");
  });
  it("collapses duplicate same-lever moves to the most-advanced status", () => {
    const moves = [
      mv({ id: "m1", targetUrl: "https://s.com/x", actionType: "edit_meta" }), // suggested
      mv({ id: "m2", targetUrl: "https://s.com/x", actionType: "edit_meta", proofStatus: "measuring" }), // measuring
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out.length).toBe(1);
    expect(out[0].status).toBe("measuring");
  });
});

describe("Move 2 — proof maturity threads into Changes (early ≠ result)", () => {
  it("a 7-day (early) proof shows as MEASURING with directional evidence, not a final result", () => {
    const moves = [
      mv({ id: "m1", targetUrl: "https://s.com/cities", actionType: "edit_meta", proofStatus: "measuring", proofMaturity: "early_checkpoint", proofDirection: "negative", proofLabel: "Early negative signal", proofNextCheckpoint: "2026-07-04" }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].status).toBe("measuring");
    expect(statusView(out[0].status)).toBe("measuring");
    expect(out[0].evidenceStrength).toBe("directional");
    expect(out[0].measurementHeadline).toBe("Early negative signal");
    expect(out[0].nextCheckpoint).toBe("2026-07-04");
  });
  it("a MATURE proof shows as a RESULT with strong evidence + the mature headline", () => {
    const moves = [
      mv({ id: "m1", targetUrl: "https://s.com/cities", actionType: "edit_meta", proofStatus: "won", proofMaturity: "mature_result", proofDirection: "positive", proofLabel: "Helped" }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].status).toBe("result");
    expect(statusView(out[0].status)).toBe("results");
    expect(out[0].evidenceStrength).toBe("strong");
    expect(out[0].result).toBe("Helped");
  });
  it("an overlapping (attribution-limited) measuring proof is flagged + directional", () => {
    const moves = [
      mv({ id: "m1", targetUrl: "https://s.com/cities", actionType: "edit_meta", proofStatus: "measuring", proofMaturity: "attribution_limited", proofLabel: "Directional only" }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].status).toBe("measuring");
    expect(out[0].attributionLimited).toBe(true);
    expect(out[0].evidenceStrength).toBe("directional");
  });
});

describe("Move 4 backfill — quality signal on every actionable Changes row", () => {
  it("an off-topic ready rec is FLAGGED and demoted out of high-confidence Ready", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/doodool-tala", pageLabel: "Doodool Tala", query: "persian jewelry", actionType: "edit_meta", preparedReady: true })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("flagged");
    expect(out[0].qualityNote).toBeTruthy();
    expect(out[0].status).toBe("suggested"); // demoted from ready — not shown as ready-to-ship
  });
  it("an on-topic ready rec passes quality and stays Ready", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/persian-boy-names", pageLabel: "Persian Boy Names", query: "persian boy names", actionType: "edit_meta", preparedReady: true })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
    expect(out[0].status).toBe("ready");
  });
  it("plan items carry an approved quality decision (already gated in Move 4)", () => {
    const p = plan([planItem("t::2026-07-01::abc::/finglish", "https://s.com/finglish", "meta")]);
    const out = buildCanonicalChanges({ tenantId: "t", moves: [], plan: p, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
  });
});

describe("strategy ranking + goal filters", () => {
  const changes = buildCanonicalChanges({
    tenantId: "t", plan: null, reservations: [],
    moves: [
      mv({ id: "big", targetUrl: "https://s.com/big", actionType: "edit_meta", score: 1000, demand: 50000 }),
      mv({ id: "new", targetUrl: "https://s.com/new", actionType: "create_new_page", actionTone: "page", score: 800, demand: 40000 }),
      mv({ id: "blocked", targetUrl: "https://s.com/blk", actionType: "edit_meta", score: 900, pageMeasuring: true }),
    ],
  });
  it("clean tests excludes new pages + blocked, keeps only strong-comparison", () => {
    const ranked = rankChanges(changes, "clean");
    expect(ranked.some((c) => c.changeFamily === "new_page")).toBe(false);
    expect(ranked.some((c) => c.status === "blocked")).toBe(false);
    expect(ranked.every((c) => c.evidenceStrength === "strong")).toBe(true);
  });
  it("growth keeps new pages (tracking evidence) but still sorts blocked last", () => {
    const ranked = rankChanges(changes, "growth");
    expect(ranked.some((c) => c.changeFamily === "new_page")).toBe(true);
    expect(ranked.at(-1)!.status).toBe("blocked");
  });
  it("goal filters: new_pages + quick_wins", () => {
    expect(changes.filter((c) => goalMatches(c, "new_pages")).every((c) => c.changeFamily === "new_page")).toBe(true);
    expect(changes.filter((c) => goalMatches(c, "quick_wins")).every((c) => c.estimatedEffortMinutes <= 3 && c.changeFamily !== "new_page")).toBe(true);
  });
  it("statusCounts buckets by view", () => {
    const counts = statusCounts(changes);
    expect(counts.todo).toBeGreaterThanOrEqual(1); // blocked + suggested live in To do
  });
});
