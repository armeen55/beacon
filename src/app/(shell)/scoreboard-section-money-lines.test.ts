/**
 * Items 40 + 41 (2026-07-02) - surface pins for the lifetime-earnings odometer
 * and the portfolio counterfactual on the Today scoreboard block. Exercises
 * scoreboard-section.tsx's exported row-builders (the eligibility gate,
 * mirroring load-experiment-outcomes.ts) against synthetic ShippedChangeRecord
 * fixtures, then feeds the rows through the pure aggregators
 * (lifetime-earnings.ts / portfolio-counterfactual.ts, already pinned on
 * their own math in tests/domains/proof-gsc/) to confirm the end-to-end wire
 * produces the right sentence, and self-hides on the documented degrade
 * paths. Ship date fixed to 2026-04-15 (28-day window closes 2026-05-13),
 * clear of the real confirmed Google-update ranges baked into
 * algorithm-weather.ts, so a clean fixture never accidentally weather-
 * quarantines (same convention compute-scoreboard.test.ts uses).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
// Fail-closed calibration quarantine (2026-07-11): the money-surface fixtures are
// CALIBRATED so these pin that a calibrated win still produces its dollar/
// counterfactual row. An uncalibrated win produces no dollar claim (proven by
// won-dollar-rule.test.ts and the gated splitLedgerLifecycle it rides).
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

import { buildLifetimeEarningsRows, buildCounterfactualRows } from "./scoreboard-section";
import { computeLifetimeEarnings } from "@/domains/proof-gsc/lifetime-earnings";
import { computePortfolioCounterfactual } from "@/domains/proof-gsc/portfolio-counterfactual";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { TrafficOutcome } from "@/domains/proof-gsc/traffic-outcome";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function win28(over: Partial<ShippedChangeRecord["windows"][number]> = {}): ShippedChangeRecord["windows"][number] {
  return {
    day: 28,
    checkOn: "2026-05-13",
    ran: true,
    treatedDelta: 40,
    controlDelta: 5,
    adjustedLift: 35,
    treatedCtrDelta: 0.03,
    controlCtrDelta: 0.002,
    adjustedCtrLift: 0.028,
    treatedPosDelta: 1,
    controlPosDelta: 0,
    adjustedPosLift: 1,
    controlsUsed: 3,
    ...over,
  };
}

function trafficOutcome(over: Partial<TrafficOutcome> = {}): TrafficOutcome {
  return {
    hasData: true,
    ran: true,
    windowDays: 28,
    treated: { sessionsPre: 200, sessionsPost: 240, conversionsPre: 2, conversionsPost: 3 },
    sessionsPctChange: 0.2,
    controlSessionsPctChange: 0,
    adjustedSessionsPct: 0.2,
    conversionsDelta: 1,
    hasRevenue: false,
    label: "Visitor traffic (28 days): +20% visits vs similar pages",
    ...over,
  };
}

function record(over: Partial<ShippedChangeRecord> = {}, path = "/p1"): ShippedChangeRecord {
  return {
    id: `${path}::2026-04-15`,
    page: `https://iranopedia.com${path}`,
    path,
    actionType: "edit_title",
    before: "old",
    after: "new",
    shippedAt: "2026-04-15T00:00:00.000Z",
    baseline: { clicks: 100, impressions: 3000, ctr: 0.03, position: 10, windowDays: 28 },
    targetQueries: ["iranian singers"],
    controlPages: ["https://iranopedia.com/actors", "https://iranopedia.com/comedians"],
    windows: [win28()],
    verdict: "won",
    confidence: "high",
    measuredAt: "2026-05-13T00:00:00.000Z",
    trafficOutcome: trafficOutcome(),
    dollarValue: null,
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: TEST_CALIBRATED_VERSION,
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...over,
  };
}

describe("buildLifetimeEarningsRows (item 40) - eligibility gate", () => {
  it("includes a mature, clean, won record with a ran traffic outcome", () => {
    const rows = buildLifetimeEarningsRows([record()], NOW, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.extraSessionsPerMonth).toBeGreaterThan(0);
  });

  it("excludes a non-mature (only 7-day window closed) record", () => {
    const rows = buildLifetimeEarningsRows(
      [record({ windows: [win28({ day: 7, checkOn: "2026-04-22", ran: true })] })],
      NOW,
      [],
    );
    expect(rows).toHaveLength(0);
  });

  it("excludes a mature record whose verdict is not won", () => {
    const rows = buildLifetimeEarningsRows([record({ verdict: "lost" })], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a weak-comparison-flagged record even though its window closed cleanly", () => {
    const rows = buildLifetimeEarningsRows([record({ controlMatchWeak: true })], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a record with no traffic outcome (never re-derives a rate without one)", () => {
    const rows = buildLifetimeEarningsRows([record({ trafficOutcome: null })], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a record whose traffic outcome never ran", () => {
    const rows = buildLifetimeEarningsRows(
      [record({ trafficOutcome: trafficOutcome({ ran: false }) })],
      NOW,
      [],
    );
    expect(rows).toHaveLength(0);
  });

  it("carries the row's own dollarValue.usdPerMonth through untouched", () => {
    const rows = buildLifetimeEarningsRows(
      [record({ dollarValue: { usdPerMonth: 42, basisSentence: "x", confidence: "high" } })],
      NOW,
      [],
    );
    expect(rows[0]!.usdPerMonth).toBe(42);
  });
});

describe("buildLifetimeEarningsRows -> computeLifetimeEarnings (item 40) - end to end", () => {
  it("one mature win, no revenue model: clicks-only sentence (the real single-win shape)", () => {
    const rows = buildLifetimeEarningsRows([record()], NOW, []);
    const r = computeLifetimeEarnings(rows)!;
    expect(r.changeCount).toBe(1);
    expect(r.usdPerMonth).toBeNull();
    expect(r.sentence).not.toMatch(/\$/);
    expect(r.sentence).toMatch(/1 change I shipped that won/);
  });

  it("silences (null) with zero mature wins", () => {
    const rows = buildLifetimeEarningsRows([record({ verdict: "measuring", windows: [] })], NOW, []);
    expect(computeLifetimeEarnings(rows)).toBeNull();
  });

  it("names dollars when a revenue model produced a positive usdPerMonth", () => {
    const rows = buildLifetimeEarningsRows(
      [record({ dollarValue: { usdPerMonth: 25, basisSentence: "x", confidence: "medium" } })],
      NOW,
      [],
    );
    const r = computeLifetimeEarnings(rows)!;
    expect(r.usdPerMonth).toBe(25);
    expect(r.sentence).toMatch(/\$25 a month/);
  });
});

describe("buildCounterfactualRows (item 41) - eligibility gate", () => {
  it("includes both mature won AND mature lost rows (the whole settled cohort, not only wins)", () => {
    const rows = buildCounterfactualRows(
      [
        record({ verdict: "won" }, "/p1"),
        record({ verdict: "lost" }, "/p2"),
      ],
      NOW,
      [],
    );
    expect(rows).toHaveLength(2);
  });

  it("excludes an inconclusive verdict - deriveMeasurementMaturity only reaches mature_result on a real won/lost call", () => {
    // Same gate load-experiment-outcomes.ts uses: at 28 days, mature_result
    // requires sufficient data AND verdict won/lost. An inconclusive 28-day
    // read maps to maturity "inconclusive", not "mature_result", and
    // isMatureOutcome only accepts "mature_result" - so it correctly drops
    // out of the portfolio claim rather than diluting it with a null read.
    const rows = buildCounterfactualRows([record({ verdict: "inconclusive" }, "/p1")], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("excludes a non-mature record", () => {
    const rows = buildCounterfactualRows(
      [record({ windows: [win28({ day: 14, checkOn: "2026-04-29" })] }, "/p1")],
      NOW,
      [],
    );
    expect(rows).toHaveLength(0);
  });

  it("excludes a weak-comparison-flagged record", () => {
    const rows = buildCounterfactualRows([record({ controlMatchWeak: true }, "/p1")], NOW, []);
    expect(rows).toHaveLength(0);
  });

  it("carries the basis window's treated/control deltas and the pro-rated baseline through", () => {
    const rows = buildCounterfactualRows(
      [record({ baseline: { clicks: 280, impressions: 3000, ctr: 0.03, position: 10, windowDays: 28 } }, "/p1")],
      NOW,
      [],
    );
    expect(rows[0]!.treatedDelta).toBe(40);
    expect(rows[0]!.controlDelta).toBe(5);
    expect(rows[0]!.scaledBaseline).toBe(280); // 28-day basis on a 28-day baseline -> scale 1
    expect(rows[0]!.controlsUsed).toBe(3);
  });
});

describe("buildCounterfactualRows -> computePortfolioCounterfactual (item 41) - end to end", () => {
  it("silences (null) below the 3-row honest minimum (the real current-ledger shape)", () => {
    const rows = buildCounterfactualRows([record({}, "/p1"), record({}, "/p2")], NOW, []);
    expect(computePortfolioCounterfactual(rows)).toBeNull();
  });

  it("speaks once 3+ mature rows qualify, naming both directions", () => {
    const rows = buildCounterfactualRows(
      [
        record({ windows: [win28({ treatedDelta: 40, controlDelta: -10 })] }, "/p1"),
        record({ windows: [win28({ treatedDelta: 40, controlDelta: -10 })] }, "/p2"),
        record({ windows: [win28({ treatedDelta: 40, controlDelta: -10 })] }, "/p3"),
      ],
      NOW,
      [],
    );
    const r = computePortfolioCounterfactual(rows)!;
    expect(r.n).toBe(3);
    expect(r.treatedPct).toBeGreaterThan(0);
    expect(r.controlPct).toBeLessThan(0);
    expect(r.sentence).toMatch(/pages I changed/);
    expect(r.sentence).toMatch(/similar pages I left alone/);
  });
});

describe("scoreboard-section money-line block - no em/en dashes anywhere", () => {
  it("neither builder's downstream sentence contains a dash", () => {
    const earningsRows = buildLifetimeEarningsRows([record()], NOW, []);
    const earnings = computeLifetimeEarnings(earningsRows);
    expect(earnings?.sentence ?? "").not.toMatch(/[–—]/);

    const cfRows = buildCounterfactualRows(
      [record({}, "/p1"), record({}, "/p2"), record({}, "/p3")],
      NOW,
      [],
    );
    const cf = computePortfolioCounterfactual(cfRows);
    expect(cf?.sentence ?? "").not.toMatch(/[–—]/);
  });
});

describe("scoreboard-section - no scheduled/overnight timing claims", () => {
  it("never claims tonight/last night/overnight/nightly timing (Beacon has no scheduler)", () => {
    const SRC = readFileSync(resolve(__dirname, "scoreboard-section.tsx"), "utf8");
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});
