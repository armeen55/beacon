/**
 * /changes default-board payload budget (W2-B, 2026-07-10).
 *
 * The default board used to serialize EVERY row's full TodayMove dossier (research
 * pack, roundtable debate, prepared draft text, teardown gaps, query tables) into
 * the RSC/hydration payload. toClientView now ships ONLY the SlimTodayMove fields
 * the collapsed list renders; the full dossier loads on demand when detail opens.
 *
 * Pins:
 *   1. STRUCTURAL: a slim move contains EXACTLY the allowed keys - a new dossier
 *      field can never silently ride back onto the default payload.
 *   2. BUDGET: on a realistic 30-row fixture, the serialized slim movesById stays
 *      under the stated budget (60 KB) AND under 15 percent of the full-dossier
 *      serialization it replaced.
 *   3. Everything else on the view (the ranked changes, counts, receipt line) is
 *      passed through untouched.
 *
 * Wave 3C RE-BASELINE (2026-07-10): SLIM_MOVE_KEYS gained `demand` + `demandBasis`,
 * the two small scalars the collapsed decision card's "why now" line reads. Measured
 * serialized slim movesById for the 30-row heavy fixture: 36,181 -> 37,201 bytes
 * (+1,020, ~2.8%). Still far under the 60 KB budget and under 15 percent of the full
 * dossiers, so the budget constant is unchanged.
 */
import { describe, expect, it } from "vitest";

import {
  SLIM_MOVE_KEYS,
  selectRankedPreparationEntries,
  slimMoveForList,
  toClientView,
  type ChangesView,
} from "@/app/(shell)/changes-data";
import type { TodayMove } from "@/app/(shell)/today-moves-data";
import type { UnifiedEntry } from "@/domains/allocator/unified-list";
import type { CanonicalChange } from "@/domains/changes/canonical-change";

/** A realistic heavy TodayMove: sized like a prepared, teardown-backed move. */
function heavyMove(i: number): TodayMove {
  const para = (n: number) =>
    Array.from({ length: n }, (_, k) => `Sentence ${k} of a realistic dossier paragraph with detail about the page and its competitors.`).join(" ");
  return {
    id: `move-${i}`,
    action: "add_answer_block",
    actionLabel: "Add a direct answer",
    actionTone: "citation",
    query: `best example query number ${i}`,
    targetUrl: `https://site.com/page-${i}`,
    pageLabel: `page-${i}`,
    why: `This page ranks 8th for a query with real demand, example ${i}.`,
    proof: para(2),
    confidence: "medium",
    demand: 1200,
    demandBasis: "gsc",
    whoCited: "competitor.com",
    whatWins: para(3),
    competitorSteal: para(4),
    yourGap: para(3),
    topQueries: Array.from({ length: 25 }, (_, k) => ({
      query: `long tail query variant ${k} for page ${i}`,
      clicks: k,
      impressions: k * 40,
      position: 9.5,
      ctr: 0.02,
    })),
    declines: [],
    sparkline: Array.from({ length: 28 }, (_, k) => ({ date: `2026-06-${String(k + 1).padStart(2, "0")}`, clicks: k % 7 })),
    cannibalization: [],
    ga4: { sessions: 100, conversions: 2 },
    friction: null,
    looselyMatched: false,
    also: ["another query", "and another"],
    outline: Array.from({ length: 8 }, (_, k) => `Section heading ${k}`),
    answerBrief: para(4),
    draftTitle: `A strong drafted title for page ${i}`,
    draftMeta: para(1),
    faqs: Array.from({ length: 6 }, (_, k) => `Frequently asked question number ${k}?`),
    schema: ["FAQPage"],
    titleVariants: Array.from({ length: 4 }, (_, k) => ({ title: `Variant ${k}`, score: k, signals: ["demand", "format"] })),
    rankWhy: `Ranked ${i} because demand is real and the fix is cheap.`,
    score: 1000 - i,
    savedAnswerBlock: para(5),
    savedFaqJsonLd: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: Array.from({ length: 5 }, (_, k) => ({ q: `q${k}`, a: para(1) })) }),
    specialists: ["demand", "competitor", "measurement"],
    debate: { agreements: [para(1)], disagreements: [para(1)], verdict: para(1) },
    routerAction: "add_answer_block",
    routerRationale: para(2),
    routerConfidence: "high",
    preparedStatus: "ready",
    preparedChecklist: {
      googleChecked: true,
      aiChecked: true,
      competitorsRead: true,
      draftPrepared: true,
      proofPlanReady: true,
      readyToReview: true,
    },
    preparedDraftKind: "answer_block",
    preparedDraftText: para(12),
    preparedExperiment: para(2),
    preparedStale: false,
    preparedQuality: null,
  } as unknown as TodayMove;
}

function viewWith(moves: TodayMove[]): ChangesView {
  const movesById: Record<string, TodayMove> = {};
  for (const m of moves) movesById[m.id] = m;
  return {
    changes: moves.map((m, i) => ({ id: `c-${i}`, sourceIds: [m.id] }) as never),
    movesById,
    summary: { todo: moves.length, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false,
    planAccepted: false,
    readyZeroHint: null,
    measuringCountCanonical: 3,
    decidedCountCanonical: 2,
    suppressedRowsNote: null,
    expiredSubline: null,
    receiptLine: "I ranked these from your Search Console demand data just now.",
    readyCount: 0,
    shippedThisWeekCount: 1,
    watching: [],
  };
}

/** The stated budget for the default board's serialized move summaries (30 rows). */
const SLIM_MOVES_BUDGET_BYTES = 60_000;

describe("/changes payload budget", () => {
  it("a slim move carries EXACTLY the allowed collapsed-list keys (structural pin)", () => {
    const slim = slimMoveForList(heavyMove(1));
    expect(Object.keys(slim).sort()).toEqual([...SLIM_MOVE_KEYS].sort());
    // None of the heavy dossier fields survive.
    const s = slim as unknown as Record<string, unknown>;
    for (const heavy of ["preparedDraftText", "debate", "topQueries", "savedAnswerBlock", "whatWins", "competitorSteal", "titleVariants", "answerBrief"]) {
      expect(s[heavy]).toBeUndefined();
    }
  });

  it("30 rows: serialized slim movesById stays under the stated budget and under 15 percent of the full dossiers", () => {
    const moves = Array.from({ length: 30 }, (_, i) => heavyMove(i));
    const view = viewWith(moves);
    const fullBytes = Buffer.byteLength(JSON.stringify(view.movesById), "utf8");
    const client = toClientView(view);
    const slimBytes = Buffer.byteLength(JSON.stringify(client.movesById), "utf8");

    expect(slimBytes).toBeLessThanOrEqual(SLIM_MOVES_BUDGET_BYTES);
    expect(slimBytes).toBeLessThanOrEqual(fullBytes * 0.15);
    // Sanity: the fixture is actually heavy, so the comparison means something.
    expect(fullBytes).toBeGreaterThan(200_000);
  });

  it("passes every non-move field through untouched (same ranked list, same counts)", () => {
    const view = viewWith([heavyMove(1)]);
    const client = toClientView(view);
    expect(client.changes).toBe(view.changes);
    expect(client.summary).toBe(view.summary);
    expect(client.receiptLine).toBe(view.receiptLine);
    expect(client.measuringCountCanonical).toBe(view.measuringCountCanonical);
    // The slim entry still keys by the same id and keeps the action fields the
    // row buttons (done/skip) need.
    expect(client.movesById["move-1"]?.id).toBe("move-1");
    expect(client.movesById["move-1"]?.targetUrl).toBe("https://site.com/page-1");
    expect(client.movesById["move-1"]?.action).toBe("add_answer_block");
  });

  it("never serializes the server-only ranked preparation handoff", () => {
    const view = viewWith([heavyMove(1)]);
    view.rankedPreparationEntries = [{ id: "secret-server-entry" }] as never;
    const client = toClientView(view) as unknown as Record<string, unknown>;
    expect(client.rankedPreparationEntries).toBeUndefined();
    expect(JSON.stringify(client)).not.toContain("secret-server-entry");
  });
});

describe("selectRankedPreparationEntries", () => {
  const entry = (id: string, sourceId: string | null, held = false): UnifiedEntry => ({
    id,
    query: `${id} query`,
    kind: "edit",
    page: `/${id}`,
    topic: null,
    pageLabel: id,
    exactWhat: `Improve ${id}`,
    expectedValue: { low: 1, high: 2, basis: "real evidence", days: 28, hypothesisId: null },
    confidence: 0.6,
    risk: "low",
    riskFlags: [],
    effortMinutes: 3,
    sources: [sourceId ? "worklist" : "keyword_library"],
    forecastBasis: "real evidence",
    hold: { held, reason: held ? "wait" : null },
    sourceChange: sourceId ? ({ id: sourceId } as CanonicalChange) : null,
    competitorUrls: [],
    fanoutSeeds: [],
    demandEvidence: { gscMonthly: 300, searchVolumeMonthly: null },
  });

  it("follows the final Changes order, excludes non-actionable rows, and strips sourceChange", () => {
    const changes = [
      { id: "allocator-b", status: "suggested" },
      { id: "worklist-a", status: "ready" },
      { id: "allocator-held", status: "suggested" },
      { id: "allocator-measuring", status: "measuring" },
    ] as CanonicalChange[];
    const ranked = selectRankedPreparationEntries(changes, [
      entry("worklist-entry", "worklist-a"),
      entry("allocator-b", null),
      entry("allocator-held", null, true),
      entry("allocator-measuring", null),
    ]);

    expect(ranked.map((row) => row.id)).toEqual(["allocator-b", "worklist-entry"]);
    expect(ranked.map((row) => row.rank)).toEqual([0, 1]);
    expect(ranked.every((row) => !("sourceChange" in row))).toBe(true);
  });
});
