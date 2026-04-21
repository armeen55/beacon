/**
 * Evidence basis classifier for Today action cards.
 *
 * Phase 2 (2026-04-20) of the customer-one plan. Collapses the scattered
 * confidence signals already present in the system (priorSuccess, URL-level
 * verdicts, mined-pattern strength, citation backing, pattern track record,
 * shared-brain pattern strength) into a single operator-facing pill.
 *
 * Rule: strongest HONEST tier wins. When shared-brain data is thin (the
 * current reality), `shared_pattern` must never fire; the classifier falls
 * back to `tenant_history`, `current_dataset`, or `heuristic` in that order.
 *
 * This is a pure function. No I/O. No side effects. Callers populate the
 * input from whatever context they already have — unknown fields pass as
 * null and are treated as absent, not speculative.
 */

export type EvidenceBasis =
  | "heuristic"
  | "tenant_history"
  | "current_dataset"
  | "shared_pattern";

/** Rec types whose presence on the card implies a measured URL-level verdict
 *  computed from this tenant's own Z-score engine. */
const URL_VERDICT_REC_TYPES: ReadonlySet<string> = new Set([
  "hurting_verdict",
  "helping_verdict",
]);

/** Input to {@link classifyEvidenceBasis}. Every field except `recType` is
 *  optional / nullable so call sites pass only what they know. */
export type EvidenceBasisInput = {
  /** The rec type string (e.g. "hurting_verdict", "replicate_pattern"). */
  recType: string;
  /** True if the rec carries a priorSuccess payload referencing this tenant. */
  hasPriorSuccess?: boolean;
  /** PatternTrackRecord for the rec's pattern, if any. */
  patternTrackRecord?: { successRate: number; actedOn: number } | null;
  /** Strength of the MinedPattern (from `playbook.ts`) the rec is derived from. */
  minedPatternStrength?: "validated" | "probable" | "speculative" | null;
  /** Current baseline citation count on the target page (from citMap). */
  baselineCitations?: number | null;
  /** Matching shared-brain pattern's strength, if a lookup is available.
   *  Pass `null` when shared-brain is not consulted at this call site — the
   *  classifier will never fabricate `shared_pattern` without explicit input. */
  brainPatternStrength?:
    | "not_enough_evidence"
    | "weak_signal"
    | "emerging_signal"
    | "strong_signal"
    | null;
};

/**
 * Classify the strongest honest evidence basis for a Today action card.
 *
 * Precedence (first truthy rule wins):
 *   1. shared_pattern   — matching BrainPattern is `emerging_signal` or `strong_signal`
 *   2. tenant_history   — priorSuccess, URL-level verdict, or a pattern track
 *                          record with successRate ≥ 0.6 AND actedOn ≥ 2
 *   3. current_dataset  — MinedPattern strength is `validated` or `probable`,
 *                          OR baselineCitations ≥ 50 on target page
 *   4. heuristic        — fallback: first-principles, no measured backing
 */
export function classifyEvidenceBasis(
  input: EvidenceBasisInput,
): EvidenceBasis {
  // 1. shared_pattern — strongest cross-tenant signal. Never fired unless the
  //    caller explicitly provides a BrainPattern strength at emerging/strong.
  if (
    input.brainPatternStrength === "emerging_signal" ||
    input.brainPatternStrength === "strong_signal"
  ) {
    return "shared_pattern";
  }

  // 2. tenant_history — measured on this tenant.
  if (input.hasPriorSuccess === true) return "tenant_history";
  if (URL_VERDICT_REC_TYPES.has(input.recType)) return "tenant_history";
  const tr = input.patternTrackRecord;
  if (tr && tr.successRate >= 0.6 && tr.actedOn >= 2) {
    return "tenant_history";
  }

  // 3. current_dataset — current snapshot evidence on this tenant.
  if (
    input.minedPatternStrength === "validated" ||
    input.minedPatternStrength === "probable"
  ) {
    return "current_dataset";
  }
  if (
    input.baselineCitations !== null &&
    input.baselineCitations !== undefined &&
    input.baselineCitations >= 50
  ) {
    return "current_dataset";
  }

  // 4. heuristic — everything else.
  return "heuristic";
}
