/**
 * W3 Step 3.5 (2026-05-02) — Recommendation Engine v2 confidence pill.
 *
 * Renders the operator-facing label for `LiveRecQueueItem.engineConfidence`:
 *   high   → "Strong"
 *   medium → "Review"
 *   low    → "Weak signal"
 *
 * Operator-locked semantics (W3 §1.5 + Step 3.3 rubric):
 *   - "Strong" means "likely safe to ship MANUALLY after a brief
 *     operator review." It NEVER means "auto-apply" — there is no
 *     Apply-All-HIGH UX in W3, deferred until the founder personally
 *     inspects 20–30 generated recs and trusts the rubric.
 *   - The internal enum stays "high" / "medium" / "low" so logs +
 *     downstream consumers don't see copy drift; only the visible
 *     label changes.
 *   - Tooltip surfaces the diagnostic reason codes from the rubric
 *     (`engineConfidence.reasons`) for operators who want to know
 *     why a rec landed where it did. Codes stay machine-readable in
 *     the tooltip (the test invariant pins the codes; making them
 *     prose would force renames every time a rule shifts).
 *
 * Pure presentation. No state, no actions, no deps on auth.
 */

import { cn } from "@/lib/utils";
import type { RecConfidenceVerdict } from "@/domains/recommendations/confidence";

export type RecConfidencePillProps = {
  verdict: RecConfidenceVerdict;
  /** Optional className passthrough so callers can position the pill. */
  className?: string;
  /** When true (default), include the reason-codes tooltip. */
  showTooltip?: boolean;
};

/**
 * Operator-facing labels. KEEP SHORT; the pill sits in a busy header
 * row alongside other badges. The "Strong" wording deliberately
 * avoids "auto," "instant," "ready," or any claim that implies the
 * operator can ship without review.
 */
export const REC_CONFIDENCE_LABEL: Record<
  RecConfidenceVerdict["confidence"],
  string
> = {
  high: "Strong",
  medium: "Review",
  low: "Weak signal",
};

/**
 * One-line tooltip prefix per confidence tier. Surfaces the trust
 * contract directly so operators don't have to read the rubric file
 * to know what the label promises (and doesn't promise).
 */
const TOOLTIP_PREFIX: Record<
  RecConfidenceVerdict["confidence"],
  string
> = {
  high: "Strong: likely safe to ship after a brief review. Manual ship only — never auto-apply.",
  medium: "Review: useful, but inspect evidence + copy before shipping.",
  low: "Weak signal: thin or invalid evidence. Operator judgment required.",
};

const STYLE: Record<
  RecConfidenceVerdict["confidence"],
  { dot: string; pill: string }
> = {
  high: {
    dot: "bg-status-success",
    pill: "border-status-success/40 bg-status-success/[0.08] text-status-success",
  },
  medium: {
    dot: "bg-status-warning",
    pill: "border-status-warning/40 bg-status-warning/[0.08] text-status-warning",
  },
  low: {
    dot: "bg-muted-foreground/50",
    pill: "border-border/60 bg-surface-inset/40 text-muted-foreground",
  },
};

export function RecConfidencePill({
  verdict,
  className,
  showTooltip = true,
}: RecConfidencePillProps) {
  const s = STYLE[verdict.confidence];
  const label = REC_CONFIDENCE_LABEL[verdict.confidence];

  // Tooltip body: prefix + reason codes joined.
  const tooltip = showTooltip
    ? `${TOOLTIP_PREFIX[verdict.confidence]}${
        verdict.reasons.length > 0
          ? ` (reasons: ${verdict.reasons.join(", ")})`
          : ""
      }`
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold",
        s.pill,
        className,
      )}
      title={tooltip}
      data-rec-confidence={verdict.confidence}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.dot)} />
      {label}
    </span>
  );
}
