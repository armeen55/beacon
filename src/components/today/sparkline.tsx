/**
 * W2 Step 2.3 (master plan) — tiny SVG sparkline for "Where AI ranks you".
 *
 * Pure presentation; no state, no math beyond rendering coords. Consumes
 * `points: Array<number | null>` directly from
 * `buildPlatformPrimaryRateSparklines()` — `null` denotes a day with zero
 * observations on that platform and renders as a gap (not a 0% dip).
 *
 * Width × height defaults to 60 × 16 px to fit inline next to a label
 * without dominating the row. Minimal stroke + a single dot at the
 * latest sampled point. No axes, no labels, no tooltips — those would
 * pull weight away from the section's job (one-glance trend).
 */

import { cn } from "@/lib/utils";

export type SparklineProps = {
  /**
   * Daily values in chronological order (oldest first). `null` =
   * unsampled day → renders as a gap. Values expected in `[0, 1]`
   * (primary rate); the component clamps display to that range so a
   * stray 1.05 doesn't render off-canvas.
   */
  points: ReadonlyArray<number | null>;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
};

export function Sparkline({
  points,
  width = 60,
  height = 16,
  className,
  ariaLabel = "Trend over time",
}: SparklineProps) {
  if (points.length === 0) {
    return (
      <span
        className={cn(
          "inline-block text-[10px] text-muted-foreground/40",
          className,
        )}
        aria-label={ariaLabel}
      >
        -
      </span>
    );
  }

  // Build path. We treat null-runs as gaps by emitting separate sub-paths
  // (M ... L ...). One sub-path per contiguous run of non-null points.
  // Coords: x = (i / (n - 1)) * width; y = height - clamp01(v) * height.
  const n = points.length;
  const denom = Math.max(1, n - 1);
  const segments: string[] = [];
  let current: string[] = [];
  let lastValidIdx = -1;
  let lastValidValue: number | null = null;

  for (let i = 0; i < n; i++) {
    const v = points[i];
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 0) {
        segments.push(current.join(" "));
        current = [];
      }
      continue;
    }
    const clamped = Math.max(0, Math.min(1, v));
    const x = (i / denom) * width;
    const y = height - clamped * height;
    current.push(
      current.length === 0
        ? `M ${x.toFixed(2)} ${y.toFixed(2)}`
        : `L ${x.toFixed(2)} ${y.toFixed(2)}`,
    );
    lastValidIdx = i;
    lastValidValue = clamped;
  }
  if (current.length > 0) segments.push(current.join(" "));

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block align-middle", className)}
    >
      {segments.length > 0 && (
        <path
          d={segments.join(" ")}
          fill="none"
          strokeWidth={1.25}
          className="stroke-accent-primary/80"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {lastValidIdx >= 0 && lastValidValue !== null && (
        <circle
          cx={(lastValidIdx / denom) * width}
          cy={height - lastValidValue * height}
          r={1.5}
          className="fill-accent-primary"
        />
      )}
    </svg>
  );
}
