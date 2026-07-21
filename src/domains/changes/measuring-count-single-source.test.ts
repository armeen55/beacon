/**
 * measuring-count-single-source (Wave 3A D5 pin, 2026-07-10) - THE contradiction pin for the
 * "25 vs 6" class of bug. From ONE ledger fixture, every Lane A count consumer must report the
 * SAME measuring number as the canonical countLedgerLifecycle, and no rewritten offender may
 * still derive a displayed count from the raw stored verdict string.
 *
 * Correct consumers already threaded off countLedgerLifecycle (MeasuringSection, TodayCounts,
 * ResultsHeaderStrip, changes measuringCountCanonical) are pinned by their own suites; this file
 * pins the offenders Lane A rewrote (scoreboard, daily-experiment dashboard) plus a static guard
 * over every file the spec named.
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { countLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import { buildScoreboard, type ScoreboardDay, type ScoreboardLedgerRow } from "@/domains/scoreboard/scoreboard";
import { buildDailyExperimentDashboard } from "@/domains/experiments/daily-experiment-dashboard";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-02T12:00:00Z");

type WFix = { day: number; ran: boolean; controlsUsed?: number };
const OPEN: WFix[] = [
  { day: 7, ran: false },
  { day: 14, ran: false },
  { day: 28, ran: false },
];
const MATURE: WFix[] = [
  { day: 7, ran: true, controlsUsed: 3 },
  { day: 14, ran: true, controlsUsed: 3 },
  { day: 28, ran: true, controlsUsed: 3 },
];

function ledgerRow(id: string, verdict: string, windows: WFix[]): ScoreboardLedgerRow {
  return {
    id,
    path: `/${id}`,
    shippedAt: "2026-05-01T00:00:00.000Z",
    verdict,
    actionType: "edit_title",
    windows,
    baseline: { impressions: 1000 },
    // Fail-closed calibration quarantine (2026-07-11): CALIBRATED so the single-
    // source count fixture still reads its mature win/loss as decided (the point
    // of this pin is that every Lane A consumer agrees, not the quarantine itself).
    calibrationVersion: TEST_CALIBRATED_VERSION,
  };
}

// Registered at module-eval time (not beforeAll) because CANONICAL_MEASURING below
// is derived at import time and must see the calibrated fixtures as decided.
registerTestCalibratedVersion();
afterAll(clearTestCalibratedVersions);

// ONE fixture, exercised by every consumer below.
// measuring = 2 open + 1 early-win (7d only) + 1 inconclusive-mature = 4
// decided   = 1 mature win + 1 mature loss = 2 ; won = 1
const LEDGER: ScoreboardLedgerRow[] = [
  ledgerRow("m1", "measuring", OPEN),
  ledgerRow("m2", "measuring", OPEN),
  ledgerRow("early", "won", [{ day: 7, ran: true, controlsUsed: 3 }]),
  ledgerRow("inconclusive", "inconclusive", MATURE),
  ledgerRow("win", "won", MATURE),
  ledgerRow("loss", "lost", MATURE),
];

const CANONICAL_MEASURING = countLedgerLifecycle(LEDGER, NOW).measuring;

function days28(): ScoreboardDay[] {
  const start = Date.parse("2026-06-04");
  return Array.from({ length: 28 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    clicks: 10,
    impressions: 200,
  }));
}

describe("measuring count - one source, every Lane A consumer agrees", () => {
  it("the canonical count is 4 (open + early-win + inconclusive), not the 2 raw 'measuring' verdicts", () => {
    expect(CANONICAL_MEASURING).toBe(4);
    // The old raw-verdict filter would have said 2 - the exact FP3 contradiction.
    expect(LEDGER.filter((r) => r.verdict === "measuring")).toHaveLength(2);
  });

  it("scoreboard.measuringCount == countLedgerLifecycle.measuring", () => {
    const s = buildScoreboard(days28(), LEDGER, NOW)!;
    expect(s.measuringCount).toBe(CANONICAL_MEASURING);
  });

  it("daily-experiment dashboard experimentCount == countLedgerLifecycle.measuring", () => {
    const dash = buildDailyExperimentDashboard({
      ledger: LEDGER as unknown as ShippedChangeRecord[],
      now: NOW,
    });
    expect(dash.activeProofBatch?.experimentCount).toBe(CANONICAL_MEASURING);
  });
});

describe("static guard - no displayed count derives from the raw verdict string", () => {
  const noRawMeasuring = [
    "src/domains/scoreboard/scoreboard.ts",
    "src/domains/experiments/daily-experiment-dashboard.ts",
  ];
  for (const rel of noRawMeasuring) {
    it(`${rel} contains no verdict === "measuring"`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src.includes('verdict === "measuring"')).toBe(false);
      expect(src.includes('verdict==="measuring"')).toBe(false);
    });
  }

  it('today-moves-data.ts:526 no longer counts measuring off a raw maturity filter', () => {
    const src = readFileSync(join(process.cwd(), "src/app/(shell)/today-moves-data.ts"), "utf8");
    expect(src.includes('filter((p) => p.maturity !== "mature_result").length')).toBe(false);
  });
});

describe("two-tenant isolation - the count is a pure function of the rows passed", () => {
  it("a second tenant's larger ledger never bleeds into the first's count", () => {
    const tenantA = LEDGER;
    const tenantB = [...LEDGER, ledgerRow("b-extra", "measuring", OPEN), ledgerRow("b-extra2", "measuring", OPEN)];
    expect(countLedgerLifecycle(tenantA, NOW).measuring).toBe(4);
    expect(countLedgerLifecycle(tenantB, NOW).measuring).toBe(6);
    expect(buildScoreboard(days28(), tenantA, NOW)!.measuringCount).toBe(4);
    expect(buildScoreboard(days28(), tenantB, NOW)!.measuringCount).toBe(6);
  });
});
