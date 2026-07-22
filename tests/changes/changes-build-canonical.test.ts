/**
 * buildCanonicalChanges + canonical-change status + strategy ranking
 * (Core 100K Phase 6 trim of src/domains/changes/build-canonical-changes.test.ts,
 * absorbing the strategy.ts coverage; boundary cases only).
 *
 * Pins: one identity per page+lever (no duplicate cards), the most-settled
 * status wins, preview is never "measuring", Ready is exact (off-topic recs
 * are demoted OUT of Ready), the zero-click trap holds unclickable pages in
 * watching, sibling-based impact ranges stay honest, no vendor slug reaches
 * a rendered rationale, and destructive decisions never ship paste-ready.
 */
import { describe, it, expect } from "vitest";
import { buildCanonicalChanges, type CanonicalMoveInput } from "@/domains/changes/build-canonical-changes";
import { deriveStatus, statusView, changeTypeFamily } from "@/domains/changes/canonical-change";
import { rankChanges, goalMatches, statusCounts } from "@/domains/changes/strategy";
import { isActDecision } from "@/domains/changes/decide-action";
import { ZERO_CLICK_TRAP_REASON, ZERO_CLICK_TRAP_REASON_GENERAL } from "@/domains/changes/zero-click-trap";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ExperimentLever, ControlReservationRecord } from "@/domains/experiments/daily-plan-types";
import type { PlanExecutionState } from "@/domains/experiments/execution-state";

function mv(over: Partial<CanonicalMoveInput> & { id: string; targetUrl: string }): CanonicalMoveInput {
  return { actionType: "edit_meta", actionTone: "clicks", query: "q", pageLabel: "p", why: "do it", ...over };
}

function planItem(id: string, url: string, lever: ExperimentLever): PlannedExperimentRecord {
  return {
    id, candidateId: id, url, canonicalUrl: url, pageLabel: url.split("/").pop()!, pageFamily: "f", lever,
    targetQuery: "q", whyNow: "why", currentText: "old", proposedText: "new", placement: "head", leaveUnchanged: [], rollbackText: "old",
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

describe("deriveStatus: most-settled wins; preview is not measuring", () => {
  it("a preview-selected item is READY, not measuring; acceptance is APPLY", () => {
    expect(deriveStatus({ selectedForToday: true, planItemStatus: "ready_to_apply" })).toBe("apply");
    expect(deriveStatus({ selectedForToday: true })).toBe("ready");
    expect(deriveStatus({ planItemStatus: "ready_to_apply" })).toBe("apply");
  });
  it("verification without proof activation is VERIFY, not measuring", () => {
    expect(deriveStatus({ planItemStatus: "verified_live" })).toBe("verify");
    expect(deriveStatus({ planItemStatus: "verification_pending" })).toBe("verify");
  });
  it("active proof / active execution is MEASURING; a mature proof outcome is RESULT", () => {
    expect(deriveStatus({ proofStatus: "measuring" })).toBe("measuring");
    expect(deriveStatus({ planItemStatus: "active" })).toBe("measuring");
    expect(deriveStatus({ proofStatus: "won" })).toBe("result");
    expect(deriveStatus({ proofStatus: "no_lift" })).toBe("result");
  });
  it("a page mid-measurement (other change) is BLOCKED; a bare prepared/rec maps to ready/suggested", () => {
    expect(deriveStatus({ pageMeasuring: true })).toBe("blocked");
    expect(statusView("blocked")).toBe("todo");
    expect(deriveStatus({ preparedReady: true })).toBe("ready");
    expect(deriveStatus({})).toBe("suggested");
  });
});

describe("buildCanonicalChanges: one identity per page+lever, no duplicates", () => {
  it("a plan-selected page does NOT also appear as a separate move card (same lever collapses)", () => {
    const p = plan([planItem("t::2026-07-01::abc::/finglish", "https://s.com/finglish", "answer_block")]);
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/finglish", actionType: "add_answer_block", actionTone: "citation" })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: p, reservations: [] });
    const finglish = out.filter((c) => c.pagePath === "/finglish" && c.changeFamily === "answer");
    expect(finglish.length).toBe(1);
    expect(finglish[0].selectedForToday).toBe(true); // the plan item wins
    // A plan item earns "strong" honestly: it has REAL reserved control pages.
    expect(finglish[0].evidenceStrength).toBe("strong");
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

describe("proof maturity threads into Changes (early is not result)", () => {
  it("a 7-day (early) proof shows as MEASURING with directional evidence, not a final result", () => {
    const moves = [
      mv({ id: "m1", targetUrl: "https://s.com/cities", actionType: "edit_meta", proofStatus: "measuring", proofMaturity: "early_checkpoint", proofDirection: "negative", proofLabel: "Early negative signal", proofNextCheckpoint: "2026-07-04" }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].status).toBe("measuring");
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
});

describe("Ready exactness: quality signal on every actionable Changes row", () => {
  it("an off-topic ready rec is FLAGGED and demoted out of high-confidence Ready", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/doodool-tala", pageLabel: "Doodool Tala", query: "persian jewelry", actionType: "edit_meta", preparedReady: true })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("flagged");
    expect(out[0].qualityNote).toBeTruthy();
    expect(out[0].status).toBe("suggested"); // demoted from ready, not shown as ready-to-ship
  });
  it("an on-topic ready rec passes quality and stays Ready", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/persian-boy-names", pageLabel: "Persian Boy Names", query: "persian boy names", actionType: "edit_meta", preparedReady: true })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
    expect(out[0].status).toBe("ready");
  });
});

describe("zero-click / image-intent trap decides WATCH, never a naive capture-clicks pick", () => {
  it("the /iran-flags fixture (pos 2.8, 5567 impressions, 0 clicks) decides watch with the honest reason", () => {
    const moves = [
      mv({
        id: "m1",
        targetUrl: "https://s.com/iran-flags",
        pageLabel: "Iran Flag",
        query: "iran flag",
        actionType: "edit_meta",
        actionTone: "clicks",
        preparedReady: true,
        topQueryPosition: 2.8,
        topQueryImpressions90d: 5567,
        topQueryClicks90d: 0,
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("flagged");
    expect(out[0].qualityNote).toBe(ZERO_CLICK_TRAP_REASON);
    expect(out[0].decision).toBe("watch");
    // Held, not deleted: it still renders, just off the actionable command path.
    expect(out[0].status).toBe("suggested");
  });

  it("a genuine capture-clicks case (pos 8, healthy nonzero CTR) stays actionable", () => {
    const moves = [
      mv({
        id: "m1",
        targetUrl: "https://s.com/persian-food",
        pageLabel: "Persian Food",
        query: "persian food",
        actionType: "edit_meta",
        actionTone: "clicks",
        preparedReady: true,
        topQueryPosition: 8,
        topQueryImpressions90d: 600,
        topQueryClicks90d: 20, // ~3.3% CTR - healthy
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
    expect(out[0].decision).toBe("edit_existing");
    expect(out[0].status).toBe("ready");
  });

  it("a citation add_answer_block on a trapped page also decides watch, with the general reason", () => {
    const moves = [
      mv({
        id: "m1",
        targetUrl: "https://s.com/citation-page",
        query: "citation page topic",
        pageLabel: "Citation Page Topic",
        actionTone: "citation",
        actionType: "add_answer_block",
        topQueryPosition: 2.8,
        topQueryImpressions90d: 5567,
        topQueryClicks90d: 0,
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("flagged");
    expect(out[0].qualityNote).toBe(ZERO_CLICK_TRAP_REASON_GENERAL);
    expect(out[0].decision).toBe("watch");
  });

  it("keeps a citation move actionable when a real AI citation gap independently supports it", () => {
    const moves = [
      mv({
        id: "aeo-backed",
        targetUrl: "https://s.com/citation-page",
        query: "citation page topic",
        pageLabel: "Citation Page Topic",
        actionTone: "citation",
        actionType: "add_answer_block",
        hasIndependentAeoEvidence: true,
        preparedReady: true,
        topQueryPosition: 2.8,
        topQueryImpressions90d: 5567,
        topQueryClicks90d: 0,
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
    expect(out[0].status).toBe("ready");
  });

  it("a trapped page cannot occupy an act-now top-3 slot even with the biggest impact score", () => {
    const moves = [
      mv({ id: "trap", targetUrl: "https://s.com/iran-flags/flag-history", pageLabel: "Flag History", query: "iran flag history", actionType: "add_answer_block", actionTone: "citation", score: 44434, topQueryPosition: 3.3, topQueryImpressions90d: 33119, topQueryClicks90d: 43 }),
      mv({ id: "h1", targetUrl: "https://s.com/persian-food", pageLabel: "Persian Food", query: "persian food", actionType: "edit_meta", actionTone: "clicks", score: 900, topQueryPosition: 8, topQueryImpressions90d: 1200, topQueryClicks90d: 60 }),
      mv({ id: "h2", targetUrl: "https://s.com/iran-travel", pageLabel: "Iran Travel", query: "iran travel", actionType: "edit_meta", actionTone: "clicks", score: 800, topQueryPosition: 7, topQueryImpressions90d: 1500, topQueryClicks90d: 75 }),
      mv({ id: "h3", targetUrl: "https://s.com/tehran", pageLabel: "Tehran", query: "tehran", actionType: "edit_meta", actionTone: "clicks", score: 700, topQueryPosition: 9, topQueryImpressions90d: 1000, topQueryClicks90d: 40 }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    const actNowRanked = rankChanges(out, "balanced").filter((c) => isActDecision(c.decision) && c.status !== "blocked");
    const top3 = actNowRanked.slice(0, 3).map((c) => c.pagePath);
    expect(top3).not.toContain("/iran-flags/flag-history");
    // The trapped page is preserved (held in watching), never dropped.
    const trapped = out.find((c) => c.pagePath === "/iran-flags/flag-history")!;
    expect(trapped.decision).toBe("watch");
    expect(isActDecision(trapped.decision)).toBe(false);
  });

  it("trap boundaries: exactly-at-threshold values stay honest, just-over trips the trap", () => {
    // pos <= 5, impr >= 500, ctr < 0.2% (strict) - CTR AT 0.2% is NOT a trap.
    const edge = (over: Partial<CanonicalMoveInput>): CanonicalMoveInput =>
      mv({ id: "edge", targetUrl: "https://s.com/edge-topic", query: "edge topic", pageLabel: "Edge Topic", actionTone: "citation", actionType: "add_answer_block", ...over });
    const atCtrFloor = buildCanonicalChanges({
      tenantId: "t",
      moves: [edge({ topQueryPosition: 5, topQueryImpressions90d: 500, topQueryClicks90d: 1 })],
      plan: null,
      reservations: [],
    });
    expect(atCtrFloor[0].qualityDecision).toBe("approved"); // ctr 0.2% is not < 0.2%
    const belowCtrFloor = buildCanonicalChanges({
      tenantId: "t",
      moves: [edge({ topQueryPosition: 5, topQueryImpressions90d: 500, topQueryClicks90d: 0 })],
      plan: null,
      reservations: [],
    });
    expect(belowCtrFloor[0].qualityDecision).toBe("flagged");
    expect(belowCtrFloor[0].decision).toBe("watch");
    // position 5.1 (just past the strong-position bar) is never a trap.
    const pastPosition = buildCanonicalChanges({
      tenantId: "t",
      moves: [edge({ topQueryPosition: 5.1, topQueryImpressions90d: 5000, topQueryClicks90d: 0 })],
      plan: null,
      reservations: [],
    });
    expect(pastPosition[0].qualityDecision).toBe("approved");
  });
});

describe("strategy ranking + goal filters", () => {
  const changes = buildCanonicalChanges({
    tenantId: "t", plan: null, reservations: [],
    moves: [
      mv({ id: "big", targetUrl: "https://s.com/big", actionType: "edit_meta", score: 1000, demand: 50000 }),
      mv({ id: "mature", targetUrl: "https://s.com/mature", actionType: "edit_meta", score: 700, proofStatus: "won", proofMaturity: "mature_result", proofLabel: "Helped" }),
      mv({ id: "new", targetUrl: "https://s.com/new", actionType: "create_new_page", actionTone: "page", score: 800, demand: 40000 }),
      mv({ id: "blocked", targetUrl: "https://s.com/blk", actionType: "edit_meta", score: 900, pageMeasuring: true }),
    ],
  });
  it("a bare suggestion (no proof, no reserved controls) is directional, never decorated as strong", () => {
    const big = changes.find((c) => c.id.includes("/big"))!;
    expect(big.evidenceStrength).toBe("directional");
  });
  it("clean tests excludes new pages + blocked, keeps only real strong-comparison (a settled proof)", () => {
    const ranked = rankChanges(changes, "clean");
    expect(ranked.some((c) => c.changeFamily === "new_page")).toBe(false);
    expect(ranked.some((c) => c.status === "blocked")).toBe(false);
    expect(ranked.every((c) => c.evidenceStrength === "strong")).toBe(true);
    expect(ranked.some((c) => c.id.includes("/mature"))).toBe(true);
  });
  it("growth keeps new pages (tracking evidence) but still sorts blocked last", () => {
    const ranked = rankChanges(changes, "growth");
    expect(ranked.some((c) => c.changeFamily === "new_page")).toBe(true);
    expect(ranked.at(-1)!.status).toBe("blocked");
  });
  it("goal filters + statusCounts bucket by view", () => {
    expect(changes.filter((c) => goalMatches(c, "new_pages")).every((c) => c.changeFamily === "new_page")).toBe(true);
    expect(changes.filter((c) => goalMatches(c, "quick_wins")).every((c) => c.estimatedEffortMinutes <= 3 && c.changeFamily !== "new_page")).toBe(true);
    expect(statusCounts(changes).todo).toBeGreaterThanOrEqual(1); // blocked + suggested live in To do
  });
});

// G8 - honest impact ranges on THIN history through buildCanonicalChanges.
function siblingMove(id: string, position: number, ctr28d: number, impressions28d: number): CanonicalMoveInput {
  const impressions90d = impressions28d * 3;
  return mv({
    id,
    targetUrl: `https://s.com${id}`,
    actionType: "edit_meta",
    actionTone: "clicks",
    topQueryPosition: position,
    topQueryImpressions90d: impressions90d,
    topQueryClicks90d: ctr28d * impressions90d,
  });
}
const SINGERS_SIBLINGS: CanonicalMoveInput[] = [
  siblingMove("/famous-iranian-actors", 22, 0.02, 700),
  siblingMove("/famous-iranian-poets", 23, 0.025, 900),
  siblingMove("/famous-iranian-athletes", 24, 0.05, 1100),
  siblingMove("/famous-iranian-scientists", 25, 0.055, 1300),
  siblingMove("/famous-iranian-directors", 27, 0.059, 1500),
];
function singersTarget(over: Partial<CanonicalMoveInput> = {}): CanonicalMoveInput {
  return mv({
    id: "singers",
    targetUrl: "https://s.com/famous-iranian-singers",
    actionType: "edit_title",
    actionTone: "clicks",
    score: 300,
    demand: 4765,
    topQueryPosition: 24,
    topQueryImpressions90d: 4765 * 3,
    topQueryClicks90d: 0.0076 * 4765 * 3,
    ...over,
  });
}

describe("G8: sibling-ctr-basis wiring (honest forecasts on thin history)", () => {
  it("the primary forecast genuinely abstains for the singers fixture (sanity check on the premise)", () => {
    const changes = buildCanonicalChanges({ tenantId: "t", plan: null, reservations: [], moves: [singersTarget()] });
    const singers = changes.find((c) => c.id.includes("famous-iranian-singers"))!;
    expect(singers.expectedOutcomeLow).toBeNull();
    expect(singers.upside).toBeNull();
    expect(singers.expectedOutcome).toContain("already earns close to what its position typically gets");
  });

  it("sizes a sibling-based range in the +85 to +200 clicks/mo ballpark, with the transparent basis line", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t", plan: null, reservations: [],
      moves: [singersTarget(), ...SINGERS_SIBLINGS],
    });
    const singers = changes.find((c) => c.id.includes("famous-iranian-singers"))!;
    expect(singers.siblingLowPerMonth).toBe(85);
    expect(singers.siblingHighPerMonth).toBe(200);
    expect(singers.siblingBasis).toContain("Based on your own pages at similar positions");
    expect(singers.siblingBasis).not.toMatch(/[\u2013\u2014]/);
    // The primary abstention + ranking fields stay byte-identical (display only).
    expect(singers.expectedOutcomeLow).toBeNull();
    expect(singers.impactScore).toBe(300);
  });

  it("fewer than 3 qualifying siblings -> siblingBasis stays null, abstention completely unchanged", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t", plan: null, reservations: [],
      moves: [singersTarget(), ...SINGERS_SIBLINGS.slice(0, 2)],
    });
    const singers = changes.find((c) => c.id.includes("famous-iranian-singers"))!;
    expect(singers.siblingBasis).toBeNull();
    expect(singers.siblingLowPerMonth).toBeNull();
    expect(singers.expectedOutcome).toContain("already earns close to what its position typically gets");
  });

  it("a page already ahead of its own siblings gets no negative promise - honest 'already ahead' text", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t", plan: null, reservations: [],
      moves: [singersTarget({ id: "singers-ahead", targetUrl: "https://s.com/famous-iranian-singers-ahead", topQueryClicks90d: 0.06 * 4765 * 3 }), ...SINGERS_SIBLINGS],
    });
    const c = changes.find((x) => x.id.includes("famous-iranian-singers-ahead"))!;
    expect(c.siblingLowPerMonth).toBeNull();
    expect(c.siblingBasis).toContain("already ahead of similar pages");
  });
});

describe("rationale line carries no vendor name or evidence-source slug", () => {
  it("rewrites the raw 'Ranked by <slugs>' rankWhy into plain evidence names", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/a", rankWhy: "Ranked by rank_revenue + profound + gsc + clarity + competitor_teardown." })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    const rationale = out[0]!.rationale;
    expect(rationale).not.toMatch(/rank_revenue|profound|dataforseo|competitor_teardown|clarity|gsc/i);
    expect(rationale).toContain("revenue impact");
    expect(rationale).toContain("AI citations");
    expect(rationale).toContain("competitor research");
  });

  it("falls back to the move's why when there is no rankWhy", () => {
    const moves = [mv({ id: "m2", targetUrl: "https://s.com/b", why: "sharpen the title", rankWhy: undefined })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0]!.rationale).toBe("sharpen the title");
  });
});

describe("decision wiring at the assembly boundary (destructive hardening)", () => {
  it("a new_page-FAMILY action on an already-live page is decided as an edit, never 'build a new page'", () => {
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/existing-guide", actionType: "split_page", pageLabel: "existing guide", query: "existing guide" })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0]!.changeFamily).toBe("new_page"); // family still collapses to new_page
    expect(out[0]!.decision).toBe("edit_existing"); // but a real live pagePath forces edit
  });

  it("a consolidate (merge) row can never carry paste-ready exactInstructions - they are stripped", () => {
    const moves = [
      mv({
        id: "m2",
        targetUrl: "https://s.com/kitchen-remodel-tips",
        actionType: "merge_pages",
        preparedReady: true,
        preparedDraftText: "Merge kitchen-remodel-tips into kitchen-remodel: add one internal link.",
        pageLabel: "kitchen remodel tips",
        query: "kitchen remodel tips",
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0]!.decision).toBe("consolidate");
    // A merge destroys URLs; it must ship as advisory prose, never paste-ready instructions.
    expect(out[0]!.exactInstructions).toBeNull();
  });
});
