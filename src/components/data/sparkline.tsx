/**
 * Sparkline (FINAL PREMIUM PLAN items 4+5) - a tiny pure-SVG clicks-over-time line usable from
 * server AND client components (no directives, no state, no deps). Optionally marks a ship date
 * with a dot + a subtle before/after tint so cause and effect read at a glance. No page name is
 * ever "just a URL string" again.
 *
 * R14b (named controls): optional `comparisons` render as muted DASHED lines under the main
 * series (max 2 by convention, the caller slices), sharing one y scale so the treated page and
 * its comparison pages are honestly on the same footing. Same component, no new chart lib.
 */

export type SparkPoint = { date: string; clicks: number };

export function Sparkline({
  points,
  markerDate,
  width = 96,
  height = 24,
  className,
  comparisons,
}: {
  points: SparkPoint[];
  /** yyyy-mm-dd ship date to mark (dot + after-shading). */
  markerDate?: string | null;
  width?: number;
  height?: number;
  className?: string;
  /** R14b - comparison-page series drawn as dashed muted lines behind the main one. */
  comparisons?: ReadonlyArray<{ points: SparkPoint[] }>;
}) {
  const pts = (points ?? []).filter((p) => p && p.date);
  if (pts.length < 5) return null;
  const comparisonSeries = (comparisons ?? [])
    .map((c) => (c.points ?? []).filter((p) => p && p.date))
    .filter((c) => c.length >= 5);
  const max = Math.max(
    1,
    ...pts.map((p) => p.clicks),
    ...comparisonSeries.flatMap((c) => c.map((p) => p.clicks)),
  );
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const pathOf = (series: SparkPoint[]): string => {
    const n = series.length;
    const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (width - 2)) + 1;
    return series
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.clicks).toFixed(1)}`)
      .join(" ");
  };
  const n = pts.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (width - 2)) + 1;
  const mi = markerDate ? pts.findIndex((p) => p.date >= markerDate) : -1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={
        comparisonSeries.length > 0
          ? `Clicks per day, last ${n} days, with ${comparisonSeries.length} comparison page${comparisonSeries.length === 1 ? "" : "s"} dashed`
          : `Clicks per day, last ${n} days`
      }
    >
      {mi >= 0 ? (
        <rect x={x(mi)} y={1} width={Math.max(0, width - 1 - x(mi))} height={height - 2} fill="#6366f1" opacity="0.07" rx="2" />
      ) : null}
      {comparisonSeries.map((c, i) => (
        <path
          key={i}
          d={pathOf(c)}
          fill="none"
          stroke="#9ca3af"
          strokeWidth="1"
          strokeDasharray="3 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
          data-comparison-series="true"
        />
      ))}
      <path d={pathOf(pts)} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      {mi >= 0 ? <circle cx={x(mi)} cy={y(pts[mi]!.clicks)} r="2.5" fill="#4f46e5" stroke="var(--background)" strokeWidth="1" /> : null}
    </svg>
  );
}
