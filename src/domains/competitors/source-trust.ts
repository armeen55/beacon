/**
 * Source Trust Index — estimates which sources each AI platform relies on most.
 *
 * Built from citation observation data. Measures frequency of domain appearance
 * per platform, not actual "trust" — the label is deliberately conservative:
 * "frequently cited by" / "commonly relied on."
 *
 * Does NOT claim to know internal model weights or preferences.
 */

import "server-only";

import {
  getAllCitationDates,
  getCitationsForDate,
} from "@/lib/persistence/cold-store";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";
import { readStore } from "@/lib/persistence/json-store";
import type {
  SourceTrustEntry,
  PlatformTrustProfile,
  SourceTrustIndex,
} from "./source-trust-types";

const MAX_TOP_SOURCES = 20;

/**
 * Compute the source trust index from citation cold store data.
 */
export async function computeSourceTrustIndex(
  ownedDomain: string,
  competitorDomains: Set<string>,
): Promise<SourceTrustIndex> {
  // audit-wave #1 (2026-06-23): the citation cold store is a single GLOBAL
  // namespace and its pre-cutover band holds the founder's Profound benchmark
  // shards. Window to the native regime — the same fix Audit-3 #2 applied to
  // proof-engine + url-watcher — so a non-founder tenant's Source Trust on
  // /competitors can't blend in those shared pre-cutover benchmark citations
  // (a cross-tenant leak). Native-regime citations are written per-tenant.
  const dates = getAllCitationDates().filter((d) => d >= NATIVE_REGIME_START);
  const ownedNorm = ownedDomain.replace(/^www\./, "").toLowerCase();

  // platform → domain → { count, topics }
  const platformDomainCounts = new Map<
    string,
    Map<string, { count: number; topics: Set<string> }>
  >();
  const platformTotals = new Map<string, number>();

  // Resolve platform from prompt-answer-observations
  const paoStore = await readStore<{
    id: string;
    platform: string;
    topic: string;
  }>("prompt-answer-observations");
  const paoPlatform = new Map<string, string>();
  const paoTopic = new Map<string, string>();
  for (const pao of paoStore) {
    paoPlatform.set(pao.id, pao.platform);
    paoTopic.set(pao.id, pao.topic);
  }

  let totalCitations = 0;

  for (const date of dates) {
    const citations = getCitationsForDate(date);
    for (const c of citations) {
      const domain = c.domain?.replace(/^www\./, "").toLowerCase();
      if (!domain) continue;

      const platform = paoPlatform.get(c.prompt_answer_id) ?? "unknown";
      const topic = paoTopic.get(c.prompt_answer_id) ?? "unknown";

      let platformMap = platformDomainCounts.get(platform);
      if (!platformMap) {
        platformMap = new Map();
        platformDomainCounts.set(platform, platformMap);
      }

      let entry = platformMap.get(domain);
      if (!entry) {
        entry = { count: 0, topics: new Set() };
        platformMap.set(domain, entry);
      }
      entry.count++;
      entry.topics.add(topic);

      platformTotals.set(platform, (platformTotals.get(platform) ?? 0) + 1);
      totalCitations++;
    }
  }

  const platforms: PlatformTrustProfile[] = [];

  for (const [platform, domainMap] of platformDomainCounts) {
    const platTotal = platformTotals.get(platform) ?? 0;
    if (platTotal === 0) continue;

    const entries: SourceTrustEntry[] = [];
    for (const [domain, data] of domainMap) {
      entries.push({
        domain,
        platform,
        citation_count: data.count,
        share_pct: Math.round((data.count / platTotal) * 10000) / 100,
        is_owned: domain === ownedNorm,
        is_competitor: competitorDomains.has(domain),
        topics: [...data.topics].sort().slice(0, 10),
      });
    }

    entries.sort((a, b) => b.citation_count - a.citation_count);
    const topSources = entries.slice(0, MAX_TOP_SOURCES);

    const ownedEntry = entries.find((e) => e.is_owned);
    const ownedRank = ownedEntry
      ? entries.findIndex((e) => e.is_owned) + 1
      : null;

    platforms.push({
      platform,
      total_citations: platTotal,
      top_sources: topSources,
      owned_rank: ownedRank,
      owned_share_pct: ownedEntry?.share_pct ?? null,
    });
  }

  platforms.sort((a, b) => b.total_citations - a.total_citations);

  return {
    computed_at: new Date().toISOString(),
    total_citations_analyzed: totalCitations,
    platforms,
  };
}

/**
 * Get a compact summary for display.
 */
export function summarizeTrustIndex(index: SourceTrustIndex): {
  platforms_analyzed: number;
  total_citations: number;
  best_owned_rank: number | null;
  best_owned_platform: string | null;
  platforms_where_owned_in_top10: string[];
} {
  let bestRank: number | null = null;
  let bestPlatform: string | null = null;
  const inTop10: string[] = [];

  for (const p of index.platforms) {
    if (p.owned_rank !== null) {
      if (bestRank === null || p.owned_rank < bestRank) {
        bestRank = p.owned_rank;
        bestPlatform = p.platform;
      }
      if (p.owned_rank <= 10) {
        inTop10.push(p.platform);
      }
    }
  }

  return {
    platforms_analyzed: index.platforms.length,
    total_citations: index.total_citations_analyzed,
    best_owned_rank: bestRank,
    best_owned_platform: bestPlatform,
    platforms_where_owned_in_top10: inTop10,
  };
}
