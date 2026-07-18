import "server-only";

import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { aiOverviewHistoryRows } from "@/domains/serp/serp-history";

/**
 * find-wiki-citations (2026-07-02, master plan item 23) - mines the three places
 * Beacon already records which URLs AI cites for one wikipedia.org sighting per
 * distinct article, tenant-agnostic (no hardcoded topic ever appears here):
 *
 *   1. prompt_answer_observations.citation_urls / citation_domains - native poll
 *      rows, joined back to the asked question via prompt_id (prompt-library
 *      first, tracked-prompts as a fallback for older Profound-linked rows).
 *   2. profound_citation_rows - imported Profound citations. This table carries
 *      no human-readable prompt or category label (see
 *      migrations/2026-06-12_profound_rows.sql: category_id is Profound's raw
 *      category UUID, not a name). We never display a UUID as "query text" -
 *      when category_id is not a UUID (older/manual imports sometimes stored a
 *      real label there) it is used as an honest, coarser topic; otherwise the
 *      query text stays null rather than showing garbage.
 *   3. dataforseo_serp_history.ai_overview_domains (item 20) - Google's AI
 *      Overview citations per tracked query; the row already carries the real
 *      query text.
 *
 * Every read is bounded (windowed `since`, row caps, lean column projections)
 * and reuses each source's existing reader - no new Supabase client code, no
 * unbounded table scans. Wikipedia detection is a plain domain suffix check
 * (`wikipedia.org` / `*.wikipedia.org`), never a topic guess.
 */

const WIKI_DOMAIN_SUFFIX = "wikipedia.org";

/** Bounds - a diagnostic mining pass, not a full-history scan. */
const OBSERVATIONS_LOOKBACK_DAYS = 90;
const OBSERVATIONS_ROW_LIMIT = 2000;
const PROFOUND_ROW_LIMIT = 2000;

export type WikiCitationHit = {
  /** The Wikipedia article title extracted from the cited URL's path. */
  articleTitle: string;
  /** Best-known question/query text this citation answered, when available. */
  queryText: string | null;
  /** Where this sighting came from - for the evidence line + debugging. */
  source: "native_observation" | "profound_citation" | "ai_overview";
  observedAt: string | null;
};

/** True when the domain is wikipedia.org or any of its language subdomains
 *  (en.wikipedia.org, fa.wikipedia.org, ...). Never matches wikimedia.org,
 *  wiktionary.org, etc. - those are different projects. */
export function isWikipediaDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, "");
  return d === WIKI_DOMAIN_SUFFIX || d.endsWith(`.${WIKI_DOMAIN_SUFFIX}`);
}

/**
 * Extract the article title from a Wikipedia URL, e.g.
 * "https://en.wikipedia.org/wiki/Chaharshanbe_Suri" -> "Chaharshanbe_Suri".
 * Returns null for non-article paths (Special:, Talk:, the bare domain, etc.)
 * so those never masquerade as beatable topics.
 */
export function wikiArticleTitleFromUrl(url: string): string | null {
  let pathname: string;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const u = new URL(withScheme);
    if (!isWikipediaDomain(u.hostname)) return null;
    pathname = u.pathname;
  } catch {
    return null;
  }
  const m = pathname.match(/\/wiki\/([^/?#]+)/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]).trim();
  if (!raw) return null;
  // Skip namespace pages (Special:, Talk:, Category:, File:, Help:, Template:,
  // Wikipedia:, User:) - these are never beatable-content candidates.
  if (/^[A-Za-z_]+:/.test(raw) && /^(Special|Talk|Category|File|Help|Template|Wikipedia|User|Portal|Draft):/i.test(raw)) {
    return null;
  }
  return raw;
}

/** Human-readable title from the underscored Wikipedia article slug. */
export function humanizeWikiTitle(title: string): string {
  return title.replace(/_/g, " ").trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a raw UUID string - never fit for display as "query text" (Profound's
 *  category_id is a UUID, not a human label; showing it would be an honest-looking
 *  lie, not real evidence). */
function looksLikeUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

export type FindWikiCitationsDeps = {
  now: () => Date;
  loadObservations: (
    tenantId: string,
    since: string,
  ) => Promise<Array<{ prompt_id: string; observed_at: string; citation_domains: string[]; citation_urls?: string[] | null }>>;
  loadPromptTextById: (tenantId: string) => Promise<Map<string, string>>;
  loadProfoundCitations: (tenantId: string) => Promise<Array<{ url: string; root_domain: string; category_id: string; date: string }>>;
  loadAiOverviewRows: (
    tenantId: string,
  ) => Promise<Array<{ query: string; capturedAt: string; aiOverviewPresent: boolean; aiOverviewDomains: Array<{ domain: string; url: string }> }>>;
};

const defaultDeps: FindWikiCitationsDeps = {
  now: () => new Date(),
  loadObservations: async (tenantId, since) => {
    const repo = getRepository().forTenant(tenantId);
    const rows = await repo.getPromptAnswerObservations({
      since,
      columns: "prompt_id, observed_at, citation_domains, citation_urls",
    });
    return rows
      .slice(0, OBSERVATIONS_ROW_LIMIT)
      .map((r) => ({
        prompt_id: r.prompt_id,
        observed_at: r.observed_at,
        citation_domains: r.citation_domains ?? [],
        citation_urls: r.citation_urls ?? null,
      }));
  },
  loadPromptTextById: async (tenantId) => {
    // Findings B + C (2026-07-18): the question text must come from THIS
    // tenant's own prompts, never a shared corpus. The prior path read the
    // GLOBAL `prompt-library` singleton (Ritz's questions leaked into
    // Iranopedia's miner — the exact bug tenant-question-library.ts fixed for
    // the engine poll) and then a BARE getRepository().getTrackedPrompts()
    // (an unscoped `select *` on the tracked_prompts table = every tenant's
    // rows). Both are replaced by a single tenant-scoped read: forTenant
    // pushes down `.eq("tenant_id", tenantId)`, so only this tenant's prompt
    // texts can ever join here.
    const map = new Map<string, string>();
    try {
      const prompts = await getRepository().forTenant(tenantId).getTrackedPrompts();
      for (const p of prompts) map.set(p.id, p.text);
    } catch {
      /* fail-soft - the miner still works with fewer joined queries */
    }
    return map;
  },
  loadProfoundCitations: async (tenantId) => {
    try {
      const { getSupabaseAdmin, isSupabaseConfigured } = await import("@/lib/persistence/supabase");
      if (!isSupabaseConfigured()) return [];
      const { data, error } = await getSupabaseAdmin()
        .from("profound_citation_rows")
        .select("url, root_domain, category_id, date")
        .eq("tenant_id", tenantId)
        .ilike("root_domain", `%${WIKI_DOMAIN_SUFFIX}%`)
        .order("date", { ascending: false })
        .limit(PROFOUND_ROW_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return data as Array<{ url: string; root_domain: string; category_id: string; date: string }>;
    } catch {
      return [];
    }
  },
  loadAiOverviewRows: async (tenantId) => {
    try {
      const rows = await aiOverviewHistoryRows(tenantId);
      return rows.map((r) => ({
        query: r.query,
        capturedAt: r.capturedAt,
        aiOverviewPresent: r.aiOverviewPresent,
        aiOverviewDomains: r.aiOverviewDomains.map((d) => ({ domain: d.domain, url: d.url })),
      }));
    } catch {
      return [];
    }
  },
};

/**
 * Mine every wikipedia.org citation sighting across the three sources for one
 * tenant, mapped to article titles, deduped so each article keeps only its
 * best-available query text (longest/most specific wins) and most recent
 * observed timestamp. Never throws - any source failure degrades to fewer
 * hits, not an error.
 */
export async function findWikiCitations(
  tenantId: string,
  depsOverride: Partial<FindWikiCitationsDeps> = {},
): Promise<WikiCitationHit[]> {
  const deps = { ...defaultDeps, ...depsOverride };
  const now = deps.now();
  const since = new Date(now.getTime() - OBSERVATIONS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const byTitle = new Map<string, WikiCitationHit>();
  const consider = (hit: WikiCitationHit) => {
    const key = hit.articleTitle.toLowerCase();
    const prev = byTitle.get(key);
    if (!prev) {
      byTitle.set(key, hit);
      return;
    }
    // Keep the more specific query text (prefer non-null, then longer).
    const prevLen = prev.queryText?.length ?? 0;
    const hitLen = hit.queryText?.length ?? 0;
    if (hitLen > prevLen) prev.queryText = hit.queryText;
    // Keep the most recent observedAt.
    if (hit.observedAt && (!prev.observedAt || hit.observedAt > prev.observedAt)) prev.observedAt = hit.observedAt;
  };

  // Source 1: native poll observations.
  try {
    const [observations, promptText] = await Promise.all([
      deps.loadObservations(tenantId, since),
      deps.loadPromptTextById(tenantId),
    ]);
    for (const obs of observations) {
      const domains = obs.citation_domains ?? [];
      const urls = obs.citation_urls ?? [];
      for (let i = 0; i < domains.length; i += 1) {
        if (!isWikipediaDomain(domains[i])) continue;
        const url = urls[i];
        const title = url ? wikiArticleTitleFromUrl(url) : null;
        if (!title) continue;
        consider({
          articleTitle: title,
          queryText: promptText.get(obs.prompt_id) ?? null,
          source: "native_observation",
          observedAt: obs.observed_at ?? null,
        });
      }
    }
  } catch (e) {
    log.warn("[wiki-gap] native observation mining failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  // Source 2: imported Profound citations (no prompt text - category_id only).
  try {
    const rows = await deps.loadProfoundCitations(tenantId);
    for (const r of rows) {
      const title = wikiArticleTitleFromUrl(r.url);
      if (!title) continue;
      const categoryLabel = r.category_id && !looksLikeUuid(r.category_id) ? r.category_id : null;
      consider({
        articleTitle: title,
        queryText: categoryLabel,
        source: "profound_citation",
        observedAt: r.date ?? null,
      });
    }
  } catch (e) {
    log.warn("[wiki-gap] profound citation mining failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  // Source 3: Google AI Overview citation history (item 20) - real query text.
  try {
    const rows = await deps.loadAiOverviewRows(tenantId);
    for (const r of rows) {
      if (!r.aiOverviewPresent) continue;
      for (const cited of r.aiOverviewDomains) {
        if (!isWikipediaDomain(cited.domain)) continue;
        const title = wikiArticleTitleFromUrl(cited.url);
        if (!title) continue;
        consider({
          articleTitle: title,
          queryText: r.query || null,
          source: "ai_overview",
          observedAt: r.capturedAt ?? null,
        });
      }
    }
  } catch (e) {
    log.warn("[wiki-gap] ai overview mining failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  return [...byTitle.values()].sort((a, b) => a.articleTitle.localeCompare(b.articleTitle));
}
