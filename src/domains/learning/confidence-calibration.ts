/**
 * Learning Loop 4: Confidence Calibration
 *
 * Compares operator attribution decisions (ground truth) against
 * algorithmic change outcome assessments to detect systematic bias
 * and recommend threshold adjustments.
 *
 * Passive — stored only, does not modify any thresholds.
 * Runs after import pipeline when sufficient attribution data exists.
 */

import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import { writeStore } from "@/lib/persistence/json-store";
import { syncConfidenceCalibration } from "@/lib/persistence/dual-write";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type ConfidenceCalibration = {
  id: string; // always "current" (singleton)
  total_compared: number;
  agreement_count: number;
  agreement_rate: number; // 0-1
  false_positive_count: number; // algorithm says improving, operator doesn't attribute
  false_negative_count: number; // algorithm says stable/declining, operator says change-caused
  recommended_threshold_adjustment: number; // bounded ±0.05
  current_improving_threshold: number; // starts at 0.15
  calibrated_at: string;
};

// Simplified EventDecision shape (avoids importing the full attribution types
// which pull in server-only modules)
type DecisionInput = {
  id: string;
  primary_change_id: string | null;
  operator_confidence: string;
  cause_type: string;
};

// ---------------------------------------------------------------------------
// Noise guards
// ---------------------------------------------------------------------------

const MIN_HIGH_CONFIDENCE_DECISIONS = 10;
const MAX_THRESHOLD_ADJUSTMENT = 0.05; // ±5%
const DEFAULT_IMPROVING_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export function computeConfidenceCalibration(
  decisions: DecisionInput[],
  outcomes: ChangeOutcome[],
): ConfidenceCalibration | null {
  // Only high-confidence decisions where operator identified a specific change
  const highConfidence = decisions.filter(
    (d) =>
      d.operator_confidence === "high" &&
      d.cause_type === "change" &&
      d.primary_change_id,
  );

  if (highConfidence.length < MIN_HIGH_CONFIDENCE_DECISIONS) {
    return null; // Insufficient data
  }

  // Build outcome lookup
  const outcomeMap = new Map<string, ChangeOutcome>();
  for (const o of outcomes) outcomeMap.set(o.change_id, o);

  let totalCompared = 0;
  let agreementCount = 0;
  let falsePositiveCount = 0;
  let falseNegativeCount = 0;

  for (const decision of highConfidence) {
    const outcome = outcomeMap.get(decision.primary_change_id!);
    if (!outcome) continue; // No matching outcome — skip

    totalCompared++;

    // Operator says: "this change caused the improvement" (cause_type = "change")
    // Algorithm says: outcome.direction
    if (outcome.direction === "improving") {
      // Both agree — the change worked
      agreementCount++;
    } else {
      // False negative — operator says it worked, algorithm says stable/declining
      falseNegativeCount++;
    }
  }

  // Check for false positives: outcomes marked improving but operator attributed to
  // something else (competitor, algorithm, unknown)
  const nonChangeDecisions = decisions.filter(
    (d) =>
      d.operator_confidence === "high" &&
      d.cause_type !== "change" &&
      d.primary_change_id,
  );

  for (const decision of nonChangeDecisions) {
    const outcome = outcomeMap.get(decision.primary_change_id!);
    if (!outcome) continue;

    if (outcome.direction === "improving") {
      // Algorithm says improving but operator says it wasn't the change
      falsePositiveCount++;
      totalCompared++;
    }
  }

  if (totalCompared === 0) return null;

  const agreementRate =
    Math.round((agreementCount / totalCompared) * 100) / 100;

  // Compute threshold adjustment recommendation
  // If too many false positives → raise threshold (be more conservative)
  // If too many false negatives → lower threshold (be more aggressive)
  let adjustment = 0;
  if (totalCompared >= MIN_HIGH_CONFIDENCE_DECISIONS) {
    const fpRate = falsePositiveCount / totalCompared;
    const fnRate = falseNegativeCount / totalCompared;

    if (fpRate > 0.2) {
      // Too many false positives — raise threshold
      adjustment = Math.min(MAX_THRESHOLD_ADJUSTMENT, fpRate * 0.1);
    } else if (fnRate > 0.2) {
      // Too many false negatives — lower threshold
      adjustment = -Math.min(MAX_THRESHOLD_ADJUSTMENT, fnRate * 0.1);
    }
  }

  // Clamp adjustment
  adjustment =
    Math.round(
      Math.max(-MAX_THRESHOLD_ADJUSTMENT, Math.min(MAX_THRESHOLD_ADJUSTMENT, adjustment)) * 1000,
    ) / 1000;

  return {
    id: "current",
    total_compared: totalCompared,
    agreement_count: agreementCount,
    agreement_rate: agreementRate,
    false_positive_count: falsePositiveCount,
    false_negative_count: falseNegativeCount,
    recommended_threshold_adjustment: adjustment,
    current_improving_threshold: DEFAULT_IMPROVING_THRESHOLD,
    calibrated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Materialization entry point
// ---------------------------------------------------------------------------

export async function materializeConfidenceCalibration(
  decisions: DecisionInput[],
  outcomes: ChangeOutcome[],
): Promise<ConfidenceCalibration | null> {
  const calibration = computeConfidenceCalibration(decisions, outcomes);

  if (!calibration) {
    // Insufficient data — don't overwrite existing calibration
    return null;
  }

  await writeStore("confidence-calibration", [calibration]);
  await syncConfidenceCalibration(calibration);

  return calibration;
}
