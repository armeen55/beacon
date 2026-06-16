/**
 * Stat sparkline (2026-06-15) — a tiny, axis-free momentum line under
 * the Today "Search (Google)" card's numbers. It plots the real daily
 * clicks the GSC site-totals loader already read (one point per day) so
 * the owner sees the shape of the last ~90 days at a glance.
 *
 * Server component, zero client JS: a single inline <svg>. The graphic
 * is aria-hidden (decorative); an sr-only line carries the meaning for
 * assistive tech. Honest framing — it's just the real clicks, with no
 * axis labels implying precision and no projection. Muted token color
 * (currentColor driven by text-muted-foreground) keeps it quiet against
 * the headline numbers.
 *
 * Renders nothing when there aren't enough points to draw a real line
 * (the caller also gates, but this is defensive).
 */

import {
  buildSparklinePath,
  SPARKLINE_VIEWBOX,
} from "@/domains/today-summary/build-sparkline-path";

export function StatSparkline({ values }: { values: number[] }) {
  const path = buildSparklinePath(values);
  if (path == null) return null;

  const { width, height } = SPARKLINE_VIEWBOX;

  return (
    <div className="mt-2 text-muted-foreground/70" data-stat-sparkline="true">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-6 w-full"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="sr-only">Daily clicks trend over 90 days</span>
    </div>
  );
}
