/**
 * proof-badge - fail-closed calibration quarantine (2026-07-11). Pins that the
 * Results card badge selector maps an UNCALIBRATED won/lost to the neutral "No
 * clear change" treatment (never "Helped"/"Did not help"), and passes a CALIBRATED
 * read through. The pure verdict->label mapper itself is unchanged (see
 * proof-plain-vocabulary.test.ts); this only pins the record-aware gate.
 */
import { describe, expect, it, afterEach } from "vitest";
import { isUncalibratedDecidedRecord, proofBadgeLabelFromVerdict } from "./proof-badge";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

afterEach(clearTestCalibratedVersions);

describe("isUncalibratedDecidedRecord - the card badge gate", () => {
  it("is true for an uncalibrated won/lost (renders 'No clear change', never Helped)", () => {
    expect(isUncalibratedDecidedRecord({ verdict: "won", calibrationVersion: null })).toBe(true);
    expect(isUncalibratedDecidedRecord({ verdict: "lost", calibrationVersion: null })).toBe(true);
    // The raw mapper would otherwise say "Helped"/"Did not help" for these - which is
    // exactly why the card must consult this gate first.
    expect(proofBadgeLabelFromVerdict("won", 28)).toBe("Helped");
    expect(proofBadgeLabelFromVerdict("lost", 28)).toBe("Did not help");
  });

  it("is false for non-decided verdicts (they were never a win/loss claim)", () => {
    expect(isUncalibratedDecidedRecord({ verdict: "measuring", calibrationVersion: null })).toBe(false);
    expect(isUncalibratedDecidedRecord({ verdict: "inconclusive", calibrationVersion: null })).toBe(false);
  });

  it("is false for a CALIBRATED won/lost (the future classifier's read shows its real badge)", () => {
    registerTestCalibratedVersion();
    expect(isUncalibratedDecidedRecord({ verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe(false);
    expect(isUncalibratedDecidedRecord({ verdict: "lost", calibrationVersion: TEST_CALIBRATED_VERSION })).toBe(false);
  });
});
