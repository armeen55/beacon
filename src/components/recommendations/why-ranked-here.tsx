/**
 * WhyRankedHere — customer-facing "why is this rec ranked here" disclosure.
 *
 * Context (Audit Correction #2, 2026-05-08):
 *   The /recommendations queue IS already sorted by real signal
 *   (`recommendation-action-rows.ts:1741-1758`: STATUS_BUCKET → PRIORITIZER_TIER
 *   → PRIORITY_RANK → evidenceDepth → observationCount → id). Confidence is
 *   computed by the W3 §3.3 rubric and surfaced as `<DerivedConfidencePill>`.
 *   The original audit's "queue is sorted by created_at, confidence is
 *   hardcoded medium" claim was wrong on every count.
 *
 *   The narrow real gap that remained: the customer sees the rank number and
 *   the confidence pill, but no plain-English "why is this where it is."
 *   The information existed only in operator-mode debug surfaces. This
 *   component closes that gap without changing engine math, sort order,
 *   schema, or thresholds.
 *
 *   Composes from existing top-level row fields ONLY:
 *     - row.priority             (high/medium/low)
 *     - row.derivedConfidence    (strong_evidence/moderate_evidence/needs_review)
 *     - row.detail.affectedPromptCount
 *     - row.detail.observationCount
 *     - row.detail.topCompetitor (name + primaryPct, where primaryPct is
 *                                 already on a 0–100 scale per
 *                                 recommendation-action-rows.ts:1238)
 *
 *   Does NOT use:
 *     - row.detail.debug.* (operator-only)
 *     - prioritizer numeric score (operator-only diagnostic)
 *     - engineConfidence reason codes (machine-readable; surfaced in
 *       <RecConfidencePill> tooltip in operator mode)
 *     - any UUID or internal stable key
 *
 *   Honesty contract:
 *     - Never claims the rec is "validated", "proven", "confirmed", "winning",
 *       or any synonym implying outcome data exists. The customer-facing
 *       confidence sentence for `needs_review` says "Beacon is watching for
 *       stronger support" (existing operator-locked microcopy).
 *     - When evidence is absent (no top competitor, 0 prompts, etc.) the
 *       corresponding sentence is OMITTED, not invented. Falls back
 *       gracefully to whatever sentences ARE composable.
 *     - Renders `null` when nothing is composable (defensive guard).
 *
 *   Pure presentational. No I/O. No state. Safe in client components.
 */

import type { RecommendationActionRow } from "@/domains/recommendations/recommendation-action-rows";

/**
 * Minimal row shape required by the component. Pulled out as its own
 * type so the test can construct fixtures without depending on every
 * field of `RecommendationActionRow`.
 */
export type WhyRankedHereRow = Pick<
  RecommendationActionRow,
  "priority" | "derivedConfidence"
> & {
  detail: Pick<
    RecommendationActionRow["detail"],
    "affectedPromptCount" | "observationCount" | "topCompetitor"
  >;
};

const PRIORITY_WORD: Record<"high" | "medium" | "low", string> = {
  high: "High",
  medium: "Medium",
  low: "Lower",
};

/**
 * Customer-safe confidence sentences. Mirrors the operator-locked
 * microcopy already used elsewhere on /recommendations:
 *   - "needs_review" → existing operator-locked "Beacon is watching for
 *     stronger support" microcopy on the row title
 *     (recommendations-client.tsx:641).
 *   - "moderate_evidence" → "Moderate confidence" tone, no claim of
 *     proof.
 *   - "strong_evidence" → notes the multi-signal grounding without
 *     claiming the rec has been validated by outcomes (it hasn't yet
 *     — outcomes only exist post-shipping per the lifecycle loop).
 */
const CONFIDENCE_SENTENCE: Record<
  "strong_evidence" | "moderate_evidence" | "needs_review",
  string
> = {
  strong_evidence:
    "Strong evidence: multi-prompt support with grounded signals.",
  moderate_evidence:
    "Moderate evidence: clear signal, but no post-shipping outcome measured yet.",
  needs_review:
    "Lower confidence — based on limited data so far. Optional, not urgent.",
};

export function composeWhyRankedReasons(row: WhyRankedHereRow): string[] {
  const reasons: string[] = [];

  // Priority line — always available; PRIORITY_WORD covers the full
  // ActionRowPriority union.
  reasons.push(`${PRIORITY_WORD[row.priority]} priority for the queue.`);

  // Affected-prompts + observation-count line. Only emit when at least
  // one prompt is affected (zero-prompt rows would be a thin signal
  // and shouldn't get a sentence claiming evidence).
  const promptCount = row.detail.affectedPromptCount;
  const obsCount = row.detail.observationCount;
  if (promptCount > 0) {
    const promptPart =
      promptCount === 1 ? "1 tracked prompt" : `${promptCount} tracked prompts`;
    if (obsCount > 0) {
      reasons.push(
        `Affects ${promptPart} across ${obsCount} observation${obsCount === 1 ? "" : "s"}.`,
      );
    } else {
      reasons.push(`Affects ${promptPart}.`);
    }
  }

  // Competitor pressure. `primaryPct` is already on a 0–100 scale per
  // recommendation-action-rows.ts:1238 (rounded integer). Threshold
  // matches the prioritizer's competitor-pressure bonus
  // (prioritize.ts:96-110 fires the bonus at ≥50%).
  const top = row.detail.topCompetitor;
  if (top && top.name.trim().length > 0) {
    if (top.primaryPct >= 50) {
      reasons.push(
        `${top.name} is primary on ${top.primaryPct}% of those prompts.`,
      );
    } else if (top.primaryPct > 0) {
      reasons.push(
        `${top.name} is competing for those prompts (primary on ${top.primaryPct}%).`,
      );
    }
  }

  // Confidence sentence — always available; CONFIDENCE_SENTENCE covers
  // the full DerivedConfidence union.
  reasons.push(CONFIDENCE_SENTENCE[row.derivedConfidence]);

  return reasons;
}

export function WhyRankedHere({ row }: { row: WhyRankedHereRow }) {
  const reasons = composeWhyRankedReasons(row);
  if (reasons.length === 0) return null;
  return (
    <details
      data-rec-why-ranked="true"
      className="group block text-[12px] leading-relaxed"
    >
      <summary
        className="cursor-pointer select-none list-none inline-flex items-center gap-1.5 text-muted-foreground/80 hover:text-muted-foreground"
        aria-label="Why is this recommendation ranked here?"
      >
        <span aria-hidden="true" className="text-[10px]">
          ›
        </span>
        <span className="underline decoration-dotted underline-offset-2">
          Why ranked here?
        </span>
      </summary>
      <ul
        className="mt-2 ml-2 max-w-prose space-y-1 text-foreground/90 border-l-2 border-muted/40 pl-3 list-disc list-outside marker:text-muted-foreground/40"
        data-rec-why-ranked-list="true"
      >
        {reasons.map((r, i) => (
          <li key={i} className="ml-3">
            {r}
          </li>
        ))}
      </ul>
    </details>
  );
}
