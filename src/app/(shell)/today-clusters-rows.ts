/**
 * today-clusters-rows (2026-06-25) — content-cluster performance: group the
 * tenant's pages by theme (URL directory, or the leading slug token for flat
 * URLs) and rank which content TYPES actually drive traffic. The strategic
 * "make more of what works / fix the weak theme" view, above the per-page lenses.
 * Pure + dependency-free.
 */

export type ClusterPageInput = { page: string; clicks: number; impressions: number };

export type ClusterPerf = {
  cluster: string;
  pages: number;
  clicks: number;
  impressions: number;
  /** clicks / impressions across the cluster (how well the theme converts views). */
  ctr: number;
};

/**
 * Theme key for a URL: the first path directory when nested (`/iran-animals/x` →
 * `iran-animals`), else the leading hyphen token of a flat slug (`/persian-boy-
 * names` → `persian`). Groups `persian-*` pages together, `iran-*` together, etc.
 */
export function clusterOf(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0]!.split("#")[0]!;
  }
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return "home";
  if (segs.length >= 2) return segs[0]!.toLowerCase();
  const token = segs[0]!.toLowerCase().split("-")[0]!;
  return token || segs[0]!.toLowerCase();
}

/**
 * Aggregate page metrics into ranked clusters. Each page counts once; clusters
 * sorted by clicks (biggest-driving theme first), capped. A `minPages` floor
 * keeps one-off pages from masquerading as a "cluster" (tunable; default 1).
 */
export function buildClusterPerformance(
  pages: readonly ClusterPageInput[],
  opts: { minPages?: number; cap?: number } = {},
): ClusterPerf[] {
  const minPages = opts.minPages ?? 1;
  const cap = opts.cap ?? 8;
  const acc = new Map<string, { pages: number; clicks: number; impressions: number }>();
  for (const p of pages) {
    if (!p.page) continue;
    const key = clusterOf(p.page);
    const a = acc.get(key) ?? { pages: 0, clicks: 0, impressions: 0 };
    a.pages += 1;
    a.clicks += p.clicks;
    a.impressions += p.impressions;
    acc.set(key, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.pages >= minPages)
    .map(([cluster, a]) => ({
      cluster,
      pages: a.pages,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    }))
    .sort((x, y) => y.clicks - x.clicks)
    .slice(0, cap);
}
