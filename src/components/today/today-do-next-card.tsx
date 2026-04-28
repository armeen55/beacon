/**
 * Phase 6A.8 (2026-04-28) — Today "Do Next" decision card.
 *
 * Single opinionated card at the top of /today (after critical alerts)
 * that tells the operator the one thing to do next, by priority:
 *
 *   1. If pending implementation queue is non-empty → ship the top
 *      accepted edit. Strongest signal: the operator already accepted
 *      a Beacon recommendation; their next move is to implement it on
 *      the site so the next scan can verify it live.
 *   2. Else if a top recommendation exists → decide on it. Same logic
 *      that powered the pre-restructure `TopPickCard`.
 *   3. Else if scan diffs include critical/important findings →
 *      review them.
 *   4. Else → render nothing (calm Today).
 *
 * Pure presentation. The decision rule is deterministic and locked
 * by tests so the priority can't drift.
 */

import Link from "next/link";

import type { TodayLifecycleQueueItem } from "@/app/(shell)/today-data";
import type { TopPickSummary } from "./top-pick-card";

export type DoNextDecision =
  | {
      kind: "ship_pending";
      edit: TodayLifecycleQueueItem;
      pendingCount: number;
    }
  | {
      kind: "decide_recommendation";
      pick: TopPickSummary;
    }
  | {
      kind: "review_scan_diffs";
      criticalCount: number;
      importantCount: number;
      totalCount: number;
    }
  | { kind: "calm" };

export type TodayDoNextCardProps = {
  pendingQueue: TodayLifecycleQueueItem[];
  pendingCount: number;
  topPick: TopPickSummary | null;
  /** Findings strip data — only `criticalCount`+`importantCount`+`totalCount` consulted. */
  findingsCriticalCount: number;
  findingsImportantCount: number;
  findingsTotalCount: number;
  className?: string;
};

/**
 * Pure decision rule — exported for unit testing without a renderer.
 * The priority order is:
 *   pending_impl > top_pick > scan_diffs(if critical/important) > calm
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
  if (input.topPick) {
    return { kind: "decide_recommendation", pick: input.topPick };
  }
  if (input.findingsCriticalCount > 0 || input.findingsImportantCount > 0) {
    return {
      kind: "review_scan_diffs",
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

  if (decision.kind === "decide_recommendation") {
    // Reuse a thin presentation similar to TopPickCard but inline so the
    // Do Next card has a single visual contract.
    const pick = decision.pick;
    return (
      <article
        className={`rounded-lg border border-accent-primary/35 bg-accent-primary/[0.04] px-5 py-4 ${props.className ?? ""}`}
        data-today-do-next="decide_recommendation"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-accent-primary">
          Do next · decide on this
        </span>
        <p className="mt-1.5 text-[14px] font-semibold text-foreground leading-snug">
          {pick.title}
        </p>
        {pick.reasoning && (
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            {pick.reasoning}
          </p>
        )}
        <div className="mt-3 text-[11px] font-semibold">
          <Link
            href="/recommendations"
            className="text-accent-primary hover:underline"
            data-do-next-cta="primary"
          >
            Open recommendation →
          </Link>
        </div>
      </article>
    );
  }

  if (decision.kind === "review_scan_diffs") {
    const tone =
      decision.criticalCount > 0
        ? "border-status-danger/40 bg-status-danger/[0.05] text-status-danger"
        : "border-status-warning/40 bg-status-warning/[0.04] text-status-warning";
    const headline =
      decision.criticalCount > 0
        ? `${decision.criticalCount} critical scan diff${decision.criticalCount === 1 ? "" : "s"} need review`
        : `${decision.importantCount} important scan diff${decision.importantCount === 1 ? "" : "s"} to review`;
    return (
      <article
        className={`rounded-lg border px-5 py-4 ${tone} ${props.className ?? ""}`}
        data-today-do-next="review_scan_diffs"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Do next · review scan diffs
        </span>
        <p className="mt-1.5 text-[14px] font-semibold leading-snug">{headline}</p>
        <p className="mt-1 text-[11px] opacity-80 leading-relaxed">
          {decision.totalCount} total diff{decision.totalCount === 1 ? "" : "s"}{" "}
          waiting for confirm or dismiss.
        </p>
        <div className="mt-3 text-[11px] font-semibold">
          <a
            href="#change-review-section"
            className="hover:underline"
            data-do-next-cta="primary"
          >
            Review scan diffs ↓
          </a>
        </div>
      </article>
    );
  }

  return null;
}
