"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type ScoreRailSegment = {
  label: string;
  value: number | null;
  max: number;
  status: "sufficient" | "partial" | "insufficient";
};

export function ScoreRail({
  segments,
  compositeValue,
  compositeLabel,
}: {
  segments: ScoreRailSegment[];
  compositeValue?: number | null;
  compositeLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {compositeValue !== null && compositeValue !== undefined && (
        <div className="flex items-end gap-3">
          <span className="text-3xl font-black tabular-nums tracking-tighter leading-none">
            {compositeValue}
          </span>
          <div className="pb-0.5">
            <span className="text-xs text-muted-foreground">/100</span>
            {compositeLabel && (
              <p className="text-[10px] text-muted-foreground/70">{compositeLabel}</p>
            )}
          </div>
        </div>
      )}
      <div className="space-y-2">
        {segments.map((seg, i) => {
          const pct = seg.value !== null ? (seg.value / seg.max) * 100 : 0;
          const isHovered = hovered === i;
          return (
            <div
              key={seg.label}
              className="group cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className={cn(
                  "text-[11px] transition-colors",
                  isHovered ? "text-foreground font-medium" : "text-muted-foreground",
                )}>
                  {seg.label}
                </span>
                <span className="text-[11px] tabular-nums font-semibold">
                  {seg.value !== null ? seg.value : (
                    <span className="text-muted-foreground/40 font-normal italic text-[10px]">
                      {seg.status === "insufficient" ? "insufficient data" : "partial"}
                    </span>
                  )}
                </span>
              </div>
              <div className={cn(
                "h-2 rounded-full overflow-hidden transition-all",
                seg.status === "insufficient" ? "bg-border/20" : "bg-border/40",
              )}>
                {seg.value !== null ? (
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      isHovered ? "opacity-100" : "opacity-85",
                      pct >= 60 ? "bg-status-success" : pct >= 35 ? "bg-status-warning" : "bg-status-danger",
                      seg.status === "partial" && "opacity-60",
                    )}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                ) : (
                  <div className="h-full w-full bg-border/10 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(127,127,127,0.05)_4px,rgba(127,127,127,0.05)_8px)]" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
