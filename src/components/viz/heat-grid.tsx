"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type HeatCell = {
  row: string;
  col: string;
  value: number;
  label?: string;
};

export function HeatGrid({
  cells,
  rows,
  cols,
  title,
  valueSuffix = "",
  emptyLabel = "—",
}: {
  cells: HeatCell[];
  rows: string[];
  cols: string[];
  title?: string;
  valueSuffix?: string;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<{ row: string; col: string } | null>(null);

  const max = Math.max(...cells.map((c) => c.value), 1);
  const cellMap = new Map<string, HeatCell>();
  for (const c of cells) cellMap.set(`${c.row}|${c.col}`, c);

  function cellColor(value: number): string {
    const intensity = value / max;
    if (intensity >= 0.7) return "bg-accent-primary/60";
    if (intensity >= 0.4) return "bg-accent-primary/30";
    if (intensity >= 0.1) return "bg-accent-primary/15";
    if (value > 0) return "bg-accent-primary/5";
    return "bg-transparent";
  }

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>}
      <div className="overflow-x-auto">
        <div className="inline-grid gap-px" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(3rem, 1fr))` }}>
          {/* Header row */}
          <div className="px-1 py-1" />
          {cols.map((col) => (
            <div key={col} className="px-1 py-1 text-[9px] font-medium text-muted-foreground text-center truncate">
              {col}
            </div>
          ))}

          {/* Data rows */}
          {rows.map((row) => (
            <>
              <div key={`label-${row}`} className="px-1 py-1 text-[10px] font-medium text-muted-foreground truncate pr-2 capitalize">
                {row}
              </div>
              {cols.map((col) => {
                const cell = cellMap.get(`${row}|${col}`);
                const value = cell?.value ?? 0;
                const isHovered = hovered?.row === row && hovered?.col === col;
                return (
                  <div
                    key={`${row}|${col}`}
                    className={cn(
                      "px-1 py-1.5 text-center text-[10px] tabular-nums rounded-sm transition-all cursor-default",
                      cellColor(value),
                      isHovered && "ring-1 ring-accent-primary/50 scale-105",
                    )}
                    onMouseEnter={() => setHovered({ row, col })}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {value > 0 ? (
                      <span className={cn("font-medium", isHovered ? "text-foreground" : "text-foreground/80")}>
                        {value.toLocaleString()}{valueSuffix}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">{emptyLabel}</span>
                    )}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>
      {hovered && (() => {
        const cell = cellMap.get(`${hovered.row}|${hovered.col}`);
        return cell ? (
          <p className="text-[10px] text-muted-foreground mt-1.5 animate-in fade-in duration-100">
            {cell.label ?? `${hovered.row} × ${hovered.col}: ${cell.value.toLocaleString()}${valueSuffix}`}
          </p>
        ) : null;
      })()}
    </div>
  );
}
