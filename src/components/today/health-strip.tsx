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

/** a11y #399: plain-English status word so the color dot isn't the only cue. */
function dotStatusWord(status: DotStatus): string {
  switch (status) {
    case "good":
      return "ok";
    case "warn":
      return "needs attention";
    case "bad":
      return "problem";
    case "neutral":
      return "no data";
  }
}

// a11y #399: the dots conveyed data/scan/local status by color alone with no
// text alternative. Give each dot role="img" + an aria-label ("Data: ok") so a
// screen reader announces the status the color encodes. Visual size/shape
// unchanged. The `label` names which signal this dot belongs to.
function statusDot(status: DotStatus, label: string) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${dotStatusWord(status)}`}
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
            {coverageState === "critical" ? "Refresh recommended: last crawl is stale" : "Refresh due: keep findings current"}
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
          // a11y #399: the toggle that opens the "how we know" panel had no
          // expanded/collapsed state exposed to assistive tech and only an
          // implicit name. aria-expanded reflects state; aria-controls +
          // aria-label give it a stable accessible name.
          aria-expanded={expanded}
          aria-controls="health-strip-how-we-know"
          aria-label="Data status: show how we know"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          {statusDot(dataStatus, "Data")}
          <span>Data: <span className="font-medium">{coverageLabel(coverageState)}</span></span>
        </button>
        <span className="flex items-center gap-1.5">
          {statusDot(scanStatus, "Scan")}
          <span>Scan: <span className="font-medium">{scanAgeLabel(crawlAgeDays, hasScanRun)}</span></span>
        </span>
        <span className="flex items-center gap-1.5">
          {statusDot(localStatus, "Local")}
          <span>Local: <span className="font-medium">{localNeedsAttention ? "needs review" : "ok"}</span></span>
        </span>
        {/* Methodology link removed 2026-04-17 (Day 3 trust cleanup). Route still
            exists at /settings/methodology for direct access; hidden from the
            daily-view HealthStrip because Settings also removed the tab today. */}
      </div>
      {expanded && (
        <div id="health-strip-how-we-know">
          <HowWeKnowPanel context={proofContext} variant="today" />
        </div>
      )}
    </div>
  );
}
