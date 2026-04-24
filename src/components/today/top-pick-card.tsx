import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RecommendationType } from "@/domains/recommendations/generate";

/**
 * Today "Top pick" card (Phase v6 Commit 5, 2026-04-23).
 *
 * Pulls the first queue item from /recommendations and surfaces it on
 * Today as a single opinionated suggestion. Opens the full queue with
 * the row anchor so the operator can accept in one click.
 *
 * Deliberately narrower than the old action-card surfaces: one title,
 * one-line reasoning, type badge, and a single link. No action buttons
 * inline — the accept / defer / dismiss buttons live on /recommendations.
 */

export type TopPickSummary = {
  stableKey: string;
  type: RecommendationType;
  title: string;
  reasoning: string;
  tier: "now" | "this_week" | "later";
};

const TYPE_LABEL: Record<RecommendationType, string> = {
  create_cluster_page: "Create page",
  create_single: "Create page",
  target_competitors: "Target",
  strengthen_page_copy: "Strengthen",
  watch_winning_cluster: "Watch",
};

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
          {TYPE_LABEL[pick.type]}
        </span>
      </div>
      <h3 className="mt-1 text-[14px] font-semibold text-foreground leading-snug">
        {pick.title}
      </h3>
      <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
        {pick.reasoning}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Open queue →
      </p>
    </Link>
  );
}
