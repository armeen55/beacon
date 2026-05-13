import Link from "next/link";

import { ACTION_TYPE_REGISTRY } from "@/domains/recommendations/action-types";
import type { ActionType } from "@/domains/recommendations/action-types";

/**
 * Customer-safe "not found" state for /recommendations/[id].
 *
 * Renders when the four-step resolver in
 * `resolveRecommendationDetail` returns `kind: "miss"` — i.e., the
 * URL's id has no exact match, no actionable edit-id match, and no
 * actionable same-rec match. Calm, factual copy; no scary "dead end"
 * vocabulary; one-click route back to the recommendations list.
 *
 * 2026-05-13 P0 follow-up — accepts an optional `hint` produced by the
 * resolver. When the URL carries enough information to parse an
 * action_type (e.g., `add_h2_section` or `add_faq`), we surface a
 * short "what you were looking for" line so the operator can decide
 * whether to scroll the list for a similar current rec.
 */
export type RecommendationDetailNotFoundProps = {
  hint?: {
    stableKey: string | null;
    editId: string | null;
    actionType: string | null;
  };
};

function isValidActionType(s: string | null): s is ActionType {
  if (typeof s !== "string") return false;
  return Object.prototype.hasOwnProperty.call(ACTION_TYPE_REGISTRY, s);
}

function humanizeAction(actionType: ActionType): string {
  return ACTION_TYPE_REGISTRY[actionType].operatorLabel.toLowerCase();
}

export function RecommendationDetailNotFound({
  hint,
}: RecommendationDetailNotFoundProps = {}) {
  const action = isValidActionType(hint?.actionType ?? null)
    ? humanizeAction(hint!.actionType as ActionType)
    : null;

  return (
    <div
      className="max-w-4xl"
      data-recommendations-detail-not-found="true"
    >
      <Link
        href="/recommendations?v2=1"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        data-recommendations-detail-back="true"
      >
        ← Recommendations
      </Link>

      <section
        className="mt-6 rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
        role="status"
      >
        <p className="text-[14px] font-semibold text-foreground">
          This recommendation was replaced or already handled.
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
          The latest set of recommendations is on the main page.
        </p>

        {action && (
          <p
            className="mt-3 text-[11px] text-muted-foreground/85 leading-relaxed max-w-md mx-auto italic"
            data-recommendations-detail-not-found-hint="true"
          >
            Looking for a {action}? Open the recommendations list to see
            today&apos;s current set.
          </p>
        )}

        <Link
          href="/recommendations?v2=1"
          className="mt-4 inline-flex text-[12px] font-semibold text-accent-primary hover:underline"
          data-recommendations-detail-back-cta="true"
        >
          Back to recommendations →
        </Link>
      </section>
    </div>
  );
}
