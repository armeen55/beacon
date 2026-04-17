"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { ActionCard, type ActionCardProps } from "./action-card";

export type FindingsStripData = {
  totalCount: number;
  criticalCount: number;
  importantCount: number;
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
          <p className="text-[14px] font-semibold text-foreground/80">No actions right now</p>
          <p className="text-[12px] text-muted-foreground/60 mt-2 max-w-[280px] mx-auto leading-relaxed">
            Beacon will surface recommendations when it detects opportunities in your data.
          </p>
        </div>
      )}

      {/* Findings strip */}
      {findings.totalCount > 0 && (
        <Link
          href="/pages"
          className={cn(
            "flex items-center justify-between rounded-lg border px-4 py-2.5 text-[12px] transition-colors hover:bg-surface-inset/30",
            findings.criticalCount > 0
              ? "border-status-danger/30 bg-status-danger/[0.03]"
              : "border-border/50",
          )}
        >
          <span className="text-foreground font-medium">
            {findings.totalCount} issue{findings.totalCount !== 1 ? "s" : ""} detected
            {findings.criticalCount > 0 && (
              <span className="text-status-danger ml-1.5">
                · {findings.criticalCount} critical
              </span>
            )}
            {findings.importantCount > 0 && findings.criticalCount === 0 && (
              <span className="text-status-warning ml-1.5">
                · {findings.importantCount} important
              </span>
            )}
          </span>
          <span className="text-accent-primary font-medium shrink-0 ml-3">
            View in Pages →
          </span>
        </Link>
      )}

      {actionMsg && (
        <p className="text-[10px] text-status-success font-medium px-1">{actionMsg}</p>
      )}
    </div>
  );
}
