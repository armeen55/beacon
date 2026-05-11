/**
 * RecommendationsV2WorkingRail — right-rail "Working" lane for the
 * /recommendations?v2=1 layout. Surfaces recommendations the operator
 * has already accepted, deferred, shipped, or that are currently being
 * measured — so the page's main column can stay focused on the
 * "Suggested" stack while accountability for in-flight items has its
 * own surface.
 *
 * Pure presentation. Consumes the same `RecommendationActionRow[]`
 * the v2 card stack consumes; filters to the in-flight statuses and
 * caps at 5 rows. Empty state collapses the whole section (caller
 * controls layout — the rail returns `null` when no rows qualify).
 *
 * Bundle 2A — open-only. Each row links back into the legacy view
 * at its row anchor; the legacy drawer keeps owning the
 * accept / defer / dismiss surface for this first pass.
 */

import Link from "next/link";

import {
  ACTION_ROW_STATUS_LABEL,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import { cn } from "@/lib/utils";

const WORKING_STATUSES: ReadonlySet<ActionRowStatus> = new Set<ActionRowStatus>([
  "accepted",
  "shipped",
  "measuring",
  "needs_review",
]);

const STATUS_PILL_TONE: Record<ActionRowStatus, string> = {
  new: "bg-accent-primary/10 text-accent-primary",
  accepted: "bg-status-info/10 text-status-info",
  shipped: "bg-status-success/10 text-status-success",
  measuring: "bg-status-warning/10 text-status-warning",
  needs_review: "bg-muted-foreground/10 text-muted-foreground",
  needs_fresh_edit: "bg-muted-foreground/10 text-muted-foreground",
  dismissed: "bg-muted-foreground/10 text-muted-foreground",
  deferred: "bg-muted-foreground/10 text-muted-foreground",
};

export type RecommendationsV2WorkingRailProps = {
  rows: ReadonlyArray<RecommendationActionRow>;
  /** Optional override for the row's "Review" link target. Defaults
   *  to /recommendations?legacy=1#rec-<id>, mirroring the v2 card. */
  reviewHrefForRow?: (row: RecommendationActionRow) => string;
};

export function RecommendationsV2WorkingRail({
  rows,
  reviewHrefForRow,
}: RecommendationsV2WorkingRailProps) {
  const inFlight = rows.filter((r) => WORKING_STATUSES.has(r.status)).slice(0, 5);

  if (inFlight.length === 0) return null;

  return (
    <aside
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
      data-recommendations-v2-rail="working"
      aria-label="Working — recently accepted recommendations"
    >
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Working
        </span>
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          {inFlight.length} in flight
        </span>
      </header>

      <ul
        className="mt-3 space-y-2.5"
        data-recommendations-v2-rail-list="true"
      >
        {inFlight.map((row) => {
          const href =
            reviewHrefForRow?.(row) ??
            `/recommendations?legacy=1#rec-${encodeURIComponent(row.sourceRecommendationId)}`;
          return (
            <li
              key={row.id}
              data-recommendations-v2-rail-row="true"
              data-recommendations-v2-rail-row-status={row.status}
            >
              <Link
                href={href}
                className="block group rounded -mx-2 px-2 py-1 hover:bg-background/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium text-foreground leading-snug flex-1 min-w-0 truncate">
                    {row.title}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0",
                      STATUS_PILL_TONE[row.status],
                    )}
                  >
                    {ACTION_ROW_STATUS_LABEL[row.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground/80 leading-snug truncate">
                  {row.targetLabel}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
