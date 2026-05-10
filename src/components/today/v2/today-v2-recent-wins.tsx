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
import type { TodayPrimaryAction } from "@/app/(shell)/today-client";

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

export function TodayV2RecentWins(props: RecentWinsProps) {
  const rows = buildRows(props);

  if (rows.length === 0) {
    return (
      <article
        className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 h-full flex flex-col"
        data-today-v2-card="recent-wins"
        data-today-v2-empty="true"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Recent wins
        </span>
        <p className="mt-2 text-[14px] font-semibold text-foreground leading-snug">
          No measured wins yet.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          When a change you ship lifts AI visibility, the proof shows up here.
          Typically 3–7 days after the change goes live.
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
      className="rounded-lg border border-status-success/30 bg-status-success/[0.04] px-5 py-5 h-full flex flex-col"
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
          <li key={row.key} data-today-v2-win-row="true">
            <Link
              href={row.href}
              className="block group hover:bg-background/40 -mx-2 px-2 py-1 rounded transition-colors"
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
