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

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * N48 expert-review pass (2026-07-03): the FINAL deterministic read over a rec
 * that already cleared the confidence gate, checking it reads like an expert
 * actually wrote it before it's shown as a confident move. Four checks, all
 * pure string inspection over the rec's own copy:
 *
 *   1. A specific NUMBER is present somewhere in the reasoning/impact, so an
 *      expert cites a figure ("9,137 times shown"), never a vague "improve
 *      this".
 *   2. A concrete NEXT STEP is present, so the operator can see what to do, not
 *      just why it matters.
 *   3. No GENERIC FILLER: no "optimize your content", "leverage synergies",
 *      "best practices" hand-waving.
 *   4. No CONTRADICTION: the copy doesn't say a page both ranks well and does
 *      not rank, or is both present and absent.
 *
 * This is a LOWER-ONLY gate, same posture as `applyCriticToVerdict`: it can
 * hold a rec (drop it to needs-more-evidence with an honest reason) but never
 * raises confidence and never rescues a reject. When every check passes it
 * returns the verdict UNCHANGED (byte-identical) so nothing new surfaces on a
 * good rec. Pure / deterministic / no I/O.
 */
export type ExpertReviewInput = {
  /** The "why this exists" motive sentence shown to the operator. */
  whyExists: string;
  /** The proposed copy the operator would ship, when the action has one. */
  proposedText?: string | null;
  /** What Beacon will watch after acceptance (the next-step / measurement plan). */
  measurementPlan?: string | null;
  /** The confidence reason line already composed by the QA gate. */
  confidenceReason?: string | null;
  /** Whether the rec carries at least one clickable/number-bearing evidence line. */
  hasQuotedEvidence: boolean;
  /**
   * Whether the rec IS a concrete action (a paste-ready edit with proposed copy,
   * or a well-defined action type): an edit-title/add-faq rec with a proposed
   * change is itself the next step, even when the motive prose reads as a
   * diagnosis. When true, the next-step check is satisfied by the action itself.
   */
  actionIsConcrete: boolean;
};

/** Marketing hand-waving an expert would never write. Lower-cased match. */
const GENERIC_FILLER_PHRASES: ReadonlyArray<string> = [
  "optimize your content",
  "leverage synergies",
  "best practices",
  "take it to the next level",
  "unlock your potential",
  "world-class",
  "cutting-edge",
  "game-changer",
  "move the needle",
  "low-hanging fruit",
];

/** True when the text contains a digit-bearing figure (a real number). */
function hasSpecificNumber(text: string): boolean {
  return /\d/.test(text);
}

/**
 * True when the text names a concrete action the operator can take. We look for
 * imperative action verbs an expert rec uses ("add", "write", "fix", "publish",
 * "rank", "recover", "track", "watch"), which distinguishes a next-step sentence
 * from a pure diagnosis.
 */
function hasConcreteNextStep(text: string): boolean {
  return /\b(add|write|edit|fix|publish|rank|recover|track|watch|answer|include|create|update|target|reach)\b/i.test(
    text,
  );
}

function containsGenericFiller(text: string): boolean {
  const lower = text.toLowerCase();
  return GENERIC_FILLER_PHRASES.some((p) => lower.includes(p));
}

/**
 * A blunt self-contradiction scan: the same claim asserted both ways in one
 * rec's copy. Deliberately narrow (only the pairs a rec genuinely can garble)
 * so it never false-positives on legitimate "you rank #8 but few click" copy.
 */
function containsContradiction(text: string): boolean {
  const lower = text.toLowerCase();
  const ranksWell = /\branks?\s+(well|highly|#?[1-3]\b)/.test(lower);
  const doesNotRank = /\b(does\s+not|doesn't|not)\s+rank/.test(lower);
  const present = /\byou(?:'re| are)\s+(?:the\s+)?(?:primary|cited|mentioned|present)/.test(lower);
  const absent = /\byou(?:'re| are)\s+(?:not\s+)?(?:absent|not\s+mentioned|not\s+cited)/.test(lower);
  return (ranksWell && doesNotRank) || (present && absent);
}

export function reviewExpertQuality(
  verdict: ExpertVerdict,
  input: ExpertReviewInput,
): ExpertVerdict {
  // Only review recs that cleared the bar (high/medium + approved). A rec the
  // gate already held/rejected keeps its verdict verbatim; the review adds
  // nothing to an already-honest hold.
  if (!verdict.enforcedApprove) return verdict;
  if (verdict.enforcedConfidence !== "high" && verdict.enforcedConfidence !== "medium") {
    return verdict;
  }

  const corpus = [
    input.whyExists,
    input.proposedText ?? "",
    input.measurementPlan ?? "",
    input.confidenceReason ?? "",
  ]
    .filter((s) => s.trim().length > 0)
    .join(" ");

  const failures: string[] = [];

  // 1. a specific number, unless the rec already carries a quoted evidence
  // line (the number lives on the bullet, not in this prose).
  if (!input.hasQuotedEvidence && !hasSpecificNumber(corpus)) {
    failures.push("it doesn't cite a single concrete number");
  }
  // 2. a concrete next step: either the copy names an action, or the rec IS a
  // concrete action (a proposed edit with a target).
  if (!input.actionIsConcrete && !hasConcreteNextStep(corpus)) {
    failures.push("it doesn't say what to actually do next");
  }
  // 3. no generic filler.
  if (containsGenericFiller(corpus)) {
    failures.push("it reads like generic filler, not a specific expert call");
  }
  // 4. no contradiction.
  if (containsContradiction(corpus)) {
    failures.push("it contradicts itself on how the page is doing");
  }

  if (failures.length === 0) {
    // Clean read, nothing new surfaces. Byte-identical to the input verdict.
    return verdict;
  }

  // Hold it, honestly. Lower-only: never below needs-more-evidence here (this is
  // a copy-quality hold, not a safety reject), never approved.
  const reason =
    failures.length === 1
      ? `I held this one back for review because ${failures[0]}. I want it to read like an expert wrote it before you act on it.`
      : `I held this one back for review because ${failures
          .slice(0, -1)
          .join(", ")} and ${failures[failures.length - 1]}. I want it to read like an expert wrote it before you act on it.`;

  return {
    enforcedConfidence: "needs_more_evidence",
    enforcedApprove: false,
    gateNotes: [...verdict.gateNotes, reason],
  };
}
