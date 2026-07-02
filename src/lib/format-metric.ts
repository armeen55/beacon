/**
 * format-metric (FINAL PREMIUM PLAN item 18) - THE number formatter for operator surfaces.
 * One discipline everywhere: thousands separators for full numbers, compact "26.5k" for chips
 * (full number belongs in the title/hover), never scientific notation, never raw floats.
 * Pure, client and server safe. Pinned by format-metric.test.ts.
 */

/** Full number with thousands separators ("26,569"). Safe on null/NaN -> "". */
export function formatMetric(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-US");
}

/** Compact chip form: 999 -> "999", 26569 -> "26.5k", 1200000 -> "1.2m". Pair with a
 *  title attribute carrying formatMetric(n) so the full number is one hover away. */
export function formatMetricCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  // One TRUNCATED decimal (26,569 -> "26.5k", never rounded up - a chip should not overclaim).
  const oneDp = (v: number) => (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
  if (abs < 1000) return `${sign}${Math.round(abs)}`;
  if (abs < 100_000) return `${sign}${oneDp(abs / 1000)}k`;
  if (abs < 1_000_000) return `${sign}${Math.floor(abs / 1000)}k`;
  return `${sign}${oneDp(abs / 1_000_000)}m`;
}

/** Signed percent for deltas ("+9%", "-3%"). Null-safe -> "". */
export function formatDeltaPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  const r = Math.round(pct);
  return `${r > 0 ? "+" : ""}${r}%`;
}
