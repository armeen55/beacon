"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

export function DonutRing({
  segments,
  size = 80,
  thickness = 8,
  centerLabel,
  centerValue,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let cumulative = 0;
  const arcs = segments.map((seg, i) => {
    const pct = seg.value / total;
    const dashArray = `${circumference * pct} ${circumference * (1 - pct)}`;
    const dashOffset = -circumference * cumulative;
    cumulative += pct;
    return { ...seg, pct, dashArray, dashOffset, index: i };
  });

  return (
    <div className="inline-flex items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={hovered === arc.index ? thickness + 3 : thickness}
              className={cn("transition-all duration-200 cursor-default", arc.color)}
              strokeDasharray={arc.dashArray}
              strokeDashoffset={arc.dashOffset}
              strokeLinecap="round"
              onMouseEnter={() => setHovered(arc.index)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        {(centerLabel || centerValue !== undefined) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue !== undefined && (
              <span className="text-sm font-bold tabular-nums leading-none">
                {hovered !== null ? `${Math.round(arcs[hovered].pct * 100)}%` : centerValue}
              </span>
            )}
            {centerLabel && (
              <span className="text-[8px] text-muted-foreground mt-0.5 leading-none">
                {hovered !== null ? arcs[hovered].label : centerLabel}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="space-y-1">
        {arcs.map((arc) => (
          <div
            key={arc.label}
            className={cn(
              "flex items-center gap-1.5 text-[10px] cursor-default transition-colors",
              hovered === arc.index ? "text-foreground font-medium" : "text-muted-foreground",
            )}
            onMouseEnter={() => setHovered(arc.index)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0", arc.color.replace("stroke-", "bg-"))} />
            <span className="truncate">{arc.label}</span>
            <span className="tabular-nums ml-auto">{arc.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
