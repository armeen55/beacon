"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type RadialDimension = {
  label: string;
  value: number | null;
  max: number;
  color?: string;
};

export function RadialScore({
  dimensions,
  size = 160,
  centerValue,
  centerLabel,
}: {
  dimensions: RadialDimension[];
  size?: number;
  centerValue?: string | number | null;
  centerLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const n = dimensions.length;
  if (n < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 20;
  const rings = 3;

  function polarToCart(angle: number, radius: number): [number, number] {
    const rad = (angle - 90) * (Math.PI / 180);
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }

  const angleStep = 360 / n;

  return (
    <div className="inline-flex items-start gap-4">
      <svg width={size} height={size} className="shrink-0">
        {/* Grid rings */}
        {Array.from({ length: rings }, (_, i) => {
          const r = (maxR / rings) * (i + 1);
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" className="stroke-border/15" strokeWidth={0.5} />;
        })}

        {/* Axis lines */}
        {dimensions.map((_, i) => {
          const angle = angleStep * i;
          const [ex, ey] = polarToCart(angle, maxR);
          return <line key={i} x1={cx} y1={cy} x2={ex} y2={ey} className="stroke-border/10" strokeWidth={0.5} />;
        })}

        {/* Value polygon */}
        <polygon
          points={dimensions.map((d, i) => {
            const angle = angleStep * i;
            const r = d.value !== null ? (d.value / d.max) * maxR : 0;
            const [px, py] = polarToCart(angle, r);
            return `${px},${py}`;
          }).join(" ")}
          className="fill-accent-primary/15 stroke-accent-primary"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Points + labels */}
        {dimensions.map((d, i) => {
          const angle = angleStep * i;
          const r = d.value !== null ? (d.value / d.max) * maxR : 0;
          const [px, py] = polarToCart(angle, r);
          const [lx, ly] = polarToCart(angle, maxR + 12);
          const isHov = hovered === i;
          return (
            <g
              key={d.label}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-default"
            >
              {d.value !== null && (
                <circle
                  cx={px} cy={py} r={isHov ? 4 : 3}
                  className={cn("fill-accent-primary transition-all duration-200", isHov && "fill-foreground")}
                />
              )}
              <text
                x={lx} y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn(
                  "transition-all duration-150",
                  isHov ? "fill-foreground text-[9px] font-semibold" : "fill-muted-foreground/60 text-[8px]",
                )}
              >
                {d.label.length > 12 ? d.label.slice(0, 10) + "…" : d.label}
              </text>
            </g>
          );
        })}

        {/* Center */}
        {centerValue !== null && centerValue !== undefined && (
          <>
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-foreground text-sm font-bold">
              {centerValue}
            </text>
            {centerLabel && (
              <text x={cx} y={cy + 10} textAnchor="middle" className="fill-muted-foreground text-[8px]">
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>

      {/* Hover detail */}
      {hovered !== null && (
        <div className="text-[10px] pt-4 animate-in fade-in slide-in-from-left-2 duration-150 min-w-[8rem]">
          <p className="font-semibold text-foreground">{dimensions[hovered].label}</p>
          <p className="tabular-nums mt-0.5">
            {dimensions[hovered].value !== null ? (
              <span className="text-foreground">{dimensions[hovered].value} / {dimensions[hovered].max}</span>
            ) : (
              <span className="text-muted-foreground/50 italic">insufficient data</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
