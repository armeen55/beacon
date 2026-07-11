/**
 * outcome-prior (2026-07-11 quarantine) - pins that the win-rate priority prior
 * counts CALIBRATED verdicts only. With an all-uncalibrated ledger (every record
 * today) the prior map is empty, so priorityScore's outcomePriorBonus resolves
 * neutral - a fresh-tenant shape. A registered version restores the pre-quarantine
 * behavior exactly.
 */
import { describe, expect, it, afterEach } from "vitest";
import { computeOutcomePriors, MIN_OUTCOME_SAMPLES } from "./outcome-prior";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

afterEach(clearTestCalibratedVersions);

const won = (calibrationVersion: string | null) => ({ actionType: "edit_title", verdict: "won", calibrationVersion });
const lost = (calibrationVersion: string | null) => ({ actionType: "edit_title", verdict: "lost", calibrationVersion });

describe("computeOutcomePriors - fail-closed calibration quarantine", () => {
  it("yields an EMPTY prior map from an all-uncalibrated ledger (no ranking movement)", () => {
    const ledger = [won(null), won(null), won(null), won(null), lost(null)]; // 5 settled, all uncalibrated
    expect(computeOutcomePriors(ledger).size).toBe(0);
  });

  it("counts CALIBRATED verdicts exactly as before (a 4-1 win rate earns a positive prior)", () => {
    registerTestCalibratedVersion();
    const v = TEST_CALIBRATED_VERSION;
    const ledger = [won(v), won(v), won(v), won(v), lost(v)]; // 5 settled >= MIN_OUTCOME_SAMPLES
    const priors = computeOutcomePriors(ledger);
    expect(priors.get("edit_title")).toBeCloseTo((0.8 - 0.5) * 2, 5); // (winRate - 0.5) * 2
  });

  it("MIN_OUTCOME_SAMPLES still gates a thin CALIBRATED sample to neutral", () => {
    registerTestCalibratedVersion();
    const ledger = Array.from({ length: MIN_OUTCOME_SAMPLES - 1 }, () => won(TEST_CALIBRATED_VERSION));
    expect(computeOutcomePriors(ledger).size).toBe(0);
  });
});
