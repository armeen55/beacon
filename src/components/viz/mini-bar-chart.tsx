"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type BarEntry = {
  label: string;
  value: number;
  secondaryValue?: number;
  color?: string;
  meta?: string;
};

export function MiniBarChart({
  entries,
  title,
  subtitle,
  maxValue,
  showValues = true,
  height = 6,
  colorScheme = "default",
}: {
  entries: BarEntry[];
  title?: string;
  subtitle?: string;
  maxValue?: number;
  showValues?: boolean;
  height?: number;
  colorScheme?: "default" | "heat" | "competitive";
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = maxValue ?? Math.max(...entries.map((e) => e.value), 1);

  function barColor(entry: BarEntry, idx: number): string {
    if (entry.color) return entry.color;
    if (colorScheme === "heat") {
      const pct = entry.value / max;
      if (pct >= 0.6) return "bg-status-success";
      if (pct >= 0.3) return "bg-status-warning";
      return "bg-status-danger";
    }
    if (colorScheme === "competitive") {
      return idx === 0 ? "bg-accent-primary" : "bg-muted-foreground/30";
    }
    return "bg-accent-primary";
  }

  return (
    <div>
      {(title || subtitle) && (
        <div className="mb-2">
          {title && <p className="text-[11px] font-semibold text-foreground">{title}</p>}
          {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      <div className="space-y-1.5">
        {entries.map((entry, i) => {
          const pct = max > 0 ? (entry.value / max) * 100 : 0;
          const isHovered = hovered === i;
          return (
            <div
              key={entry.label}
              className="group cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className={cn(
                  "truncate transition-colors",
                  isHovered ? "text-foreground font-medium" : "text-muted-foreground",
                )}>
                  {entry.label}
                </span>
                {showValues && (
                  <span className="tabular-nums font-medium text-foreground shrink-0">
                    {entry.value.toLocaleString()}
                    {entry.secondaryValue !== undefined && (
                      <span className="text-muted-foreground font-normal"> / {entry.secondaryValue.toLocaleString()}</span>
                    )}
                  </span>
                )}
              </div>
              <div
                className="rounded-full bg-border/30 overflow-hidden mt-0.5 transition-all"
                style={{ height: `${isHovered ? height + 2 : height}px` }}
              >
                <div
                  className={cn("h-full rounded-full transition-all duration-300", barColor(entry, i))}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              {isHovered && entry.meta && (
                <p className="text-[9px] text-muted-foreground/70 mt-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  {entry.meta}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
