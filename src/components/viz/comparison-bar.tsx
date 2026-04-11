"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type ComparisonEntry = {
  label: string;
  ownedValue: number;
  competitorValue: number;
  ownedLabel?: string;
  competitorLabel?: string;
  meta?: string;
};

export function ComparisonBar({
  entries,
  title,
  ownedLabel = "You",
  competitorLabel = "Competitor",
}: {
  entries: ComparisonEntry[];
  title?: string;
  ownedLabel?: string;
  competitorLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const maxVal = Math.max(...entries.flatMap((e) => [e.ownedValue, e.competitorValue]), 1);

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>}
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground/60 mb-2">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent-primary" />{ownedLabel}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-status-danger/40" />{competitorLabel}</span>
      </div>
      <div className="space-y-2">
        {entries.map((entry, i) => {
          const total = entry.ownedValue + entry.competitorValue;
          const ownedPct = total > 0 ? (entry.ownedValue / total) * 100 : 50;
          const isHov = hovered === i;
          return (
            <div
              key={entry.label}
              className="cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={cn("text-[10px] truncate transition-colors", isHov ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {entry.label}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                  {entry.ownedValue.toLocaleString()} vs {entry.competitorValue.toLocaleString()}
                </span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden gap-px">
                <div
                  className={cn("bg-accent-primary rounded-l-full transition-all duration-300", isHov && "brightness-110")}
                  style={{ width: `${ownedPct}%` }}
                />
                <div
                  className={cn("bg-status-danger/30 rounded-r-full flex-1 transition-all duration-300", isHov && "bg-status-danger/50")}
                />
              </div>
              {isHov && entry.meta && (
                <p className="text-[9px] text-muted-foreground/60 mt-0.5 animate-in fade-in duration-100">{entry.meta}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
