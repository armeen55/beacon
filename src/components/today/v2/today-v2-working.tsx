/**
 * TodayV2Working — "Working" card for the v2 /today layout.
 *
 * Bundle 1 of the UI redesign. Surfaces the changes the operator has
 * already shipped that Beacon is currently measuring. Replaces the v1
 * TodayLifecycleStrip + TodayImplementationQueue + LiveChangesBlock
 * triad with a single accountability lane.
 *
 * Honesty contract (mirrors LiveChangesBlock):
 *   - Never claims a verdict the data builder hasn't produced.
 *   - Never displays a "verdict expected on date X" countdown.
 *   - Surfaces relative dates ("3 days ago"), not absolute ISO strings.
 *
 * Empty state renders a calm "nothing in motion" message — never blank.
 */

import Link from "next/link";
import type { TodayLiveChange } from "@/domains/today/live-changes-data";

type WorkingProps = {
  liveChanges: ReadonlyArray<TodayLiveChange>;
  pendingImplementationCount: number;
};

function relativeDays(daysSinceLive: number): string {
  if (daysSinceLive === 0) return "today";
  if (daysSinceLive === 1) return "yesterday";
  return `${daysSinceLive} days ago`;
}

function verdictPill(verdict: TodayLiveChange["currentVerdict"]) {
  switch (verdict) {
    case "helping":
      return {
        label: "Helping",
        className: "bg-status-success/15 text-status-success",
      };
    case "hurting":
      return {
        label: "Hurting",
        className: "bg-status-danger/15 text-status-danger",
      };
    case "weak_signal":
      return {
        label: "Early signal",
        className: "bg-status-warning/15 text-status-warning",
      };
    case "too_early":
      return {
        label: "Measuring",
        className: "bg-muted-foreground/10 text-muted-foreground",
      };
    case "nothing_yet":
    default:
      return {
        label: "Watching",
        className: "bg-muted-foreground/10 text-muted-foreground",
      };
  }
}

export function TodayV2Working({
  liveChanges,
  pendingImplementationCount,
}: WorkingProps) {
  const visibleChanges = liveChanges.slice(0, 3);
  const hasContent =
    visibleChanges.length > 0 || pendingImplementationCount > 0;

  if (!hasContent) {
    return (
      <article
        className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 h-full flex flex-col"
        data-today-v2-card="working"
        data-today-v2-empty="true"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Working
        </span>
        <p className="mt-2 text-[14px] font-semibold text-foreground leading-snug">
          Nothing in motion right now.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          When you ship a change Beacon recommends, it shows up here so you can
          see what is being measured.
        </p>
        <div className="mt-auto pt-4">
          <Link
            href="/changes"
            className="text-[12px] font-semibold text-accent-primary hover:underline"
          >
            Open changes →
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 h-full flex flex-col"
      data-today-v2-card="working"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Working
        </span>
        {pendingImplementationCount > 0 && (
          <span className="text-[10px] text-muted-foreground/80 tabular-nums">
            {pendingImplementationCount} pending
          </span>
        )}
      </div>

      {visibleChanges.length === 0 ? (
        <p className="mt-2 text-[13px] text-foreground/90 leading-relaxed">
          You have {pendingImplementationCount} change
          {pendingImplementationCount === 1 ? "" : "s"} waiting to ship.
        </p>
      ) : (
        <ul className="mt-2 space-y-2.5" data-today-v2-working-list="true">
          {visibleChanges.map((change) => {
            const pill = verdictPill(change.currentVerdict);
            const href = change.changelogId
              ? `/changes/${change.changelogId}`
              : "/changes";
            return (
              <li key={change.recEditId} data-today-v2-working-row="true">
                <Link
                  href={href}
                  className="block group hover:bg-background/40 -mx-2 px-2 py-1 rounded transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium text-foreground leading-snug flex-1 min-w-0 truncate">
                      {change.displayLabel}
                    </p>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${pill.className} shrink-0`}
                    >
                      {pill.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80 leading-snug">
                    Live {relativeDays(change.daysSinceLive)}
                    {change.topicTargeted ? ` · ${change.topicTargeted}` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto pt-4 flex items-center gap-3 text-[12px] font-semibold">
        <Link
          href="/changes"
          className="text-accent-primary hover:underline"
          data-today-v2-cta="primary"
        >
          Open changes →
        </Link>
        {pendingImplementationCount > 0 && visibleChanges.length > 0 && (
          <Link
            // 2026-06-16: the legacy `/changes` table (which honored
            // `?tab=pending_implementation`) was deleted in the dual-surface
            // collapse, so the prior `?legacy=1` escape now no-ops. Point at
            // the live v2 `/changes` (matches the sibling pending CTAs in
            // implementation-queue + today-do-next-card). NOTE: v2 /changes
            // does not yet filter by tab — surfacing a deep-linked
            // pending-implementation view in v2 is a tracked follow-up.
            href="/changes?tab=pending_implementation"
            className="text-muted-foreground hover:text-foreground"
            data-today-v2-cta="pending"
          >
            View pending ({pendingImplementationCount})
          </Link>
        )}
      </div>
    </article>
  );
}
