/**
 * Recommendation Lifecycle OS — Phase 2 (2026-04-27).
 *
 * Match engine orchestrator. PURE function. Dispatches on
 * `edit.action_type` to the correct per-action matcher.
 *
 * Single-edit entry point only. FAQ Q+A pair reconciliation lives in
 * `faq-pair.ts` because it requires the runner to know which two
 * `recommended_edits` rows belong to the same FAQ — a join the pure
 * single-edit engine cannot make on its own.
 *
 * Wired by the (Phase 3) scan dual-write runner. Until then, consumed
 * only by tests.
 */

import {
  matchInternalLink,
  matchPositional,
  matchSchemaType,
  matchSingleton,
  pathMatches,
} from "./per-action-matchers";
import {
  isSupportedActionType,
  type MatchInputs,
  type MatchResult,
} from "./types";

/**
 * The single-edit pure match function. Returns a `MatchResult`
 * describing whether and how the edit appears in the supplied
 * inventory.
 *
 * Hard rules:
 *   - Pure. No I/O. No mutation of inputs.
 *   - Deterministic. Same inputs → same output, byte-for-byte.
 *   - No throws. Soft failures (unsupported action, missing text,
 *     empty inventory) all return a `MatchResult` with the appropriate
 *     outcome + reason — the runner logs and continues.
 *   - `not_found_after_7d` is NEVER returned. The pure function has no
 *     clock; the runner promotes `not_found` to `not_found_after_7d`
 *     by joining `accepted_at` against the current scan time.
 */
export function matchAcceptedEdit(inputs: MatchInputs): MatchResult {
  const { edit } = inputs;

  if (!isSupportedActionType(edit.action_type)) {
    return {
      outcome: "not_found",
      confidence: "low",
      kind: "unsupported",
      reason: `match engine v1 has no matcher for action_type "${edit.action_type}"`,
    };
  }

  switch (edit.action_type) {
    case "edit_title":
      return matchSingleton(edit, inputs.currentInventory, "title");
    case "edit_meta":
      return matchSingleton(edit, inputs.currentInventory, "meta");
    case "change_h1":
      return matchSingleton(edit, inputs.currentInventory, "h1");

    case "add_h2_section":
    case "rewrite_h2":
      return matchPositional(edit, inputs.currentInventory, "h2", {
        otherUrlInventories: inputs.otherUrlInventories,
      });

    case "add_faq":
    case "rewrite_faq":
      // Single-leg routing: dispatch by which side this edit targets.
      // The element key prefix is the deterministic signal — generators
      // emit `faq_question[new]:hash` or `faq_answer[new]:hash`.
      // Falls back to faq_question when the prefix is unrecognized
      // (defensive — keeps the engine no-throw).
      if (edit.target_element_key?.startsWith("faq_answer")) {
        return matchPositional(edit, inputs.currentInventory, "faq_answer", {
          otherUrlInventories: inputs.otherUrlInventories,
        });
      }
      return matchPositional(edit, inputs.currentInventory, "faq_question", {
        otherUrlInventories: inputs.otherUrlInventories,
      });

    case "add_internal_link":
      return matchInternalLink(edit, inputs.currentInventory);

    case "add_schema":
    case "fix_schema":
      return matchSchemaType(edit, inputs.currentInventory);

    default: {
      // Exhaustiveness — TypeScript proves we've handled every
      // SupportedActionType. This branch is unreachable but kept as a
      // safety belt in case the union grows without a matcher update.
      const _exhaustive: never = edit.action_type as never;
      return {
        outcome: "not_found",
        confidence: "low",
        kind: "unsupported",
        reason: `unhandled supported action_type "${String(_exhaustive)}"`,
      };
    }
  }
}

// Re-exports for the runner (Phase 3). All pure.
export { matchFaqPair, type FaqPairInputs, type FaqPairResult } from "./faq-pair";
export { normalizeText, normalizeTextBoth } from "./normalize-text";
export { jaccard, levenshtein, similarity, tokenize } from "./similarity";
export { pathMatches };
export {
  ACTION_THRESHOLDS,
  isSupportedActionType,
  SUPPORTED_ACTION_TYPES,
  type ActionThresholds,
  type MatchConfidence,
  type MatchInputs,
  type MatchKind,
  type MatchOutcome,
  type MatchResult,
  type OtherUrlInventory,
  type SupportedActionType,
} from "./types";
