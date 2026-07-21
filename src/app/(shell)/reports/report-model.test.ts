import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
// Fail-closed calibration quarantine (2026-07-11): report fixtures are CALIBRATED so
// the monthly headline + win cards pin calibrated behavior. An uncalibrated win
// would leave the Wins band empty (gated splitLedgerLifecycle).
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  computeCumulativeOutcome,
} from "@/domains/proof-gsc/cumulative-outcome";
import { countLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import {
  buildReportModel,
  buildWinCards,
  monthlyHeadline,
  missesOwnedLine,
  pageNameFromPath,
  winHeadline,
} from "./report-model";

/**
 * report-model tests (P23) - the reports pack composes existing data, so the
 * headline contract this file pins is COUNT AGREEMENT: the numbers /reports
 * prints are byte-identical to what the canonical /results resolvers
 * (computeCumulativeOutcome + countLedgerLifecycle) return for the same ledger.
 * Plus the win-card shaping + the Beacon-voice copy (no dashes, no lab words).
 */

// A fixed "now" so every window-close calculation is deterministic.
const NOW = new Date("2026-07-03T00:00:00Z");

/** A mature WON row: a closed 28-day window that ran with >= 2 controls and
 *  >= 200 baseline impressions, verdict "won", carrying a measured adjustedLift. */
function wonRow(
  id: string,
  path: string,
  actionType: string,
  adjustedLift: number,
  shippedAt = "2026-05-20",
): ShippedChangeRecord {
  return {
    id,
    path,
    actionType,
    shippedAt,
    verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION,
    baseline: { impressions: 5_000 },
    windows: [{ day: 28, ran: true, controlsUsed: 3, adjustedLift }],
  } as unknown as ShippedChangeRecord;
}

/** A mature LOST row (mature, verdict "lost"): counts as decided-not-won. */
function lostRow(id: string, path: string, shippedAt = "2026-05-20"): ShippedChangeRecord {
  return {
    id,
    path,
    actionType: "edit_meta",
    shippedAt,
    verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION,
    baseline: { impressions: 5_000 },
    windows: [{ day: 28, ran: true, controlsUsed: 3, adjustedLift: -4 }],
    // proven-neutral so it also surfaces in the misses recap
    equivalence: { provenNeutral: true, sentence: "the full read showed the effect was too small to matter." },
  } as unknown as ShippedChangeRecord;
}

/** A still-measuring row: shipped recently, no closed 28-day window. */
function measuringRow(id: string, path: string, shippedAt = "2026-06-28"): ShippedChangeRecord {
  return {
    id,
    path,
    actionType: "add_answer_block",
    shippedAt,
    verdict: "pending",
    baseline: { impressions: 5_000 },
    windows: [{ day: 7, ran: true, controlsUsed: 3, adjustedLift: 2 }],
  } as unknown as ShippedChangeRecord;
}

describe("report-model: count agreement with the canonical /results resolvers", () => {
  const ledger = [
    wonRow("w1", "/persian-comedians", "edit_title", 35),
    wonRow("w2", "/persian-actors", "edit_meta", 12),
    lostRow("l1", "/persian-singers"),
    measuringRow("m1", "/persian-poets"),
    measuringRow("m2", "/persian-chefs"),
  ];

  it("shipped / won / measuring / decided match computeCumulativeOutcome exactly", () => {
    const model = buildReportModel({ ledger, computedAt: NOW.toISOString(), now: NOW });
    const outcome = computeCumulativeOutcome(ledger, NOW)!;
    expect(model.outcome).toEqual(outcome);
    expect(model.shipped).toBe(outcome.shipped);
    expect(model.outcome!.won).toBe(outcome.won);
    expect(model.outcome!.measuring).toBe(outcome.measuring);
    expect(model.outcome!.decided).toBe(outcome.decided);
  });

  it("won / measuring / decided match countLedgerLifecycle (THE ONE-COUNT RULE)", () => {
    const model = buildReportModel({ ledger, computedAt: NOW.toISOString(), now: NOW });
    const counts = countLedgerLifecycle(ledger, NOW);
    expect(model.outcome!.won).toBe(counts.won);
    expect(model.outcome!.measuring).toBe(counts.measuring);
    expect(model.outcome!.decided).toBe(counts.decided);
    // Sanity: this fixture yields 2 wins, 2 measuring, 3 decided-vs... let it be data-driven.
    expect(counts.won).toBe(2);
    expect(counts.measuring).toBe(2);
    expect(counts.decided).toBe(3); // 2 won + 1 lost
  });

  it("total clicks-a-month equals the shared winClicksPerMonth (not re-derived)", () => {
    const model = buildReportModel({ ledger, computedAt: NOW.toISOString(), now: NOW });
    const outcome = computeCumulativeOutcome(ledger, NOW)!;
    // The displayed total IS the canonical figure (single rounded sum), so it
    // can never contradict /results.
    expect(model.totalClicksPerMonth).toBe(outcome.winClicksPerMonth);
    // The per-card figures are individually-rounded honest numbers; their sum
    // matches the canonical total to within rounding (each card rounds once).
    const sumOfCards = model.wins.reduce((s, w) => s + w.clicksPerMonth, 0);
    expect(Math.abs(sumOfCards - outcome.winClicksPerMonth)).toBeLessThanOrEqual(model.wins.length);
  });
});

describe("report-model: win cards", () => {
  const ledger = [
    wonRow("w1", "/persian-comedians", "edit_title", 35),
    wonRow("w2", "/persian-actors", "edit_meta", 12),
  ];

  it("shapes each win biggest first with a plain page name and change kind", () => {
    const cards = buildWinCards(ledger, NOW);
    expect(cards.map((c) => c.id)).toEqual(["w1", "w2"]); // biggest clicks first
    expect(cards[0].pageName).toBe("persian comedians page");
    expect(cards[0].changeKind).toBe("title rewrite");
    expect(cards[0].windowDays).toBe(28);
    expect(cards[0].clicksPerMonth).toBeGreaterThan(0);
  });

  it("leaves off a won row with no measured clicks delta (nothing to celebrate)", () => {
    const noLift = wonRow("w0", "/no-number", "edit_title", 0);
    delete (noLift.windows[0] as { adjustedLift?: number }).adjustedLift;
    const cards = buildWinCards([noLift], NOW);
    expect(cards).toEqual([]);
  });

  it("builds a screenshot-ready headline with a concrete number and no dashes", () => {
    const line = winHeadline({
      pageName: "persian comedians page",
      changeKind: "title rewrite",
      clicksPerMonth: 38,
      windowDays: 28,
    });
    expect(line).toContain("+38 clicks a month");
    expect(line).toContain("measured over 28 days");
    expect(line).not.toMatch(/[–—]/);
  });

  it("pageNameFromPath never echoes a raw slug", () => {
    expect(pageNameFromPath("/persian-female-first-names")).toBe("persian female first names page");
    expect(pageNameFromPath("/")).toBe("This page");
  });
});

describe("report-model: win-card dollar lines route through THE ONE DOLLAR RULE", () => {
  const revenueModel = { kind: "per_lead" as const, dollarsPerLead: 10 };
  /** A mature won row carrying a priced dollarValue, so a CLEAN win yields a dollar
   *  line. `contaminated` sets the weak-comparison veto the cumulative dollar figures
   *  already exclude on. */
  function pricedWonRow(over: { controlMatchWeak?: boolean; shippedAt?: string } = {}): ShippedChangeRecord {
    return {
      ...wonRow("w-money", "/persian-comedians", "edit_title", 35, over.shippedAt ?? "2026-05-20"),
      dollarValue: { usdPerMonth: 420 },
      controlMatchWeak: over.controlMatchWeak ?? false,
    } as unknown as ShippedChangeRecord;
  }

  it("shows the grounded dollar line for a CLEAN win with a usable rate", () => {
    const [card] = buildWinCards([pricedWonRow()], NOW, revenueModel, []);
    expect(card.dollarLine).toContain("This change earned about $420 a month");
    expect(card.dollarPrompt).toBeNull();
  });

  it("suppresses the dollar line AND the connect-prompt for a weak-comparison win (matches Today/Results exclusion)", () => {
    const [card] = buildWinCards([pricedWonRow({ controlMatchWeak: true })], NOW, revenueModel, []);
    // Today and Results exclude this win from every cumulative dollar figure; the
    // /reports card must not claim it earned money, and must not falsely prompt to
    // "connect revenue" the operator already configured.
    expect(card.dollarLine).toBeNull();
    expect(card.dollarPrompt).toBeNull();
    // The clicks win still stands.
    expect(card.clicksPerMonth).toBeGreaterThan(0);
  });

  it("suppresses the dollar line for a win whose measurement window overlaps a Google shock", () => {
    const shock = [{ id: "s1", start: "2026-05-25", end: "2026-06-10", kind: "confirmed" as const, label: "a Google core update" }];
    const [card] = buildWinCards([pricedWonRow()], NOW, revenueModel, shock);
    expect(card.dollarLine).toBeNull();
    expect(card.dollarPrompt).toBeNull();
  });

  it("still prompts a CLEAN win that has no usable rate (nothing to hide, real ask)", () => {
    const [card] = buildWinCards([pricedWonRow()], NOW, null, []);
    expect(card.dollarLine).toBeNull();
    expect(card.dollarPrompt).toContain("Connect revenue");
  });
});

describe("report-model: monthly headline + misses (Beacon voice)", () => {
  it("headline states shipped-this-month and the honest scoreboard", () => {
    const ledger = [
      wonRow("w1", "/a", "edit_title", 35, "2026-06-25"),
      lostRow("l1", "/b", "2026-06-25"),
      measuringRow("m1", "/c", "2026-06-28"),
    ];
    const model = buildReportModel({ ledger, computedAt: NOW.toISOString(), now: NOW });
    const line = monthlyHeadline(model)!;
    expect(line).toContain("This month I shipped 3 changes.");
    expect(line).toContain("1 won");
    expect(line).toContain("1 is still measuring");
    expect(line).toContain("1 did not move the needle");
    expect(line).not.toMatch(/[–—]/);
    expect(line).not.toMatch(/\b(experiment|control|baseline|treatment|reservation)s?\b/i);
  });

  it("misses line owns the count plainly and matches the recap items", () => {
    const ledger = [lostRow("l1", "/b"), lostRow("l2", "/c")];
    const model = buildReportModel({ ledger, computedAt: NOW.toISOString(), now: NOW });
    expect(model.misses.length).toBe(2);
    const line = missesOwnedLine(model)!;
    expect(line).toBe("2 changes did not move the needle. Here is what we learned.");
  });

  it("headline is null when nothing has ever shipped (page shows its empty state)", () => {
    const model = buildReportModel({ ledger: [], computedAt: NOW.toISOString(), now: NOW });
    expect(model.outcome).toBeNull();
    expect(monthlyHeadline(model)).toBeNull();
    expect(missesOwnedLine(model)).toBeNull();
    expect(model.wins).toEqual([]);
    expect(model.biggestWin).toBeNull();
  });
});
