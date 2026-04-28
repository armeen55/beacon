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
    return (
      <div
        className={`rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-3 ${className ?? ""}`}
        data-today-implementation-queue="empty"
      >
        <p className="text-[12px] font-semibold text-foreground">
          Nothing waiting on you.
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
          Accepted edits live here until the next scan finds them on the page.
        </p>
      </div>
    );
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
          >
            <LifecycleStatusPill status="accepted" compact />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground/90">
                {item.display_label ?? item.action_type}
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
            href="/changes"
            className="text-[10px] font-semibold text-accent-primary hover:underline"
          >
            +{overflow} more pending →
          </Link>
        </div>
      )}
    </div>
  );
}
