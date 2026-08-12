/**
 * /changes proof timeline — single card.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit. Each card is one shipped (or watching) change in the
 * vertical timeline, rendered with:
 *
 *   • Plain-English title (the change_description).
 *   • Customer-friendly target URL when present.
 *   • Shipped date as a short calendar label.
 *   • ONE result pill (Helping / Hurting / Too early / No signal yet /
 *     Needs review / Live / Watching), driven by the pure resolver.
 *   • A one-line outcome blurb from the same resolver.
 *   • Optional pattern-timing line ("Similar changes usually show
 *     signal around day N") when the row has a readyOn prediction.
 *   • "Open change →" CTA → /changes/[id].
 *
 * Pure presentation. No client-side state, no server-action calls.
 * The card never renders raw schema fields, scores, ids, hashes, or
 * any internal vocabulary.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ProofPill } from "@/domains/decision/changes/proof-timeline/result-pill";
// Presentation component (pulled into the client bundle): import the client-safe
// action-types module directly, not the decision facade (which re-exports
// server-only modules).
import {
  isIndexingDirectiveActionType,
  INDEXING_DIRECTIVE_CAVEAT,
  type ActionType,
} from "@/domains/decision/changes/action-types";

import { ChangesV2ResultPill } from "./changes-v2-result-pill";

export type ChangesV2CardRow = {
  id: string;
  title: string;
  targetUrl: string | null;
  shippedAt: string;
  pill: ProofPill;
  patternTimingNarrative: string | null;
  /**
   * #310 / destructive-action safety (folded here from the retired
   * recommendation cards, 2026-07-21). The change's underlying edit action
   * type. When it is a crawl/index directive (robots.txt, meta noindex,
   * canonical, redirect/status) the card HOLDS it for review: it never offers
   * a one-tap live-confirm affordance and shows the plain-English hold notice
   * instead, so a wrong value can never ship in one tap. Type-driven, never
   * copy-driven. Optional/null on the common on-page-content change.
   */
  editActionType?: ActionType | null;
};

/**
 * Mark-shipped affordance state, threaded down from the client island.
 *
 * Parity with the legacy scorecard (`scorecard-client.tsx`): the per-row
 * "Mark shipped" button is shown ONLY when the linked recommended-edit's
 * implementation status is `accepted` (operator confirms an
 * already-accepted edit is live on the page). The card itself stays a
 * dumb presenter — the client island owns `useTransition`, the call to
 * `markChangelogEditShipped`, and the feedback text. When `onMarkShipped`
 * is omitted (e.g. pure render-to-string tests of the timeline that don't
 * exercise the action), no button renders.
 */
type ChangesV2CardMarkShipped = {
  /** True only when the linked edit is `accepted` (mirrors legacy gating). */
  canMarkShipped: boolean;
  /** Disable + show pending copy while the action is in flight. */
  pending: boolean;
  /** Feedback line under the button after the action resolves. */
  feedback: { message: string; isError: boolean } | null;
  /** Fire the server action for this row. */
  onMarkShipped: () => void;
};

export function ChangesV2Card({
  row,
  className,
  markShipped,
}: {
  row: ChangesV2CardRow;
  className?: string;
  markShipped?: ChangesV2CardMarkShipped;
}) {
  // #310 / destructive-action audit (folded here 2026-07-21 from the retired
  // recommendation cards) — crawl/index directives (robots.txt, meta noindex,
  // canonical, redirect/status) can DEINDEX a live site. They are HELD FOR
  // REVIEW: type-driven, never copy-driven. When true the card SUPPRESSES the
  // one-tap "I made this change" live-confirm affordance and routes the owner
  // to the change's review surface instead, so a wrong value can never ship in
  // one tap. The plain-English hold notice renders above the CTA row.
  const heldForReview = isIndexingDirectiveActionType(row.editActionType);
  const showMarkShipped = Boolean(
    !heldForReview && markShipped?.canMarkShipped && markShipped.onMarkShipped,
  );
  return (
    <article
      data-changes-card="proof-timeline"
      data-changes-card-id={row.id}
      className={cn(
        "rounded-lg border border-border/60 bg-surface-base px-4 py-4 transition-colors",
        "hover:border-border focus-within:border-border",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            // Two-line clamp keeps pathologically long titles from
            // breaking the card layout. The projection helper already
            // strips internal vocabulary; the clamp is the visual
            // backstop.
            className="text-[14px] font-semibold text-foreground leading-snug line-clamp-2 break-words"
            data-changes-card-title="true"
          >
            {row.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground min-w-0">
            {row.targetUrl && (
              <span
                className="font-mono truncate max-w-full sm:max-w-[280px]"
                data-changes-card-url="true"
                title={row.targetUrl}
              >
                {row.targetUrl}
              </span>
            )}
            <span
              className="tabular-nums whitespace-nowrap"
              data-changes-card-shipped-at="true"
            >
              {formatShippedAt(row.shippedAt)}
            </span>
          </div>
        </div>

        <ChangesV2ResultPill pill={row.pill} className="shrink-0" />
      </div>

      <p
        className="mt-2.5 text-[12.5px] leading-relaxed text-foreground/80"
        data-changes-card-blurb="true"
      >
        {row.pill.blurb}
      </p>

      {row.patternTimingNarrative && (
        <p
          className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed"
          data-changes-card-pattern-timing="true"
        >
          {row.patternTimingNarrative}
        </p>
      )}

      {/* #310 — indexing-safety hold notice. A crawl/index directive can
          DEINDEX a live site if applied wrong, so it is never presented as a
          casual one-tap change: the notice renders here and the one-tap
          live-confirm affordance below is suppressed. Benign on-page content
          changes render no notice. */}
      {heldForReview && (
        <p
          className="mt-3 rounded border border-status-warning/40 bg-status-warning/[0.08] px-2.5 py-2 text-[11.5px] leading-relaxed text-status-warning"
          role="alert"
          data-changes-card-indexing-caveat="true"
        >
          <span aria-hidden="true">⚠️ </span>
          {INDEXING_DIRECTIVE_CAVEAT}
        </p>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <Link
          // Preserve the v2 context — the proof brief at /changes/[id]
          // shares the same `?v2=1` switcher with the list page, so
          // customers stay on the v2 path through the click-through.
          // Visual: button-shaped affordance (not bare link text) so
          // "Open change" reads as the card's primary action.
          href={`/changes/${row.id}?v2=1`}
          prefetch={false}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border/60 bg-surface-inset/40",
            "px-2.5 py-1 text-[12px] font-semibold text-foreground/85 transition-colors",
            "hover:bg-surface-inset hover:text-foreground hover:border-border",
          )}
          data-changes-card-cta="open-change"
        >
          Open change
          <span aria-hidden className="text-accent-primary">→</span>
        </Link>

        {/* Mark-shipped affordance — parity with the legacy scorecard.
            Renders ONLY when the linked recommended-edit is `accepted`
            (operator confirms an already-accepted edit is live on the
            page). Same server action + payload as legacy, so persistence
            is identical. Feedback is announced via aria-live so assistive
            tech hears the result. Plain English, no automation claims. */}
        {showMarkShipped && markShipped && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={markShipped.pending}
              onClick={markShipped.onMarkShipped}
              className={cn(
                "inline-flex items-center rounded-md border border-accent-primary/40 bg-accent-primary/[0.06]",
                "px-2.5 py-1 text-[12px] font-semibold text-accent-primary transition-colors",
                "hover:bg-accent-primary/[0.12] disabled:opacity-50",
              )}
              title="Tells us this change is live on your site, so we start checking whether it helped right away."
              data-changes-card-mark-shipped="true"
            >
              {markShipped.pending ? "Saving…" : "Mark done"}
            </button>
            <p
              aria-live="polite"
              className={cn(
                "text-[11px] leading-snug text-right max-w-[220px]",
                markShipped.feedback
                  ? markShipped.feedback.isError
                    ? "text-status-danger"
                    : "text-status-success"
                  : "sr-only",
              )}
              data-changes-card-mark-shipped-feedback={
                markShipped.feedback
                  ? markShipped.feedback.isError
                    ? "error"
                    : "success"
                  : undefined
              }
            >
              {markShipped.feedback?.message ?? ""}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function formatShippedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
