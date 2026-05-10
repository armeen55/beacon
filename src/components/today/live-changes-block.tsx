/**
 * LiveChangesBlock — /today surface for currently-live shipped changes.
 *
 * Audit Correction #1 follow-up (2026-05-08). Surfaces the
 * `verified_live` rec_edit rows the lifecycle loop has produced,
 * alongside the dynamic state Beacon is currently watching for.
 *
 * Empty state: renders `null`. The lifecycle-strip count chip
 * already says "0 live verified" when the count is zero; this block
 * is additive — it complements the strip with a *detail* surface
 * when there ARE live changes worth describing.
 *
 * Honesty contract (mirrors the data builder in
 * `src/domains/today/live-changes-data.ts`):
 *   - Never claims a rec is "validated", "proven", "confirmed",
 *     "winning", or "won". The data builder enforces this on its
 *     side; this component only renders fields the builder produces.
 *   - Never displays a static "verdict expected on date X" countdown.
 *     The builder picks dynamic-state copy per current verdict /
 *     pre-verdict / very-recent.
 *   - Surfaces the live-at date as a relative phrase ("3 days ago"),
 *     never as "wait until X to know."
 *
 * Pure presentational. No I/O. Safe in client components.
 */

import Link from "next/link";

import type { TodayLiveChange } from "@/domains/today/live-changes-data";
import { EarlySignalPill } from "@/components/display/early-signal-pill";

export type LiveChangesBlockProps = {
  liveChanges: ReadonlyArray<TodayLiveChange>;
};

function relativeLiveAt(daysSinceLive: number): string {
  if (daysSinceLive === 0) return "today";
  if (daysSinceLive === 1) return "1 day ago";
  return `${daysSinceLive} days ago`;
}

export function LiveChangesBlock({ liveChanges }: LiveChangesBlockProps) {
  if (liveChanges.length === 0) return null;

  const headerSuffix = liveChanges.length === 1 ? "" : ` (${liveChanges.length})`;

  return (
    <section
      data-today-live-changes="true"
      className="rounded-lg border border-status-success/30 bg-status-success/[0.04] px-4 py-3"
    >
      <header className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-status-success">
          Live changes{headerSuffix}
        </h3>
        <p className="text-[11px] text-muted-foreground/85">
          Beacon found these shipped changes and is monitoring impact as new
          AI readings land.
        </p>
      </header>

      <ul className="space-y-2.5" data-today-live-changes-list="true">
        {liveChanges.map((change) => {
          const detailHref = change.changelogId
            ? `/changes/${change.changelogId}`
            : "/changes";
          return (
            <li
              key={change.recEditId}
              data-today-live-change-row="true"
              data-rec-id={change.recId}
              className="rounded-md border border-border/40 bg-background/80 px-3 py-2"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="font-medium text-foreground text-[13px] leading-snug">
                  {change.displayLabel}
                </p>
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                  Live {relativeLiveAt(change.daysSinceLive)}
                </span>
                {/* Renders amber "Early signs of lift" only when verdict==="weak_signal";
                    null for every other verdict — calm fallback. Same component
                    used in scorecard-client.tsx so copy stays operator-locked. */}
                <EarlySignalPill verdict={change.currentVerdict} compact />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                {change.targetUrl}
                {change.topicTargeted ? ` · ${change.topicTargeted}` : ""}
              </p>
              <p
                className="mt-1.5 text-[12px] text-foreground/95 leading-snug"
                data-today-live-change-state="true"
              >
                {change.stateLine}
              </p>
              <p
                className="mt-0.5 text-[11px] text-muted-foreground/80 leading-snug italic"
                data-today-live-change-next="true"
              >
                {change.nextEvidenceLine}
              </p>
              <Link
                href={detailHref}
                className="mt-1.5 inline-block text-[11px] text-accent-primary underline decoration-dotted underline-offset-2 hover:text-accent-primary/80"
                data-today-live-change-link="true"
              >
                View details →
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
