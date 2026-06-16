/**
 * Expert-rec-engine — the DETERMINISTIC verdict authority (2026-06-16).
 *
 * Extracted from `llm-expert-strategist.ts` into a PURE module (no server-only)
 * so BOTH the server-only LLM strategist AND the pure generation-time QA path
 * (`recommendation-qa.ts`, run inside `buildRecommendationActionRows`) share
 * the SAME confidence/approve authority. The directive's principle: the LLM
 * reasons, but THIS function — never the LLM — decides confidence and can
 * reject.
 *
 * PURE / deterministic / no I/O.
 */

import { TOPIC_FIT_FLOOR, INTENT_FIT_FLOOR } from "./page-topic-fit";

export type RiskLevel = "low" | "medium" | "high";

export type FinalConfidence =
  | "high"
  | "medium"
  | "low"
  | "needs_more_evidence"
  | "rejected";

export type ExpertVerdict = {
  /** The DETERMINISTIC final confidence — the LLM cannot raise past this. */
  enforcedConfidence: FinalConfidence;
  /** Whether the rec may be presented as actionable (deterministic). */
  enforcedApprove: boolean;
  /** Plain-English notes on why the gate set this verdict. */
  gateNotes: string[];
};

/**
 * The deterministic gate. Confidence + approve come ONLY from deterministic
 * signals (safety reject, page/intent fit, evidence presence, copy safety) —
 * never from LLM output.
 */
export function enforceExpertConfidence(args: {
  /** Upstream deterministic safety gate already rejected this rec. */
  deterministicReject: boolean;
  /** Page-topic intent-fit verdict (Slice 3). null = not scored. */
  shouldUseQueryForOptimization: boolean | null;
  /** Any core evidence family present (gsc/semrush/aeo/clarity/competitor). */
  hasCoreEvidence: boolean;
  topicMatchScore: number | null;
  intentMatchScore: number | null;
  /** Proposed copy is artifact-free (no instruction-text / "Add Add" / dup
   *  brand). Defaults true when there is no proposed copy to vet. */
  copySafe?: boolean;
}): ExpertVerdict {
  if (args.deterministicReject) {
    return {
      enforcedConfidence: "rejected",
      enforcedApprove: false,
      gateNotes: [
        "A deterministic safety gate rejected this recommendation; the LLM's reasoning cannot override it.",
      ],
    };
  }
  if (args.shouldUseQueryForOptimization === false) {
    return {
      enforcedConfidence: "rejected",
      enforcedApprove: false,
      gateNotes: [
        "Page-topic intent-fit found the query is the wrong target for this page; the LLM's reasoning cannot override a topic/intent mismatch.",
      ],
    };
  }
  if (!args.hasCoreEvidence) {
    return {
      enforcedConfidence: "needs_more_evidence",
      enforcedApprove: false,
      gateNotes: [
        "No core evidence family is present — confidence is capped at needs-more-evidence regardless of how strong the reasoning reads.",
      ],
    };
  }
  // Unsafe proposed copy can never be high/medium — the draft needs review.
  const copySafe = args.copySafe !== false;

  // Core evidence present but intent-fit not scored → moderate ceiling.
  if (args.topicMatchScore == null || args.intentMatchScore == null) {
    return copySafe
      ? {
          enforcedConfidence: "medium",
          enforcedApprove: true,
          gateNotes: [
            "Core evidence present; page-topic intent-fit was not scored — capped at medium.",
          ],
        }
      : {
          enforcedConfidence: "needs_more_evidence",
          enforcedApprove: false,
          gateNotes: [
            "The proposed copy needs review before this can be acted on (it isn't yet clean publishable copy).",
          ],
        };
  }

  const topic = args.topicMatchScore;
  const intent = args.intentMatchScore;
  if (topic >= 70 && intent >= 70 && copySafe) {
    return {
      enforcedConfidence: "high",
      enforcedApprove: true,
      gateNotes: [`Strong evidence and intent fit (topic ${topic}/100, intent ${intent}/100).`],
    };
  }
  if (topic >= TOPIC_FIT_FLOOR && intent >= INTENT_FIT_FLOOR) {
    return {
      enforcedConfidence: copySafe ? "medium" : "needs_more_evidence",
      enforcedApprove: copySafe,
      gateNotes: copySafe
        ? [`Moderate evidence and intent fit (topic ${topic}/100, intent ${intent}/100).`]
        : [
            `Evidence and intent fit are moderate (topic ${topic}/100, intent ${intent}/100), but the proposed copy needs review first.`,
          ],
    };
  }
  return {
    enforcedConfidence: "low",
    enforcedApprove: false,
    gateNotes: [`Weak fit (topic ${topic}/100, intent ${intent}/100) — not strong enough to act on yet.`],
  };
}
