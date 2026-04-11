"use client";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

export type SparklinePoint = {
  label: string;
  value: number;
};

export function Sparkline({
  points,
  width = 120,
  height = 32,
  strokeColor,
  fillColor,
  showTooltip = true,
  trend,
}: {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  strokeColor?: string;
  fillColor?: string;
  showTooltip?: boolean;
  trend?: "up" | "down" | "flat";
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;

  const autoStroke = trend === "up" ? "stroke-status-success" : trend === "down" ? "stroke-status-danger" : "stroke-accent-primary";
  const autoFill = trend === "up" ? "fill-status-success/10" : trend === "down" ? "fill-status-danger/10" : "fill-accent-primary/10";

  function x(i: number): number {
    return pad + ((width - pad * 2) / (points.length - 1)) * i;
  }
  function y(v: number): number {
    return pad + (height - pad * 2) * (1 - (v - min) / range);
  }

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const idx = Math.round((relX - pad) / ((width - pad * 2) / (points.length - 1)));
    setHoverIdx(Math.max(0, Math.min(idx, points.length - 1)));
  }

  return (
    <div className="inline-flex items-center gap-1.5 relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <path
          d={areaPath}
          className={cn(fillColor ?? autoFill)}
        />
        <path
          d={linePath}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(strokeColor ?? autoStroke)}
        />
        {hoverIdx !== null && (
          <>
            <circle
              cx={x(hoverIdx)}
              cy={y(points[hoverIdx].value)}
              r={3}
              className={cn("fill-background", strokeColor ?? autoStroke)}
              strokeWidth={2}
            />
            <line
              x1={x(hoverIdx)}
              y1={pad}
              x2={x(hoverIdx)}
              y2={height - pad}
              className="stroke-muted-foreground/20"
              strokeWidth={1}
              strokeDasharray="2,2"
            />
          </>
        )}
      </svg>
      {showTooltip && hoverIdx !== null && (
        <span className="text-[10px] tabular-nums text-foreground font-medium whitespace-nowrap animate-in fade-in duration-100">
          {points[hoverIdx].value.toLocaleString()}
          <span className="text-muted-foreground font-normal ml-0.5">{points[hoverIdx].label}</span>
        </span>
      )}
    </div>
  );
}
