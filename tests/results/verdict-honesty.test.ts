import { afterEach, describe, expect, it } from "vitest";
import {
  appendVerdictRevision,
  buildVerdictRevisionLines,
  isDownwardRevision,
  type VerdictRevision,
} from "@/domains/proof-gsc/verdict-revisions";
import {
  CALIBRATED_VERDICT_VERSIONS,
  CALIBRATED_POOLED_VERDICT_VERSIONS,
  UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE,
  isCalibratedVerdict,
  isCalibratedPooledVerdict,
  displayProofOutcome,
  learningEligibleVerdict,
} from "@/domains/proof-gsc/verdict-calibration";
import {
  TEST_CALIBRATED_VERSION,
  TEST_CALIBRATED_POOLED_VERSION,
  registerTestCalibratedVersion,
  registerTestCalibratedPooledVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
import { verdictSchedule, type VerdictScheduleRow } from "@/domains/proof-gsc/verdict-schedule";
import { buildScoreboard, type ScoreboardDay } from "@/domains/scoreboard/scoreboard";
import { buildDailyExperimentDashboard } from "@/domains/experiments/daily-experiment-dashboard";
import { monthDayLabel } from "@/components/data/receipt-line";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

afterEach(clearTestCalibratedVersions);

describe("verdict revisions: append once, never rewrite", () => {
const NOW = new Date("2026-07-19T08:00:00.000Z");

describe("appendVerdictRevision (R14a - append once, never rewrite)", () => {
  it("the FIRST measurement is an announcement, not a revision", () => {
    expect(
      appendVerdictRevision({
        existing: null,
        previousVerdict: "measuring",
        previousMeasuredAt: null, // never measured before
        nextVerdict: "won",
        basisDay: 7,
        overrideApplied: false,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("an unchanged verdict appends NOTHING (re-measure is a no-op)", () => {
    const existing: VerdictRevision[] = [
      { at: "2026-07-10T00:00:00.000Z", from: "won", to: "inconclusive", reason: "the 14-day read" },
    ];
    const next = appendVerdictRevision({
      existing,
      previousVerdict: "inconclusive",
      previousMeasuredAt: "2026-07-10T00:00:00.000Z",
      nextVerdict: "inconclusive",
      basisDay: 28,
      overrideApplied: false,
      now: NOW,
    });
    expect(next).toEqual(existing); // same entries, none added
  });

  it("a real flip appends exactly ONE entry and leaves past entries byte-identical", () => {
    const first: VerdictRevision = {
      at: "2026-07-10T00:00:00.000Z",
      from: "won",
      to: "inconclusive",
      reason: "the 14-day read",
    };
    const next = appendVerdictRevision({
      existing: [first],
      previousVerdict: "inconclusive",
      previousMeasuredAt: "2026-07-10T00:00:00.000Z",
      nextVerdict: "lost",
      basisDay: 28,
      overrideApplied: false,
      now: NOW,
    });
    expect(next).toHaveLength(2);
    expect(next![0]).toEqual(first); // never rewritten
    expect(next![1]).toEqual({
      at: NOW.toISOString(),
      from: "inconclusive",
      to: "lost",
      reason: "the 28-day read",
    });
  });

  it("the operator override is named as the reason, not blamed on a read", () => {
    const next = appendVerdictRevision({
      existing: null,
      previousVerdict: "won",
      previousMeasuredAt: "2026-07-05T00:00:00.000Z",
      nextVerdict: "inconclusive",
      basisDay: 28,
      overrideApplied: true,
      now: NOW,
    });
    expect(next![0]!.reason).toBe("you set this result aside from learning");
  });

  it("calling the seam twice with the SAME stored state appends once, not twice (idempotent per change)", () => {
    const args = {
      existing: null,
      previousVerdict: "won" as const,
      previousMeasuredAt: "2026-07-05T00:00:00.000Z",
      nextVerdict: "inconclusive" as const,
      basisDay: 28,
      overrideApplied: false,
      now: NOW,
    };
    const first = appendVerdictRevision(args)!;
    // After persistence the stored verdict now matches, so the same computed
    // verdict appends nothing more - this is the append-once guarantee.
    const second = appendVerdictRevision({
      ...args,
      existing: first,
      previousVerdict: "inconclusive",
    });
    expect(second).toEqual(first);
  });
});

describe("isDownwardRevision (recap membership)", () => {
  it("a retracted win and a slide into hurting are downward", () => {
    expect(isDownwardRevision({ from: "won", to: "inconclusive" })).toBe(true);
    expect(isDownwardRevision({ from: "won", to: "lost" })).toBe(true);
    expect(isDownwardRevision({ from: "measuring", to: "lost" })).toBe(true);
  });
});

describe("buildVerdictRevisionLines (the card copy)", () => {
  it("speaks the owned-plainly first-person sentence with real dates and no dashes", () => {
    const lines = buildVerdictRevisionLines([
      { at: "2026-07-19T08:00:00.000Z", from: "won", to: "inconclusive", reason: "the 28-day read" },
      { at: "2026-07-22T08:00:00.000Z", from: "inconclusive", to: "lost", reason: "the 28-day read" },
    ]);
    expect(lines[0]).toBe(
      "I first called this a win; the 28-day read on 2026-07-19 revised it to no clear effect.",
    );
    expect(lines[1]).toBe(
      "Then the 28-day read on 2026-07-22 revised it from no clear effect to hurting.",
    );
    for (const line of lines) expect(/[‒–—―]/.test(line)).toBe(false);
  });
});
});

describe("verdict calibration quarantine: fail closed by default", () => {
describe("the registry is empty today (fail-closed by default)", () => {
  it("ships with zero registered calibrated versions", () => {
    expect(CALIBRATED_VERDICT_VERSIONS).toEqual([]);
    expect(CALIBRATED_POOLED_VERDICT_VERSIONS).toEqual([]);
  });
});

describe("isCalibratedVerdict - fail-closed", () => {
  it("is false for a null calibrationVersion", () => {
    expect(isCalibratedVerdict({ verdict: "won", calibrationVersion: null })).toBe(false);
  });
  it("is false for an UNKNOWN (unregistered) version", () => {
    expect(isCalibratedVerdict({ verdict: "won", calibrationVersion: "made-up-v9" })).toBe(false);
  });
  it("is true ONLY for a registered version", () => {
    registerTestCalibratedVersion();
    expect(isCalibratedVerdict({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe(true);
    expect(isCalibratedVerdict({ verdict: "won", calibrationVersion: "still-not-it" })).toBe(false);
  });
});

describe("isCalibratedPooledVerdict - fail-closed with an independent registry", () => {
  it("is false for an UNKNOWN (unregistered) version", () => {
    expect(isCalibratedPooledVerdict({ calibrationVersion: "made-up-pooled-v9" })).toBe(false);
  });
  it("does not trust a version certified only for the per-page classifier", () => {
    registerTestCalibratedVersion();
    expect(isCalibratedPooledVerdict({ calibrationVersion: TEST_CALIBRATED_VERSION })).toBe(false);
  });
  it("is true ONLY for a separately registered pooled version", () => {
    registerTestCalibratedPooledVersion();
    expect(isCalibratedPooledVerdict({ calibrationVersion: TEST_CALIBRATED_POOLED_VERSION })).toBe(true);
    expect(isCalibratedPooledVerdict({ calibrationVersion: "still-not-it" })).toBe(false);
  });
});

describe("displayProofOutcome", () => {
  it("maps an uncalibrated won to no_clear_effect_uncalibrated with the exact sentence", () => {
    const out = displayProofOutcome({ verdict: "won", calibrationVersion: null });
    expect(out.kind).toBe("no_clear_effect_uncalibrated");
    expect(out).toEqual({
      kind: "no_clear_effect_uncalibrated",
      sentence: "No clear effect yet. Earlier reads used thresholds that failed Beacon's self-test.",
    });
    // The exported constant is the single source of that copy.
    expect(UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE).toBe(
      "No clear effect yet. Earlier reads used thresholds that failed Beacon's self-test.",
    );
  });

  it("passes inconclusive / measuring / insufficient_data through unchanged (never quarantined)", () => {
    expect(displayProofOutcome({ verdict: "inconclusive" }).kind).toBe("inconclusive");
    expect(displayProofOutcome({ verdict: "measuring" }).kind).toBe("measuring");
    expect(displayProofOutcome({ verdict: "insufficient_data" }).kind).toBe("insufficient_data");
  });

  it("treats an unrecognized verdict as an honest non-claim (inconclusive), never a win", () => {
    expect(displayProofOutcome({ verdict: "weird_new_state" }).kind).toBe("inconclusive");
  });

  it("passes a CALIBRATED won/lost through as won/lost (the future classifier's path)", () => {
    registerTestCalibratedVersion();
    expect(displayProofOutcome({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION })).toEqual({ kind: "won" });
    expect(displayProofOutcome({ verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION })).toEqual({ kind: "lost" });
  });

});

describe("learningEligibleVerdict - the learning/ranking gate", () => {
  it("returns null for every uncalibrated verdict (won/lost/inconclusive/measuring)", () => {
    expect(learningEligibleVerdict({ verdict: "won", calibrationVersion: null })).toBeNull();
    expect(learningEligibleVerdict({ verdict: "lost" })).toBeNull();
    expect(learningEligibleVerdict({ verdict: "inconclusive", calibrationVersion: "unknown" })).toBeNull();
    expect(learningEligibleVerdict({ verdict: "measuring" })).toBeNull();
  });

  it("returns the real verdict for a CALIBRATED record (flows exactly as before)", () => {
    registerTestCalibratedVersion();
    expect(learningEligibleVerdict({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe("won");
    expect(learningEligibleVerdict({ verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe("lost");
    expect(learningEligibleVerdict({ verdict: "inconclusive", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe("inconclusive");
  });
});
});

describe("verdict date single source: every consumer equals verdictSchedule", () => {
const NOW = new Date("2026-07-02T12:00:00Z");

// A single change shipped 2026-06-28, still measuring (no window closed). Its 7-day checkpoint
// (2026-07-05) is the soonest FUTURE first-read; its final verdict is ship+28 (2026-07-26) and
// reliable Google data lands 3 days after that (2026-07-29).
const LEDGER: VerdictScheduleRow[] = [
  {
    id: "singers",
    path: "/singers",
    shippedAt: "2026-06-28T05:00:00.000Z",
    verdict: "measuring",
    actionType: "edit_title",
    windows: [
      { day: 7, ran: false },
      { day: 14, ran: false },
      { day: 28, ran: false },
    ],
    baseline: { impressions: 1000 },
  },
];

const SCHEDULE = verdictSchedule(LEDGER, NOW);

function days28(): ScoreboardDay[] {
  const start = Date.parse("2026-06-04");
  return Array.from({ length: 28 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    clicks: 10,
    impressions: 200,
  }));
}

describe("verdictSchedule - the one proof schedule", () => {
  it("firstReadOn is the soonest FUTURE 7/14/28 checkpoint, finalVerdictOn is ship+28, reliableDataOn adds the GSC lag", () => {
    expect(SCHEDULE.firstReadOn).toBe("2026-07-05");
    expect(SCHEDULE.finalVerdictOn).toBe("2026-07-26");
    expect(SCHEDULE.reliableDataOn).toBe("2026-07-29");
  });

  it("a decided (mature) ledger has no future schedule", () => {
    const mature: VerdictScheduleRow[] = [
      {
        id: "done",
        path: "/done",
        shippedAt: "2026-05-01T00:00:00.000Z",
        verdict: "won",
        actionType: "edit_title",
        windows: [
          { day: 7, ran: true, controlsUsed: 3 },
          { day: 14, ran: true, controlsUsed: 3 },
          { day: 28, ran: true, controlsUsed: 3 },
        ],
        baseline: { impressions: 1000 },
      },
    ];
    expect(verdictSchedule(mature, NOW)).toEqual({
      firstReadOn: null,
      finalVerdictOn: null,
      reliableDataOn: null,
    });
  });
});

describe("every date consumer equals verdictSchedule.firstReadOn", () => {
  it("scoreboard.nextVerdictDate == firstReadOn", () => {
    const s = buildScoreboard(days28(), LEDGER, NOW)!;
    expect(s.nextVerdictDate).toBe(SCHEDULE.firstReadOn);
  });

  it("daily-experiment dashboard nextCheckpoint == firstReadOn and reliableDataDate == reliableDataOn", () => {
    const dash = buildDailyExperimentDashboard({
      ledger: LEDGER as unknown as ShippedChangeRecord[],
      now: NOW,
    });
    expect(dash.activeProofBatch?.nextCheckpoint).toBe(SCHEDULE.firstReadOn);
    expect(dash.activeProofBatch?.reliableDataDate).toBe(SCHEDULE.reliableDataOn);
  });
});


});
