"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export type AreaSeries = {
  label: string;
  data: number[];
  color: string;
  fillColor?: string;
};

/**
 * Optional event annotations \u2014 vertical markers on specific x-positions.
 * Each event gets a small dot + vertical guideline, plus a label on hover.
 * Index must match `labels` array. Added 2026-04-19 for hurting-event overlay.
 */
export type AreaEvent = {
  index: number;
  tone: "danger" | "success" | "neutral";
  label: string;
};

export function AreaChart({
  series,
  labels,
  width: widthProp,
  height = 220,
  showGrid = true,
  stacked = false,
  responsive = true,
  className,
  events,
}: {
  series: AreaSeries[];
  labels: string[];
  width?: number;
  height?: number;
  showGrid?: boolean;
  stacked?: boolean;
  /** When true, width follows container (fills grid). */
  responsive?: boolean;
  className?: string;
  events?: AreaEvent[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredW, setMeasuredW] = useState(widthProp ?? 640);

  useEffect(() => {
    if (!responsive) {
      if (widthProp != null) setMeasuredW(widthProp);
      return;
    }
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(el.getBoundingClientRect().width);
      setMeasuredW(Math.max(200, w));
    });
    ro.observe(el);
    setMeasuredW(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, [responsive, widthProp]);

  const width = responsive ? measuredW : (widthProp ?? 400);

  const pad = { top: 10, right: 6, bottom: 28, left: 6 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const n = labels.length;

  if (n < 2 || series.length === 0) return null;

  let processedSeries: { label: string; data: number[]; color: string; fillColor?: string }[];
  let globalMax: number;

  if (stacked) {
    const stackedData: number[][] = series.map((s) => [...s.data]);
    for (let si = 1; si < stackedData.length; si++) {
      for (let di = 0; di < n; di++) {
        stackedData[si][di] += stackedData[si - 1][di];
      }
    }
    globalMax = Math.max(...stackedData[stackedData.length - 1], 1);
    processedSeries = series.map((s, i) => ({ ...s, data: stackedData[i] }));
  } else {
    globalMax = Math.max(...series.flatMap((s) => s.data), 1);
    processedSeries = series;
  }

  function x(i: number): number { return pad.left + (chartW / (n - 1)) * i; }
  function y(v: number): number { return pad.top + chartH * (1 - v / globalMax); }

  function buildPath(data: number[]): string {
    return data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  }

  function buildArea(data: number[], baseline?: number[]): string {
    const top = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const btm = (baseline ?? data.map(() => 0))
      .map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(v).toFixed(1)}`)
      .reverse()
      .join(" ");
    const bottomPath = baseline
      ? [...baseline].reverse().map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
      : `L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)}`;
    return `${top} ${bottomPath} Z`;
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left - pad.left;
    const idx = Math.round(relX / (chartW / (n - 1)));
    setHoverIdx(Math.max(0, Math.min(idx, n - 1)));
  }

  const gridLines = 4;

  return (
    <div
      ref={containerRef}
      className={cn("flex w-full min-w-0 flex-col", className)}
      style={{ height }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full shrink-0 cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {showGrid && Array.from({ length: gridLines + 1 }, (_, i) => {
          const yy = pad.top + (chartH / gridLines) * i;
          return (
            <line key={i} x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="stroke-border/15" strokeWidth={0.5} />
          );
        })}

        {stacked
          ? processedSeries.map((s, si) => (
              <path
                key={s.label}
                d={buildArea(s.data, si > 0 ? processedSeries[si - 1].data : undefined)}
                className={cn("transition-opacity duration-200", s.fillColor ?? s.color.replace("stroke-", "fill-") + "/20")}
                style={{ opacity: hoverIdx !== null ? 0.7 : 0.5 }}
              />
            ))
          : processedSeries.map((s) => (
              <g key={s.label}>
                <path
                  d={buildArea(s.data)}
                  className={cn(s.fillColor ?? s.color.replace("stroke-", "fill-") + "/10")}
                />
                <path
                  d={buildPath(s.data)}
                  fill="none"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={s.color}
                />
              </g>
            ))}

        {/* Event annotations (hurting dates, etc). Thin guideline + dot on
           the bottom axis so the series itself stays readable. */}
        {events?.filter((e) => e.index >= 0 && e.index < n).map((ev, i) => {
          const tone =
            ev.tone === "danger" ? "stroke-status-danger" :
            ev.tone === "success" ? "stroke-status-success" :
            "stroke-muted-foreground";
          const fill =
            ev.tone === "danger" ? "fill-status-danger" :
            ev.tone === "success" ? "fill-status-success" :
            "fill-muted-foreground";
          return (
            <g key={`ev-${i}-${ev.index}`}>
              <line
                x1={x(ev.index)} y1={pad.top}
                x2={x(ev.index)} y2={height - pad.bottom}
                className={cn(tone, "opacity-40")}
                strokeWidth={1}
                strokeDasharray="2,3"
              />
              <circle
                cx={x(ev.index)}
                cy={height - pad.bottom}
                r={3}
                className={cn(fill, "opacity-85")}
              >
                <title>{ev.label}</title>
              </circle>
            </g>
          );
        })}

        {hoverIdx !== null && (
          <>
            <line
              x1={x(hoverIdx)} y1={pad.top} x2={x(hoverIdx)} y2={height - pad.bottom}
              className="stroke-foreground/20" strokeWidth={1} strokeDasharray="3,3"
            />
            {processedSeries.map((s) => (
              <circle
                key={s.label}
                cx={x(hoverIdx)} cy={y(s.data[hoverIdx])}
                r={3} className={cn("fill-background", s.color)} strokeWidth={2}
              />
            ))}
          </>
        )}

        {labels.filter((_, i) => i % Math.ceil(n / 6) === 0 || i === n - 1).map((label, _, arr) => {
          const origIdx = labels.indexOf(label);
          // Anchor first/last labels to edges so they don't clip against the
          // SVG viewport. Middle labels stay centered.
          const anchor =
            origIdx === 0 ? "start" : origIdx === n - 1 ? "end" : "middle";
          return (
            <text
              key={label}
              x={x(origIdx)}
              y={height - 4}
              textAnchor={anchor}
              className="fill-muted-foreground/50 text-[8px]"
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* Hover tooltip — UX.6.3 (2026-05-08): reserved fixed-height
          row so the layout doesn't shift when the cursor enters /
          leaves the chart. Pre-fix this was conditionally rendered
          (`hoverIdx !== null && ...`), which made downstream content
          (e.g. the visibility chart's "Compare competitors / Split
          by platform" checkbox row) jump up/down each hover. The
          row now always exists; its content is conditional. */}
      <div
        className="mt-1 flex min-h-[14px] flex-wrap items-center gap-x-4 gap-y-1 text-[10px]"
        data-area-chart-hover-row="true"
        aria-live="polite"
      >
        {hoverIdx !== null && (
          <>
            <span className="text-muted-foreground font-medium">{labels[hoverIdx]}</span>
            {processedSeries.map((s) => (
              <span key={s.label} className="tabular-nums">
                <span className={cn("font-semibold", s.color.replace("stroke-", "text-"))}>{s.data[hoverIdx].toLocaleString()}</span>
                <span className="text-muted-foreground ml-1">{s.label}</span>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
