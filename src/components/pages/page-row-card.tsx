"use client";

import { cn } from "@/lib/utils";
import type { PageRow } from "@/app/(shell)/pages/pages-client";

type PageStatus = PageRow["status"];
type PageNextMove = PageRow["nextMove"];

/** Shared with Pages detail panel — keep in sync with product copy. */
export const STATUS_CONFIG: Record<PageStatus, { label: string; color: string; dot: string }> = {
  winning: { label: "Strong", color: "text-status-success", dot: "bg-status-success" },
  building: { label: "Building", color: "text-accent-primary", dot: "bg-accent-primary" },
  unresolved: { label: "Follow up", color: "text-status-warning", dot: "bg-status-warning" },
  dormant: { label: "Low signal", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

/** Shared with Pages detail panel — keep in sync with product copy. */
export const NEXT_MOVE: Record<PageNextMove, { label: string; color: string }> = {
  double_down: { label: "Strong", color: "text-status-success" },
  review_signals: { label: "Review", color: "text-status-warning" },
  strengthen_evidence: { label: "Strengthen", color: "text-accent-primary" },
  wait: { label: "Watching", color: "text-muted-foreground" },
  no_action: { label: "No action", color: "text-muted-foreground" },
};

export function PageRowCard({
  row,
  isSelected,
  onSelect,
}: {
  row: PageRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const sc = STATUS_CONFIG[row.status];
  const nm = NEXT_MOVE[row.nextMove];
  return (
    <button
      data-page-id={row.id}
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-3 transition-colors",
        isSelected
          ? "bg-accent-primary/8 border-l-[3px] border-l-accent-primary"
          : "hover:bg-surface-inset/50 border-l-[3px] border-l-transparent",
      )}
    >
      <p className="text-[13px] font-medium text-foreground leading-snug truncate">{row.label}</p>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", sc.dot)} />
        {row.fixBriefs.length > 0 ? (
          <span className="text-[11px] font-medium text-status-danger tabular-nums">
            {row.fixBriefs.length} open item{row.fixBriefs.length !== 1 ? "s" : ""}
          </span>
        ) : (
          <span className={cn("text-[11px] font-medium", sc.color)}>{sc.label}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
        {row.totalCitations > 0 && <span className="tabular-nums">{row.totalCitations} mentions</span>}
        {row.pendingFindingCount > 0 && (
          <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[10px] text-accent-primary font-medium">
            {row.pendingFindingCount} new
          </span>
        )}
        {!row.snapshot && <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[10px] text-status-warning font-medium">Not scanned</span>}
        {row.snapshot && row.snapshot.faqCount === 0 && (
          <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">No Q&amp;A</span>
        )}
        {row.snapshot && row.snapshot.schemaTypes.length === 0 && (
          <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">No schema</span>
        )}
        {row.snapshot && row.snapshot.hasCanonicalMismatch && (
          <span className="rounded bg-status-warning/10 px-1.5 py-0.5 text-[10px] text-status-warning font-medium">Canonical mismatch</span>
        )}
        <span className={cn("font-medium", nm.color)}>{nm.label}</span>
      </div>
    </button>
  );
}
