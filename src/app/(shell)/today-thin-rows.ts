/**
 * today-thin-rows (2026-06-25) — "Thin pages with demand → expand them": pages
 * with a low word count that nonetheless earn real Google impressions. The ranking
 * is earned but the page under-serves the query — expanding it (depth, an answer
 * block, examples) captures clicks the thin content leaves on the table. Pure +
 * dependency-free; loaders inject crawl metadata (word count) + per-page impressions.
 */

export type ThinInput = { url: string; wordCount: number };

export type ThinPage = {
  url: string;
  wordCount: number;
  impressions: number;
};

/**
 * Pick thin-but-trafficked expand candidates: word count below `maxWords` AND
 * ≥`minImpressions` monthly impressions. Sorted by impressions (biggest unmet
 * demand first), capped. Pages with no recorded word count are skipped (can't
 * judge depth).
 */
export function buildThinPages(
  pages: readonly ThinInput[],
  impressionsByUrl: Map<string, number>,
  opts: { maxWords?: number; minImpressions?: number; cap?: number } = {},
): ThinPage[] {
  const maxWords = opts.maxWords ?? 500;
  const minImpressions = opts.minImpressions ?? 50;
  const cap = opts.cap ?? 10;
  const out: ThinPage[] = [];
  for (const p of pages) {
    if (!p.url || p.wordCount <= 0 || p.wordCount >= maxWords) continue;
    const impressions = impressionsByUrl.get(p.url) ?? 0;
    if (impressions < minImpressions) continue;
    out.push({ url: p.url, wordCount: p.wordCount, impressions });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out.slice(0, cap);
}

/** Total impressions riding on thin pages (the unmet-demand pool to expand into). */
export function thinImpressionsAtStake(rows: ThinPage[]): number {
  return rows.reduce((s, r) => s + r.impressions, 0);
}
