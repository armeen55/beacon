/**
 * Test-only support for the verdict-calibration quarantine (2026-07-11). NOT a
 * `.test.ts` file, so vitest never collects it as a suite; it is imported by the
 * suites that need to exercise the CALIBRATED path.
 *
 * Production CALIBRATED_VERDICT_VERSIONS is empty (no classifier has passed the
 * self-test yet), so every record is uncalibrated and quarantined. A test that
 * wants to prove "a calibrated (future-version) record flows exactly as before"
 * registers this version in beforeAll and clears it in afterAll. Vitest isolates
 * modules per test file, so the mutation never leaks between files.
 */

import { CALIBRATED_POOLED_VERDICT_VERSIONS, CALIBRATED_VERDICT_VERSIONS } from "./verdict-calibration";

/** The version tests stamp onto records to mark them calibrated. */
export const TEST_CALIBRATED_VERSION = "calibrated-test-v1";
export const TEST_CALIBRATED_POOLED_VERSION = "calibrated-pooled-test-v1";

/** Register the test version so isCalibratedVerdict/displayProofOutcome/
 *  learningEligibleVerdict treat TEST_CALIBRATED_VERSION records as calibrated. */
export function registerTestCalibratedVersion(): void {
  const arr = CALIBRATED_VERDICT_VERSIONS as string[];
  if (!arr.includes(TEST_CALIBRATED_VERSION)) arr.push(TEST_CALIBRATED_VERSION);
}

export function registerTestCalibratedPooledVersion(): void {
  const arr = CALIBRATED_POOLED_VERDICT_VERSIONS as string[];
  if (!arr.includes(TEST_CALIBRATED_POOLED_VERSION)) arr.push(TEST_CALIBRATED_POOLED_VERSION);
}

/** Restore the empty production registry (fail-closed for every record again). */
export function clearTestCalibratedVersions(): void {
  (CALIBRATED_VERDICT_VERSIONS as string[]).length = 0;
  (CALIBRATED_POOLED_VERDICT_VERSIONS as string[]).length = 0;
}
