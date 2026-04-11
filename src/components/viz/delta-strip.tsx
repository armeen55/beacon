"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type DeltaEntry = {
  label: string;
  previous: number;
  current: number;
  meta?: string;
};

export function DeltaStrip({
  entries,
  title,
  subtitle,
}: {
  entries: DeltaEntry[];
  title?: string;
  subtitle?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-0.5">{title}</p>}
      {subtitle && <p className="text-[10px] text-muted-foreground mb-2">{subtitle}</p>}
      <div className="space-y-1">
        {entries.map((entry, i) => {
          const delta = entry.current - entry.previous;
          const pctChange = entry.previous > 0 ? Math.round((delta / entry.previous) * 100) : null;
          const isPositive = delta > 0;
          const isNegative = delta < 0;
          const isHov = hovered === i;
          return (
            <div
              key={entry.label}
              className={cn("flex items-center gap-2 px-2 py-1 rounded cursor-default transition-colors", isHov && "bg-surface-inset/30")}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">{entry.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60 shrink-0">{entry.previous.toLocaleString()}</span>
              <span className="text-muted-foreground/30 text-[10px] shrink-0">→</span>
              <span className="text-[10px] tabular-nums font-medium shrink-0">{entry.current.toLocaleString()}</span>
              <span className={cn(
                "text-[10px] tabular-nums font-semibold w-12 text-right shrink-0",
                isPositive ? "text-status-success" : isNegative ? "text-status-danger" : "text-muted-foreground",
              )}>
                {isPositive ? "+" : ""}{delta}
                {pctChange !== null && <span className="text-[8px] font-normal ml-0.5">({pctChange > 0 ? "+" : ""}{pctChange}%)</span>}
              </span>
            </div>
          );
        })}
      </div>
      {hovered !== null && entries[hovered]?.meta && (
        <p className="text-[9px] text-muted-foreground/70 px-2 mt-1 animate-in fade-in duration-100">
          {entries[hovered].meta}
        </p>
      )}
    </div>
  );
}
