/**
 * TodayV2RecentWins — "Recent wins" card for the v2 /today layout.
 *
 * Bundle 1 of the UI redesign. Replaces the v1 MeasuredWins +
 * "Latest signal" proof line + scattered ChangeReview wins with a
 * single proof rail showing the last few measured outcomes.
 *
 * Sources, in priority order:
 *   1. URL-verdict proof (the Z-score engine's clean per-page win,
 *      already loaded as `urlVerdictProof`).
 *   2. measuredWins from the recommendation tracker (helping_verdict
 *      ActionCards).
 *
 * Empty state is calm: "no measured wins yet" + a nudge toward the
 * Changes page where outcomes accumulate.
 */

import Link from "next/link";
import type { TodayPrimaryAction } from "@/app/(shell)/today-shared-types";

type UrlVerdictProof = {
  changeId: string;
  pagePath: string;
  changeDate: string | null;
  citationDeltaPct: number;
  deltaLabel: string;
};

type RecentWinsProps = {
  measuredWins: ReadonlyArray<TodayPrimaryAction>;
  urlVerdictProof: UrlVerdictProof | null;
};

type WinRow = {
  key: string;
  headline: string;
  subline: string;
  href: string;
};

function buildRows({
  measuredWins,
  urlVerdictProof,
}: RecentWinsProps): WinRow[] {
  const rows: WinRow[] = [];

  if (urlVerdictProof) {
    const subline = urlVerdictProof.changeDate
      ? `Up ${urlVerdictProof.deltaLabel} after your ${urlVerdictProof.changeDate} change`
      : `Up ${urlVerdictProof.deltaLabel}`;
    rows.push({
      key: `url-${urlVerdictProof.changeId}`,
      headline: urlVerdictProof.pagePath,
      subline,
      href: `/changes/${urlVerdictProof.changeId}`,
    });
  }

  for (const win of measuredWins) {
    if (rows.length >= 3) break;
    rows.push({
      key: win.id,
      headline: win.headline,
      subline:
        win.expectedMetric ??
        win.expectedOutcome ??
        "Beacon detected a measured lift after this change.",
      href: win.href,
    });
  }

  return rows.slice(0, 3);
}

/**
 * #402 — does this tenant have any measured wins to show? The parent
 * section uses this to decide whether to give the wins card a column at
 * all (an empty trophy case shouldn't eat a third of the action grid).
 * Keep this in lockstep with `buildRows`.
 */
export function hasRecentWins(props: RecentWinsProps): boolean {
  return buildRows(props).length > 0;
}

export function TodayV2RecentWins(props: RecentWinsProps) {
  const rows = buildRows(props);

  // #402 — render nothing when there are no measured wins. Previously
  // an empty-state <article> always occupied a grid column, leaving a
  // permanent empty trophy case. The parent now drops the column too
  // (see today-v2-sections.tsx hasRecentWins gate).
  if (rows.length === 0) {
    return null;
  }

  return (
    <article
      // `min-w-0` is the QA-pass-1 overflow defense — without it, a
      // long unbroken `urlVerdictProof.pagePath` inside the
      // `truncate` <p> can expand this card past its grid track and
      // force horizontal page scroll. Sibling `today-v2-working.tsx`
      // already defends against this on its own truncated row;
      // mirror the shape here.
      className="min-w-0 rounded-lg border border-status-success/30 bg-status-success/[0.04] px-5 py-5 h-full flex flex-col"
      data-today-v2-card="recent-wins"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-status-success">
          Recent wins
        </span>
        <span className="text-[10px] text-muted-foreground/80 tabular-nums">
          {rows.length} measured
        </span>
      </div>

      <ul className="mt-2 space-y-2.5" data-today-v2-wins-list="true">
        {rows.map((row) => (
          <li key={row.key} data-today-v2-win-row="true" className="min-w-0">
            <Link
              href={row.href}
              className="block group hover:bg-background/40 -mx-2 px-2 py-1 rounded transition-colors min-w-0"
            >
              <p className="text-[13px] font-medium text-foreground leading-snug truncate">
                {row.headline}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                {row.subline}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4 text-[12px] font-semibold">
        <Link
          href="/changes"
          className="text-accent-primary hover:underline"
          data-today-v2-cta="primary"
        >
          See all changes →
        </Link>
      </div>
    </article>
  );
}
