/**
 * LearnedMoveLine (RANK-1, 2026-07-06) - the visible half of the learning loop on
 * ONE move card/row: the single honest, first-person line that tells the operator
 * WHY a move moved in the ranking after measured wins (or losses):
 *
 *   "I moved this up because your last 3 answer-block changes all won."
 *
 * SELF-HIDING: renders NOTHING (returns null) when there is no learned tag - a
 * fresh/undecided tenant, or a coin-flip bucket that did not re-rank anything,
 * sees no line at all (the copy layer nulls the tag; this component honors it).
 *
 * Runs the tag through the central dash stripper as a belt-and-suspenders guard
 * even though the copy is authored dash-free upstream (experiment-prior.tagFor),
 * so the primary surface can never leak an em/en dash. Tokens + primitives only;
 * the Beacon voice lives in the sentence itself.
 */

import { Brain } from "lucide-react";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

export function LearnedMoveLine({ tag }: { tag: string | null | undefined }) {
  if (!tag) return null;
  return (
    <p
      data-learned-move-line="true"
      className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-accent-primary-light px-2 py-0.5 text-meta font-medium text-accent-primary ring-1 ring-accent-primary-muted"
    >
      <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden /> {stripBannedDashes(tag)}
    </p>
  );
}
