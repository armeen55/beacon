import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeBehaviorOutcome,
  behaviorDataThroughBound,
  taskCompletionShare,
  elapsedPostDays,
  behaviorHasContent,
  isAnswerShapedAction,
  GA4_MIN_SESSIONS_PER_WINDOW,
  CLARITY_MIN_VISITS_PER_WINDOW,
  type BehaviorOutcome,
} from "@/domains/proof-gsc/behavior-outcome";
import { computeTrafficOutcome } from "@/domains/proof-gsc/traffic-outcome";
import {
  computeCumulativeOutcome,
  type CumulativeOutcomeRow,
} from "@/domains/proof-gsc/cumulative-outcome";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

describe("behavior outcome: honest bounds, floors, self-hiding", () => {
describe("behaviorDataThroughBound (defect E: honest lower bound, never the max)", () => {
  it("stamps the EARLIER source when both GA4 and Clarity have data", () => {
    // GA4 reaches the 19th, Clarity only the 17th; the fused read is honest only
    // through the 17th (the exact production defect: a 07-19 stamp over a GSC
    // verdict basis that ended 07-17).
    expect(behaviorDataThroughBound("2026-07-19", "2026-07-17")).toBe("2026-07-17");
    expect(behaviorDataThroughBound("2026-07-15", "2026-07-18")).toBe("2026-07-15");
  });
  it("is null when neither source has landed yet", () => {
    expect(behaviorDataThroughBound(null, null)).toBeNull();
  });
});

/**
 * behavior-outcome.test.ts (BEACON_500 N4 + N17) - pins the sample floors
 * (never a verdict from 12 sessions), the live_at window math, every composite
 * sentence variant, the task-completion arithmetic including the quick-back
 * adjustment, the answer-shaped delta line, the self-hiding rule, and the
 * dash-clean rule.
 */

type Args = Parameters<typeof computeBehaviorOutcome>[0];

function args(over: Partial<Args> = {}): Args {
  return {
    windowDays: 14,
    preWindowDays: 28,
    actionType: "edit_title",
    ga4Pre: { sessions: 214, engagedSessions: 140, conversions: 0 },
    ga4Post: { sessions: 230, engagedSessions: 160, conversions: 0 },
    clarityPre: { visits: 300, rageClicks: 20, deadClicks: 25, quickbacks: 30 },
    clarityPost: { visits: 280, rageClicks: 8, deadClicks: 10, quickbacks: 28 },
    dataThrough: "2026-06-30",
    ...over,
  };
}

const CLARITY_ZERO = { visits: 0, rageClicks: 0, deadClicks: 0, quickbacks: 0 };

// ── sample floors: honest null per metric per window ─────────────────────────

describe("sample floors", () => {
  it("a GA4 window below 50 sessions nulls every GA4 metric for that window only", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: GA4_MIN_SESSIONS_PER_WINDOW - 1, engagedSessions: 40, conversions: 3 },
      }),
    );
    expect(r.engagedSharePre).toBeNull();
    expect(r.conversionsPre).toBeNull();
    // The post window cleared its own floor and stays readable.
    expect(r.engagedSharePost).not.toBeNull();
  });

  it("a GA4 window at exactly 50 sessions clears the floor", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: GA4_MIN_SESSIONS_PER_WINDOW, engagedSessions: 30, conversions: 0 },
      }),
    );
    expect(r.engagedSharePre).toBeCloseTo(0.6, 5);
  });

  it("a Clarity window below 100 visits nulls every Clarity metric for that window", () => {
    const r = computeBehaviorOutcome(
      args({
        clarityPre: { visits: CLARITY_MIN_VISITS_PER_WINDOW - 1, rageClicks: 5, deadClicks: 5, quickbacks: 10 },
      }),
    );
    expect(r.frustrationPer100Pre).toBeNull();
    expect(r.quickbackSharePre).toBeNull();
    expect(r.frustrationPer100Post).not.toBeNull();
  });

});

// ── window math from live_at ─────────────────────────────────────────────────

describe("elapsedPostDays (the live_at clock)", () => {
  it("counts ship day..latest source day inclusive", () => {
    expect(elapsedPostDays("2026-06-01", "2026-06-01", 28)).toBe(1);
    expect(elapsedPostDays("2026-06-01", "2026-06-14", 28)).toBe(14);
  });

  it("is 0 before any post-ship source day exists (never a fake window)", () => {
    expect(elapsedPostDays("2026-06-01", "2026-05-31", 28)).toBe(0);
    expect(elapsedPostDays("2026-06-01", null, 28)).toBe(0);
  });

  it("windowDays 0 yields ran false and an all-null outcome", () => {
    const r = computeBehaviorOutcome(args({ windowDays: 0 }));
    expect(r.ran).toBe(false);
    expect(r.engagedSharePre).toBeNull();
    expect(r.frustrationPer100Post).toBeNull();
    expect(r.compositeVerdict).toBe("none");
    expect(r.sentence).toBeNull();
    expect(behaviorHasContent(r)).toBe(false);
  });

  it("pro-rates pre conversions to the post window length", () => {
    const r = computeBehaviorOutcome(
      args({
        windowDays: 14,
        preWindowDays: 28,
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 2 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 8 },
      }),
    );
    expect(r.conversionsPre).toBeCloseTo(1, 5); // 2 over 28d -> 1 over 14d
    expect(r.conversionsPost).toBe(8);
  });
});

// ── composite sentence variants ──────────────────────────────────────────────

describe("composite sentence", () => {
  it("better: engagement up and frustration down, with the sample receipt", () => {
    const r = computeBehaviorOutcome(args());
    expect(r.compositeVerdict).toBe("better");
    expect(r.sentence).toBe(
      "Visitors behave better since the change: engaged visits up 6 percent, frustrated clicks down 57 percent. Read on 214 visits before the change and 230 after.",
    );
  });

  it("mixed: engagement up but frustration up names both sides", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 144, conversions: 0 },
        clarityPre: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
        clarityPost: { visits: 200, rageClicks: 20, deadClicks: 20, quickbacks: 20 },
      }),
    );
    expect(r.compositeVerdict).toBe("mixed");
    expect(r.sentence).toBe(
      "Mixed read on visitors since the change: engaged visits up 20 percent, but frustrated clicks up 100 percent. Read on 200 visits before the change and 200 after.",
    );
  });

  it("same: every lane flat says so plainly", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 0 },
        clarityPre: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
        clarityPost: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
      }),
    );
    expect(r.compositeVerdict).toBe("same");
    expect(r.sentence).toBe(
      "Visitors behave about the same since the change. Read on 200 visits before the change and 200 after.",
    );
  });

});

// ── N17 task completion ──────────────────────────────────────────────────────

describe("taskCompletionShare (N17)", () => {
  it("is the engaged share adjusted down by the quick-back share", () => {
    expect(taskCompletionShare(0.8, 0.125)).toBeCloseTo(0.7, 10);
    expect(taskCompletionShare(0.6, 0)).toBeCloseTo(0.6, 10);
    expect(taskCompletionShare(0.6, 1)).toBe(0);
  });

  it("is null unless BOTH inputs cleared their floors", () => {
    expect(taskCompletionShare(null, 0.1)).toBeNull();
    expect(taskCompletionShare(0.8, null)).toBeNull();
    expect(taskCompletionShare(null, null)).toBeNull();
  });

  it("is null (no line) when Clarity is below floor, even with plenty of GA4 data", () => {
    const r = computeBehaviorOutcome(
      args({
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(r.taskCompletionSharePre).toBeNull();
    expect(r.taskCompletionSharePost).toBeNull();
    expect(r.taskCompletionLine).toBeNull();
  });
});

// ── N17 answer-shaped delta line ─────────────────────────────────────────────

describe("answer delta line (answer-shaped changes only)", () => {
  const answerArgs = (over: Partial<Args> = {}): Args =>
    args({
      actionType: "add_answer_block",
      // pre: engaged 0.75, quick-back 0.2 -> 0.6
      ga4Pre: { sessions: 200, engagedSessions: 150, conversions: 0 },
      clarityPre: { visits: 200, rageClicks: 5, deadClicks: 5, quickbacks: 40 },
      // post: engaged 0.7, quick-back 0 -> 0.7
      ga4Post: { sessions: 250, engagedSessions: 175, conversions: 0 },
      clarityPost: { visits: 250, rageClicks: 5, deadClicks: 5, quickbacks: 0 },
      ...over,
    });

  it("names the before/after tenths when more people find their answer", () => {
    const r = computeBehaviorOutcome(answerArgs());
    expect(r.taskCompletionSharePre).toBeCloseTo(0.6, 10);
    expect(r.taskCompletionSharePost).toBeCloseTo(0.7, 10);
    expect(r.answerDeltaLine).toBe(
      "More people are finding their answer since the change: 6 in 10 before, 7 in 10 after.",
    );
  });

  it("never renders for a non-answer change even with both windows readable", () => {
    const r = computeBehaviorOutcome(answerArgs({ actionType: "edit_title" }));
    expect(r.answerDeltaLine).toBeNull();
  });

  it("isAnswerShapedAction covers answer blocks and FAQs, not titles or links", () => {
    expect(isAnswerShapedAction("add_answer_block")).toBe(true);
    expect(isAnswerShapedAction("ADD_FAQ")).toBe(true);
    expect(isAnswerShapedAction("faq_schema")).toBe(true);
    expect(isAnswerShapedAction("edit_title")).toBe(false);
    expect(isAnswerShapedAction("add_internal_link")).toBe(false);
    expect(isAnswerShapedAction("")).toBe(false);
  });
});

// ── self-hiding rule ─────────────────────────────────────────────────────────

describe("behaviorHasContent (the self-hiding rule)", () => {
  it("false for null/undefined and for an all-null outcome", () => {
    expect(behaviorHasContent(null)).toBe(false);
    expect(behaviorHasContent(undefined)).toBe(false);
    const empty = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 0, engagedSessions: 0, conversions: 0 },
        ga4Post: { sessions: 0, engagedSessions: 0, conversions: 0 },
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(behaviorHasContent(empty)).toBe(false);
  });

  it("true as soon as any line exists", () => {
    expect(behaviorHasContent(computeBehaviorOutcome(args()))).toBe(true);
  });
});
});

describe("traffic outcome: control-adjusted Dollar-ROI input", () => {
const M = (sessions: number, engagedSessions: number, conversions: number) => ({
  sessions,
  engagedSessions,
  conversions,
});

describe("computeTrafficOutcome — Dollar-ROI proof (gap #1)", () => {
  it("control-adjusted sessions lift: treated up, control flat → positive adjusted", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7, // no pro-rating
      treatedPre: M(100, 80, 0),
      treatedPost: M(150, 120, 0), // +50%
      controls: [{ pre: M(100, 80, 0), post: M(100, 80, 0) }], // 0%
    });
    expect(o.sessionsPctChange).toBeCloseTo(0.5, 5);
    expect(o.controlSessionsPctChange).toBeCloseTo(0, 5);
    expect(o.adjustedSessionsPct).toBeCloseTo(0.5, 5);
    expect(o.ran).toBe(true);
    expect(o.hasData).toBe(true);
    expect(o.label).toContain("Visitor traffic (7 days):");
    expect(o.label).toContain("+50% visits vs similar pages");
  });

  it("does NOT claim 'vs similar pages' when no comparable controls contributed", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(100, 80, 0),
      treatedPost: M(150, 120, 0), // +50% treated-only
      controls: [], // no control pages had pre-window sessions
    });
    expect(o.controlSessionsPctChange).toBeNull();
    expect(o.adjustedSessionsPct).toBeCloseTo(0.5, 5); // falls back to treated-only
    expect(o.label).not.toContain("vs similar pages");
    expect(o.label).toContain("vs its own baseline (no comparison pages yet)");
  });

  it("pro-rates a 28d pre window to a 7d post window for a fair comparison", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 28,
      treatedPre: M(400, 0, 0), // 400 over 28d → 100 over 7d
      treatedPost: M(100, 0, 0), // matches the pro-rated pre → flat
      controls: [],
    });
    expect(o.treated.sessionsPre).toBe(100); // pro-rated
    expect(o.sessionsPctChange).toBeCloseTo(0, 5);
  });

  it("no elapsed window (windowDays 0) reads as measuring, never a -100% artifact", () => {
    const o = computeTrafficOutcome({
      windowDays: 0,
      ran: false,
      preWindowDays: 28,
      treatedPre: M(280, 0, 0), // pre exists but no post day yet
      treatedPost: M(0, 0, 0),
      controls: [],
    });
    expect(o.hasData).toBe(false);
    expect(o.sessionsPctChange).toBeNull(); // NOT -100%
    expect(o.label).toBe("Visitor traffic: too soon to tell, first results come a week after you ship");
  });

  it("post window with zero GA4 rows reads 'no GA4 data', not a fake swing", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(0, 0, 0),
      treatedPost: M(0, 0, 0),
      controls: [],
    });
    expect(o.hasData).toBe(false);
    expect(o.label).toBe("Visitor traffic: no data for this page yet");
  });

  it("never claims revenue (GA4 returns none for this property)", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(100, 80, 1),
      treatedPost: M(200, 160, 5),
      controls: [],
    });
    expect(o.hasRevenue).toBe(false);
    expect(o.label.toLowerCase()).not.toContain("revenue");
    expect(o.label).not.toContain("$");
  });
});
});

describe("cumulative outcome: measured deltas only, money never faked", () => {
const NOW = new Date("2026-07-02T12:00:00Z");

function wonRow(overrides: Partial<CumulativeOutcomeRow> & { id: string; path: string }): CumulativeOutcomeRow {
  return {
    shippedAt: "2026-05-20T00:00:00Z",
    verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION,
    windows: [
      { day: 7, ran: true, controlsUsed: 3, adjustedLift: 20 },
      { day: 14, ran: true, controlsUsed: 3, adjustedLift: 41 },
      { day: 28, ran: true, controlsUsed: 3, adjustedLift: 84 },
    ],
    baseline: { impressions: 1200 },
    // THE ONE DOLLAR RULE (won-dollar-rule.ts): dollars require a ran GA4 traffic
    // outcome with a positive control-adjusted rate, so the fixture carries one.
    trafficOutcome: {
      ran: true,
      windowDays: 28,
      treated: { sessionsPre: 200 },
      adjustedSessionsPct: 0.2,
    },
    ...overrides,
  };
}

function measuringRow(overrides: Partial<CumulativeOutcomeRow> & { id: string; path: string }): CumulativeOutcomeRow {
  return {
    shippedAt: "2026-06-20T00:00:00Z",
    verdict: "measuring",
    windows: [
      { day: 7, ran: false },
      { day: 14, ran: false },
      { day: 28, ran: false },
    ],
    baseline: { impressions: 500 },
    ...overrides,
  };
}

describe("computeCumulativeOutcome - win with a measured monthly click lift", () => {
  it("sums each won change's own measured basis-window delta as a monthly rate", () => {
    const rows: CumulativeOutcomeRow[] = [
      // 84 extra clicks over the 28-day basis window -> 90 a month.
      wonRow({ id: "a", path: "/a" }),
      // A second win judged at its 28-day basis with +42 clicks -> 45 a month.
      wonRow({
        id: "b",
        path: "/b",
        windows: [
          { day: 7, ran: true, controlsUsed: 2, adjustedLift: 9 },
          { day: 14, ran: true, controlsUsed: 2, adjustedLift: 18 },
          { day: 28, ran: true, controlsUsed: 2, adjustedLift: 42 },
        ],
      }),
      measuringRow({ id: "c", path: "/c" }),
    ];
    const out = computeCumulativeOutcome(rows, NOW)!;
    expect(out.shipped).toBe(3);
    expect(out.won).toBe(2);
    expect(out.decided).toBe(2);
    expect(out.measuring).toBe(1);
    expect(out.winClicksPerMonth).toBe(135); // 90 + 45, measured deltas only
    expect(out.valueLine).toBe(
      "Together your 2 wins are adding about 135 extra clicks a month, measured against similar pages we did not change.",
    );
    expect(out.waitingLine).toBeNull();
  });

  it("never invents a click figure: a won row without a measured delta contributes 0", () => {
    const out = computeCumulativeOutcome(
      [
        wonRow({
          id: "a",
          path: "/a",
          windows: [{ day: 28, ran: true, controlsUsed: 3 }], // legacy row, no adjustedLift
        }),
      ],
      NOW,
    )!;
    expect(out.won).toBe(1);
    expect(out.winClicksPerMonth).toBe(0);
    expect(out.valueLine).toBeNull(); // no measured clicks sum -> no claim
  });
});

describe("computeCumulativeOutcome - honest zero-verdict frame", () => {
  it("names the REAL date the earliest still-measuring 28-day window closes", () => {
    const rows: CumulativeOutcomeRow[] = [
      measuringRow({ id: "a", path: "/a", shippedAt: "2026-06-20T00:00:00Z" }), // closes Jul 18
      measuringRow({ id: "b", path: "/b", shippedAt: "2026-06-25T00:00:00Z" }), // closes Jul 23
    ];
    const out = computeCumulativeOutcome(rows, NOW)!;
    expect(out.decided).toBe(0);
    expect(out.firstVerdictOn).toBe("2026-07-18");
    // P2-1 - the checkpoint clause ties this to the SAME schedule the Today proof
    // strip names (verdictSchedule.firstReadOn), so the two surfaces read as two
    // stages of one schedule instead of two unrelated dates.
    expect(out.waitingLine).toBe(
      "Next checkpoint Jul 4. No settled reads yet. The first lands around Jul 18 when the earliest 28-day window closes. Longer confirmation reads come later.",
    );
    expect(out.valueLine).toBeNull();
    expect(out.dollarLine).toBeNull();
  });

  it("says it is waiting on Google's data when every 28-day close date already passed", () => {
    const rows: CumulativeOutcomeRow[] = [
      measuringRow({ id: "a", path: "/a", shippedAt: "2026-05-01T00:00:00Z" }), // closed May 29
    ];
    const out = computeCumulativeOutcome(rows, NOW)!;
    expect(out.firstVerdictOn).toBe("2026-05-29");
    // P2-1 - no future checkpoint exists here, so no "Next checkpoint" clause is added.
    expect(out.waitingLine).toBe(
      "No settled reads yet. The earliest 28-day window has already closed, so the first lands as soon as Google's data catches up. Longer confirmation reads come later.",
    );
  });

  // P2-1 - when the only remaining future read IS the 28-day settle itself (the
  // 7/14-day checkpoints already ran or passed), the checkpoint clause must not
  // repeat the exact same date as "next checkpoint" and then again as "settled read".
  it("drops the waiting frame once anything has a final read", () => {
    const rows: CumulativeOutcomeRow[] = [
      wonRow({ id: "a", path: "/a" }),
      measuringRow({ id: "b", path: "/b" }),
    ];
    expect(computeCumulativeOutcome(rows, NOW)!.waitingLine).toBeNull();
  });
});

describe("computeCumulativeOutcome - money is never faked", () => {
  it("omits the dollar line entirely when no won row carries a dollar rate (no GA4 value data)", () => {
    const out = computeCumulativeOutcome(
      [wonRow({ id: "a", path: "/a" }), wonRow({ id: "b", path: "/b", dollarValue: { usdPerMonth: null } })],
      NOW,
    )!;
    expect(out.estimatedUsdPerMonth).toBeNull();
    expect(out.dollarLine).toBeNull();
  });

  it("sums real per-win dollar rates and labels the line as an estimate with its basis", () => {
    const out = computeCumulativeOutcome(
      [
        wonRow({ id: "a", path: "/a", dollarValue: { usdPerMonth: 30 } }),
        wonRow({ id: "b", path: "/b", dollarValue: { usdPerMonth: 12.5 } }),
      ],
      NOW,
    )!;
    expect(out.estimatedUsdPerMonth).toBe(42.5);
    expect(out.dollarLine).toBe(
      "At your rate, that is about $43 a month. This is an estimate, your rate times the extra visits the wins earned, not measured revenue.",
    );
  });

  // THE ONE DOLLAR RULE (R4, 2026-07-03): the strip applies the SAME strict
  // exclusions as Today's lifetime earnings odometer, so the two figures can
  // never disagree. Full parity is pinned in won-dollar-rule.test.ts.
  it("excludes a weak-comparison win's dollars (still counts it as a win)", () => {
    const out = computeCumulativeOutcome(
      [wonRow({ id: "a", path: "/a", controlMatchWeak: true, dollarValue: { usdPerMonth: 30 } })],
      NOW,
    )!;
    expect(out.won).toBe(1);
    expect(out.estimatedUsdPerMonth).toBeNull();
    expect(out.dollarLine).toBeNull();
  });

  it("excludes dollars from a win with no ran traffic outcome (nothing to price)", () => {
    const out = computeCumulativeOutcome(
      [wonRow({ id: "a", path: "/a", trafficOutcome: null, dollarValue: { usdPerMonth: 30 } })],
      NOW,
    )!;
    expect(out.estimatedUsdPerMonth).toBeNull();
  });

  it("excludes dollars from a win whose window overlapped a known Google shock", () => {
    const out = computeCumulativeOutcome(
      [wonRow({ id: "a", path: "/a", dollarValue: { usdPerMonth: 30 } })],
      NOW,
      // wonRow ships 2026-05-20 (window closes 2026-06-17); this shock overlaps it.
      [{ id: "s1", start: "2026-06-01", end: "2026-06-03", kind: "confirmed", label: "a confirmed Google update" }],
    )!;
    expect(out.won).toBe(1);
    expect(out.estimatedUsdPerMonth).toBeNull();
    expect(out.dollarLine).toBeNull();
  });
});
describe("waitingLine - fail-closed calibration quarantine (review fix 10)", () => {
  it("quarantined reads get the approved honest sentence, never a false 'waiting on Google' claim", () => {
    // Two uncalibrated mature wins: their 28-day windows RAN (the data arrived);
    // the thresholds failed the self-test. decided = 0 (gated), measuring = 2.
    const rows = [
      wonRow({ id: "q1", path: "/a", calibrationVersion: null }),
      wonRow({ id: "q2", path: "/b", calibrationVersion: null }),
    ];
    const outcome = computeCumulativeOutcome(rows, NOW)!;
    expect(outcome.decided).toBe(0);
    expect(outcome.measuring).toBe(2);
    expect(outcome.waitingLine).toContain(
      "No clear effect yet. Earlier reads used thresholds that failed Beacon's self-test.",
    );
    expect(outcome.waitingLine).not.toContain("Google's data catches up");
    expect(outcome.waitingLine).not.toContain("waiting on Google");
  });

  it("a genuinely-collecting ledger (no quarantined reads) keeps its original waiting copy", () => {
    const rows = [
      wonRow({
        id: "open-1",
        path: "/c",
        verdict: "measuring",
        calibrationVersion: null,
        windows: [{ day: 7, ran: false, controlsUsed: 0, adjustedLift: 0 }],
        shippedAt: "2026-06-20T00:00:00Z", // 28d window closes in the future
      }),
    ];
    const outcome = computeCumulativeOutcome(rows, NOW)!;
    expect(outcome.waitingLine).toContain("No settled reads yet");
    expect(outcome.waitingLine).not.toContain("self-test");
  });
});
});
