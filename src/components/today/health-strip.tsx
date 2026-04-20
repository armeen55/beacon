"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CoverageState } from "@/lib/coverage-state";
import { HowWeKnowPanel } from "./how-we-know-panel";
import type { TodayProofContext } from "@/lib/today-proof-context";

export type HealthStripProps = {
  coverageState: CoverageState;
  crawlAgeDays: number | null;
  hasScanRun: boolean;
  localNeedsAttention: boolean;
  proofContext: TodayProofContext;
};

type DotStatus = "good" | "warn" | "bad" | "neutral";

function statusDot(status: DotStatus) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        status === "good" && "bg-status-success",
        status === "warn" && "bg-status-warning",
        status === "bad" && "bg-status-danger",
        status === "neutral" && "bg-muted-foreground/40",
      )}
    />
  );
}

function dataFreshnessStatus(cs: CoverageState): DotStatus {
  if (cs === "critical" || cs === "stale") return "bad";
  if (cs === "aging" || cs === "partial") return "warn";
  return "good";
}

function scanAgeStatus(crawlAgeDays: number | null, hasScanRun: boolean): DotStatus {
  if (!hasScanRun) return "neutral";
  if (crawlAgeDays !== null && crawlAgeDays > 14) return "bad";
  if (crawlAgeDays !== null && crawlAgeDays > 7) return "warn";
  return "good";
}

function scanAgeLabel(crawlAgeDays: number | null, hasScanRun: boolean): string {
  if (!hasScanRun) return "not run";
  if (crawlAgeDays === null) return "unknown";
  if (crawlAgeDays === 0) return "today";
  if (crawlAgeDays === 1) return "yesterday";
  return `${crawlAgeDays}d ago`;
}

function coverageLabel(cs: CoverageState): string {
  if (cs === "critical") return "critical";
  if (cs === "stale") return "stale";
  if (cs === "aging") return "aging";
  if (cs === "partial") return "partial";
  return "fresh";
}

export function HealthStrip({
  coverageState,
  crawlAgeDays,
  hasScanRun,
  localNeedsAttention,
  proofContext,
}: HealthStripProps) {
  const [expanded, setExpanded] = useState(false);

  const dataStatus = dataFreshnessStatus(coverageState);
  const scanStatus = scanAgeStatus(crawlAgeDays, hasScanRun);
  const localStatus: DotStatus = localNeedsAttention ? "warn" : "good";

  const isStale = dataStatus === "bad" || dataStatus === "warn";

  return (
    <div className="space-y-2">
      {/* When data is stale/critical, show a single compact warning with action */}
      {isStale && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-status-warning/30 bg-status-warning/[0.04] px-3 py-2">
          <span className="text-[11px] text-status-warning font-medium">
            {coverageState === "critical" ? "Data is outdated" : "Data is aging"} — import fresh data to unlock accurate actions
          </span>
          <Link
            href="/settings/import"
            className="shrink-0 text-[11px] font-semibold text-accent-primary hover:underline"
          >
            Import →
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          {statusDot(dataStatus)}
          <span>Data: <span className="font-medium">{coverageLabel(coverageState)}</span></span>
        </button>
        <span className="flex items-center gap-1.5">
          {statusDot(scanStatus)}
          <span>Scan: <span className="font-medium">{scanAgeLabel(crawlAgeDays, hasScanRun)}</span></span>
        </span>
        <span className="flex items-center gap-1.5">
          {statusDot(localStatus)}
          <span>Local: <span className="font-medium">{localNeedsAttention ? "needs review" : "ok"}</span></span>
        </span>
        {/* Methodology link removed 2026-04-17 (Day 3 trust cleanup). Route still
            exists at /settings/methodology for direct access; hidden from the
            daily-view HealthStrip because Settings also removed the tab today. */}
      </div>
      {expanded && (
        <HowWeKnowPanel context={proofContext} variant="today" />
      )}
    </div>
  );
}
