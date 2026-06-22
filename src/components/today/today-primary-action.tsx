"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { buildPrimaryDecisionCopy } from "@/lib/today-primary-decision-copy";
import type { TodayNextMove } from "@/lib/today-summary";
import type { TodayPrimaryAction } from "@/app/(shell)/today-shared-types";

// Labels rewritten 2026-04-17 (Day 4 jargon sweep) — match action-card.tsx.
const BUCKET_STYLE: Record<string, { border: string; bg: string; label: string; accent: string }> = {
  critical: { border: "border-status-danger", bg: "bg-status-danger/8", label: "Fix now", accent: "text-status-danger" },
  high_leverage: { border: "border-status-success", bg: "bg-status-success/8", label: "Biggest win", accent: "text-status-success" },
  opportunistic: { border: "border-accent-primary", bg: "bg-accent-primary/5", label: "Worth trying", accent: "text-accent-primary" },
};

export type TodayPrimaryActionProps = {
  primaryAction: TodayPrimaryAction | null;
  nextMove: TodayNextMove;
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
    context?: { targetPageUrl?: string | null; patternId?: string | null },
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
    replicationSourceChangeId?: string | null;
    replicationPatternId?: string | null;
    replicationEvidenceTier?: "observed" | "mixed" | "inferred";
  }) => Promise<{ success: boolean; experimentId: string }>;
  pending: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
  actionMsg: string | null;
  setActionMsg: (s: string | null) => void;
  /** Ref attached to the main CTA for programmatic focus (Track 1.2 Phase 3). */
  primaryFocusRef?: RefObject<HTMLElement | null>;
  /** When true, focus the main CTA on mount (skipped when urgent strip may precede in tab order). */
  autoFocusPrimary?: boolean;
  /** When crawl/coverage/scan limits trust, the card stays visible but reads as secondary to the truth strip. */
  truthDataSecondary?: boolean;
  /** Stronger deferral when visibility/coverage staleness gate is shown on Today. */
  visibilityImportDeferred?: boolean;
};

/** Primary recommendation card + `summary.nextMove` fallback (Phase 4-2). */
export function TodayPrimaryAction({
  primaryAction,
  nextMove,
  onRespondToRec,
  onStartExperiment,
  pending,
  startTransition,
  actionMsg,
  setActionMsg,
  primaryFocusRef,
  autoFocusPrimary = false,
  truthDataSecondary = false,
  visibilityImportDeferred = false,
}: TodayPrimaryActionProps) {
  const attachPrimaryRef = primaryFocusRef
    ? (el: HTMLElement | null) => {
        primaryFocusRef.current = el;
      }
    : undefined;

  if (primaryAction) {
    const bs = BUCKET_STYLE[primaryAction.bucket] ?? BUCKET_STYLE.opportunistic;
    const decisionCopy = buildPrimaryDecisionCopy({
      rationale: primaryAction.rationale,
      expectedOutcome: primaryAction.expectedOutcome,
      bucket: primaryAction.bucket,
      confidence: primaryAction.confidence,
      confidenceReason: primaryAction.confidenceReason,
      type: primaryAction.type,
    });
    return (
      <div
        className={cn(
          "rounded-lg border-2 px-5 pt-4 pb-5",
          truthDataSecondary
            ? cn(
                "border-border/50 bg-surface-inset/25 ring-1 ring-border/30",
                visibilityImportDeferred ? "opacity-[0.72]" : "opacity-[0.88]",
              )
            : cn(bs.border, bs.bg),
        )}
      >
        {truthDataSecondary ? (
          <p className="text-[10px] text-muted-foreground leading-snug mb-3 pb-2 border-b border-border/35">
            {visibilityImportDeferred
              ? "Visibility data is behind the latest scan, wait for a fresh poll before accepting this recommendation."
              : "Data is incomplete, refresh when you can. This recommendation stays here for when you're ready."}
          </p>
        ) : null}
        <div className="flex items-center gap-2 mb-3">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              truthDataSecondary ? "bg-muted-foreground/45" : bs.accent.replace("text-", "bg-"),
            )}
          />
          <span
            className={cn(
              "text-[11px] font-semibold",
              truthDataSecondary ? "text-muted-foreground" : bs.accent,
            )}
          >
            {bs.label}
          </span>
        </div>
        <p
          className={cn(
            "tracking-tight leading-snug mb-2",
            truthDataSecondary ? "text-[15px] font-semibold text-foreground/90" : "text-base font-bold",
          )}
        >
          {primaryAction.headline}
        </p>
        <div className="space-y-3 mt-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Why this matters
            </p>
            <p className="text-[13px] text-foreground/90 leading-relaxed mt-1">
              {decisionCopy.whyItMatters}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              If you ignore it
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">
              {decisionCopy.ifYouIgnore}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              If you ship it
            </p>
            <p className="text-[13px] text-foreground/85 leading-relaxed mt-1">
              {decisionCopy.successLooksLike}
            </p>
          </div>
          <div className="rounded-md border border-border/35 bg-surface-inset/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {"How much this matters + how sure we are"}
            </p>
            <p className="text-[12px] text-foreground/90 leading-relaxed mt-1">
              {decisionCopy.leverageAndConfidence}
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <span
                className={cn(
                  "font-semibold",
                  primaryAction.confidence === "high"
                    ? "text-status-success"
                    : primaryAction.confidence === "medium"
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {primaryAction.confidence === "high"
                  ? "Strong data"
                  : primaryAction.confidence === "medium"
                    ? "Moderate data"
                    : "Early data: small sample"}
              </span>
              {primaryAction.dataFreshness ? (
                <span className="tabular-nums">· {primaryAction.dataFreshness}</span>
              ) : null}
            </p>
            {/* Phase 1 (2026-04-20): surface the raw confidenceReason string verbatim.
               buildPrimaryDecisionCopy already consumes it into interpreted copy, but
               the specific evidence (e.g. "87 citations · 78% pattern success rate")
               wasn't otherwise visible. */}
            {primaryAction.confidenceReason && (
              <p className="text-[10px] italic text-muted-foreground/70 leading-snug mt-1.5">
                {primaryAction.confidenceReason}
              </p>
            )}
          </div>
        </div>
        {primaryAction.lineageBullets && primaryAction.lineageBullets.length > 0 && (
          <div className="mt-3 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Based on</p>
            <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-muted-foreground">
              {primaryAction.lineageBullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {primaryAction.sourceChangeId && (
              <p className="mt-1.5 text-[10px]">
                <Link
                  href={`/changes/${encodeURIComponent(primaryAction.sourceChangeId)}`}
                  prefetch={false}
                  className="text-accent-primary hover:underline font-medium"
                >
                  See what happened →
                </Link>
              </p>
            )}
          </div>
        )}
        {primaryAction.answerContext && (
          <div className="mt-3 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">From AI answers</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{primaryAction.answerContext}</p>
          </div>
        )}
        {primaryAction.watchAfter && (
          <p className="text-[11px] text-muted-foreground/50 mt-1">
            Check back: {primaryAction.watchAfter.charAt(0).toLowerCase() + primaryAction.watchAfter.slice(1)}
          </p>
        )}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          {primaryAction.responseStatus !== "accepted" && (
            <>
              {onStartExperiment && onRespondToRec && (
                <button
                  ref={attachPrimaryRef}
                  type="button"
                  autoFocus={autoFocusPrimary}
                  onClick={() => {
                    const note = prompt("What did you change or plan to change? (short note)");
                    if (note === null) return;
                    startTransition(async () => {
                      // Fix 2 (2026-04-21): carry target URL + pattern so
                      // the response store can auto-link later-detected
                      // changes on this URL back to this acceptance.
                      await onRespondToRec(primaryAction.id, "accepted", {
                        targetPageUrl: primaryAction.targetPageUrl ?? null,
                        patternId: primaryAction.patternId ?? null,
                      });
                      await onStartExperiment({
                        recId: primaryAction.id,
                        headline: primaryAction.headline,
                        recType: primaryAction.type,
                        targetPageUrl: primaryAction.targetPageUrl ?? null,
                        targetPagePath: primaryAction.targetPagePath ?? null,
                        watchAfter: primaryAction.watchAfter ?? "",
                        operatorNote: note,
                        baselineCitations: primaryAction.baselineCitations ?? null,
                      });
                      setActionMsg("Got it, we're watching this now.");
                    });
                  }}
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Try this →
                </button>
              )}
              {onRespondToRec && !onStartExperiment && (
                <button
                  ref={attachPrimaryRef}
                  type="button"
                  autoFocus={autoFocusPrimary}
                  onClick={() =>
                    startTransition(async () => {
                      // Fix 2 (2026-04-21): same auto-link context as above.
                      await onRespondToRec(primaryAction.id, "accepted", {
                        targetPageUrl: primaryAction.targetPageUrl ?? null,
                        patternId: primaryAction.patternId ?? null,
                      });
                      setActionMsg("Accepted.");
                    })
                  }
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Accept →
                </button>
              )}
              {onRespondToRec && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        await onRespondToRec(primaryAction.id, "deferred");
                        setActionMsg("Deferred.");
                      })
                    }
                    disabled={pending}
                    className="text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        await onRespondToRec(primaryAction.id, "dismissed");
                        setActionMsg("Dismissed.");
                      })
                    }
                    disabled={pending}
                    className="text-[11px] font-medium text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  >
                    Dismiss
                  </button>
                </>
              )}
            </>
          )}
          {primaryAction.responseStatus === "accepted" && (
            <>
              <Link
                ref={attachPrimaryRef}
                href={primaryAction.href}
                autoFocus={autoFocusPrimary}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        {actionMsg && <p className="text-[10px] text-status-success mt-2 font-medium">{actionMsg}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">What to try next</p>
      <p className="text-[14px] font-semibold leading-snug mb-1">{nextMove.title}</p>
      <p className="text-[12px] text-muted-foreground leading-relaxed">{nextMove.evidence}</p>
      <Link
        ref={attachPrimaryRef}
        href={nextMove.href}
        autoFocus={autoFocusPrimary}
        className="inline-flex mt-3 items-center gap-2 rounded-md border border-foreground/20 bg-surface-raised px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface-inset/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Go →
      </Link>
    </div>
  );
}
