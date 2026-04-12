/**
 * Competitor Discovery Pipeline
 *
 * Builds a broad candidate competitor universe from actual citation data,
 * co-mention data, and source trust signals — then classifies each domain.
 */

import { classifyCompetitorType, type CompetitorType } from "./classify-type";
import type { CoMentionMatrix } from "./co-mention-types";
import type { SourceTrustIndex } from "./source-trust-types";

export type TopicThreat = {
  topic: string;
  theirCitations: number;
  yourCitations: number;
  theyLead: boolean;
};

export type DiscoveredDomain = {
  domain: string;
  type: CompetitorType;
  citations: number;
  share: number;
  coMentionStrength: number | null;
  trustRank: number | null;
  isInUniverse: boolean;
  isOwned: boolean;
  discoveredVia: ("citations" | "co_mention" | "source_trust")[];
  topTopics: string[];
  topicThreats: TopicThreat[];
  citationDelta: number;
  suggestedMove: string | null;
};

export type DiscoveryResult = {
  all: DiscoveredDomain[];
  direct: DiscoveredDomain[];
  directories: DiscoveredDomain[];
  editorial: DiscoveredDomain[];
  forums: DiscoveredDomain[];
  newDiscoveries: DiscoveredDomain[];
  totalDomainsAnalyzed: number;
  computedAt: string;
};

export function discoverCompetitorUniverse(opts: {
  citationIndex: {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
      topics?: string[];
    }[];
  } | null;
  coMentionMatrix: CoMentionMatrix | null;
  sourceTrustIndex: SourceTrustIndex | null;
  ownedDomain: string;
  universeDomains: Set<string>;
}): DiscoveryResult {
  const { citationIndex, coMentionMatrix, sourceTrustIndex, ownedDomain, universeDomains } = opts;
  const domainMap = new Map<
    string,
    {
      citations: number;
      isOwned: boolean;
      topics: Set<string>;
      sources: Set<"citations" | "co_mention" | "source_trust">;
      coMentionStrength: number | null;
      trustRank: number | null;
    }
  >();

  const ownedNorm = ownedDomain.toLowerCase().replace(/^www\./, "");
  let totalCitations = 0;

  if (citationIndex) {
    for (const row of citationIndex.by_page_and_topic) {
      let domain: string;
      try {
        domain = new URL(row.page_url).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        continue;
      }
      const existing = domainMap.get(domain) ?? {
        citations: 0,
        isOwned: false,
        topics: new Set<string>(),
        sources: new Set<"citations" | "co_mention" | "source_trust">(),
        coMentionStrength: null,
        trustRank: null,
      };
      existing.citations += row.total_citations;
      if (row.is_owned || domain === ownedNorm) existing.isOwned = true;
      existing.sources.add("citations");
      if (row.topics) {
        for (const t of row.topics) existing.topics.add(t);
      }
      domainMap.set(domain, existing);
      totalCitations += row.total_citations;
    }
  }

  if (coMentionMatrix) {
    for (const entry of coMentionMatrix.entries) {
      const dom = entry.domain.toLowerCase().replace(/^www\./, "");
      const existing = domainMap.get(dom) ?? {
        citations: 0,
        isOwned: false,
        topics: new Set<string>(),
        sources: new Set<"citations" | "co_mention" | "source_trust">(),
        coMentionStrength: null,
        trustRank: null,
      };
      existing.sources.add("co_mention");
      existing.coMentionStrength = entry.co_mention_strength;
      if (entry.topics) {
        for (const t of entry.topics) existing.topics.add(t);
      }
      domainMap.set(dom, existing);
    }
  }

  if (sourceTrustIndex) {
    for (const platform of sourceTrustIndex.platforms) {
      for (let i = 0; i < platform.top_sources.length; i++) {
        const src = platform.top_sources[i];
        const dom = src.domain.toLowerCase().replace(/^www\./, "");
        const existing = domainMap.get(dom) ?? {
          citations: 0,
          isOwned: false,
          topics: new Set<string>(),
          sources: new Set<"citations" | "co_mention" | "source_trust">(),
          coMentionStrength: null,
          trustRank: null,
        };
        existing.sources.add("source_trust");
        if (existing.trustRank === null || i + 1 < existing.trustRank) {
          existing.trustRank = i + 1;
        }
        if (src.is_owned) existing.isOwned = true;
        domainMap.set(dom, existing);
      }
    }
  }

  // Build per-domain per-topic citation counts for threat analysis
  const domainTopicCits = new Map<string, Map<string, number>>();
  if (citationIndex) {
    for (const row of citationIndex.by_page_and_topic) {
      let domain: string;
      try {
        domain = new URL(row.page_url).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        continue;
      }
      if (!domainTopicCits.has(domain)) domainTopicCits.set(domain, new Map());
      const topicMap = domainTopicCits.get(domain)!;
      if (row.topics) {
        for (const t of row.topics) {
          topicMap.set(t, (topicMap.get(t) ?? 0) + row.total_citations);
        }
      }
    }
  }

  const ownedTopicCits = domainTopicCits.get(ownedNorm) ?? new Map<string, number>();
  const ownedTotalCits = domainMap.get(ownedNorm)?.citations ?? 0;

  function computeTopicThreats(domain: string): TopicThreat[] {
    const theirTopics = domainTopicCits.get(domain) ?? new Map<string, number>();
    const threats: TopicThreat[] = [];
    for (const [topic, theirCount] of theirTopics) {
      const yourCount = ownedTopicCits.get(topic) ?? 0;
      threats.push({ topic, theirCitations: theirCount, yourCitations: yourCount, theyLead: theirCount > yourCount });
    }
    return threats.sort((a, b) => b.theirCitations - a.theirCitations).slice(0, 5);
  }

  function suggestMove(domain: string, type: CompetitorType, threats: TopicThreat[]): string | null {
    if (type !== "direct") return null;
    const topicsTheyLead = threats.filter((t) => t.theyLead);
    if (topicsTheyLead.length === 0) return null;
    const weakest = topicsTheyLead[0];
    if (weakest.yourCitations === 0) {
      return `Create content targeting "${weakest.topic}" — you have no citations there`;
    }
    return `Strengthen "${weakest.topic}" content — they lead with ${weakest.theirCitations} vs your ${weakest.yourCitations} citations`;
  }

  const all: DiscoveredDomain[] = [...domainMap.entries()]
    .filter(([, data]) => data.citations > 0 || data.sources.size > 0)
    .map(([domain, data]) => {
      const type = classifyCompetitorType(domain);
      const topicThreats = computeTopicThreats(domain);
      return {
        domain,
        type,
        citations: data.citations,
        share: totalCitations > 0 ? Math.round((data.citations / totalCitations) * 1000) / 10 : 0,
        coMentionStrength: data.coMentionStrength,
        trustRank: data.trustRank,
        isInUniverse: universeDomains.has(domain),
        isOwned: data.isOwned,
        discoveredVia: [...data.sources],
        topTopics: [...data.topics].slice(0, 5),
        topicThreats,
        citationDelta: data.citations - ownedTotalCits,
        suggestedMove: suggestMove(domain, type, topicThreats),
      };
    })
    .sort((a, b) => b.citations - a.citations);

  return {
    all,
    direct: all.filter((d) => d.type === "direct" && !d.isOwned),
    directories: all.filter((d) => d.type === "directory"),
    editorial: all.filter((d) => d.type === "editorial"),
    forums: all.filter((d) => d.type === "forum"),
    newDiscoveries: all.filter((d) => !d.isInUniverse && !d.isOwned && d.type === "direct"),
    totalDomainsAnalyzed: domainMap.size,
    computedAt: new Date().toISOString(),
  };
}
