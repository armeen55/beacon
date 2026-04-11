"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type TrellisCell = {
  label: string;
  status: "strong" | "moderate" | "weak" | "absent";
  value?: number;
  meta?: string;
};

const STATUS_COLORS: Record<string, string> = {
  strong: "bg-status-success",
  moderate: "bg-accent-primary",
  weak: "bg-status-warning",
  absent: "bg-border/20",
};

const STATUS_RING: Record<string, string> = {
  strong: "ring-status-success/30",
  moderate: "ring-accent-primary/30",
  weak: "ring-status-warning/30",
  absent: "ring-border/20",
};

export function CoverageTrellis({
  cells,
  title,
  subtitle,
  columns = 6,
}: {
  cells: TrellisCell[];
  title?: string;
  subtitle?: string;
  columns?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-0.5">{title}</p>}
      {subtitle && <p className="text-[10px] text-muted-foreground mb-2">{subtitle}</p>}
      <div className="flex flex-wrap gap-1.5">
        {cells.map((cell, i) => {
          const isHov = hovered === i;
          return (
            <div
              key={cell.label}
              className={cn(
                "rounded-md px-2 py-1.5 cursor-default transition-all min-w-[4.5rem]",
                STATUS_COLORS[cell.status] + "/10",
                isHov && "ring-2 " + STATUS_RING[cell.status],
              )}
              style={{ flexBasis: `calc(${100 / columns}% - 0.375rem)` }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center gap-1">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_COLORS[cell.status])} />
                <span className="text-[10px] font-medium text-foreground truncate capitalize">{cell.label}</span>
              </div>
              {cell.value !== undefined && (
                <span className="text-[10px] tabular-nums text-muted-foreground mt-0.5 block pl-3">
                  {cell.value.toLocaleString()}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {hovered !== null && cells[hovered] && (
        <p className="text-[9px] text-muted-foreground/70 mt-1.5 animate-in fade-in duration-100">
          {cells[hovered].meta ?? `${cells[hovered].label}: ${cells[hovered].status}${cells[hovered].value !== undefined ? ` (${cells[hovered].value!.toLocaleString()})` : ""}`}
        </p>
      )}
      <div className="flex items-center gap-3 mt-2 text-[9px] text-muted-foreground/60">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-status-success" />Strong</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />Moderate</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-status-warning" />Weak</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-border/40" />Absent</span>
      </div>
    </div>
  );
}
