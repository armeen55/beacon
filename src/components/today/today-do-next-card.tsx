/**
 * Phase 6A.8 (2026-04-28) — Today "Do Next" decision card.
 *
 * UX.6.2 (2026-05-07) — vocabulary + duplication cleanup:
 *
 *   - The `decide_recommendation` branch was DROPPED. Pre-fix it
 *     rendered the same top-pick rec already shown by the Command
 *     Center's NextBestActionCard AND by the Action Queue's primary
 *     ActionCard — three copies of the same paragraph. Now Command
 *     Center is the summary, Action Queue is the workbench, and
 *     Do Next stays focused on the two cases CC doesn't cover:
 *     pending-impl-to-ship + site findings to review.
 *   - The `review_scan_diffs` branch was renamed to use the unified
 *     "Site findings" vocabulary (see `lib/site-findings-labels.ts`)
 *     and uses calmer neutral styling when only `important`-priority
 *     findings exist. Critical findings keep the danger styling.
 *
 * Single opinionated card at the top of /today (after critical alerts)
 * that tells the operator the one thing to do next, by priority:
 *
 *   1. If pending implementation queue is non-empty → ship the top
 *      accepted edit. Strongest signal: the operator already accepted
 *      a Beacon recommendation; their next move is to implement it on
 *      the site so the next scan can verify it live.
 *   2. Else if scan findings include critical/important priority →
 *      review them as a SITE FINDINGS surface. Calmer styling unless
 *      critical fires.
 *   3. Else → render nothing (calm Today).
 *
 * Pure presentation. The decision rule is deterministic and locked
 * by tests so the priority can't drift.
 */

import Link from "next/link";

import type { TodayLifecycleQueueItem } from "@/app/(shell)/today-data";
import type { TopPickSummary } from "./top-pick-card";
import {
  doNextHeadline,
  doNextSubtitle,
} from "@/lib/site-findings-labels";

export type DoNextDecision =
  | {
      kind: "ship_pending";
      edit: TodayLifecycleQueueItem;
      pendingCount: number;
    }
  | {
      kind: "review_site_findings";
      criticalCount: number;
      importantCount: number;
      totalCount: number;
    }
  | { kind: "calm" };

export type TodayDoNextCardProps = {
  pendingQueue: TodayLifecycleQueueItem[];
  pendingCount: number;
  /** Top-pick is consumed by the Command Center NextBestActionCard
   *  and by the Action Queue's primary ActionCard. Do Next no longer
   *  surfaces it (UX.6.2 — duplication cleanup). The prop stays in
   *  the type so callers don't need a refactor; it's currently
   *  unused. Tagged `_topPick` so lints don't flag it. */
  topPick?: TopPickSummary | null;
  /** Findings strip data — only `criticalCount`+`importantCount`+`totalCount` consulted. */
  findingsCriticalCount: number;
  findingsImportantCount: number;
  findingsTotalCount: number;
  className?: string;
};

/**
 * Pure decision rule — exported for unit testing without a renderer.
 * The priority order is:
 *   pending_impl > site_findings(if critical/important) > calm
 *
 * UX.6.2 (2026-05-07) — `decide_recommendation` outcome was removed
 * because the Command Center's NextBestActionCard already presents
 * the top-pick rec, and the Action Queue's primary ActionCard already
 * presents its full body. Do Next no longer triplicates.
 */
export function decideDoNext(
  input: Omit<TodayDoNextCardProps, "className">,
): DoNextDecision {
  if (input.pendingQueue.length > 0) {
    return {
      kind: "ship_pending",
      edit: input.pendingQueue[0],
      pendingCount: input.pendingCount,
    };
  }
  if (input.findingsCriticalCount > 0 || input.findingsImportantCount > 0) {
    return {
      kind: "review_site_findings",
      criticalCount: input.findingsCriticalCount,
      importantCount: input.findingsImportantCount,
      totalCount: input.findingsTotalCount,
    };
  }
  return { kind: "calm" };
}

export function TodayDoNextCard(props: TodayDoNextCardProps) {
  const decision = decideDoNext(props);
  if (decision.kind === "calm") return null;

  if (decision.kind === "ship_pending") {
    const edit = decision.edit;
    const label = edit.display_label ?? edit.action_type;
    return (
      <article
        className={`rounded-lg border border-status-warning/40 bg-status-warning/[0.04] px-5 py-4 ${props.className ?? ""}`}
        data-today-do-next="ship_pending"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-status-warning">
            Do next · ship this
          </span>
          {decision.pendingCount > 1 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {decision.pendingCount} pending total
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[14px] font-semibold text-foreground leading-snug">
          {label}
        </p>
        {edit.target_url && (
          <p className="mt-1 text-[11px] font-mono text-muted-foreground/80 truncate">
            {edit.target_url}
          </p>
        )}
        {edit.needsRewrite && (
          <p className="mt-2 text-[11px] text-status-warning leading-relaxed">
            ⚠︎ Operator rewrite required: the proposed text is a generator
            placeholder. Edit before shipping.
          </p>
        )}
        <div className="mt-3 flex items-center gap-3 text-[11px] font-semibold">
          <Link
            href="/recommendations"
            className="text-accent-primary hover:underline"
            data-do-next-cta="primary"
          >
            Open recommendation →
          </Link>
          {decision.pendingCount > 1 && (
            <Link
              href="/changes?tab=pending_implementation"
              className="text-muted-foreground hover:text-foreground"
              data-do-next-cta="view-all"
            >
              View all pending
            </Link>
          )}
        </div>
      </article>
    );
  }

  if (decision.kind === "review_site_findings") {
    // UX.6.2 (2026-05-07) — calmer neutral styling when only
    // `important` priority findings exist. Reserve danger styling for
    // genuinely critical-priority findings. Pre-fix used warning-amber
    // for the important branch which made every "important" count
    // read as urgent.
    const tone =
      decision.criticalCount > 0
        ? "border-status-danger/40 bg-status-danger/[0.05] text-status-danger"
        : "border-border/60 bg-surface-inset/30 text-foreground";
    const headline = doNextHeadline({
      critical: decision.criticalCount,
      important: decision.importantCount,
    });
    const subtitle = doNextSubtitle({
      total: decision.totalCount,
      critical: decision.criticalCount,
      important: decision.importantCount,
    });
    return (
      <article
        className={`rounded-lg border px-5 py-4 ${tone} ${props.className ?? ""}`}
        data-today-do-next="review_site_findings"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          Site findings to review
        </span>
        <p className="mt-1.5 text-[14px] font-semibold leading-snug">{headline}</p>
        <p className="mt-1 text-[11px] opacity-80 leading-relaxed">
          {subtitle}
        </p>
        <div className="mt-3 text-[11px] font-semibold">
          <Link
            href="/pages"
            className="hover:underline"
            data-do-next-cta="primary"
          >
            Open site findings →
          </Link>
        </div>
      </article>
    );
  }

  return null;
}
