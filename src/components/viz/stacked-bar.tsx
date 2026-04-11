"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type StackSegment = {
  label: string;
  value: number;
  color: string;
};

export type StackedBarEntry = {
  label: string;
  segments: StackSegment[];
  total?: number;
};

export function StackedBar({
  entries,
  title,
  showTotals = true,
  height = 20,
}: {
  entries: StackedBarEntry[];
  title?: string;
  showTotals?: boolean;
  height?: number;
}) {
  const [hovered, setHovered] = useState<{ entry: number; seg: number } | null>(null);
  const maxTotal = Math.max(...entries.map((e) => e.total ?? e.segments.reduce((s, seg) => s + seg.value, 0)), 1);

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>}
      <div className="space-y-2">
        {entries.map((entry, ei) => {
          const total = entry.total ?? entry.segments.reduce((s, seg) => s + seg.value, 0);
          const barWidth = (total / maxTotal) * 100;
          return (
            <div key={entry.label}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10px] text-muted-foreground truncate">{entry.label}</span>
                {showTotals && <span className="text-[10px] tabular-nums font-medium shrink-0">{total.toLocaleString()}</span>}
              </div>
              <div
                className="rounded-full overflow-hidden bg-border/20 flex"
                style={{ height, width: `${Math.max(barWidth, 3)}%` }}
              >
                {entry.segments.map((seg, si) => {
                  const segPct = total > 0 ? (seg.value / total) * 100 : 0;
                  const isHov = hovered?.entry === ei && hovered?.seg === si;
                  return (
                    <div
                      key={seg.label}
                      className={cn("transition-all duration-200 cursor-default", seg.color, isHov && "brightness-110")}
                      style={{ width: `${segPct}%`, minWidth: seg.value > 0 ? "2px" : 0 }}
                      onMouseEnter={() => setHovered({ entry: ei, seg: si })}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
              </div>
              {hovered?.entry === ei && (
                <p className="text-[9px] text-muted-foreground mt-0.5 animate-in fade-in duration-100">
                  {entry.segments[hovered.seg].label}: {entry.segments[hovered.seg].value.toLocaleString()} ({total > 0 ? Math.round((entry.segments[hovered.seg].value / total) * 100) : 0}%)
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
