/**
 * sparkline (2026-06-25) — one shared, pure SVG-path builder for the weekly
 * clicks sparklines that the traffic-trend section, the per-page momentum lens,
 * and the Workbench momentum strip all draw. Extracted to kill the triplicated
 * path math (which would otherwise drift). No DOM, no deps — fully testable.
 */

export type SparkPoint = { clicks: number };

export type SparklinePaths = {
  /** `M…L…` polyline through the points. */
  line: string;
  /** Closed area path (polyline + baseline) for the fill. */
  area: string;
  /** x(i): horizontal pixel for point index i (fractional ok, for markers). */
  x: (i: number) => number;
  /** y(c): vertical pixel for a clicks value. */
  y: (c: number) => number;
};

/**
 * Build the line + area paths and the x/y scales for a set of points in a
 * `w`×`h` viewBox with `pad` inset. A single point centers; an empty set yields
 * empty paths (the caller self-hides before this in practice).
 */
export function buildSparklinePaths(
  points: readonly SparkPoint[],
  w: number,
  h: number,
  pad = 3,
): SparklinePaths {
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.clicks));
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (c: number) => h - pad - (c / max) * (h - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.clicks).toFixed(1)}`).join(" ");
  const area =
    n === 0
      ? ""
      : `${line} L${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)} L${x(0).toFixed(1)},${(h - pad).toFixed(1)} Z`;
  return { line, area, x, y };
}

/**
 * Fractional point-index of the week-bucket a date falls in (for an
 * overlaid marker), or null when the date is outside the window. Interpolates
 * within the 7-day bucket so the marker lands where the event actually happened.
 */
export function weekBucketIndex(
  points: readonly { weekStart: string }[],
  dateIso: string,
): number | null {
  const t = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  for (let i = 0; i < points.length; i++) {
    const start = Date.parse(`${points[i]!.weekStart}T00:00:00Z`);
    const end = start + 7 * 86_400_000;
    if (t >= start && t < end) return i + (t - start) / (7 * 86_400_000);
  }
  return null;
}
