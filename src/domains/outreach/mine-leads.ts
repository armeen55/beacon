import "server-only";

import { log } from "@/lib/logger";
import { readWikiGapResults } from "@/domains/wiki-gap/wiki-gap-store";
import { readKeywordGapResults } from "@/domains/serp/keyword-gap-store";
import { loadLinkGapsForTenant } from "@/domains/link-authority/load-link-gaps";
import { linkGapsToOutreachTargets, type LinkGapOutreachTarget } from "@/domains/link-authority/to-outreach-signals";
import {
  computeOutreachLeads,
  type WikiCitingContextInput,
  type KeywordGapCompetitorInput,
  type ProfoundCitationDomainInput,
} from "./compute-leads";
import type { OutreachLead } from "./types";

/**
 * outreach/mine-leads (BEACON_500 item 57, 2026-07-02) - bounded loaders over
 * the three lead sources named in the master plan, all of which are ALREADY
 * mined and cached by other operator-triggered batches:
 *
 *   1. wiki-gap beatable articles (produce-wiki-gaps.ts, cached <=30d) - the
 *      queryText on a beatable gap names the topic; we look for a non-Wikipedia
 *      citing domain for that SAME query in the AI Overview history (item 20),
 *      which already carries real per-domain citation URLs.
 *   2. keyword-gap competitor domains (keyword-gap-producer.ts, cached <=30d) -
 *      read straight from the stored gap rows, no live DataForSEO call.
 *   3. profound citation domains (profound_citation_rows, already imported) -
 *      a lean, bounded, non-Wikipedia read.
 *
 * This module makes ZERO live paid calls - every source is a read of data
 * another operator-triggered batch already produced. Honest empty when a
 * source has not been run yet (never fabricated leads).
 */

const PROFOUND_ROW_LIMIT = 500;
const MAX_LEADS = 60;

export type MineLeadsResult = {
  leads: OutreachLead[];
  sourcesChecked: { wikiGap: boolean; keywordGap: boolean; profound: boolean; linkGap: boolean };
};

async function loadWikiCitingContexts(tenantId: string): Promise<WikiCitingContextInput[]> {
  try {
    const stored = await readWikiGapResults(tenantId);
    if (!stored || stored.gaps.length === 0) return [];
    const { aiOverviewHistoryRows } = await import("@/domains/serp/serp-history");
    const overviewRows = await aiOverviewHistoryRows(tenantId).catch(() => []);
    const byQuery = new Map<string, { domain: string; url: string }[]>();
    for (const row of overviewRows) {
      if (!row.aiOverviewPresent) continue;
      const key = row.query.trim().toLowerCase();
      if (!byQuery.has(key)) byQuery.set(key, []);
      byQuery.get(key)!.push(...row.aiOverviewDomains);
    }
    const out: WikiCitingContextInput[] = [];
    for (const gap of stored.gaps) {
      if (gap.band === "low") continue; // only beatable gaps are worth an outreach angle
      const q = (gap.queryText || gap.displayTitle).trim().toLowerCase();
      const cited = byQuery.get(q) ?? [];
      const nonWiki = cited.find((c) => !c.domain.toLowerCase().includes("wikipedia"));
      out.push({
        citingUrl: nonWiki?.url ?? null,
        articleDisplayTitle: gap.displayTitle,
        queryText: gap.queryText,
      });
    }
    return out;
  } catch (e) {
    log.warn("[outreach] wiki citing context load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

async function loadKeywordGapCompetitors(tenantId: string): Promise<KeywordGapCompetitorInput[]> {
  try {
    const stored = await readKeywordGapResults(tenantId);
    if (!stored || stored.gaps.length === 0) return [];
    const bestByDomain = new Map<string, KeywordGapCompetitorInput>();
    for (const gap of stored.gaps) {
      const prev = bestByDomain.get(gap.competitorDomain);
      if (!prev || (gap.volume ?? 0) > (prev.volume ?? 0)) {
        bestByDomain.set(gap.competitorDomain, {
          competitorDomain: gap.competitorDomain,
          sampleKeyword: gap.keyword,
          volume: gap.volume,
        });
      }
    }
    return [...bestByDomain.values()];
  } catch (e) {
    log.warn("[outreach] keyword gap competitor load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

async function loadProfoundCitationDomains(tenantId: string): Promise<ProfoundCitationDomainInput[]> {
  try {
    const { getSupabaseAdmin, isSupabaseConfigured } = await import("@/lib/persistence/supabase");
    if (!isSupabaseConfigured()) return [];
    const { data, error } = await getSupabaseAdmin()
      .from("profound_citation_rows")
      .select("url, root_domain, category_id, date")
      .eq("tenant_id", tenantId)
      .not("root_domain", "ilike", "%wikipedia.org%")
      .order("date", { ascending: false })
      .limit(PROFOUND_ROW_LIMIT);
    if (error || !Array.isArray(data)) return [];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const seen = new Set<string>();
    const out: ProfoundCitationDomainInput[] = [];
    for (const r of data as { url: string; root_domain: string; category_id: string; date: string }[]) {
      if (!r.root_domain || seen.has(r.root_domain)) continue;
      seen.add(r.root_domain);
      out.push({
        domain: r.root_domain,
        url: r.url,
        topicLabel: r.category_id && !UUID_RE.test(r.category_id.trim()) ? r.category_id : null,
      });
    }
    return out;
  } catch (e) {
    log.warn("[outreach] profound citation domain load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** RANK-7 (2026-07-06): link-gap outreach targets - competitors that out-link
 *  the tenant so badly it cannot win the query on content. Reads the $0
 *  keyword-gap store + ALREADY-cached backlink counts (never a fresh paid call).
 *  Empty-safe -> [] when no gap run or no cached backlink reads exist yet. */
async function loadLinkGapOutreachTargets(tenantId: string, ownDomain: string): Promise<LinkGapOutreachTarget[]> {
  try {
    const gaps = await loadLinkGapsForTenant(tenantId, { ownDomain });
    return linkGapsToOutreachTargets(gaps);
  } catch (e) {
    log.warn("[outreach] link-gap target load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Mine + merge candidate outreach leads for one tenant from the four existing
 * evidence sources. Never throws. Honest empty when all sources are thin (no
 * prior wiki-gap/keyword-gap run, no non-Wikipedia profound citations, no
 * cached link-gap backlink reads).
 */
export async function mineOutreachLeads(tenantId: string, ownDomain: string): Promise<MineLeadsResult> {
  const [wikiCitingContexts, keywordGapCompetitors, profoundCitationDomains, linkGapTargets] = await Promise.all([
    loadWikiCitingContexts(tenantId),
    loadKeywordGapCompetitors(tenantId),
    loadProfoundCitationDomains(tenantId),
    loadLinkGapOutreachTargets(tenantId, ownDomain),
  ]);

  const leads = computeOutreachLeads({
    ownDomain,
    wikiCitingContexts,
    keywordGapCompetitors,
    profoundCitationDomains,
    linkGapTargets,
  }).slice(0, MAX_LEADS);

  return {
    leads,
    sourcesChecked: {
      wikiGap: wikiCitingContexts.length > 0,
      keywordGap: keywordGapCompetitors.length > 0,
      profound: profoundCitationDomains.length > 0,
      linkGap: linkGapTargets.length > 0,
    },
  };
}
