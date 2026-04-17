"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { REC_CONFIDENCE_LABEL } from "@/lib/confidence-labels";

export type ActionCardAction = {
  id: string;
  headline: string;
  rationale: string;
  expectedOutcome: string;
  sourceEvidence: string;
  priorityScore: number;
  bucket: "critical" | "high_leverage" | "opportunistic";
  type: string;
  confidence: "high" | "medium" | "low";
  href: string;
  responseStatus?: "accepted" | "dismissed" | "deferred" | null;
  confidenceReason?: string;
  watchAfter?: string;
  dataFreshness?: string | null;
  hasExperiment?: boolean;
  targetPageUrl?: string | null;
  targetPagePath?: string | null;
  baselineCitations?: number | null;
  sourceChangeId?: string | null;
  lineageBullets?: string[];
  answerContext?: string | null;
  specificMove?: string | null;
  actionClass?: string | null;
  targetSection?: string | null;
  priorSuccess?: { changeId: string; pagePath: string; description: string; citationDelta: number } | null;
  engineTiming?: { platform: string; medianDays: number; sampleCount: number }[] | null;
  expectedMetric?: string | null;
};

export type ActionCardProps = {
  action: ActionCardAction;
  variant: "primary" | "secondary";
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
  ) => Promise<{ success: boolean }>;
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
  dimmed?: boolean;
};

const BUCKET_STYLE: Record<string, { dot: string; label: string; border: string; bg: string }> = {
  critical: { dot: "bg-status-danger", label: "Critical", border: "border-status-danger/40", bg: "bg-status-danger/[0.03]" },
  high_leverage: { dot: "bg-status-success", label: "High leverage", border: "border-status-success/30", bg: "bg-status-success/[0.02]" },
  opportunistic: { dot: "bg-muted-foreground/60", label: "Opportunistic", border: "border-border/60", bg: "bg-surface-raised/30" },
};

const CONFIDENCE_LABEL = REC_CONFIDENCE_LABEL;

export function ActionCard({
  action,
  variant,
  onRespondToRec,
  onStartExperiment,
  pending,
  startTransition,
  actionMsg,
  setActionMsg,
  dimmed = false,
}: ActionCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const bs = BUCKET_STYLE[action.bucket] ?? BUCKET_STYLE.opportunistic;
  const isPrimary = variant === "primary";

  return (
    <div
      className={cn(
        "rounded-lg border px-5 pt-4 pb-5",
        dimmed
          ? "border-border/40 bg-surface-inset/20 opacity-[0.65]"
          : cn(bs.border, bs.bg),
        !isPrimary && "border-border/50 bg-surface-raised/20 px-4 pt-3 pb-4",
      )}
    >
      {/* Header: bucket + confidence */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", dimmed ? "bg-muted-foreground/40" : bs.dot)} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {bs.label}
          </span>
        </span>
        <span className={cn(
          "text-[10px] font-medium",
          action.confidence === "high" ? "text-status-success/80" : "text-muted-foreground/50",
        )}>
          {CONFIDENCE_LABEL[action.confidence]}
        </span>
      </div>

      {/* Headline */}
      <p className={cn(
        "font-extrabold tracking-tight leading-snug text-foreground",
        isPrimary ? "text-[17px]" : "text-[14px]",
      )}>
        {action.headline}
      </p>

      {/* Prior success + expected metric chips */}
      {(action.priorSuccess || action.expectedMetric || action.engineTiming) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {action.priorSuccess && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-success/10 text-[10px] font-medium text-status-success">
              Worked on {action.priorSuccess.pagePath}: +{Math.round(action.priorSuccess.citationDelta)}%
            </span>
          )}
          {action.expectedMetric && !action.priorSuccess && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-primary/10 text-[10px] font-medium text-accent-primary">
              {action.expectedMetric}
            </span>
          )}
          {action.engineTiming && action.engineTiming.length > 0 && (() => {
            const sorted = [...action.engineTiming].sort((a, b) => a.medianDays - b.medianDays);
            const allSame = sorted.every(t => t.medianDays === sorted[0].medianDays);
            if (allSame && sorted.length > 1) {
              const lo = Math.max(sorted[0].medianDays - 14, 7);
              const hi = sorted[0].medianDays + 5;
              return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-inset/50 text-[9px] text-muted-foreground/60">
                  Signal: {lo}–{hi} days
                </span>
              );
            }
            return sorted.map(t => (
              <span key={t.platform} className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-inset/50 text-[9px] text-muted-foreground/60">
                {t.platform} ~{t.medianDays}d
              </span>
            ));
          })()}
        </div>
      )}

      {/* Rationale */}
      <p className={cn(
        "text-muted-foreground leading-relaxed mt-2",
        isPrimary ? "text-[13px]" : "text-[12px]",
      )}>
        {action.rationale}
      </p>

      {/* CTA row */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {action.responseStatus !== "accepted" && (
          <>
            {onStartExperiment && onRespondToRec && (
              <button
                type="button"
                onClick={() => {
                  const note = prompt("What did you change or plan to change? (short note)");
                  if (note === null) return;
                  startTransition(async () => {
                    await onRespondToRec(action.id, "accepted");
                    await onStartExperiment({
                      recId: action.id,
                      headline: action.headline,
                      recType: action.type,
                      targetPageUrl: action.targetPageUrl ?? null,
                      targetPagePath: action.targetPagePath ?? null,
                      watchAfter: action.watchAfter ?? "",
                      operatorNote: note,
                      baselineCitations: action.baselineCitations ?? null,
                    });
                    setActionMsg("Accepted & tracking.");
                  });
                }}
                disabled={pending}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition-opacity",
                  isPrimary
                    ? "bg-foreground text-background hover:opacity-90"
                    : "border border-foreground/20 text-foreground hover:bg-surface-inset/40",
                )}
              >
                Accept & test →
              </button>
            )}
            {onRespondToRec && (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await onRespondToRec(action.id, "deferred");
                      setActionMsg("Deferred.");
                    })
                  }
                  disabled={pending}
                  className="text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await onRespondToRec(action.id, "dismissed");
                      setActionMsg("Dismissed.");
                    })
                  }
                  disabled={pending}
                  className="text-[11px] font-medium text-muted-foreground/35 hover:text-muted-foreground transition-colors"
                >
                  Dismiss
                </button>
              </span>
            )}
          </>
        )}
        {action.responseStatus === "accepted" && (
          <>
            <Link
              href={action.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition-opacity",
                isPrimary
                  ? "bg-foreground text-background hover:opacity-90"
                  : "border border-foreground/20 text-foreground hover:bg-surface-inset/40",
              )}
            >
              Go →
            </Link>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-status-success">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              Accepted
            </span>
          </>
        )}
      </div>

      {/* Expandable details: evidence, AI context, watch-after */}
      {(action.lineageBullets?.length || action.answerContext || action.watchAfter) && (
        <div className="mt-3 pt-2 border-t border-border/30">
          <button
            type="button"
            onClick={() => setEvidenceOpen((v) => !v)}
            className="text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {evidenceOpen ? "▾ Less" : "▸ Evidence & context"}
          </button>
          {evidenceOpen && (
            <div className="mt-2 space-y-2">
              {action.lineageBullets && action.lineageBullets.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-muted-foreground">
                  {action.lineageBullets.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {action.answerContext && (
                <p className="text-[11px] text-muted-foreground/80">{action.answerContext}</p>
              )}
              {action.sourceChangeId && (
                <Link
                  href={`/changes/${encodeURIComponent(action.sourceChangeId)}`}
                  className="inline-block text-[10px] text-accent-primary hover:underline font-medium"
                >
                  See the data →
                </Link>
              )}
              {action.watchAfter && (
                <p className="text-[10px] text-muted-foreground/50">
                  Watch after: {action.watchAfter.charAt(0).toLowerCase() + action.watchAfter.slice(1)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
