/**
 * verdict-calibration (2026-07-11) - THE single choke point that quarantines
 * uncalibrated proof verdicts, fail-closed.
 *
 * WHY THIS EXISTS
 * ---------------
 * A faithful placebo recompute (the self-test Beacon runs against its own
 * measurement thresholds) classified 40 of 40 UNTOUCHED pages as wins or losses
 * under the deployed thresholds. A threshold that calls random noise a win 100%
 * of the time proves nothing, so every "won"/"lost" verdict already sitting in
 * the shipped-change proof ledger is untrustworthy. Until a corrected classifier
 * ships and registers its version below, NO stored won/lost verdict may be shown
 * to the operator as a trustworthy win/loss, may influence recommendation
 * ranking, or may train any learner. (Operator decision 2026-07-11.)
 *
 * History is preserved append-only: nothing is deleted, every record keeps its
 * stored verdict on disk. This module only changes how that stored verdict is
 * READ for display and for learning - it never rewrites one.
 *
 * HOW IT WORKS
 * ------------
 * A record is "calibrated" ONLY when its `calibrationVersion` is a member of
 * CALIBRATED_VERDICT_VERSIONS. The list is empty today, so every existing record
 * is uncalibrated and quarantined. When the corrected classifier ships it will
 * stamp its own version string onto the records it measures and add that string
 * here; from that moment those records flow exactly as verdicts always have,
 * with zero code changes at any consumer (they all read this module).
 *
 * Fail-closed everywhere: a null / undefined / unknown version is NEVER treated
 * as calibrated. A missing field can only ever remove trust, never grant it.
 *
 * TWO INTENTIONAL EXCEPTIONS (documented so a future reader does not "fix" them):
 *   - The protective brakes - autopilot/circuit-breaker.ts and
 *     autopilot/run-revert.ts - keep reading RAW verdicts, NOT through this
 *     module. The quarantine removes UNEARNED TRUST in wins; it must never
 *     remove CAUTION. A brake that stops acting on a possible loss because the
 *     loss was "uncalibrated" would be strictly less safe, so the brakes stay
 *     maximally cautious and read losses raw.
 *   - The citation engine (change_outcomes_v2: attribution/load-proven-wins.ts,
 *     today-v2-proven-results.tsx, the "Worked before" priorSuccess chips) is a
 *     DIFFERENT measurement pipeline entirely - it does not use the GSC proof
 *     thresholds that failed the self-test - so it is outside this quarantine's
 *     scope and is not routed through here.
 *
 * ONE SHARED-REGISTRY MEMBER (in scope, so a future reader does not mistake it
 * for the out-of-scope citation engine above):
 *   - The pooled batch verdict (pooled-verdict.ts helped / did_not_help /
 *     no_clear_lift, stored in pooled-verdict-store.ts, shown on /results by
 *     pooled-verdict-section.tsx) shares THIS registry. Its inverse-variance
 *     pool with a sign-flip null has NOT passed a placebo self-test either, so
 *     every pooled row carries calibrationVersion: null and is read fail-closed
 *     through isCalibratedPooledVerdict below. Pooled wins stay quarantined until
 *     a certified pooled classifier registers its version in
 *     CALIBRATED_VERDICT_VERSIONS - that same one edit re-lights the pooled
 *     surface too.
 */

/**
 * Calibration version strings that have PASSED Beacon's self-test and may be
 * trusted as real wins/losses. EMPTY today by design: no classifier has passed
 * the placebo self-test yet, so every existing record is uncalibrated. The
 * corrected classifier registers its version string here when it ships - that
 * one edit re-lights every consumer at once, because they all read this list.
 */
export const CALIBRATED_VERDICT_VERSIONS: readonly string[] = [];

/** The exact customer-facing sentence for an uncalibrated decided verdict. First
 *  person Beacon voice, no lab words, no em/en dashes. This is the ONLY string a
 *  customer surface may show where an uncalibrated win/loss used to be. */
export const UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE =
  "No clear effect yet. Earlier reads used thresholds that failed Beacon's self-test.";

/** The minimal record shape this module reads. Structurally satisfied by
 *  ShippedChangeRecord (proof-gsc/shipped-change-store.ts) and by any lean
 *  projection that carries the verdict + calibration version. */
export type CalibratableRecord = {
  verdict: string;
  /** The classifier version that produced this verdict, or null when it was
   *  measured under the pre-self-test thresholds (every existing record). */
  calibrationVersion?: string | null;
};

/**
 * True ONLY when the record's calibrationVersion is a registered, self-test-
 * passing version. Fail-closed: null / undefined / unknown -> false. Today this
 * returns false for EVERY record (CALIBRATED_VERDICT_VERSIONS is empty).
 */
export function isCalibratedVerdict(record: CalibratableRecord | null | undefined): boolean {
  const version = record?.calibrationVersion;
  if (version == null) return false;
  return CALIBRATED_VERDICT_VERSIONS.includes(version);
}

/** The minimal pooled-row shape this module reads. Structurally satisfied by
 *  PooledVerdictRow (proof-gsc/pooled-verdict-store.ts). */
export type CalibratablePooledRow = {
  calibrationVersion?: string | null;
};

/**
 * True ONLY when a POOLED batch verdict row's calibrationVersion is a registered,
 * self-test-passing version. Pooled verdicts share the SAME registry as per-page
 * verdicts (CALIBRATED_VERDICT_VERSIONS), so the pooled sign-flip inference stays
 * quarantined until a pooled classifier is certified. Fail-closed: null /
 * undefined / unknown version -> false. Today this returns false for EVERY pooled
 * row (CALIBRATED_VERDICT_VERSIONS is empty), so no uncertified pooled win/loss
 * line may ever render.
 */
export function isCalibratedPooledVerdict(row: CalibratablePooledRow | null | undefined): boolean {
  const version = row?.calibrationVersion;
  if (version == null) return false;
  return CALIBRATED_VERDICT_VERSIONS.includes(version);
}

export type ProofOutcomeDisplay =
  | { kind: "won" }
  | { kind: "lost" }
  | { kind: "no_clear_effect_uncalibrated"; sentence: string }
  | { kind: "inconclusive" }
  | { kind: "measuring" }
  | { kind: "insufficient_data" };

/**
 * THE shared display selector every operator-facing surface reads. Turns a
 * stored verdict into what may honestly be shown right now:
 *   - a CALIBRATED decided verdict (won/lost) passes through as won/lost;
 *   - an UNCALIBRATED decided verdict (won/lost) becomes
 *     "no_clear_effect_uncalibrated", carrying the exact customer sentence, so a
 *     surface renders "No clear effect yet ..." where a win/loss used to be;
 *   - inconclusive / measuring / insufficient_data pass through unchanged (they
 *     are honest non-claims, untouched by the quarantine);
 *   - any unknown verdict is treated as inconclusive (never a fabricated win).
 *
 * A surface must never render "won"/"Helped"/"Confirmed" off a record whose
 * displayProofOutcome().kind is "no_clear_effect_uncalibrated".
 */
export function displayProofOutcome(record: CalibratableRecord): ProofOutcomeDisplay {
  const verdict = record.verdict;
  if (verdict === "won" || verdict === "lost") {
    if (isCalibratedVerdict(record)) return { kind: verdict };
    return { kind: "no_clear_effect_uncalibrated", sentence: UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE };
  }
  if (verdict === "measuring") return { kind: "measuring" };
  if (verdict === "insufficient_data") return { kind: "insufficient_data" };
  // inconclusive, plus any unrecognized verdict -> an honest non-claim.
  return { kind: "inconclusive" };
}

/**
 * The verdict a learner/ranker may train on, or null. Returns the stored verdict
 * ONLY for a calibrated record; for every uncalibrated record (all of them
 * today) it returns null, so a decided verdict is excluded from every prior,
 * weight, few-shot, retirement decision, and reliability score. All
 * learning/ranking consumers route through this so the quarantine is enforced in
 * exactly ONE place.
 */
export function learningEligibleVerdict(record: CalibratableRecord): string | null {
  return isCalibratedVerdict(record) ? record.verdict : null;
}
