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
      "rounded-lg border border-border/60 bg-surface-raised/40",
      size === "lg" ? "px-5 py-4" : "px-4 py-3",
    )}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">{label}</p>
        {delta !== null && delta !== undefined && (
          <span className={cn(
            "text-[11px] font-bold tabular-nums",
            delta > 0 ? "text-status-success" : delta < 0 ? "text-status-danger" : "text-muted-foreground",
          )}>
            {delta > 0 ? "+" : ""}{delta}{deltaSuffix}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("font-extrabold tabular-nums tracking-tighter", size === "lg" ? "text-3xl" : "text-2xl")}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <Sparkline points={sparklineData} width={80} height={28} trend={effectiveTrend} showTooltip={false} />
        )}
      </div>
      {meta && <p className="text-[10px] text-muted-foreground/60 mt-1.5 leading-snug">{meta}</p>}
    </div>
  );
}
