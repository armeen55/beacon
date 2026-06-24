/**
 * Competitor Sitemap Crawler — fetches and parses XML sitemaps for competitor domains.
 *
 * Handles: standard sitemaps, sitemap index files, missing sitemaps.
 * Does NOT require puppeteer — pure HTTP + XML parsing.
 */

import type {
  CompetitorSitemapEntry,
  CompetitorSitemapSnapshot,
} from "./types";

// ---------------------------------------------------------------------------
// XML parsing (minimal, no dependencies)
// ---------------------------------------------------------------------------

function extractTag(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

function parseSitemapXml(xml: string): CompetitorSitemapEntry[] {
  const urls = extractTag(xml, "url");
  const entries: CompetitorSitemapEntry[] = [];

  for (const urlBlock of urls) {
    const locs = extractTag(urlBlock, "loc");
    const lastmods = extractTag(urlBlock, "lastmod");
    if (locs.length > 0) {
      entries.push({
        loc: locs[0],
        lastmod: lastmods[0] ?? null,
      });
    }
  }

  return entries;
}

function parseSitemapIndex(xml: string): string[] {
  const sitemaps = extractTag(xml, "sitemap");
  const urls: string[] = [];
  for (const block of sitemaps) {
    const locs = extractTag(block, "loc");
    if (locs.length > 0) urls.push(locs[0]);
  }
  return urls;
}

function isSitemapIndex(xml: string): boolean {
  return xml.includes("<sitemapindex") || xml.includes("<sitemapIndex");
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; text: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "BeaconBot/1.0 (competitor-monitor)",
      },
    });
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } catch {
    return { ok: false, text: "", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function crawlCompetitorSitemap(
  domain: string,
  displayName: string,
): Promise<CompetitorSitemapSnapshot> {
  const sitemapUrl = `https://${domain}/sitemap.xml`;
  const crawledAt = new Date().toISOString();

  const res = await fetchWithTimeout(sitemapUrl);

  if (!res.ok) {
    return {
      domain,
      displayName,
      crawledAt,
      pageCount: 0,
      entries: [],
      error: `Failed to fetch sitemap: HTTP ${res.status}`,
    };
  }

  const xml = res.text;
  let allEntries: CompetitorSitemapEntry[] = [];
  let crawlError: string | null = null;

  if (isSitemapIndex(xml)) {
    // Sitemap index — fetch each sub-sitemap
    const subSitemapUrls = parseSitemapIndex(xml);
    for (const subUrl of subSitemapUrls.slice(0, 10)) {
      // Cap at 10 sub-sitemaps to avoid abuse
      const subRes = await fetchWithTimeout(subUrl);
      if (subRes.ok) {
        allEntries.push(...parseSitemapXml(subRes.text));
      }
    }
    // audit-wave4 #4: a sitemap index that listed children but yielded ZERO
    // entries (every child failed to fetch, or all were empty) must NOT report
    // success with 0 pages — detectCompetitorChanges would read that as the
    // competitor removing its entire site. Surface it as an error so the prior
    // snapshot is kept instead.
    if (subSitemapUrls.length > 0 && allEntries.length === 0) {
      crawlError = "Sitemap index returned no entries (all child sitemaps failed or empty)";
    }
  } else {
    allEntries = parseSitemapXml(xml);
  }

  return {
    domain,
    displayName,
    crawledAt,
    pageCount: allEntries.length,
    entries: allEntries,
    error: crawlError,
  };
}

export async function crawlAllCompetitors(
  competitors: { domain: string; displayName: string }[],
): Promise<CompetitorSitemapSnapshot[]> {
  // Crawl sequentially to be polite
  const snapshots: CompetitorSitemapSnapshot[] = [];
  for (const comp of competitors) {
    const snapshot = await crawlCompetitorSitemap(comp.domain, comp.displayName);
    snapshots.push(snapshot);
  }
  return snapshots;
}
