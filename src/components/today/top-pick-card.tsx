import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RecommendationType } from "@/domains/recommendations/generate";
import type { RecommendationAction } from "@/domains/recommendations/resolved-types";

/**
 * Today "Top pick" card (Phase v6 Commit 5, 2026-04-23; revised v7
 * stabilization 2026-04-24).
 *
 * Pulls the first queue item from /recommendations and surfaces it on
 * Today. Reads the resolved action + URL so the title never leaks
 * internal generator titles like "Create a Shield: X page".
 */

export type TopPickSummary = {
  stableKey: string;
  /** Legacy candidate type — kept for back-compat but unused for display. */
  type: RecommendationType;
  /** Operator-facing title, already sanitized. */
  title: string;
  reasoning: string;
  tier: "now" | "this_week" | "later";
  /** Resolved final action (post-resolver). Drives the type badge. */
  action: RecommendationAction;
  /** Canonical URL when the resolver attached one; null when create_new_page / watch. */
  resolvedUrl: string | null;
};

const ACTION_LABEL: Record<RecommendationAction, string> = {
  strengthen_existing_page: "Strengthen",
  expand_existing_page: "Expand",
  add_section_or_faq: "Add section",
  create_new_page: "Create page",
  merge_or_dedupe: "Merge",
  split_or_separate_page: "Split",
  needs_review: "Review",
  watch: "Watch",
};

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}

const TIER_TONE: Record<
  TopPickSummary["tier"],
  { frame: string; label: string; tone: string }
> = {
  now: {
    frame: "border-status-danger/30 bg-status-danger/[0.03]",
    label: "Top pick · now",
    tone: "text-status-danger",
  },
  this_week: {
    frame: "border-status-warning/30 bg-status-warning/[0.03]",
    label: "Top pick · this week",
    tone: "text-status-warning",
  },
  later: {
    frame: "border-border/50 bg-surface-inset/30",
    label: "Top pick · later",
    tone: "text-muted-foreground",
  },
};

export function TopPickCard({ pick }: { pick: TopPickSummary }) {
  const meta = TIER_TONE[pick.tier];
  return (
    <Link
      href={`/recommendations#rec-${encodeURIComponent(pick.stableKey)}`}
      className={cn(
        "block rounded-lg border px-5 py-4 hover:border-accent-primary/40 transition-colors",
        meta.frame,
      )}
      aria-label="Top recommendation"
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider font-bold",
            meta.tone,
          )}
        >
          {meta.label}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
          {ACTION_LABEL[pick.action]}
        </span>
      </div>
      <h3 className="mt-1 text-[14px] font-semibold text-foreground leading-snug">
        {pick.title}
      </h3>
      {pick.resolvedUrl && (
        <p className="mt-1 text-[11px]">
          <span className="text-muted-foreground">→</span>{" "}
          <span className="text-accent-primary font-mono tabular-nums">
            {shortUrl(pick.resolvedUrl)}
          </span>
        </p>
      )}
      <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
        {pick.reasoning}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Open queue →
      </p>
    </Link>
  );
}
