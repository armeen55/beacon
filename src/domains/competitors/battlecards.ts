/**
 * Competitive Battlecards — structured comparison objects.
 *
 * Compares owned presence against competitor presence across multiple
 * dimensions using current Beacon data. Factual and explainable —
 * no sales-battlecard gimmicks, no fake strategic claims.
 */

import "server-only";

import type { CitationEvidenceIndex, TopicCitationSummary } from "@/domains/pages/types";
import type { CoMentionMatrix } from "./co-mention-types";
import type { SourceTrustIndex } from "./source-trust-types";
import type { GeoCoverageIndex } from "@/domains/geo/types";
import type {
  CompetitorBattlecard,
  DimensionComparison,
  BattlecardIndex,
} from "./battlecard-types";

const MAX_CARDS = 8;
const MIN_CITATIONS_FOR_CARD = 10;

/**
 * Compute battlecards for top competitor domains.
 */
export function computeBattlecards(opts: {
  citationIndex: CitationEvidenceIndex;
  coMentionMatrix: CoMentionMatrix | null;
  trustIndex: SourceTrustIndex;
  geoCoverage: GeoCoverageIndex;
  ownedDomain: string;
  competitorNames: Map<string, string>;
}): BattlecardIndex {
  const { citationIndex, coMentionMatrix, trustIndex, geoCoverage, ownedDomain } = opts;
  const ownedNorm = ownedDomain.replace(/^www\./, "").toLowerCase();

  // Aggregate competitor citations across topics
  const compCitTotals = new Map<string, number>();
  const compTopics = new Map<string, Map<string, number>>();

  for (const rollup of citationIndex.by_page_and_topic) {
    if (rollup.is_owned) continue;
    const domain = rollup.domain.replace(/^www\./, "").toLowerCase();
    compCitTotals.set(domain, (compCitTotals.get(domain) ?? 0) + rollup.total_citations);

    let topicMap = compTopics.get(domain);
    if (!topicMap) {
      topicMap = new Map();
      compTopics.set(domain, topicMap);
    }
    topicMap.set(rollup.topic, (topicMap.get(rollup.topic) ?? 0) + rollup.total_citations);
  }

  // Total owned citations
  const totalOwnedCit = citationIndex.by_page_and_topic
    .filter((r) => r.is_owned)
    .reduce((s, r) => s + r.total_citations, 0);

  // Owned topics
  const ownedTopicCit = new Map<string, number>();
  for (const rollup of citationIndex.by_page_and_topic) {
    if (!rollup.is_owned) continue;
    ownedTopicCit.set(rollup.topic, (ownedTopicCit.get(rollup.topic) ?? 0) + rollup.total_citations);
  }

  // Sort competitors by citation count
  const topCompetitors = [...compCitTotals.entries()]
    .filter(([, count]) => count >= MIN_CITATIONS_FOR_CARD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CARDS);

  const cards: CompetitorBattlecard[] = [];

  for (const [domain, totalCit] of topCompetitors) {
    const dimensions: DimensionComparison[] = [];

    // 1. Citation share
    const totalAll = totalOwnedCit + totalCit;
    const ownedSharePct = totalAll > 0 ? Math.round((totalOwnedCit / totalAll) * 100) : null;
    const compSharePct = totalAll > 0 ? Math.round((totalCit / totalAll) * 100) : null;
    dimensions.push({
      dimension: "citation_share",
      label: "Citation share (head-to-head)",
      owned_value: ownedSharePct,
      competitor_value: compSharePct,
      advantage: ownedSharePct !== null && compSharePct !== null
        ? ownedSharePct > compSharePct ? "owned" : compSharePct > ownedSharePct ? "competitor" : "even"
        : "insufficient",
      explanation: `You: ${totalOwnedCit.toLocaleString()} citations (${ownedSharePct ?? "?"}%) vs ${totalCit.toLocaleString()} (${compSharePct ?? "?"}%).`,
    });

    // 2. Topic pressure — topics where competitor leads
    const competitorTopicMap = compTopics.get(domain) ?? new Map();
    const pressureTopics: string[] = [];
    for (const [topic, compTopicCit] of competitorTopicMap) {
      const ownedTopicCitCount = ownedTopicCit.get(topic) ?? 0;
      if (compTopicCit > ownedTopicCitCount && compTopicCit >= 5) {
        pressureTopics.push(topic);
      }
    }
    pressureTopics.sort((a, b) => {
      const diff = (competitorTopicMap.get(b) ?? 0) - (competitorTopicMap.get(a) ?? 0);
      return diff;
    });

    dimensions.push({
      dimension: "topic_pressure",
      label: "Topic pressure",
      owned_value: null,
      competitor_value: pressureTopics.length,
      advantage: pressureTopics.length === 0 ? "owned" : pressureTopics.length >= 3 ? "competitor" : "even",
      explanation: pressureTopics.length > 0
        ? `Competitor leads in ${pressureTopics.length} topic${pressureTopics.length !== 1 ? "s" : ""}: ${pressureTopics.slice(0, 3).join(", ")}${pressureTopics.length > 3 ? ` +${pressureTopics.length - 3}` : ""}.`
        : "No topics where competitor clearly leads.",
    });

    // 3. Co-mention frequency
    const coEntry = coMentionMatrix?.entries.find((e) => e.domain === domain);
    if (coEntry) {
      dimensions.push({
        dimension: "co_mention_frequency",
        label: "Co-mention frequency",
        owned_value: null,
        competitor_value: coEntry.co_occurrence_count,
        advantage: coEntry.co_occurrence_count >= 20 ? "competitor" : "even",
        explanation: `Appears alongside you in ${coEntry.co_occurrence_count} AI answers (strength: ${Math.round(coEntry.co_mention_strength * 100)}%).`,
      });
    }

    // 4. Geographic presence
    const compCities = geoCoverage.cities.filter(
      (c) => c.competitor_pages > 0 && c.coverage_status !== "strong",
    );
    const pressureCities = compCities
      .filter((c) => c.competitor_pages >= 5)
      .map((c) => c.city)
      .slice(0, 5);

    if (pressureCities.length > 0) {
      dimensions.push({
        dimension: "geographic_presence",
        label: "Local pressure",
        owned_value: null,
        competitor_value: pressureCities.length,
        advantage: pressureCities.length >= 3 ? "competitor" : "even",
        explanation: `Competitor presence in markets where you're weak: ${pressureCities.slice(0, 3).join(", ")}${pressureCities.length > 3 ? ` +${pressureCities.length - 3}` : ""}.`,
      });
    }

    // 5. Platform reliance
    for (const platform of trustIndex.platforms) {
      const compEntry = platform.top_sources.find((s) => s.domain === domain);
      if (compEntry && platform.owned_rank !== null) {
        const compRank = platform.top_sources.findIndex((s) => s.domain === domain) + 1;
        dimensions.push({
          dimension: "platform_reliance",
          label: `${platformLabel(platform.platform)} reliance`,
          owned_value: platform.owned_rank,
          competitor_value: compRank,
          advantage: platform.owned_rank < compRank ? "owned" : compRank < platform.owned_rank ? "competitor" : "even",
          explanation: `Your rank: #${platform.owned_rank} (${platform.owned_share_pct}%) vs competitor #${compRank} (${compEntry.share_pct}%) on ${platformLabel(platform.platform)}.`,
        });
        break; // Only show most relevant platform
      }
    }

    const competitorAdvantages = dimensions.filter((d) => d.advantage === "competitor").length;
    const ownedAdvantages = dimensions.filter((d) => d.advantage === "owned").length;

    const threat: CompetitorBattlecard["overall_threat"] =
      competitorAdvantages >= 3 || totalCit > totalOwnedCit * 2
        ? "high"
        : competitorAdvantages >= 1 || totalCit > totalOwnedCit
          ? "moderate"
          : "low";

    let keyInsight: string;
    if (threat === "high") {
      keyInsight = `Strong competitive pressure — leads in ${competitorAdvantages} dimension${competitorAdvantages !== 1 ? "s" : ""} with ${totalCit.toLocaleString()} total citations.`;
    } else if (threat === "moderate") {
      keyInsight = `Moderate presence — ${totalCit.toLocaleString()} citations${pressureTopics.length > 0 ? `, leads in ${pressureTopics.length} topic${pressureTopics.length !== 1 ? "s" : ""}` : ""}.`;
    } else {
      keyInsight = `Lower threat — you lead in ${ownedAdvantages} dimension${ownedAdvantages !== 1 ? "s" : ""}.`;
    }

    cards.push({
      competitor_domain: domain,
      competitor_name: opts.competitorNames.get(domain) ?? null,
      overall_threat: threat,
      total_citations: totalCit,
      owned_citations: totalOwnedCit,
      dimensions,
      pressure_topics: pressureTopics.slice(0, 5),
      pressure_cities: pressureCities,
      key_insight: keyInsight,
    });
  }

  cards.sort((a, b) => {
    const threatOrder = { high: 0, moderate: 1, low: 2 };
    return (threatOrder[a.overall_threat] ?? 3) - (threatOrder[b.overall_threat] ?? 3)
      || b.total_citations - a.total_citations;
  });

  return {
    computed_at: new Date().toISOString(),
    cards,
    top_threat: cards.length > 0 ? cards[0].competitor_domain : null,
    data_note: cards.length > 0
      ? `${cards.length} competitor${cards.length !== 1 ? "s" : ""} with ≥${MIN_CITATIONS_FOR_CARD} citations analyzed.`
      : "No competitors with sufficient citation data for battlecard analysis.",
  };
}

function platformLabel(platform: string): string {
  const map: Record<string, string> = {
    chatgpt: "ChatGPT",
    google_aio: "AI Overviews",
    perplexity: "Perplexity",
  };
  return map[platform] ?? platform;
}
