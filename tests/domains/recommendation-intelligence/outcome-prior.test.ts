/**
 * #10 learning loop (2026-06-22) — proof-ledger verdicts → per-action_type
 * priority prior, and the bounded priority-score term that consumes it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  computeOutcomePriors,
  computeOutcomePriorDiagnostics,
  MIN_OUTCOME_SAMPLES,
} from "@/domains/recommendation-intelligence/outcome-prior";
import {
  outcomePriorBonus,
  MAX_OUTCOME_PRIOR_BONUS,
} from "@/domains/recommendation-intelligence/priority-score";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

// Fail-closed calibration quarantine (2026-07-11): these fixtures are CALIBRATED so
// the win-rate prior math + diagnostics pin their pre-quarantine behavior. The
// dedicated uncalibrated pin lives in src/domains/recommendation-intelligence/
// outcome-prior.test.ts.
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

const rec = (actionType: string, verdict: string) => ({ actionType, verdict, calibrationVersion: TEST_CALIBRATED_VERSION });

describe("computeOutcomePriors — win rate → [-1,+1]", () => {
  it("all won → +1, all lost → -1, 50/50 → 0", () => {
    expect(
      computeOutcomePriors(Array.from({ length: 3 }, () => rec("edit_title", "won"))).get(
        "edit_title",
      ),
    ).toBe(1);
    expect(
      computeOutcomePriors(Array.from({ length: 3 }, () => rec("edit_title", "lost"))).get(
        "edit_title",
      ),
    ).toBe(-1);
    expect(
      computeOutcomePriors([
        rec("edit_title", "won"),
        rec("edit_title", "won"),
        rec("edit_title", "lost"),
        rec("edit_title", "lost"),
      ]).get("edit_title"),
    ).toBe(0);
  });

  it("stays neutral (absent) below MIN_OUTCOME_SAMPLES settled outcomes", () => {
    expect(MIN_OUTCOME_SAMPLES).toBe(3);
    const thin = computeOutcomePriors([rec("edit_meta", "won"), rec("edit_meta", "won")]); // n=2
    expect(thin.has("edit_meta")).toBe(false);
  });

  it("ignores measuring / inconclusive verdicts (only won+lost settle)", () => {
    const m = computeOutcomePriors([
      rec("section_add", "won"),
      rec("section_add", "won"),
      rec("section_add", "won"),
      rec("section_add", "measuring"),
      rec("section_add", "inconclusive"),
    ]);
    expect(m.get("section_add")).toBe(1); // 3 won / 0 lost
  });
});

describe("outcomePriorBonus — bounded, symmetric, priority-only", () => {
  it("scales [-1,+1] to ±MAX and is neutral on absent/NaN", () => {
    expect(outcomePriorBonus(1)).toBe(MAX_OUTCOME_PRIOR_BONUS);
    expect(outcomePriorBonus(-1)).toBe(-MAX_OUTCOME_PRIOR_BONUS);
    expect(outcomePriorBonus(0)).toBe(0);
    expect(outcomePriorBonus(undefined)).toBe(0);
    expect(outcomePriorBonus(Number.NaN)).toBe(0);
  });

  it("clamps out-of-range priors", () => {
    expect(outcomePriorBonus(5)).toBe(MAX_OUTCOME_PRIOR_BONUS);
    expect(outcomePriorBonus(-5)).toBe(-MAX_OUTCOME_PRIOR_BONUS);
  });
});

describe("computeOutcomePriorDiagnostics — per-action_type learning view", () => {
  const drec = (
    actionType: string,
    verdict: string,
    operatorVerdictOverride: string | null = null,
  ) => ({ actionType, verdict, operatorVerdictOverride, calibrationVersion: TEST_CALIBRATED_VERSION });

  it("counts won/lost/excluded and reports the prior (null below MIN samples)", () => {
    const rows = computeOutcomePriorDiagnostics([
      drec("edit_title", "won"),
      drec("edit_title", "won"),
      drec("edit_title", "won"),
      drec("edit_meta", "won"), // only 1 settled → below MIN → prior null
    ]);
    const title = rows.find((r) => r.actionType === "edit_title")!;
    expect(title.won).toBe(3);
    expect(title.lost).toBe(0);
    expect(title.settled).toBe(3);
    expect(title.prior).toBeCloseTo(1, 5);
    const meta = rows.find((r) => r.actionType === "edit_meta")!;
    expect(meta.settled).toBe(1);
    expect(meta.prior).toBeNull();
  });

  it("an operator-excluded result drops out of won/lost and the prior", () => {
    const rows = computeOutcomePriorDiagnostics([
      drec("edit_title", "won"),
      drec("edit_title", "won"),
      drec("edit_title", "won"),
      // measureRecord pins an excluded record's verdict to 'inconclusive'.
      drec("edit_title", "inconclusive", "inconclusive"),
    ]);
    const title = rows.find((r) => r.actionType === "edit_title")!;
    expect(title.won).toBe(3);
    expect(title.excluded).toBe(1);
    expect(title.settled).toBe(3); // the excluded one is NOT counted as settled
    expect(title.prior).toBeCloseTo(1, 5); // and does not move the prior
  });
});
