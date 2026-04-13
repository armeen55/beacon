"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/viz/kpi-card";
import { DonutRing } from "@/components/viz/donut-ring";
import type { PageRow, PageSummary } from "@/app/(shell)/pages/pages-client";

export type PagesWorkbenchTopProps = {
  crawlIsStale: boolean;
  uncrawledCount: number;
  crawlAgeDays: number | null;
  pageSummary?: PageSummary;
  onScan?: () => Promise<{ success: boolean; pagesScanned?: number; pagesChanged?: number; alertCount?: number; error?: string }>;
  scanPending: boolean;
  startScanTransition: (cb: () => void) => void;
  lastScanAt?: string | null;
  latestObservationRunId?: string | null;
  viewCounts: Record<"fix" | "winning" | "watch" | "all", number>;
  view: "fix" | "winning" | "watch" | "all";
  setView: (v: "fix" | "winning" | "watch" | "all") => void;
  fixRows: PageRow[];
  winningRows: PageRow[];
  watchRows: PageRow[];
  rows: PageRow[];
  setSelectedId: (id: string | null) => void;
};

export function PagesWorkbenchTop({
  crawlIsStale,
  uncrawledCount,
  crawlAgeDays,
  pageSummary,
  onScan,
  scanPending,
  startScanTransition,
  lastScanAt,
  latestObservationRunId,
  viewCounts,
  view,
  setView,
  fixRows,
  winningRows,
  watchRows,
  rows,
  setSelectedId,
}: PagesWorkbenchTopProps) {
  return (
    <>
      {/* ── Stale / missing crawl warning ── */}
      {(crawlIsStale || (pageSummary && pageSummary.scanned === 0)) && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/[0.05] px-4 py-3 mb-4 text-[12px]">
          {pageSummary && pageSummary.scanned === 0 ? (
            <p className="text-foreground">
              <span className="font-semibold text-status-warning">No pages have been scanned.</span>{" "}
              Use <span className="font-medium">Refresh scan</span> to inspect your pages.
            </p>
          ) : crawlIsStale ? (
            <p className="text-foreground">
              <span className="font-semibold text-status-warning">Scan data is {crawlAgeDays} days old.</span>{" "}
              Page structure may have changed since the last scan.
              {uncrawledCount > 0 && <span className="text-muted-foreground"> · {uncrawledCount} pages not yet scanned.</span>}
            </p>
          ) : null}
        </div>
      )}

      {/* ── Summary strip: KPI cards + status donut ── */}
      {pageSummary && (
        <div className="mb-5 space-y-4">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
              <KpiCard label="Tracked" value={pageSummary.total} size="lg" />
              <KpiCard label="Cited" value={pageSummary.cited} meta={`${pageSummary.totalCitations.toLocaleString()} total mentions`} size="lg" />
              <KpiCard label="Need Work" value={pageSummary.needsAction} meta={pageSummary.needsAction > 0 ? "Open issues" : "All clear"} size="lg" />
              <KpiCard label="Scanned" value={pageSummary.scanned} size="lg" />
            </div>
            {(pageSummary.winning > 0 || pageSummary.building > 0 || pageSummary.unresolved > 0 || pageSummary.dormant > 0) && (
              <div className="shrink-0">
                <DonutRing
                  segments={[
                    ...(pageSummary.winning > 0 ? [{ label: "Strong", value: pageSummary.winning, color: "stroke-status-success" }] : []),
                    ...(pageSummary.building > 0 ? [{ label: "Building", value: pageSummary.building, color: "stroke-accent-primary" }] : []),
                    ...(pageSummary.unresolved > 0 ? [{ label: "Follow up", value: pageSummary.unresolved, color: "stroke-status-warning" }] : []),
                    ...(pageSummary.dormant > 0 ? [{ label: "Low signal", value: pageSummary.dormant, color: "stroke-muted-foreground/40" }] : []),
                  ]}
                  size={90}
                  thickness={10}
                  centerLabel="Status"
                  centerValue={pageSummary.total}
                />
              </div>
            )}
          </div>
          {(pageSummary.noFaq > 0 || pageSummary.noSchema > 0) && pageSummary.scanned > 0 && (
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
              {pageSummary.noFaq > 0 && (
                <span>
                  <span className="font-medium text-foreground/80">{pageSummary.noFaq}</span> without Q&amp;A block
                </span>
              )}
              {pageSummary.noSchema > 0 && (
                <span>
                  <span className="font-medium text-foreground/80">{pageSummary.noSchema}</span> without structured data
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top bar: scan + view tabs */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {onScan && (
          <button
            onClick={() => startScanTransition(async () => { await onScan(); })}
            disabled={scanPending}
            className={cn("px-3 py-1.5 rounded-md text-xs font-medium border transition-colors shrink-0", scanPending ? "border-border text-muted-foreground opacity-50" : "border-border/80 text-foreground hover:bg-surface-inset")}
          >
            {scanPending ? "Scanning…" : "Refresh scan"}
          </button>
        )}
        {lastScanAt && (
          <span className="text-[11px] text-muted-foreground/70 shrink-0 flex items-center gap-2 flex-wrap">
            <span>
              Last scan{" "}
              {new Date(lastScanAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {latestObservationRunId && (
              <Link
                href={`/observations/${encodeURIComponent(latestObservationRunId)}`}
                className="text-accent-primary hover:underline font-medium"
              >
                View run
              </Link>
            )}
          </span>
        )}
        <span className="flex-1 min-w-[8px]" />
        {(["fix", "winning", "watch", "all"] as const).map((v) =>
          viewCounts[v] > 0 || v === "all" ? (
            <button key={v} onClick={() => { setView(v); const first = (v === "fix" ? fixRows : v === "winning" ? winningRows : v === "watch" ? watchRows : rows)[0]; if (first) setSelectedId(first.id); }}
              className={cn("px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/80")}
            >
              {v === "fix" ? "Needs work" : v === "winning" ? "Strong" : v === "watch" ? "Active" : "All"} · {viewCounts[v]}
            </button>
          ) : null
        )}
      </div>
    </>
  );
}
