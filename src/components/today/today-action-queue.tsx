"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { ActionCard, type ActionCardProps } from "./action-card";
import { compactStripLabel } from "@/lib/site-findings-labels";

export type FindingsStripData = {
  totalCount: number;
  criticalCount: number;
  importantCount: number;
  /** Short human-readable breakdown by finding type, e.g. "12 missing FAQ schema · 8 low extractability". Optional — falls back to the generic count if absent. */
  typeBreakdownLabel?: string | null;
};

export function TodayActionQueue({
  primaryAction,
  secondaryAction,
  moreActions = [],
  findings,
  onRespondToRec,
  onStartExperiment,
  pending,
  startTransition,
  actionMsg,
  setActionMsg,
  truthBlocked,
}: {
  primaryAction: ActionCardProps["action"] | null;
  secondaryAction: ActionCardProps["action"] | null;
  /** Brain-action stack beyond the primary + secondary slots. Up to 2 extra. */
  moreActions?: ActionCardProps["action"][];
  findings: FindingsStripData;
  onRespondToRec?: (recId: string, status: "accepted" | "dismissed" | "deferred") => Promise<{ success: boolean }>;
  onStartExperiment?: (opts: {
    recId: string;
    headline: string;
    recType: string;
    targetPageUrl: string | null;
    targetPagePath: string | null;
    watchAfter: string;
    operatorNote: string;
    baselineCitations: number | null;
  }) => Promise<{ success: boolean; experimentId: string }>;
  pending: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
  actionMsg: string | null;
  setActionMsg: (s: string | null) => void;
  truthBlocked: boolean;
}) {
  const hasActions =
    primaryAction || secondaryAction || moreActions.length > 0;

  return (
    <div className="space-y-4">
      {primaryAction && (
        <ActionCard
          action={primaryAction}
          variant="primary"
          onRespondToRec={onRespondToRec}
          onStartExperiment={onStartExperiment}
          pending={pending}
          startTransition={startTransition}
          actionMsg={actionMsg}
          setActionMsg={setActionMsg}
          dimmed={truthBlocked}
        />
      )}

      {secondaryAction && (
        <ActionCard
          action={secondaryAction}
          variant="secondary"
          onRespondToRec={onRespondToRec}
          onStartExperiment={onStartExperiment}
          pending={pending}
          startTransition={startTransition}
          actionMsg={null}
          setActionMsg={setActionMsg}
          dimmed={truthBlocked}
        />
      )}

      {moreActions.map((a) => (
        <ActionCard
          key={a.id}
          action={a}
          variant="secondary"
          onRespondToRec={onRespondToRec}
          onStartExperiment={onStartExperiment}
          pending={pending}
          startTransition={startTransition}
          actionMsg={null}
          setActionMsg={setActionMsg}
          dimmed={truthBlocked}
        />
      ))}

      {!hasActions && !truthBlocked && (
        <div className="rounded-lg border border-border/50 bg-surface-raised/30 px-5 py-8 text-center">
          <p className="text-[14px] font-semibold text-foreground/80">Nothing to do right now</p>
          <p className="text-[12px] text-muted-foreground/60 mt-2 max-w-[280px] mx-auto leading-relaxed">
            Beacon will show you things to try when it spots them in your data.
          </p>
        </div>
      )}

      {/* Findings strip — UX.6.2 (2026-05-07): unified vocabulary.
          Pre-fix said "{N} page issues — {N} urgent", which was a
          THIRD competing name for the same scan_findings layer that
          also appeared as "scan diffs" on Do Next and "Scan diffs to
          review" on the bottom accordion. Now reads
          "{N} site findings · {M} important" via `compactStripLabel`,
          matching the rest of /today's vocabulary. The full
          type-breakdown (e.g. "12 missing FAQ schema · 8 low
          extractability") still flows through
          `findings.typeBreakdownLabel` as the hover-title tooltip.
          T2 (2026-05-05) original behavior preserved: short summary
          on default surface; deep breakdown on /pages.
          Bonus: replaces a prior literal "·" rendering bug
          where the JSX inserted the 6-character escape sequence
          instead of a "·" middle dot. */}
      {findings.totalCount > 0 && (
        <Link
          href="/pages"
          className={cn(
            "flex items-center justify-between rounded-lg border px-4 py-2.5 text-[12px] transition-colors hover:bg-surface-inset/30",
            findings.criticalCount > 0
              ? "border-status-danger/30 bg-status-danger/[0.03]"
              : "border-border/50",
          )}
          title={findings.typeBreakdownLabel ?? undefined}
          data-findings-strip="true"
        >
          <span
            className={cn(
              "font-medium",
              findings.criticalCount > 0
                ? "text-status-danger"
                : "text-foreground",
            )}
          >
            {compactStripLabel({
              total: findings.totalCount,
              important: findings.importantCount,
              critical: findings.criticalCount,
            })}
          </span>
          <span className="text-accent-primary font-medium shrink-0 ml-3">
            See on Pages →
          </span>
        </Link>
      )}

      {actionMsg && (
        <p className="text-[10px] text-status-success font-medium px-1">{actionMsg}</p>
      )}
    </div>
  );
}
