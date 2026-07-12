/**
 * verdict-calibration (2026-07-11 quarantine) - pins the single choke point:
 *   - fail-closed on null / undefined / unknown version (every record today);
 *   - the exact customer sentence for an uncalibrated decided verdict;
 *   - inconclusive / measuring / insufficient_data pass through untouched;
 *   - a future REGISTERED version flows through exactly as a real verdict does.
 *
 * The "registered version" cases mutate the module's version registry in place
 * (via the shared test support) and restore it after, since production
 * CALIBRATED_VERDICT_VERSIONS is empty by design.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  CALIBRATED_VERDICT_VERSIONS,
  CALIBRATED_POOLED_VERDICT_VERSIONS,
  UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE,
  isCalibratedVerdict,
  isCalibratedPooledVerdict,
  displayProofOutcome,
  learningEligibleVerdict,
} from "./verdict-calibration";
import {
  TEST_CALIBRATED_VERSION,
  TEST_CALIBRATED_POOLED_VERSION,
  registerTestCalibratedVersion,
  registerTestCalibratedPooledVersion,
  clearTestCalibratedVersions,
} from "./verdict-calibration-test-support";

afterEach(clearTestCalibratedVersions);

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
  it("is false for an undefined / missing calibrationVersion", () => {
    expect(isCalibratedVerdict({ verdict: "won" })).toBe(false);
    expect(isCalibratedVerdict(undefined)).toBe(false);
    expect(isCalibratedVerdict(null)).toBe(false);
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
  it("is false for a null calibrationVersion (every pooled row today)", () => {
    expect(isCalibratedPooledVerdict({ calibrationVersion: null })).toBe(false);
  });
  it("is false for an undefined / missing calibrationVersion", () => {
    expect(isCalibratedPooledVerdict({})).toBe(false);
    expect(isCalibratedPooledVerdict(undefined)).toBe(false);
    expect(isCalibratedPooledVerdict(null)).toBe(false);
  });
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

  it("maps an uncalibrated lost to no_clear_effect_uncalibrated too", () => {
    expect(displayProofOutcome({ verdict: "lost", calibrationVersion: null }).kind).toBe(
      "no_clear_effect_uncalibrated",
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

  it("no added copy contains an em or en dash", () => {
    expect(UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE).not.toMatch(/[‒–—―]/);
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
