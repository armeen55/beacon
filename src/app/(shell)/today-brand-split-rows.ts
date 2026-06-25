/**
 * today-brand-split-rows (2026-06-25) — split GSC demand into BRANDED (people who
 * already know you — searching your name) vs DISCOVERY (non-branded topic queries
 * — people finding you for the first time). Discovery growth is real SEO growth;
 * a site living on brand traffic isn't expanding its reach. Pure + dependency-free.
 */

export type BrandQueryInput = { query: string; clicks: number; impressions: number };

export type BrandSplit = {
  branded: { clicks: number; impressions: number; queries: number };
  discovery: { clicks: number; impressions: number; queries: number };
  /** Share of clicks that are DISCOVERY (non-branded) — the reach metric. */
  discoveryClicksPct: number;
  /** Top discovery queries by clicks (the topics winning you new people). */
  topDiscovery: BrandQueryInput[];
};

/**
 * Normalize brand seeds into lowercase tokens worth matching (≥3 chars, deduped).
 * Caller passes the business name + domain label; we split on non-alphanumerics so
 * "Ritz Builders" → ["ritz", "builders"] and "iranopedia.com" → ["iranopedia"].
 */
export function brandTokens(seeds: string[]): string[] {
  const out = new Set<string>();
  for (const s of seeds) {
    for (const tok of (s || "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 3 && !GENERIC.has(tok)) out.add(tok);
    }
  }
  return [...out];
}

// Tokens too generic to count as "brand" even if they appear in the name/domain.
const GENERIC = new Set(["com", "net", "org", "www", "the", "inc", "llc", "co", "shop", "store", "online"]);

function isBranded(query: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const q = query.toLowerCase();
  return tokens.some((t) => q.includes(t));
}

/**
 * Partition queries into branded vs discovery. `brandSeeds` are raw strings (name,
 * domain); tokenized internally. Discovery = anything not matching a brand token.
 */
export function splitBrandedTraffic(
  queries: readonly BrandQueryInput[],
  brandSeeds: string[],
  opts: { topDiscovery?: number } = {},
): BrandSplit {
  const tokens = brandTokens(brandSeeds);
  const branded = { clicks: 0, impressions: 0, queries: 0 };
  const discovery = { clicks: 0, impressions: 0, queries: 0 };
  const discoveryRows: BrandQueryInput[] = [];

  for (const q of queries) {
    if (!q.query) continue;
    const bucket = isBranded(q.query, tokens) ? branded : discovery;
    bucket.clicks += q.clicks;
    bucket.impressions += q.impressions;
    bucket.queries += 1;
    if (bucket === discovery) discoveryRows.push(q);
  }

  const totalClicks = branded.clicks + discovery.clicks;
  const discoveryClicksPct = totalClicks > 0 ? Math.round((discovery.clicks / totalClicks) * 100) : 0;
  const topDiscovery = discoveryRows.sort((a, b) => b.clicks - a.clicks).slice(0, opts.topDiscovery ?? 6);

  return { branded, discovery, discoveryClicksPct, topDiscovery };
}
