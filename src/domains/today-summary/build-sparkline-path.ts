/**
 * Sparkline path builder (2026-06-15) — the PURE geometry behind the
 * tiny daily-clicks momentum line on the Today "Search (Google)" stat
 * card. Maps a `number[]` series to an SVG polyline `d` string inside a
 * fixed viewBox, normalizing the series to fill the vertical space.
 *
 * Honest by construction: it plots the real values only — no smoothing,
 * no projection, no implied axis. The card gates on having enough points
 * (≥14) so we never render a flat or near-empty line that would imply
 * precision we don't have.
 *
 * Pure: no I/O, no Date. Unit-tested in build-sparkline-path.test.ts.
 */

/** Fixed viewBox for the inline sparkline (small, axis-free). */
export const SPARKLINE_VIEWBOX = { width: 100, height: 24 } as const;

/** Vertical inset so the stroke (and its round cap) never clips the edge. */
const PAD_Y = 2;

/**
 * Build the SVG path `d` for a sparkline from a numeric series.
 *
 * - <2 points → null (a single point isn't a trend; the caller omits it).
 * - All values equal (range 0) → a flat line through the vertical middle
 *   (avoids divide-by-zero; honest "no change" rather than a fake slope).
 * - Otherwise → values normalized to [PAD_Y, height-PAD_Y], higher value
 *   = higher on screen (smaller y), points evenly spaced across the width.
 *
 * Coordinates are rounded to 2 decimals to keep the markup compact.
 */
export function buildSparklinePath(
  values: number[],
  viewBox: { width: number; height: number } = SPARKLINE_VIEWBOX,
): string | null {
  if (values.length < 2) return null;

  const { width, height } = viewBox;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const usableH = height - PAD_Y * 2;
  const stepX = width / (values.length - 1);

  const y = (v: number): number => {
    if (range === 0) return height / 2;
    // Higher value → smaller y (top of the box).
    return PAD_Y + usableH * (1 - (v - min) / range);
  };

  return values
    .map((v, i) => {
      const px = (stepX * i).toFixed(2);
      const py = y(v).toFixed(2);
      return `${i === 0 ? "M" : "L"}${px},${py}`;
    })
    .join(" ");
}
