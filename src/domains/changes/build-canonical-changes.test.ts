import { describe, it, expect } from "vitest";
import { buildCanonicalChanges, type CanonicalMoveInput } from "./build-canonical-changes";
import { deriveStatus, statusView, changeTypeFamily } from "./canonical-change";
import { rankChanges, goalMatches, statusCounts } from "./strategy";
import { isActDecision } from "./decide-action";
import { ZERO_CLICK_TRAP_REASON, ZERO_CLICK_TRAP_REASON_GENERAL } from "./zero-click-trap";
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

describe("buildCanonicalChanges: one identity per page+lever, no duplicates", () => {
  it("a plan-selected page does NOT also appear as a separate move card (same lever collapses)", () => {
    const p = plan([planItem("t::2026-07-01::abc::/finglish", "https://s.com/finglish", "answer_block")]);
    const moves = [mv({ id: "m1", targetUrl: "https://s.com/finglish", actionType: "add_answer_block", actionTone: "citation" })];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: p, reservations: [] });
    const finglish = out.filter((c) => c.pagePath === "/finglish" && c.changeFamily === "answer");
    expect(finglish.length).toBe(1);
    expect(finglish[0].selectedForToday).toBe(true); // the plan item wins
    // B1 - a plan item earns "strong" honestly: it has REAL reserved control pages
    // (planItem() above reserves 3), unlike a bare suggestion with no comparison data.
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

describe("Move 2: proof maturity threads into Changes (early is not result)", () => {
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

describe("Move 4 backfill: quality signal on every actionable Changes row", () => {
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
  it("plan items carry an approved quality decision (already gated in Move 4)", () => {
    const p = plan([planItem("t::2026-07-01::abc::/finglish", "https://s.com/finglish", "meta")]);
    const out = buildCanonicalChanges({ tenantId: "t", moves: [], plan: p, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
  });
});

describe("G2 (2026-07-10 hygiene batch): zero-click / image-intent trap decides WATCH, never a naive capture-clicks pick", () => {
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

  it("a single-fact zero-click trap (pos 4.1, material impressions, 0 clicks) also decides watch", () => {
    const moves = [
      mv({
        id: "m1",
        targetUrl: "https://s.com/iran-animals/asiatic-cheetah",
        pageLabel: "Iran National Animal: The Asiatic Cheetah",
        query: "national animal of iran",
        actionType: "edit_meta",
        actionTone: "clicks",
        topQueryPosition: 4.1,
        topQueryImpressions90d: 900,
        topQueryClicks90d: 0,
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("flagged");
    expect(out[0].qualityNote).toBe(ZERO_CLICK_TRAP_REASON);
    expect(out[0].decision).toBe("watch");
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
        topQueryClicks90d: 20, // ~3.3% CTR - healthy, nothing structurally unclickable here
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
    expect(out[0].decision).toBe("edit_existing");
    expect(out[0].status).toBe("ready");
  });

  it("low impressions on a strong position never trips the trap (not material yet, stays honest)", () => {
    const moves = [
      mv({
        id: "m1",
        targetUrl: "https://s.com/small-page",
        query: "small page topic",
        pageLabel: "Small Page Topic",
        actionTone: "clicks",
        topQueryPosition: 2,
        topQueryImpressions90d: 50, // below the material threshold
        topQueryClicks90d: 0,
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
  });

  it("a citation add_answer_block on a trapped page also decides watch, with the general reason (blind-benchmark defect)", () => {
    // The blind holdout benchmark failed here: /iran-flags... rode in as an act-now
    // add_answer_block ("Win AI citations") because the trap only gated clicks-tone moves.
    // A trapped page cannot earn clicks under ANY lever, so a citation edit is held too, with
    // the lever-appropriate sentence (the title-change wording would not fit an answer block).
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
    expect(out[0].status).toBe("suggested");
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
    expect(out[0].decision).toBe("edit_existing");
    expect(out[0].status).toBe("ready");
  });

  it("the flag-history fixture (pos 3.3, 33,119 impressions, 0.13% CTR) as an act-now add_answer_block demotes to watching", () => {
    // The exact blind-benchmark page: position 3.3, 33,119 impressions/90d, ~0.13% CTR, pitched
    // as "Win AI citations" with a huge impressions-derived impact score. It must NOT survive as
    // an act-now card; it is held in watching with the general trap sentence.
    const moves = [
      mv({
        id: "flag-history",
        targetUrl: "https://s.com/iran-flags/iran-islamic-republic-flag-history",
        pageLabel: "Iran Islamic Republic Flag History",
        query: "iran flag history",
        actionType: "add_answer_block",
        actionTone: "citation",
        preparedReady: true,
        score: 44434,
        demand: 28800,
        topQueryPosition: 3.3,
        topQueryImpressions90d: 33119,
        topQueryClicks90d: 43, // 43 / 33119 = 0.13% CTR
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("flagged");
    expect(out[0].qualityNote).toBe(ZERO_CLICK_TRAP_REASON_GENERAL);
    expect(out[0].decision).toBe("watch");
    expect(out[0].status).toBe("suggested"); // demoted off ready, never deleted
  });

  it("a trapped page cannot occupy an act-now top-3 slot even with the biggest impact score", () => {
    // Mirrors the real board: rank balanced, then keep only the act-decisions (edit/consolidate/
    // create/prune) the way the /changes actionable queue does. The trapped page carries the
    // highest impact score of all, yet must be absent from the act-now ranks.
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

  it("a healthy citation page with good CTR still ranks act-now (regression - the guard is targeted)", () => {
    const moves = [
      mv({
        id: "healthy",
        targetUrl: "https://s.com/nowruz-guide",
        pageLabel: "Nowruz Guide",
        query: "nowruz guide",
        actionType: "add_answer_block",
        actionTone: "citation",
        preparedReady: true,
        topQueryPosition: 6,
        topQueryImpressions90d: 2000,
        topQueryClicks90d: 120, // 6% CTR - clickable, nothing trapped
      }),
    ];
    const out = buildCanonicalChanges({ tenantId: "t", moves, plan: null, reservations: [] });
    expect(out[0].qualityDecision).toBe("approved");
    expect(isActDecision(out[0].decision)).toBe(true);
  });

  it("trap boundaries: exactly-at-threshold values stay honest, just-over trips the trap", () => {
    // position exactly 5, impressions exactly 500, CTR exactly 0.2% (1/500) - the thresholds are
    // strict (pos <= 5, impr >= 500, ctr < 0.2%), so CTR AT 0.2% is NOT a trap.
    // query + pageLabel match so the off-topic relevance check never fires; the trap is the only
    // thing under test here.
    const edge = (over: Partial<CanonicalMoveInput>): CanonicalMoveInput =>
      mv({ id: "edge", targetUrl: "https://s.com/edge-topic", query: "edge topic", pageLabel: "Edge Topic", actionTone: "citation", actionType: "add_answer_block", ...over });
    const atCtrFloor = buildCanonicalChanges({
      tenantId: "t",
      moves: [edge({ topQueryPosition: 5, topQueryImpressions90d: 500, topQueryClicks90d: 1 })],
      plan: null,
      reservations: [],
    });
    expect(atCtrFloor[0].qualityDecision).toBe("approved"); // ctr 0.2% is not < 0.2%
    // Nudge CTR just below the floor (0 clicks) at the same strong position + material impressions.
    const belowCtrFloor = buildCanonicalChanges({
      tenantId: "t",
      moves: [edge({ topQueryPosition: 5, topQueryImpressions90d: 500, topQueryClicks90d: 0 })],
      plan: null,
      reservations: [],
    });
    expect(belowCtrFloor[0].qualityDecision).toBe("flagged");
    expect(belowCtrFloor[0].decision).toBe("watch");
    // position 5.1 (just past the strong-position bar) is never a trap, however low the CTR.
    const pastPosition = buildCanonicalChanges({
      tenantId: "t",
      moves: [edge({ topQueryPosition: 5.1, topQueryImpressions90d: 5000, topQueryClicks90d: 0 })],
      plan: null,
      reservations: [],
    });
    expect(pastPosition[0].qualityDecision).toBe("approved");
  });

  it("two tenants: the SAME trap query on each tenant's own page decides watch independently, no bleed", () => {
    const trapMove = (tenantSuffix: string): CanonicalMoveInput =>
      mv({
        id: `m-${tenantSuffix}`,
        targetUrl: `https://${tenantSuffix}.com/iran-flags`,
        query: "iran flag",
        pageLabel: "Iran Flag",
        actionTone: "clicks",
        topQueryPosition: 2.8,
        topQueryImpressions90d: 5567,
        topQueryClicks90d: 0,
      });
    const outA = buildCanonicalChanges({ tenantId: "tenant-a", moves: [trapMove("tenant-a")], plan: null, reservations: [] });
    const outB = buildCanonicalChanges({ tenantId: "tenant-b", moves: [trapMove("tenant-b")], plan: null, reservations: [] });
    expect(outA[0].qualityNote).toBe(ZERO_CLICK_TRAP_REASON);
    expect(outB[0].qualityNote).toBe(ZERO_CLICK_TRAP_REASON);
    expect(outA[0].decision).toBe("watch");
    expect(outB[0].decision).toBe("watch");
    expect(outA[0].tenantId).toBe("tenant-a");
    expect(outB[0].tenantId).toBe("tenant-b");
  });
});

describe("strategy ranking + goal filters", () => {
  const changes = buildCanonicalChanges({
    tenantId: "t", plan: null, reservations: [],
    moves: [
      // B1 fix: a bare suggestion has no comparison data yet, so it is directional, not strong.
      // "mature" is the one move here with a REAL settled proof (real comparison data) behind it.
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
  it("goal filters: new_pages + quick_wins", () => {
    expect(changes.filter((c) => goalMatches(c, "new_pages")).every((c) => c.changeFamily === "new_page")).toBe(true);
    expect(changes.filter((c) => goalMatches(c, "quick_wins")).every((c) => c.estimatedEffortMinutes <= 3 && c.changeFamily !== "new_page")).toBe(true);
  });
  it("statusCounts buckets by view", () => {
    const counts = statusCounts(changes);
    expect(counts.todo).toBeGreaterThanOrEqual(1); // blocked + suggested live in To do
  });
});

/**
 * G8 (Wave 4, 2026-07-11) - honest impact ranges on THIN history, end to end through
 * buildCanonicalChanges. The singers-shaped fixture: /famous-iranian-singers ranks position 24
 * (deep tail, industry-default expected CTR 0.6 percent) earning 0.76 percent CTR on 4,765
 * monthly impressions - opportunity-math.ts's own industry-curve comparison sees NO gap (0.76 >
 * 0.6) and abstains ("already earns close to what its position typically gets"). But 5 of the
 * tenant's OWN sibling list pages, ranking within +/-3 positions, earn 2.0 to 5.9 percent CTR -
 * sibling-ctr-basis.ts's own conservative (p25-to-median) band sizes a defensible +85 to +200
 * clicks/mo range from that, without touching the primary abstention or any ranking field.
 */
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

describe("G8: sibling-ctr-basis wiring (build-canonical-changes)", () => {
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
    expect(singers.siblingBasis).toContain("2.5 to 5 percent of views as clicks");
    expect(singers.siblingBasis).toContain("this page earns 0.8 percent on 4,765 views a month");
    expect(singers.siblingBasis).not.toMatch(/[\u2013\u2014]/);
  });

  it("never touches the primary opportunity fields or ranking math - display + decision support only", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t", plan: null, reservations: [],
      moves: [singersTarget(), ...SINGERS_SIBLINGS],
    });
    const singers = changes.find((c) => c.id.includes("famous-iranian-singers"))!;
    // Still abstains on the PRIMARY forecast (opportunity-math never sees siblings) - the
    // ranking-linked fields (expectedOutcomeLow/upside/impactScore) are byte-identical to the
    // no-siblings case above.
    expect(singers.expectedOutcomeLow).toBeNull();
    expect(singers.upside).toBeNull();
    expect(singers.impactScore).toBe(300); // m.score, untouched by the sibling gate
  });

  it("fewer than 3 qualifying siblings -> siblingBasis stays null, abstention completely unchanged", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t", plan: null, reservations: [],
      moves: [singersTarget(), ...SINGERS_SIBLINGS.slice(0, 2)],
    });
    const singers = changes.find((c) => c.id.includes("famous-iranian-singers"))!;
    expect(singers.siblingBasis).toBeNull();
    expect(singers.siblingLowPerMonth).toBeNull();
    expect(singers.siblingHighPerMonth).toBeNull();
    expect(singers.expectedOutcome).toContain("already earns close to what its position typically gets");
  });

  it("a page already ahead of its own siblings gets no negative promise - honest 'already ahead' text", () => {
    const changes = buildCanonicalChanges({
      tenantId: "t", plan: null, reservations: [],
      moves: [singersTarget({ id: "singers-ahead", targetUrl: "https://s.com/famous-iranian-singers-ahead", topQueryClicks90d: 0.06 * 4765 * 3 }), ...SINGERS_SIBLINGS],
    });
    const c = changes.find((x) => x.id.includes("famous-iranian-singers-ahead"))!;
    expect(c.siblingLowPerMonth).toBeNull();
    expect(c.siblingHighPerMonth).toBeNull();
    expect(c.siblingBasis).toContain("already ahead of similar pages");
  });

  it("two-tenant isolation: a tenant's sibling pool never crosses into another tenant's computation", () => {
    // Tenant "poor" has only the target (no rich siblings of its own) - even though a
    // structurally identical "rich" tenant exists elsewhere, each buildCanonicalChanges call is
    // scoped to exactly one tenantId's own moves, so "poor" must still abstain.
    const poorChanges = buildCanonicalChanges({ tenantId: "poor", plan: null, reservations: [], moves: [singersTarget()] });
    const richChanges = buildCanonicalChanges({
      tenantId: "rich", plan: null, reservations: [],
      moves: [singersTarget(), ...SINGERS_SIBLINGS],
    });
    const poorSingers = poorChanges.find((c) => c.id.includes("famous-iranian-singers"))!;
    const richSingers = richChanges.find((c) => c.id.includes("famous-iranian-singers"))!;
    expect(poorSingers.siblingBasis).toBeNull();
    expect(richSingers.siblingBasis).not.toBeNull();
    expect(richSingers.tenantId).toBe("rich");
    expect(poorSingers.tenantId).toBe("poor");
  });
});
