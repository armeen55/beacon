/**
 * competitor-citations-loader (2026-06-24, Step 2) — read the tenant's
 * topic-scoped `profound_citation_rows` and surface the exact pages AI cites
 * INSTEAD of the tenant, grouped + ranked, plus the tenant's OWN cited URLs.
 *
 * Pure data shaping over a stored read (the sync writes the rows; here we only
 * read + aggregate). Tenant-agnostic: the owned domain is passed in (derived
 * from the tenant's own pages), and platform/social aggregators are classified
 * generically — no vertical/tenant hardcoding.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

/** Generic platforms / social / search — NOT displaceable content competitors
 *  and NOT a vertical-specific list (universal infra, like a stopword set). A
 *  reddit thread or YouTube video is competitor PRESSURE on a topic, but not a
 *  page you "out-build" → it never seeds a create_page on its own. */
const AGGREGATOR_DOMAINS = new Set([
  "reddit.com", "youtube.com", "facebook.com", "instagram.com", "quora.com",
  "pinterest.com", "tiktok.com", "x.com", "twitter.com", "linkedin.com",
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com",
]);

const TOKEN_STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are",
  "with", "blog", "content", "article", "articles", "wiki", "html", "php", "com",
  "www", "index", "watch", "reel", "comments", "r", "p", "id", "en", "amp",
]);

export type CompetitorCitedPage = {
  /** Canonicalized competitor URL. */
  url: string;
  /** Root domain (no www). */
  domain: string;
  /** Topic tokens derived from the URL path (for matching to owned pages). */
  topicTokens: string[];
  /** Human label derived from the URL slug, e.g. "persian wedding". */
  label: string;
  /** Total citations across models/days. */
  citationCount: number;
  /** Distinct AI models that cited it (Perplexity/ChatGPT/…) — breadth. */
  modelCount: number;
  /** Generic platform/social (down-weighted; never seeds create_page alone). */
  isAggregator: boolean;
};

export type CompetitorCitationsResult = {
  competitors: CompetitorCitedPage[];
  /** The tenant's OWN cited URLs (canonical) → citation count. Drives "are you
   *  cited for this cluster" / ownedAiShare. */
  ownedCitedUrls: Map<string, number>;
  rowsScanned: number;
};

function stripWww(h: string): string {
  return h.replace(/^www\./i, "").toLowerCase();
}

/** Tokens + a human label from a URL path slug. */
function slugInfo(url: string): { tokens: string[]; label: string } {
  let path = "";
  try {
    path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname;
  } catch {
    path = url;
  }
  const raw = path
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[/_]+/g, " ")
    .replace(/-+/g, " ")
    .toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !TOKEN_STOP.has(t) && !/^\d+$/.test(t));
  const label = tokens.slice(0, 6).join(" ").trim();
  return { tokens, label };
}

function isOwned(host: string, ownedNorm: string): boolean {
  const h = stripWww(host);
  return !!ownedNorm && (h === ownedNorm || h.endsWith("." + ownedNorm));
}

export async function loadCompetitorCitedPagesForTenant(
  tenantId: string,
  ownedDomain: string,
  opts: { maxRows?: number } = {},
): Promise<CompetitorCitationsResult> {
  const ownedNorm = stripWww((ownedDomain || "").trim());
  const maxRows = opts.maxRows ?? 50_000;
  const empty: CompetitorCitationsResult = {
    competitors: [],
    ownedCitedUrls: new Map(),
    rowsScanned: 0,
  };

  const rows: Array<{ root_domain: string; url: string; model: string; citation_count: number }> = [];
  try {
    const sb = getSupabaseAdmin();
    const PAGE = 1000;
    for (let off = 0; off < maxRows; off += PAGE) {
      const { data, error } = await sb
        .from("profound_citation_rows")
        .select("root_domain,url,model,citation_count")
        .eq("tenant_id", tenantId)
        .range(off, off + PAGE - 1);
      if (error) {
        log.warn("[competitor-citations] read failed", { tenantId, error: error.message });
        break;
      }
      const batch = (data ?? []) as typeof rows;
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch (e) {
    log.warn("[competitor-citations] supabase unavailable", { tenantId, error: String(e) });
    return empty;
  }
  if (rows.length === 0) return empty;

  type Agg = { url: string; domain: string; citationCount: number; models: Set<string> };
  const byUrl = new Map<string, Agg>();
  const ownedCitedUrls = new Map<string, number>();

  for (const r of rows) {
    const host = stripWww(r.root_domain || "");
    const canon = canonicalizeCitationUrl(r.url || "") || r.url || "";
    if (!canon) continue;
    const count = Number(r.citation_count) || 1;
    if (isOwned(host, ownedNorm)) {
      ownedCitedUrls.set(canon, (ownedCitedUrls.get(canon) ?? 0) + count);
      continue;
    }
    let agg = byUrl.get(canon);
    if (!agg) {
      agg = { url: canon, domain: host, citationCount: 0, models: new Set() };
      byUrl.set(canon, agg);
    }
    agg.citationCount += count;
    if (r.model) agg.models.add(r.model);
  }

  const competitors: CompetitorCitedPage[] = [...byUrl.values()]
    .map((a) => {
      const { tokens, label } = slugInfo(a.url);
      return {
        url: a.url,
        domain: a.domain,
        topicTokens: tokens,
        label: label || a.domain || "(unknown)",
        citationCount: a.citationCount,
        modelCount: a.models.size,
        isAggregator: AGGREGATOR_DOMAINS.has(a.domain),
      };
    })
    // rank: breadth (models) first, then volume
    .sort((x, y) => y.modelCount - x.modelCount || y.citationCount - x.citationCount);

  return { competitors, ownedCitedUrls, rowsScanned: rows.length };
}
