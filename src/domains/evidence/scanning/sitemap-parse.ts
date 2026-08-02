/**
 * Pure sitemap XML parsing. A site serves either a flat `<urlset>` or a `<sitemapindex>` whose
 * children hold the real `<url>` entries, and a large site nests indexes inside indexes. These
 * helpers parse both shapes; in-process-scan owns the bounded recursion through them.
 *
 * Pure string to data. No fetch, no fs, no tenant context.
 */

export type SitemapUrlEntry = { url: string; lastmod: string | null };

/** Children returned from ONE index document. The caller's own fetch budget bounds the tree. */
const MAX_CHILD_SITEMAPS = 50;

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
