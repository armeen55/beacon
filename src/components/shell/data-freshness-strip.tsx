import { cn } from "@/lib/utils";

export type DataFreshnessStripProps = {
  /**
   * Latest import activity — use the same signal as `getDataCoverage().lastImportAt`
   * / newest `importRuns[].started_at` (ISO).
   */
  lastImportAt: string | null;
  /**
   * Latest completed website crawl — use `latestWebsiteCrawlRun()?.completed_at` (ISO).
   */
  lastScanCompletedAt: string | null;
  className?: string;
};

/**
 * Compact import + scan freshness for shell-level placement (Phase 2C).
 * Presentation-only: pass timestamps from the server layout or a parent RSC.
 */
export function DataFreshnessStrip({
  lastImportAt,
  lastScanCompletedAt,
  className,
}: DataFreshnessStripProps) {
  return (
    <div
      role="status"
      aria-label="Data freshness"
      className={cn(
        "flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/35 bg-surface-inset/25 px-4 py-1.5 text-[11px] leading-snug text-muted-foreground",
        className,
      )}
    >
      <FreshnessSegment label="Import" at={lastImportAt} />
      <span className="text-border/80 select-none" aria-hidden>
        ·
      </span>
      <FreshnessSegment label="Scan" at={lastScanCompletedAt} />
    </div>
  );
}

function FreshnessSegment({ label, at }: { label: string; at: string | null }) {
  if (!at) {
    return (
      <span>
        <span className="font-medium text-foreground/80">{label}</span>
        <span className="text-muted-foreground/90"> — no timestamp</span>
      </span>
    );
  }

  const d = new Date(at);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const ageDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const ago =
    ageDays < 0
      ? "upcoming"
      : ageDays === 0
        ? "today"
        : ageDays === 1
          ? "yesterday"
          : `${ageDays}d ago`;

  return (
    <span className="tabular-nums">
      <span className="font-medium text-foreground/85">{label}</span>
      <span className="text-muted-foreground">
        {" "}
        {dateStr} {timeStr}
        <span className="text-muted-foreground/75"> ({ago})</span>
      </span>
    </span>
  );
}
