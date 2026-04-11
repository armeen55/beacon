"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type RankEntry = {
  label: string;
  value: number;
  badge?: string;
  badgeColor?: string;
  isOwned?: boolean;
  meta?: string;
};

export function RankLadder({
  entries,
  title,
  valueSuffix = "",
  showRank = true,
  maxVisible = 10,
}: {
  entries: RankEntry[];
  title?: string;
  valueSuffix?: string;
  showRank?: boolean;
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const visible = expanded ? entries : entries.slice(0, maxVisible);
  const maxVal = Math.max(...entries.map((e) => e.value), 1);

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>}
      <div className="space-y-0">
        {visible.map((entry, i) => {
          const pct = (entry.value / maxVal) * 100;
          const isHov = hovered === i;
          return (
            <div
              key={entry.label}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-default",
                entry.isOwned && "bg-accent-primary/[0.06]",
                isHov && !entry.isOwned && "bg-surface-inset/40",
              )}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {showRank && (
                <span className="text-[10px] text-muted-foreground/60 tabular-nums w-5 text-right shrink-0">
                  {i + 1}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-[11px] truncate",
                    entry.isOwned ? "font-semibold text-accent-primary" : "font-medium text-foreground",
                  )}>
                    {entry.label}
                  </span>
                  {entry.badge && (
                    <span className={cn("text-[8px] font-semibold px-1 py-px rounded border shrink-0", entry.badgeColor ?? "text-muted-foreground border-border/40")}>
                      {entry.badge}
                    </span>
                  )}
                </div>
                <div className="h-1 rounded-full bg-border/20 mt-1 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      entry.isOwned ? "bg-accent-primary" : "bg-muted-foreground/25",
                    )}
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
              </div>
              <span className="text-[11px] tabular-nums font-semibold shrink-0">
                {entry.value.toLocaleString()}{valueSuffix}
              </span>
            </div>
          );
        })}
      </div>
      {entries.length > maxVisible && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-accent-primary hover:underline font-medium mt-1 px-2"
        >
          {expanded ? "Show less" : `Show all ${entries.length}`}
        </button>
      )}
      {hovered !== null && visible[hovered]?.meta && (
        <p className="text-[9px] text-muted-foreground/70 mt-1 px-2 animate-in fade-in duration-100">
          {visible[hovered].meta}
        </p>
      )}
    </div>
  );
}
