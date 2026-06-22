"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { HowWeKnowPanel } from "@/components/today/how-we-know-panel";
import type { CoverageTone, TodayProofContext } from "@/lib/today-proof-context";
import type { CoverageState } from "@/lib/coverage-state";
import {
  coverageWarningLine,
  coverageStateDisplayLabel,
} from "@/lib/coverage-state";
import type { TodayMilestoneTeaser } from "@/app/(shell)/today-shared-types";

function relativeDate(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return "";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export type TodayVisibilitySnapshotProps = {
  proofContext: TodayProofContext;
  coverageTone: CoverageTone;
  coverageState: CoverageState;
  crawlStale: boolean;
  visStale: boolean;
  visStaleNote: string | null;
  crawlAgeDays: number | null;
  allClear: boolean;
  resolvedFindingsCount: number;
  primaryAccepted: boolean;
  reviewPending: string | null;
  hasScanRun: boolean;
  hasObservationFile: boolean;
  milestoneTeaser?: TodayMilestoneTeaser | null;
  replicationSummary?: { pageCount: number } | null;
  /** When Today visibility/coverage gate is active, freshness callout reads louder than the queue above. */
  staleTruthGateActive?: boolean;
};

export function TodayVisibilitySnapshot({
  proofContext,
  coverageTone,
  coverageState,
  crawlStale,
  visStale,
  visStaleNote,
  crawlAgeDays,
  allClear,
  resolvedFindingsCount,
  primaryAccepted,
  reviewPending,
  hasScanRun,
  hasObservationFile,
  milestoneTeaser,
  replicationSummary,
  staleTruthGateActive = false,
}: TodayVisibilitySnapshotProps) {
  const csWarning = coverageWarningLine(coverageState);
  const showBigFreshnessBox =
    crawlStale ||
    visStale ||
    coverageTone === "partial" ||
    coverageState === "critical" ||
    coverageState === "stale" ||
    coverageState === "aging" ||
    coverageState === "partial";

  return (
    <>
      {/* ── Coverage state (1.1i) — label + subtle inline warning when no big box ── */}
      <p className="text-[11px] px-1 text-muted-foreground/80">
        Coverage:{" "}
        <span className="font-medium text-foreground/90">
          {coverageStateDisplayLabel(coverageState)}
        </span>
        {" · "}
        <Link
          href="/settings/methodology#coverage-states"
          className="text-accent-primary hover:underline font-medium"
        >
          What this means →
        </Link>
      </p>
      {csWarning && !showBigFreshnessBox && (
        <p className="text-[11px] px-1 -mt-0.5 text-muted-foreground/60">
          {csWarning}
        </p>
      )}

      {/* ── Coverage + freshness warnings ── */}
      {showBigFreshnessBox && (
        <div className={cn(
          "rounded-lg border-2 px-4 py-3 space-y-2",
          staleTruthGateActive && "ring-2 ring-status-warning/30 shadow-sm",
          coverageState === "critical" || coverageTone === "critical"
            ? "border-status-danger/40 bg-status-danger/[0.06]"
            : coverageState === "stale" || coverageTone === "degraded" || crawlStale || visStale
              ? "border-status-warning/35 bg-status-warning/[0.05]"
              : coverageState === "aging"
                ? "border-border/60 bg-surface-inset/30"
                : "border-accent-primary/25 bg-accent-primary/[0.04]",
        )}>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              coverageState === "critical" || coverageTone === "critical"
                ? "bg-status-danger animate-pulse"
                : coverageState === "stale" || coverageTone === "degraded" || crawlStale || visStale
                  ? "bg-status-warning animate-pulse"
                  : coverageState === "aging"
                    ? "bg-muted-foreground/50"
                    : "bg-accent-primary",
            )} />
            <p className={cn(
              "text-[12px] font-bold",
              coverageState === "critical" || coverageTone === "critical"
                ? "text-status-danger"
                : coverageState === "stale" || coverageTone === "degraded" || crawlStale || visStale
                  ? "text-status-warning"
                  : coverageState === "aging"
                    ? "text-muted-foreground"
                    : "text-accent-primary",
            )}>
              {coverageState === "critical"
                ? "Refresh recommended: last crawl is stale"
                : coverageState === "stale"
                  ? "Refresh recommended: based on an earlier crawl"
                  : coverageState === "aging"
                    ? "Refresh due: nearing freshness threshold"
                    : coverageState === "partial" || coverageTone === "partial"
                      ? "Partial visibility sample"
                      : coverageTone === "critical"
                        ? "Coverage refresh recommended"
                        : coverageTone === "degraded"
                          ? "Coverage refresh due soon"
                          : "Data freshness"}
            </p>
          </div>
          <ul className="text-[11px] text-foreground leading-relaxed list-disc pl-4 space-y-1">
            {crawlStale && (
              <li>
                Website crawl is <span className="font-semibold tabular-nums">{crawlAgeDays}d</span> old, HTML findings may miss recent edits.
                <Link href="/pages" className="text-accent-primary hover:underline font-medium ml-1">Run scan →</Link>
              </li>
            )}
            {visStale && visStaleNote && <li>{visStaleNote}</li>}
            {csWarning &&
              !crawlStale &&
              !visStale &&
              (coverageState === "critical" ||
                coverageState === "stale" ||
                coverageState === "aging") && <li>{csWarning}</li>}
            {coverageTone === "partial" && !visStale && (
              <li>
                {proofContext.visibilitySynthetic
                  ? "Visibility row is synthetic or demo-pinned, treat charts as directional, not ground truth until a real import is wired."
                  : "Citation rollup timestamp is missing or older than your crawl, sample may not reflect the latest HTML."}
              </li>
            )}
          </ul>
          {proofContext.visibilityCompletedAt ? (
            <p className="text-[10px] text-muted-foreground/90 pt-1 border-t border-border/40 tabular-nums">
              Last visibility data:{" "}
              {new Date(proofContext.visibilityCompletedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          ) : null}
        </div>
      )}

      {/* ── Inbox Zero — earned completion state ── */}
      {allClear && (
        <div className="rounded-lg border-2 border-status-success/30 bg-status-success/[0.04] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-status-success shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-status-success">You're clear. Nothing needs your attention.</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {resolvedFindingsCount > 0 && <>{resolvedFindingsCount} finding{resolvedFindingsCount !== 1 ? "s" : ""} handled. </>}
                {primaryAccepted && <>Top recommendation accepted. </>}
                Refresh your connected data anytime to look for new opportunities.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Compact milestone + replication links ── */}
      {(milestoneTeaser || (replicationSummary && replicationSummary.pageCount > 0)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground px-0.5">
          {milestoneTeaser && (
            <span className={cn(
              milestoneTeaser.magnitude === "major"
                ? "border-l-2 border-accent-primary/50 pl-2"
                : "",
            )}>
              <span className={cn(
                "font-medium",
                milestoneTeaser.magnitude === "major"
                  ? "text-foreground font-semibold"
                  : "text-foreground",
              )}>
                {milestoneTeaser.title}
              </span>
              {milestoneTeaser.subtitle && (
                <span className="text-muted-foreground/70">: {milestoneTeaser.subtitle}</span>
              )}
              {milestoneTeaser.achievedAt && (
                <span className="text-muted-foreground/50"> · {relativeDate(milestoneTeaser.achievedAt)}</span>
              )}
              <span className="text-muted-foreground/70"> · </span>
              <Link href="/changes" className="text-accent-primary hover:underline font-medium">
                Changes →
              </Link>
            </span>
          )}
          {replicationSummary && replicationSummary.pageCount > 0 && (
            <span>
              Similar patterns observed ·{" "}
              <Link
                href="/changes?tab=replicate"
                className="font-medium text-accent-primary hover:underline"
              >
                {replicationSummary.pageCount} page{replicationSummary.pageCount !== 1 ? "s" : ""} →
              </Link>
            </span>
          )}
        </div>
      )}

      {/* ── Methodology reference (collapsed) ── */}
      <HowWeKnowPanel context={proofContext} variant="today" />

      {/* ── System status ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="font-medium text-foreground">System</span>
        <span>
          Scan: {hasScanRun ? (crawlAgeDays === 0 ? "today" : crawlAgeDays === 1 ? "yesterday" : `${crawlAgeDays}d ago`) : <Link href="/pages" className="text-accent-primary hover:underline font-medium">not run</Link>}
        </span>
        <span className="text-border">·</span>
        <span>
          Visibility: {hasObservationFile ? (visStale ? <span className="text-status-warning font-medium">stale</span> : "fresh") : <Link href="/settings/import" className="text-accent-primary hover:underline font-medium">no data</Link>}
        </span>
        {reviewPending && (
          <>
            <span className="text-border">·</span>
            <Link href="/changes?tab=attribution" className="text-accent-primary hover:underline font-medium">{reviewPending} pending review</Link>
          </>
        )}
      </div>
    </>
  );
}
