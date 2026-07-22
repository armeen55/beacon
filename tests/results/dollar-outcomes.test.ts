/**
 * THE ONE DOLLAR RULE (R4, 2026-07-03) - pins the single shared eligibility gate
 * behind every cumulative dollar figure, and the parity it exists for: the
 * cumulative outcome strip (Today + Results) and Today's lifetime earnings
 * odometer must render the SAME dollar total from the SAME ledger. Before this
 * rule the strip summed every won-band dollar while the odometer excluded
 * shock-overlapped and weak-comparison wins, so the two figures could disagree
 * on one screen.
 *
 * Fixture convention: ship 2026-04-15 (28-day window closes 2026-05-13) is clear
 * of the confirmed Google-update ranges baked into algorithm-weather.ts (same
 * convention as scoreboard-section-money-lines.test.ts); shock exclusions here
 * use an explicit ShockWindow fixture.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
// Fail-closed calibration quarantine (2026-07-11): the win fixtures are CALIBRATED
// so these pin that a calibrated win still sums into the one dollar figure. The
// uncalibrated case at the end pins that an uncalibrated win contributes nothing.
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

import {
  buildWonDollarBreakdown,
  monthlyExtraSessionsRate,
  selectDollarRuleWins,
  sumWonDollarsPerMonth,
  BEHAVIOR_CORROBORATION_NOTE,
} from "@/domains/proof-gsc/won-dollar-rule";
import { computeCumulativeOutcome } from "@/domains/proof-gsc/cumulative-outcome";
import type { ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { TrafficOutcome } from "@/domains/proof-gsc/traffic-outcome";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function win28(shipDate: string, over: Partial<ShippedChangeRecord["windows"][number]> = {}): ShippedChangeRecord["windows"][number] {
  const checkOn = new Date(Date.parse(`${shipDate}T00:00:00Z`) + 28 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    day: 28,
    checkOn,
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

function record(
  path: string,
  shipDate: string,
  over: Partial<ShippedChangeRecord> = {},
): ShippedChangeRecord {
  return {
    id: `${path}::${shipDate}`,
    page: `https://iranopedia.com${path}`,
    path,
    actionType: "edit_title",
    before: "old",
    after: "new",
    shippedAt: `${shipDate}T00:00:00.000Z`,
    baseline: { clicks: 100, impressions: 3000, ctr: 0.03, position: 10, windowDays: 28 },
    targetQueries: ["iranian singers"],
    controlPages: ["https://iranopedia.com/actors", "https://iranopedia.com/comedians"],
    windows: [win28(shipDate)],
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
    createdAt: `${shipDate}T00:00:00.000Z`,
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...over,
  };
}

const usd = (n: number) => ({ usdPerMonth: n, basisSentence: "x", confidence: "medium" as const });

/** Overlaps only the May-1 ship's May 1..May 29 measurement window. */
const SHOCKS: ShockWindow[] = [
  { id: "s1", start: "2026-05-20", end: "2026-05-22", kind: "confirmed", label: "a confirmed Google update" },
];

const cleanWin = record("/clean-win", "2026-04-15", { dollarValue: usd(40) });
const shockWin = record("/shock-win", "2026-05-01", { dollarValue: usd(25) });
const weakWin = record("/weak-win", "2026-04-15", { controlMatchWeak: true, dollarValue: usd(30) });
const lostRow = record("/lost", "2026-04-15", { verdict: "lost", dollarValue: usd(10) });
const noTrafficWin = record("/no-traffic", "2026-04-15", { trafficOutcome: null, dollarValue: usd(15) });
const measuringRow = record("/measuring", "2026-06-24", {
  verdict: "won",
  windows: [win28("2026-06-24", { day: 7, ran: true })],
  dollarValue: usd(99),
});

const LEDGER = [cleanWin, shockWin, weakWin, lostRow, noTrafficWin, measuringRow];

describe("selectDollarRuleWins - the strict eligibility set", () => {
  it("keeps only the mature, clean, traffic-backed win", () => {
    const picked = selectDollarRuleWins(LEDGER, NOW, SHOCKS);
    expect(picked.map((r) => r.path)).toEqual(["/clean-win"]);
  });

  it("keeps a clicks-only win (no dollar rate) in the set so the odometer can still report clicks", () => {
    const clicksOnly = record("/clicks-only", "2026-04-15", { dollarValue: null });
    const picked = selectDollarRuleWins([clicksOnly], NOW, SHOCKS);
    expect(picked).toHaveLength(1);
    expect(sumWonDollarsPerMonth([clicksOnly], NOW, SHOCKS)).toEqual({
      usdPerMonth: null,
      contributingWins: 0,
    });
  });

  it("rates come from the row's own traffic outcome, never invented", () => {
    expect(monthlyExtraSessionsRate(cleanWin)).toBeCloseTo((0.2 * 200) / 28 * 30, 6);
    expect(monthlyExtraSessionsRate(noTrafficWin)).toBe(0);
  });
});

describe("sumWonDollarsPerMonth - the one figure", () => {
  it("sums only the eligible win's rate: shock, weak, lost, no-traffic and measuring dollars never count", () => {
    expect(sumWonDollarsPerMonth(LEDGER, NOW, SHOCKS)).toEqual({
      usdPerMonth: 40,
      contributingWins: 1,
    });
  });

  it("returns null (never a fabricated $0) when nothing qualifies", () => {
    expect(sumWonDollarsPerMonth([lostRow, measuringRow], NOW, SHOCKS).usdPerMonth).toBeNull();
  });
});

describe("buildWonDollarBreakdown - N4 behavior corroboration on win rows", () => {
  it("cites behavior corroboration ONLY when visitors behaved better", () => {
    const corroborated = {
      ...cleanWin,
      behaviorOutcome: { compositeVerdict: "better" },
    } as ShippedChangeRecord;
    const breakdown = buildWonDollarBreakdown([corroborated], NOW, SHOCKS);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]!.behaviorNote).toBe(BEHAVIOR_CORROBORATION_NOTE);
    expect(BEHAVIOR_CORROBORATION_NOTE).not.toMatch(/[–—]/);
  });

  it("stays silent for worse/mixed/none/absent behavior (corroboration only, never a caveat here)", () => {
    for (const verdict of ["worse", "mixed", "same", "none"] as const) {
      const row = {
        ...cleanWin,
        behaviorOutcome: { compositeVerdict: verdict },
      } as ShippedChangeRecord;
      expect(buildWonDollarBreakdown([row], NOW, SHOCKS)[0]!.behaviorNote).toBeUndefined();
    }
    expect(buildWonDollarBreakdown([cleanWin], NOW, SHOCKS)[0]!.behaviorNote).toBeUndefined();
  });

  it("behavior never changes selection or the summed figure", () => {
    const corroborated = {
      ...cleanWin,
      behaviorOutcome: { compositeVerdict: "better" },
    } as ShippedChangeRecord;
    const worse = {
      ...cleanWin,
      behaviorOutcome: { compositeVerdict: "worse" },
    } as ShippedChangeRecord;
    expect(sumWonDollarsPerMonth([corroborated], NOW, SHOCKS)).toEqual(
      sumWonDollarsPerMonth([worse], NOW, SHOCKS),
    );
    expect(selectDollarRuleWins([worse], NOW, SHOCKS)).toHaveLength(1);
  });
});

describe("DOLLAR figure - the cumulative outcome strip renders the summed figure", () => {
  it("cumulative outcome strip carries the $40 a month figure", () => {
    const strip = computeCumulativeOutcome(LEDGER, NOW, SHOCKS)!;
    expect(strip.estimatedUsdPerMonth).toBe(40);
    expect(strip.dollarLine).toContain("$40 a month");
  });

  it("the strip drops dollars when the only dollar-bearing win is quarantined", () => {
    const rows = [shockWin, weakWin, measuringRow];
    const strip = computeCumulativeOutcome(rows, NOW, SHOCKS)!;
    expect(strip.estimatedUsdPerMonth).toBeNull();
    expect(strip.dollarLine).toBeNull();
  });

});

describe("fail-closed calibration quarantine (2026-07-11)", () => {
  it("an UNCALIBRATED win earns NO dollar row and contributes nothing to the summed figure", () => {
    const uncalWin = record("/clean-win", "2026-04-15", { dollarValue: usd(40), calibrationVersion: null });
    expect(selectDollarRuleWins([uncalWin], NOW, SHOCKS)).toHaveLength(0);
    expect(sumWonDollarsPerMonth([uncalWin], NOW, SHOCKS).usdPerMonth).toBeNull();
  });
});

import {
  computeChangeDollarValue,
  toMonthlyRate,
  extraSessionsFromTrafficOutcome,
  shouldShowChangeDollarLine,
  type ChangeRevenueModel,
} from "@/domains/proof-gsc/change-dollar-value";

describe("change-level dollar attribution: unit economics, won-only line", () => {
describe("toMonthlyRate", () => {
  it("rolls a 7-day delta up to a 30-day rate", () => {
    expect(toMonthlyRate(14, 7)).toBeCloseTo(60, 5); // 14/7*30
  });

  it("returns 0 for a zero or invalid window instead of throwing/Infinity", () => {
    expect(toMonthlyRate(10, 0)).toBe(0);
    expect(toMonthlyRate(10, -5)).toBe(0);
    expect(toMonthlyRate(Number.NaN, 7)).toBe(0);
  });
});

describe("extraSessionsFromTrafficOutcome - control-adjusted, not raw pre/post", () => {
  it("applies the adjusted percent lift to the page's own pre-window sessions", () => {
    const extra = extraSessionsFromTrafficOutcome({
      ran: true,
      treated: { sessionsPre: 87 },
      adjustedSessionsPct: 0.147, // ~ +15% control-adjusted
    });
    expect(extra).toBeCloseTo(87 * 0.147, 5);
    expect(extra).toBeGreaterThan(0);
  });

  it("can read POSITIVE even when the page's raw sessions fell, if it fell less than its comparison pages", () => {
    // Real-world case this test exists to catch: treated 87 -> 76 (raw -11,
    // i.e. -12.6%) but comparison pages fell further (-27.6%), so the
    // control-adjusted lift is a genuine +14.7% relative win. The dollar
    // line must track THIS number, not the raw negative delta, or it
    // contradicts the traffic-outcome label shown right above it.
    const extra = extraSessionsFromTrafficOutcome({
      ran: true,
      treated: { sessionsPre: 87 },
      adjustedSessionsPct: 0.14724826953473943,
    });
    expect(extra).toBeGreaterThan(0);
  });

  it("returns 0 when the window has not run yet", () => {
    expect(
      extraSessionsFromTrafficOutcome({ ran: false, treated: { sessionsPre: 100 }, adjustedSessionsPct: 0.5 }),
    ).toBe(0);
  });

});

describe("computeChangeDollarValue - no revenue model (clicks-only, honest degradation)", () => {
  it("returns null usd and a plain extra-visits sentence when no model is set", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 70, // over the window below
      windowDays: 7,
      keyEventDelta: 0,
      revenueModel: undefined,
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).toContain("extra");
    expect(r.basisSentence).toMatch(/visit/);
    expect(r.basisSentence).not.toMatch(/\$/);
  });

  it("names a cost, not an earning, when trafficDelta is negative", () => {
    const r = computeChangeDollarValue({
      trafficDelta: -60,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: undefined,
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).toMatch(/costing you/);
  });

});

describe("computeChangeDollarValue - rpm model (content tenants)", () => {
  const rpmModel: ChangeRevenueModel = { kind: "rpm", rpmUsd: 12 };

  it("multiplies the operator's rpm by the monthly extra sessions", () => {
    // 7-day delta of 70 sessions -> 300/month; 300/1000 * 12 = 3.6
    const r = computeChangeDollarValue({
      trafficDelta: 70,
      windowDays: 7,
      keyEventDelta: 0,
      revenueModel: rpmModel,
    });
    expect(r.usdPerMonth).toBeCloseTo(3.6, 5);
    expect(r.basisSentence).toMatch(/\$/);
    expect(r.basisSentence).toMatch(/your rate of \$12/);
    expect(r.basisSentence).toMatch(/worth about/);
  });

  it("never divides by a bad rpm rate (rate <= 0 degrades to clicks-only)", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 100,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 0 },
    });
    expect(r.usdPerMonth).toBeNull();
    expect(r.basisSentence).not.toMatch(/\$/);
  });

});

describe("computeChangeDollarValue - per_lead model (service tenants)", () => {
  const perLeadModel: ChangeRevenueModel = { kind: "per_lead", dollarsPerLead: 45 };

  it("multiplies the operator's per-lead rate by the monthly extra key events", () => {
    // 14-day delta of 2 events -> ~4.2857/month; * 45 ≈ 192.86
    const r = computeChangeDollarValue({
      trafficDelta: 0,
      windowDays: 14,
      keyEventDelta: 2,
      revenueModel: perLeadModel,
    });
    expect(r.usdPerMonth).toBeCloseTo((2 / 14) * 30 * 45, 2);
    expect(r.basisSentence).toMatch(/\$45 per lead/);
  });

});

describe("computeChangeDollarValue - sparse data / confidence", () => {
  it("reads low confidence on a thin extra-sessions count even with a real rate", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 2, // tiny
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(r.confidence).toBe("low");
  });

  it("reads high confidence on a large, sustained extra-sessions count", () => {
    const r = computeChangeDollarValue({
      trafficDelta: 500,
      windowDays: 30,
      keyEventDelta: 0,
      revenueModel: { kind: "rpm", rpmUsd: 12 },
    });
    expect(r.confidence).toBe("high");
  });

});
describe("shouldShowChangeDollarLine - won-only, measuring-never presentation gate", () => {
  it("shows on a mature win with a positive dollar value and real revenue connected", () => {
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 340 }, hasRevenue: true }),
    ).toBe(true);
  });

  it("never shows on an in-flight (measuring) row, even with a positive dollar value", () => {
    expect(
      shouldShowChangeDollarLine({ band: "inflight", dollarValue: { usdPerMonth: 340 }, hasRevenue: true }),
    ).toBe(false);
  });

  it("never shows on a win with no dollar value (no revenue model configured)", () => {
    expect(shouldShowChangeDollarLine({ band: "win", dollarValue: null, hasRevenue: true })).toBe(false);
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: null }, hasRevenue: true }),
    ).toBe(false);
  });

  // operator spec 2026-07-09 E-38: hide dollar estimates until real revenue data
  // is connected, even when every other condition (mature win, positive rate-
  // based dollarValue) would otherwise show the line.
  it("never shows on an otherwise-qualifying win when real revenue is not connected yet", () => {
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 340 }, hasRevenue: false }),
    ).toBe(false);
    expect(
      shouldShowChangeDollarLine({ band: "win", dollarValue: { usdPerMonth: 340 }, hasRevenue: undefined }),
    ).toBe(false);
  });
});

});
