/**
 * W3 Step 3.3 (2026-05-01) — Recommendation Engine v2 confidence rubric.
 *
 * Pure deterministic function. No I/O, no LLM, no UI.
 *
 * Rubric semantics (operator-locked, founder-revised 2026-05-01):
 *
 *   HIGH   — likely safe to manually ship after a brief operator review.
 *            HIGH is NOT "auto-apply." Beacon never builds an
 *            Apply-All-HIGH UX from this label until the operator has
 *            personally inspected 20–30 generated recs and trusts the
 *            rubric. HIGH is hard to earn on purpose: it requires
 *            multi-prompt validation, real resolver tier, all edits
 *            high-confidence, packet-grounded evidence, resolver
 *            confidence high, and at least 2 evidence refs. Targeted
 *            distribution at first: 5–15% of recs.
 *
 *   MEDIUM — useful, but the operator should inspect the evidence
 *            and copy before shipping. Default zone for most recs in
 *            a young product. Targeted distribution: 50–70%.
 *
 *   LOW    — weak / thin signal, structural issue, or needs human
 *            judgment. Operator can still ship LOW recs, but the
 *            label is honest about the trust gap. Targeted
 *            distribution: 20–40%.
 *
 * Hard rules (locked by tests):
 *   1. LOW gates short-circuit. The first match wins; the verdict
 *      carries that gate's reason code. No further evaluation.
 *   2. HIGH requires ALL six positive conditions. Any blocker forces
 *      MEDIUM (after LOW gates pass).
 *   3. The rubric is pure: same inputs → same output. No clock reads,
 *      no random tie-breaks.
 *   4. The reason codes are stable strings — diagnostic surfaces
 *      (logs, debug views) can pin against them without forcing
 *      copy changes through this layer.
 *
 * Out of scope (operator-locked W3 §1.5):
 *   - Apply-All-HIGH bar / batch-accept UX.
 *   - LLM provider activation (W3 Step 3.4).
 *   - UI cleanup (W3 Step 3.5).
 *
 * NEVER add an `acceptAllHighConfidence` action that consumes this
 * label. HIGH is a manual-ship safety claim.
 */

import { looksLikePlaceholder } from "./placeholder-detection";
import type { ResolverTier } from "./resolved-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecConfidence = "high" | "medium" | "low";

/**
 * Stable diagnostic codes that tell the rest of the system WHY a rec
 * landed in HIGH / MEDIUM / LOW. Surfaceable in logs + debug views;
 * UI-prominence is intentionally limited (the operator-facing copy
 * for these codes is the rec card's own labels, not these strings).
 *
 * Codes are grouped by where they fire:
 *   - LOW gates — early-return reasons (one wins, returned alone).
 *   - HIGH positives — accumulated when a HIGH dimension is satisfied.
 *   - HIGH blockers — accumulated when a HIGH dimension fails.
 *
 * MEDIUM verdicts carry both the positives that DID hit and the
 * blockers that prevented HIGH; LOW verdicts carry only the gating
 * code.
 */
export type ConfidenceReasonCode =
  // ── LOW gates (early returns) ──
  | "no_affected_prompts"
  | "needs_human_review"
  | "no_edits"
  | "edit_low_confidence"
  | "edit_placeholder_text"
  | "competitor_name_leak_in_copy"
  | "tier_deterministic_only"
  | "resolution_low_confidence"
  // ── HIGH positives ──
  | "multi_prompt_signal"
  | "adjudicated_or_inventory_tier"
  | "all_edits_high_confidence"
  | "grounded_in_search_signal"
  | "grounded_in_competitor_blueprints"
  | "resolution_high_confidence"
  | "sufficient_evidence_refs"
  // ── HIGH blockers (accumulated when condition fails) ──
  | "single_prompt_signal"
  | "tier_observation_only"
  | "edit_medium_or_lower_confidence"
  | "no_grounded_packet_signal"
  | "resolution_medium_confidence"
  | "thin_evidence_refs";

export type RecConfidenceVerdict = {
  readonly confidence: RecConfidence;
  /**
   * For HIGH: every positive code that contributed (no blockers
   * present).
   * For MEDIUM: positives that DID land + blockers that prevented
   * HIGH (mixed list).
   * For LOW: the single gate that fired (the early-return reason).
   *
   * Always at least one entry; never undefined.
   */
  readonly reasons: ReadonlyArray<ConfidenceReasonCode>;
};

/**
 * Rubric thresholds — exported for tests + future tuning. Operator-
 * locked at W3 Step 3.3 launch (2026-05-01); revisit only after the
 * sample-10 quality report (W3 Step 3.6) lands.
 */
export const HIGH_MIN_AFFECTED_PROMPTS = 2;
export const HIGH_MIN_EVIDENCE_REFS = 2;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Minimal edit shape needed to compute confidence. Caller passes the
 * recommended_edits row's relevant fields; nothing about persistence
 * leaks into the rubric.
 */
export type ConfidenceEditInput = {
  readonly proposed_text: string | null;
  readonly confidence: "low" | "medium" | "high";
  readonly target_element_key?: string | null;
};

export type ComputeRecConfidenceArgs = {
  /** How many distinct prompts this rec affects. */
  readonly affectedPromptCount: number;
  /** Resolver tier — observation / inventory / adjudicated /
   *  deterministic_only. */
  readonly resolverTier: ResolverTier;
  /** Resolver-level confidence in the resolved URL/action. */
  readonly resolutionConfidence: "low" | "medium" | "high";
  /** True when the resolver flagged the rec for human review. */
  readonly needsHumanReview: boolean;
  /** Count of structured evidence refs the resolver attached. */
  readonly evidenceRefCount: number;
  /** Recommended-edit rows linked to this rec. May be empty. */
  readonly edits: ReadonlyArray<ConfidenceEditInput>;
  /**
   * Whether the rec's evidence packet has at least one
   * `aiSearchSignal.topSearchQueries[0]` row. Caller-supplied;
   * defaults to false (treated as "no grounded signal" → blocks HIGH).
   * Step 3.4's LLM activation will plumb this in from the actual
   * packet.
   */
  readonly hasAiSearchSignal?: boolean;
  /**
   * Whether the rec's evidence packet has at least one
   * `competitorPageBlueprints[0]` row. Caller-supplied; defaults to
   * false. Either signal counts (search OR blueprints); HIGH needs
   * at least one.
   */
  readonly hasCompetitorPageBlueprints?: boolean;
  /**
   * Optional list of competitor names to scan in proposed_text for
   * leakage. When passed, any edit whose proposed_text contains a
   * competitor name (word-boundary, case-insensitive) triggers LOW.
   * The validator already runs this check at write time
   * (`validateCompetitorPublicCopy`); the rubric repeats it as a
   * defense-in-depth so a row that somehow slipped through still
   * gets a LOW label here.
   */
  readonly competitorNames?: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function copyContainsCompetitor(
  copy: string | null,
  competitorNames: ReadonlyArray<string>,
): boolean {
  if (typeof copy !== "string" || copy.length === 0) return false;
  if (competitorNames.length === 0) return false;
  for (const name of competitorNames) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue; // avoid noise from short tokens
    const re = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "i");
    if (re.test(copy)) return true;
  }
  return false;
}

/**
 * Compute the confidence verdict for one resolved + edit-decorated
 * recommendation. Pure.
 */
export function computeRecConfidence(
  args: ComputeRecConfidenceArgs,
): RecConfidenceVerdict {
  // ── LOW gates (early returns; first match wins) ──

  if (args.affectedPromptCount === 0) {
    return { confidence: "low", reasons: ["no_affected_prompts"] };
  }
  if (args.needsHumanReview) {
    return { confidence: "low", reasons: ["needs_human_review"] };
  }
  if (args.edits.length === 0) {
    return { confidence: "low", reasons: ["no_edits"] };
  }
  for (const edit of args.edits) {
    if (edit.confidence === "low") {
      return { confidence: "low", reasons: ["edit_low_confidence"] };
    }
    if (looksLikePlaceholder(edit.proposed_text)) {
      return { confidence: "low", reasons: ["edit_placeholder_text"] };
    }
    if (
      copyContainsCompetitor(
        edit.proposed_text,
        args.competitorNames ?? [],
      )
    ) {
      return {
        confidence: "low",
        reasons: ["competitor_name_leak_in_copy"],
      };
    }
  }
  if (args.resolverTier === "deterministic_only") {
    return { confidence: "low", reasons: ["tier_deterministic_only"] };
  }
  if (args.resolutionConfidence === "low") {
    return {
      confidence: "low",
      reasons: ["resolution_low_confidence"],
    };
  }

  // ── HIGH evaluation (six dimensions, must ALL pass for HIGH) ──

  const positives: ConfidenceReasonCode[] = [];
  const blockers: ConfidenceReasonCode[] = [];

  // 1. Multi-prompt signal.
  if (args.affectedPromptCount >= HIGH_MIN_AFFECTED_PROMPTS) {
    positives.push("multi_prompt_signal");
  } else {
    blockers.push("single_prompt_signal");
  }

  // 2. Real resolver tier (already past deterministic_only LOW gate;
  //    "observation" still blocks HIGH — it's a soft inventory match).
  if (
    args.resolverTier === "adjudicated" ||
    args.resolverTier === "inventory"
  ) {
    positives.push("adjudicated_or_inventory_tier");
  } else {
    blockers.push("tier_observation_only");
  }

  // 3. Every edit at confidence "high".
  if (args.edits.every((e) => e.confidence === "high")) {
    positives.push("all_edits_high_confidence");
  } else {
    blockers.push("edit_medium_or_lower_confidence");
  }

  // 4. Packet grounding — at least one of search-signal or
  //    competitor-blueprints. Either positive code can land; missing
  //    BOTH is a single blocker.
  if (args.hasAiSearchSignal === true) {
    positives.push("grounded_in_search_signal");
  }
  if (args.hasCompetitorPageBlueprints === true) {
    positives.push("grounded_in_competitor_blueprints");
  }
  if (
    args.hasAiSearchSignal !== true &&
    args.hasCompetitorPageBlueprints !== true
  ) {
    blockers.push("no_grounded_packet_signal");
  }

  // 5. Resolution confidence "high" — "medium" is a blocker (HIGH is
  //    hard to earn).
  if (args.resolutionConfidence === "high") {
    positives.push("resolution_high_confidence");
  } else {
    blockers.push("resolution_medium_confidence");
  }

  // 6. Sufficient evidence refs.
  if (args.evidenceRefCount >= HIGH_MIN_EVIDENCE_REFS) {
    positives.push("sufficient_evidence_refs");
  } else {
    blockers.push("thin_evidence_refs");
  }

  if (blockers.length === 0) {
    return { confidence: "high", reasons: positives };
  }
  // MEDIUM — return the positives that DID land alongside the
  // blockers, so callers can see what's missing.
  return {
    confidence: "medium",
    reasons: [...positives, ...blockers],
  };
}
