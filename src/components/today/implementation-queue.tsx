/**
 * Phase 6A.7 (2026-04-28) — Today implementation queue card.
 *
 * Surfaces the top 5 `recommended_edits` rows in `accepted` state
 * with no `live_at` yet — i.e. edits the operator accepted but
 * hasn't shipped on the site. Lets the operator see "what should I
 * implement next?" at a glance instead of scrolling /recommendations.
 *
 * The data is server-computed in today-data.ts (sorted by updated_at
 * desc, sliced to 5, dismissed/recommended/etc. excluded). This
 * component is pure presentation: render the rows, link to the rec
 * detail page for full context. No write actions yet — those stay
 * on /recommendations.
 *
 * Calm empty state when zero rows: makes Today feel done rather than
 * empty.
 */

import Link from "next/link";

import { LifecycleStatusPill } from "@/components/display/lifecycle-status-pill";

export type TodayImplementationQueueProps = {
  queue: Array<{
    id: string;
    rec_id: string;
    action_type: string;
    target_url: string | null;
    display_label: string | null;
    proposed_text_preview: string | null;
    updated_at: string;
    /** Phase 6A.8 — true when the proposed text is a generator placeholder
     *  the operator must rewrite before the edit can ship. */
    needsRewrite?: boolean;
  }>;
  /** Total pending count across all accepted edits — when > queue.length
   *  we render a "+N more" footer linking to the Pending tab. */
  totalPendingCount: number;
  className?: string;
};

export function TodayImplementationQueue({
  queue,
  totalPendingCount,
  className,
}: TodayImplementationQueueProps) {
  if (queue.length === 0) {
    // UX.6.2 (2026-05-07) — empty-state compression. Pre-fix this
    // rendered a styled card ("Nothing waiting on you. Accepted
    // edits live here until the next scan finds them on the page.")
    // that took ~3 lines of vertical space without driving any
    // action. The TodayLifecycleStrip already shows the live-verified
    // count chip + a small "· nothing waiting" muted suffix when all
    // pending counts are zero, so the empty card is pure noise. Drop
    // it entirely — operators don't need a card to tell them there's
    // nothing to do.
    return null;
  }

  const overflow = Math.max(totalPendingCount - queue.length, 0);

  return (
    <div
      className={`rounded-lg border border-border/60 bg-surface-raised/40 ${className ?? ""}`}
      data-today-implementation-queue="populated"
      data-implementation-queue-rows={queue.length}
    >
      <div className="flex items-baseline justify-between px-4 pt-3 pb-1.5">
        <div>
          <h3 className="text-[12px] font-semibold text-foreground">
            Accepted edits waiting for site update
          </h3>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            Ship these on the site; the next scan will mark them Live.
          </p>
        </div>
        <Link
          href="/recommendations"
          className="text-[10px] font-semibold text-accent-primary hover:underline shrink-0"
        >
          Open recommendations →
        </Link>
      </div>
      <ul className="divide-y divide-border/40">
        {queue.map((item) => (
          <li
            key={item.id}
            className="flex items-baseline gap-3 px-4 py-2 text-[11px]"
            data-queue-row-id={item.id}
            data-queue-needs-rewrite={item.needsRewrite ? "true" : "false"}
          >
            <LifecycleStatusPill status="accepted" compact />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5 truncate">
                <span className="font-medium text-foreground/90 truncate">
                  {item.display_label ?? item.action_type}
                </span>
                {item.needsRewrite && (
                  <span
                    className="shrink-0 inline-flex items-center rounded border border-status-warning/40 bg-status-warning/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-status-warning"
                    title="The proposed text is a generator placeholder — rewrite it before shipping."
                  >
                    needs rewrite
                  </span>
                )}
              </div>
              {(item.target_url || item.proposed_text_preview) && (
                <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">
                  {item.target_url ?? item.proposed_text_preview}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <div className="px-4 py-2 border-t border-border/40 text-right">
          <Link
            href="/changes?tab=pending_implementation"
            className="text-[10px] font-semibold text-accent-primary hover:underline"
          >
            +{overflow} more pending →
          </Link>
        </div>
      )}
    </div>
  );
}
