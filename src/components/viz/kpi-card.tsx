"use client";

import { cn } from "@/lib/utils";
import { Sparkline, type SparklinePoint } from "./sparkline";

export function KpiCard({
  label,
  value,
  suffix,
  delta,
  deltaSuffix = "",
  trend,
  sparklineData,
  meta,
  size = "default",
}: {
  label: string;
  value: string | number;
  suffix?: string;
  delta?: number | null;
  deltaSuffix?: string;
  trend?: "up" | "down" | "flat";
  sparklineData?: SparklinePoint[];
  meta?: string;
  size?: "default" | "lg";
}) {
  const effectiveTrend = trend ?? (delta !== null && delta !== undefined ? (delta > 0 ? "up" : delta < 0 ? "down" : "flat") : undefined);

  return (
    <div className={cn(
      "rounded-lg border border-border/50 bg-surface-raised/30 transition-colors hover:border-border/70",
      size === "lg" ? "px-5 py-4" : "px-3 py-2.5",
    )}>
      <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("font-bold tabular-nums tracking-tight", size === "lg" ? "text-2xl" : "text-lg")}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
          {delta !== null && delta !== undefined && (
            <span className={cn(
              "text-xs font-semibold tabular-nums",
              delta > 0 ? "text-status-success" : delta < 0 ? "text-status-danger" : "text-muted-foreground",
            )}>
              {delta > 0 ? "+" : ""}{delta}{deltaSuffix}
            </span>
          )}
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <Sparkline points={sparklineData} width={80} height={24} trend={effectiveTrend} showTooltip={false} />
        )}
      </div>
      {meta && <p className="text-[9px] text-muted-foreground/50 mt-1">{meta}</p>}
    </div>
  );
}
