/**
 * TodayV2DoToday — single "Do Today" card for the v2 /today layout.
 *
 * Bundle 1 of the UI redesign (Plan: i-want-a-maximum-depth-curried-curry).
 * Replaces the v1 stack of TopPickCard + TodayPrimaryAction + SecondaryAction
 * + MoreActions + TodayDoNextCard with a SINGLE opinionated card that surfaces
 * exactly one action: the highest-priority recommendation Beacon thinks the
 * operator should ship today.
 *
 * Pure presentation. Reads already-loaded props from today-data.ts; no I/O.
 * Empty state renders a calm "watching" message rather than a zero-card hole.
 */

import Link from "next/link";
import type { TodayPrimaryAction } from "@/app/(shell)/today-shared-types";

const CONFIDENCE_LABEL: Record<TodayPrimaryAction["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const CONFIDENCE_DOT: Record<TodayPrimaryAction["confidence"], string> = {
  high: "bg-status-success",
  medium: "bg-status-warning",
  low: "bg-muted-foreground/50",
};

export function TodayV2DoToday({
  primaryAction,
}: {
  primaryAction: TodayPrimaryAction | null;
}) {
  if (!primaryAction) {
    return (
      <article
        className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 h-full flex flex-col"
        data-today-v2-card="do-today"
        data-today-v2-empty="true"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Do today
        </span>
        <p className="mt-2 text-[14px] font-semibold text-foreground leading-snug">
          Nothing to ship right now.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          No new recommendations right now. Refresh your connected data
          (Settings → Connectors) to surface fresh search demand or content
          gaps on your pages.
        </p>
        <div className="mt-auto pt-4">
          <Link
            href="/recommendations"
            className="text-[12px] font-semibold text-accent-primary hover:underline"
          >
            Open recommendations →
          </Link>
        </div>
      </article>
    );
  }

  // Lead with the EVIDENCE (rationale: "people searched X 2,498 times…",
  // "this page is getting -38%…") — that's what makes Beacon read like a
  // sharp SEO, not a to-do app. The outcome line is secondary and only
  // shows when it adds something the rationale didn't already say.
  const rationale = primaryAction.rationale?.trim() || null;
  const expectedRaw =
    primaryAction.expectedMetric ??
    primaryAction.expectedOutcome ??
    null;
  const expected =
    expectedRaw && expectedRaw.trim() && expectedRaw.trim() !== rationale
      ? expectedRaw.trim()
      : null;

  return (
    <article
      className="rounded-lg border border-accent-primary/30 bg-accent-primary/[0.04] px-5 py-5 h-full flex flex-col"
      data-today-v2-card="do-today"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-accent-primary">
          Do today
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          <span
            className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[primaryAction.confidence]}`}
            aria-hidden="true"
          />
          {CONFIDENCE_LABEL[primaryAction.confidence]}
        </span>
      </div>

      <h3 className="mt-2 text-[15px] font-semibold text-foreground leading-snug">
        {primaryAction.headline}
      </h3>

      {primaryAction.targetPagePath && (
        <p className="mt-1 text-[11px] font-mono text-muted-foreground/80 truncate">
          {primaryAction.targetPagePath}
        </p>
      )}

      {rationale && (
        <p className="mt-2 text-[12px] text-foreground/85 leading-relaxed">
          {rationale}
        </p>
      )}

      {expected && (
        <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
          {expected}
        </p>
      )}

      {primaryAction.priorSuccess && (
        <p className="mt-2 text-[11px] text-status-success/90 leading-relaxed">
          ↻ Worked before on{" "}
          <span className="font-mono">{primaryAction.priorSuccess.pagePath}</span>
          {primaryAction.priorSuccess.citationDelta > 0
            ? ` (+${primaryAction.priorSuccess.citationDelta} mentions)`
            : ""}
        </p>
      )}

      <div className="mt-auto pt-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-[12px] font-semibold">
        <Link
          href={primaryAction.href}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent-primary px-4 py-2.5 text-background transition-colors hover:bg-accent-primary/90 sm:w-auto"
          data-today-v2-cta="primary"
        >
          Review &amp; edit →
        </Link>
        <Link
          href="/recommendations"
          className="inline-flex min-h-[44px] items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          data-today-v2-cta="view-all"
        >
          See all
        </Link>
      </div>
    </article>
  );
}
