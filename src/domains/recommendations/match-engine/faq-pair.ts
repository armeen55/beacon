/**
 * Recommendation Lifecycle OS — Phase 2 (2026-04-27).
 *
 * FAQ paired matcher. A single `add_faq` recommendation typically fans
 * out into TWO `recommended_edits` rows — one for `faq_question`, one
 * for `faq_answer`. This combinator runs both legs through the
 * positional matcher and reconciles the pair into a single verdict per
 * leg, with `partially_implemented` surfacing when only one side
 * matches.
 *
 * Pure. No I/O. Idempotent.
 */

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { RecommendedEditRow } from "../recommended-edits-persistence";
import { matchPositional } from "./per-action-matchers";
import type { MatchResult, OtherUrlInventory } from "./types";

export type FaqPairInputs = {
  questionEdit: RecommendedEditRow;
  answerEdit: RecommendedEditRow;
  currentInventory: ReadonlyArray<PageElementInventoryRow>;
  otherUrlInventories?: ReadonlyArray<OtherUrlInventory>;
};

export type FaqPairResult = {
  question: MatchResult;
  answer: MatchResult;
};

/**
 * Match an FAQ Q+A pair. Returns one `MatchResult` per leg.
 *
 * Reconciliation rules:
 *   - Both legs `verified_live` (or `_modified`)  → as-is per leg.
 *   - One leg matched (verified_live*), other not_found → BOTH legs
 *     get outcome `partially_implemented` + kind `structural_partial`,
 *     preserving the matched leg's similarity/element info.
 *   - One needs_review, other not_found → both go to `needs_review`
 *     (operator decides if it's a partial implementation or noise).
 *   - Both not_found → both stay not_found.
 *   - wrong_page is left as-is (operator's wrong-URL signal trumps
 *     pair reconciliation).
 */
export function matchFaqPair(inputs: FaqPairInputs): FaqPairResult {
  const q = matchPositional(
    inputs.questionEdit,
    inputs.currentInventory,
    "faq_question",
    { otherUrlInventories: inputs.otherUrlInventories },
  );
  const a = matchPositional(
    inputs.answerEdit,
    inputs.currentInventory,
    "faq_answer",
    { otherUrlInventories: inputs.otherUrlInventories },
  );

  const isLive = (m: MatchResult) =>
    m.outcome === "verified_live" || m.outcome === "verified_live_modified";
  const isWrongPage = (m: MatchResult) => m.outcome === "wrong_page";

  // wrong_page on either leg short-circuits — keep as-is.
  if (isWrongPage(q) || isWrongPage(a)) return { question: q, answer: a };

  const qLive = isLive(q);
  const aLive = isLive(a);

  if (qLive && aLive) return { question: q, answer: a };

  if (qLive && !aLive) {
    // Q landed, A missing or below threshold → partial.
    return {
      question: { ...q, outcome: "partially_implemented", kind: "structural_partial",
        reason: "FAQ question is live; answer not detected — operator may have implemented Q only" },
      answer: { ...a, outcome: "partially_implemented", kind: "structural_partial",
        reason: "FAQ question is live; answer not detected" },
    };
  }
  if (aLive && !qLive) {
    return {
      question: { ...q, outcome: "partially_implemented", kind: "structural_partial",
        reason: "FAQ answer is live; question not detected" },
      answer: { ...a, outcome: "partially_implemented", kind: "structural_partial",
        reason: "FAQ answer is live; question not detected — operator may have implemented A only" },
    };
  }

  // Neither live. If one is needs_review, escalate the other to needs_review too.
  const qReview = q.outcome === "needs_review";
  const aReview = a.outcome === "needs_review";
  if (qReview && !aReview) {
    return {
      question: q,
      answer: { ...a, outcome: "needs_review", confidence: "medium",
        reason: "paired FAQ question is candidate-matching; review answer too" },
    };
  }
  if (aReview && !qReview) {
    return {
      question: { ...q, outcome: "needs_review", confidence: "medium",
        reason: "paired FAQ answer is candidate-matching; review question too" },
      answer: a,
    };
  }
  return { question: q, answer: a };
}
