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

/** Confidence rank for the lower-only clamp (higher = more confident). */
const CONFIDENCE_RANK: Record<FinalConfidence, number> = {
  rejected: 0,
  needs_more_evidence: 1,
  low: 2,
  medium: 3,
  high: 4,
};

export type CriticVerdictKind =
  | "approve"
  | "lower_confidence"
  | "needs_more_evidence"
  | "reject";

/**
 * The adversarial QA critic's structured review. It can lower / cap confidence
 * or reject, NEVER raise. All the risk arrays + the note are for DISPLAY
 * ("Adversarial QA" panel); only `criticVerdict` + `confidenceCeiling` feed the
 * lower-only clamp. (Operator GQA-3 schema, 2026-06-16.)
 */
export type CriticReview = {
  criticVerdict: CriticVerdictKind;
  /** The HIGHEST confidence the critic will allow (clamped to never exceed det). */
  confidenceCeiling: FinalConfidence;
  unsupportedClaims: string[];
  evidenceGaps: string[];
  queryPageMismatchRisks: string[];
  copyRisks: string[];
  publishingRisks: string[];
  factualRisks: string[];
  /** Concrete things that would raise this to high confidence. */
  whatWouldMakeThisHighConfidence: string[];
  /** One plain-English line for the operator. */
  humanReviewNote: string;
};

/**
 * Apply an adversarial critic review to the DETERMINISTIC verdict — LOWER-ONLY.
 * The critic can pull confidence DOWN (or reject) but can NEVER raise it past
 * the deterministic ceiling and can never flip a deterministic reject to
 * approved. This is the safety invariant: "deterministic gates remain the final
 * authority." Pure.
 */
export function applyCriticToVerdict(
  deterministic: ExpertVerdict,
  critic: CriticReview,
): ExpertVerdict {
  // A deterministic reject is permanent — the critic cannot rescue it.
  if (deterministic.enforcedConfidence === "rejected") return deterministic;

  // Critic reject → rejected (the critic may always pull down to reject).
  if (critic.criticVerdict === "reject" || critic.confidenceCeiling === "rejected") {
    return {
      enforcedConfidence: "rejected",
      enforcedApprove: false,
      gateNotes: [
        ...deterministic.gateNotes,
        `Adversarial QA rejected this: ${critic.humanReviewNote}`,
      ],
    };
  }

  // Otherwise take the LOWER of the deterministic confidence and the critic's
  // ceiling — a critic ceiling at or above the deterministic level is clamped
  // away (the critic can never raise).
  const lowered =
    CONFIDENCE_RANK[critic.confidenceCeiling] < CONFIDENCE_RANK[deterministic.enforcedConfidence]
      ? critic.confidenceCeiling
      : deterministic.enforcedConfidence;

  const approve =
    deterministic.enforcedApprove && (lowered === "high" || lowered === "medium");

  const note =
    lowered === deterministic.enforcedConfidence
      ? `Adversarial QA agreed: ${critic.humanReviewNote}`
      : `Adversarial QA lowered confidence to ${lowered}: ${critic.humanReviewNote}`;

  return {
    enforcedConfidence: lowered,
    enforcedApprove: approve,
    gateNotes: [...deterministic.gateNotes, note],
  };
}

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
  /** Any core evidence family present (gsc/aeo/clarity/competitor). */
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

  // audit-3 #10: intent-fit NOT scored (no query extractable to verify the
  // query/page match). Pre-fix this fail-OPEN: it returned medium + approve:true,
  // making an UNVERIFIED rec auto-actionable AND live-pushable (publishing-mode
  // gates pushability on approve===true). An unscored fit is the same risk class
  // as the wrong-target reject — Beacon cannot confirm the query belongs on this
  // page. Distinguish "unscored" (this branch) from "scored benign" (below):
  // unscored → needs_more_evidence + approve:false, so the rec still surfaces
  // for the operator but is never one-tap published without a verified fit.
  // (Keeps the approve===true ⟺ high|medium invariant publishing-mode relies on.)
  if (args.topicMatchScore == null || args.intentMatchScore == null) {
    return {
      enforcedConfidence: "needs_more_evidence",
      enforcedApprove: false,
      gateNotes: [
        copySafe
          ? "Core evidence is present, but page-topic intent-fit was not scored — Beacon can't confirm this query is the right target for this page, so it needs review before it can be acted on or published."
          : "Page-topic intent-fit was not scored AND the proposed copy needs review — this can't be acted on or published yet.",
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
