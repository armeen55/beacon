/**
 * Pure sitemap XML parsing — extracted from scripts/scan-owned-pages.ts
 * (2026-06-10, P0 wall 2: multi-tenant scan fleet).
 *
 * Why: the original fetcher parsed only flat `<urlset>` sitemaps, which
 * is what Ritz serves. Wix sites (Iranopedia) serve a `<sitemapindex>`
 * at /sitemap.xml whose children hold the real `<url>` entries — the
 * flat parser saw 0 entries and the scan aborted. These helpers parse
 * BOTH shapes; the fetcher recurses one level into index children.
 *
 * Pure string → data. No fetch, no fs, no tenant context — unit-testable
 * without a network.
 */

export type SitemapUrlEntry = { url: string; lastmod: string | null };

/**
 * One-level child cap when recursing a sitemap index. Wix emits one
 * child per collection/page-group; 50 covers encyclopedia-scale sites
 * while bounding the fetch fan-out of a hostile/degenerate index.
 */
export const MAX_CHILD_SITEMAPS = 50;

/** Parse `<url><loc>…</loc><lastmod>…</lastmod></url>` blocks (flat urlset). */
export function parseSitemapUrlEntries(xml: string): SitemapUrlEntry[] {
  const entries: SitemapUrlEntry[] = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const modMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (locMatch) {
      entries.push({
        url: locMatch[1].trim().replace(/\/+$/, ""),
        lastmod: modMatch ? modMatch[1].trim() : null,
      });
    }
  }
  return entries;
}

/**
 * Parse `<sitemap><loc>…</loc></sitemap>` children of a `<sitemapindex>`.
 * Returns [] when the XML is not an index (flat urlset, garbage, etc.).
 * Caps at MAX_CHILD_SITEMAPS, preserving document order (Wix lists the
 * most product-shaped collections first; order rarely matters because
 * callers fetch all children up to the cap).
 */
export function parseSitemapIndexLocs(xml: string): string[] {
  if (!/<sitemapindex[\s>]/.test(xml)) return [];
  const locs: string[] = [];
  const blocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) ?? [];
  for (const block of blocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    if (locMatch) {
      const loc = locMatch[1].trim();
      if (loc.length > 0) locs.push(loc);
    }
    if (locs.length >= MAX_CHILD_SITEMAPS) break;
  }
  return locs;
}

/** Dedupe entries by normalized URL, keeping the first occurrence. */
export function dedupeSitemapEntries(entries: SitemapUrlEntry[]): SitemapUrlEntry[] {
  const seen = new Set<string>();
  const out: SitemapUrlEntry[] = [];
  for (const e of entries) {
    const key = e.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
