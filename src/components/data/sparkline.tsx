/**
 * Sparkline (FINAL PREMIUM PLAN items 4+5) - a tiny pure-SVG clicks-over-time line usable from
 * server AND client components (no directives, no state, no deps). Optionally marks a ship date
 * with a dot + a subtle before/after tint so cause and effect read at a glance. No page name is
 * ever "just a URL string" again.
 */

export type SparkPoint = { date: string; clicks: number };

export function Sparkline({
  points,
  markerDate,
  width = 96,
  height = 24,
  className,
}: {
  points: SparkPoint[];
  /** yyyy-mm-dd ship date to mark (dot + after-shading). */
  markerDate?: string | null;
  width?: number;
  height?: number;
  className?: string;
}) {
  const pts = (points ?? []).filter((p) => p && p.date);
  if (pts.length < 5) return null;
  const max = Math.max(1, ...pts.map((p) => p.clicks));
  const n = pts.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (width - 2)) + 1;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.clicks).toFixed(1)}`).join(" ");
  const mi = markerDate ? pts.findIndex((p) => p.date >= markerDate) : -1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={`Clicks per day, last ${n} days`}
    >
      {mi >= 0 ? (
        <rect x={x(mi)} y={1} width={Math.max(0, width - 1 - x(mi))} height={height - 2} fill="#6366f1" opacity="0.07" rx="2" />
      ) : null}
      <path d={d} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      {mi >= 0 ? <circle cx={x(mi)} cy={y(pts[mi]!.clicks)} r="2.5" fill="#4f46e5" stroke="white" strokeWidth="1" /> : null}
    </svg>
  );
}
