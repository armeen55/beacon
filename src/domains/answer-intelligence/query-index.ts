/**
 * Query Keyword Index — unlocks the 5,289 fan-out queries for recommendations.
 *
 * AI platforms (especially Perplexity) digest user prompts into actual search
 * keywords stored in `prompt-answer-observations[].metadata.search_queries`.
 * These are the REAL keywords that drive AI citations — not the Profound topic
 * labels like "Atherton Construction."
 *
 * Examples of fan-out queries:
 *   "best builders for large gated homes in Atherton"
 *   "luxury home builders Bay Area irregular lot"
 *   "best builders Los Altos architect-designed custom homes"
 *
 * This index makes them queryable by topic and by page URL:
 *   - by_topic: topic string → sorted fan-out queries
 *   - by_page: page URL → relevant queries (bridged via citationIndex.page_to_topics)
 *
 * Built on demand from the prompt-answer-observations store + citation evidence index.
 */

import { readStore } from "@/lib/persistence/json-store";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopicQueries = {
  top_queries: string[];                      // sorted by frequency, most common first
  top_city_queries: Record<string, string[]>; // city name → queries mentioning that city
  total_fanouts: number;
};

export type QueryKeywordIndex = {
  by_topic: Record<string, TopicQueries>;
  /** Page URL → relevant fan-out queries, bridged via citationIndex.page_to_topics. */
  by_page: Record<string, string[]>;
  /** Total unique fan-out keywords extracted. */
  total_unique_queries: number;
};

// ---------------------------------------------------------------------------
// City extraction
// ---------------------------------------------------------------------------

const KNOWN_CITIES = [
  "atherton", "menlo park", "palo alto", "los altos", "los altos hills",
  "cupertino", "saratoga", "woodside", "portola valley", "mountain view",
  "sunnyvale", "san jose", "emerald hills", "bay area",
];

function extractCityFromQuery(query: string): string | null {
  const lower = query.toLowerCase();
  // Check longest first to avoid "los altos" matching before "los altos hills"
  const sorted = [...KNOWN_CITIES].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    if (lower.includes(city)) return city;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build index
// ---------------------------------------------------------------------------

/**
 * Build the query keyword index from observation fan-out data.
 *
 * Reads from:
 *   - `prompt-answer-observations` store (metadata.search_queries field)
 *   - citationIndex.page_to_topics (for the topic→page bridge)
 *
 * The page_to_topics bridge is critical: fan-out queries are keyed by
 * topic (from the observation), not by page URL. To attach queries to
 * pages, we invert page_to_topics (which maps pageUrl → topics) into
 * topics → pageUrls, then copy each topic's queries to its associated pages.
 */
export function buildQueryKeywordIndex(
  citationIndex: CitationEvidenceIndex | null,
): QueryKeywordIndex {
  const observations = readStore<PromptAnswerObservation>("prompt-answer-observations");

  // Step 1: Extract all fan-out queries grouped by topic
  const topicQueryCounts = new Map<string, Map<string, number>>();

  for (const obs of observations) {
    const sq = obs.metadata?.search_queries;
    if (typeof sq !== "string" || sq.length < 3) continue;

    const topic = obs.topic;
    if (!topic) continue;

    // Split comma-separated fan-outs into individual queries
    const queries = sq.split(",").map((q) => q.trim()).filter((q) => q.length > 3);

    let topicMap = topicQueryCounts.get(topic);
    if (!topicMap) {
      topicMap = new Map();
      topicQueryCounts.set(topic, topicMap);
    }

    for (const query of queries) {
      topicMap.set(query, (topicMap.get(query) ?? 0) + 1);
    }
  }

  // Step 2: Sort queries by frequency within each topic
  const by_topic: Record<string, TopicQueries> = {};
  const allUniqueQueries = new Set<string>();

  for (const [topic, queryMap] of topicQueryCounts) {
    const sorted = [...queryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([q]) => q);

    // Group by city
    const cityQueries: Record<string, string[]> = {};
    for (const q of sorted) {
      const city = extractCityFromQuery(q);
      if (city) {
        if (!cityQueries[city]) cityQueries[city] = [];
        cityQueries[city].push(q);
      }
      allUniqueQueries.add(q);
    }

    by_topic[topic] = {
      top_queries: sorted.slice(0, 50), // cap at 50 per topic
      top_city_queries: cityQueries,
      total_fanouts: sorted.length,
    };
  }

  // Step 3: Bridge topic→page via citationIndex.page_to_topics
  const by_page: Record<string, string[]> = {};

  if (citationIndex?.page_to_topics) {
    // Invert: page→topics becomes topic→pages
    const topicToPages = new Map<string, string[]>();
    for (const [pageUrl, topics] of Object.entries(citationIndex.page_to_topics)) {
      for (const topic of topics) {
        const topicLower = topic.toLowerCase();
        // Match against our topic keys (case-insensitive)
        for (const indexTopic of topicQueryCounts.keys()) {
          if (indexTopic.toLowerCase() === topicLower) {
            const pages = topicToPages.get(indexTopic) ?? [];
            pages.push(pageUrl);
            topicToPages.set(indexTopic, pages);
          }
        }
      }
    }

    // Copy topic queries to each associated page
    for (const [topic, pages] of topicToPages) {
      const topicData = by_topic[topic];
      if (!topicData) continue;
      for (const pageUrl of pages) {
        const normalizedUrl = pageUrl.replace(/\/+$/, "").toLowerCase();
        if (!by_page[normalizedUrl]) {
          by_page[normalizedUrl] = [];
        }
        // Add unique queries only
        const existing = new Set(by_page[normalizedUrl]);
        for (const q of topicData.top_queries.slice(0, 20)) {
          if (!existing.has(q)) {
            by_page[normalizedUrl].push(q);
            existing.add(q);
          }
        }
      }
    }
  }

  return {
    by_topic,
    by_page,
    total_unique_queries: allUniqueQueries.size,
  };
}

// ---------------------------------------------------------------------------
// Query helpers for step generation
// ---------------------------------------------------------------------------

/**
 * Get the top N fan-out queries for a page URL.
 * Falls back to topic-level queries if no page-specific data.
 */
export function getQueriesForPage(
  index: QueryKeywordIndex,
  pageUrl: string,
  topN: number = 7,
): string[] {
  const normalizedUrl = pageUrl.replace(/\/+$/, "").toLowerCase();
  const pageQueries = index.by_page[normalizedUrl];
  if (pageQueries && pageQueries.length > 0) {
    return pageQueries.slice(0, topN);
  }
  return [];
}

/**
 * Get the top fan-out query for a specific topic + city combination.
 * Useful for generating anchor text and title rewrites.
 */
export function getTopQueryForTopicCity(
  index: QueryKeywordIndex,
  topic: string,
  city?: string | null,
): string | null {
  const topicData = index.by_topic[topic];
  if (!topicData) return null;

  if (city) {
    const cityLower = city.toLowerCase();
    const cityQueries = topicData.top_city_queries[cityLower];
    if (cityQueries && cityQueries.length > 0) return cityQueries[0];
  }

  return topicData.top_queries[0] ?? null;
}

/**
 * Get fan-out queries for a topic, optionally filtered by city.
 */
export function getQueriesForTopic(
  index: QueryKeywordIndex,
  topic: string,
  city?: string | null,
  topN: number = 10,
): string[] {
  const topicData = index.by_topic[topic];
  if (!topicData) return [];

  if (city) {
    const cityLower = city.toLowerCase();
    const cityQueries = topicData.top_city_queries[cityLower];
    if (cityQueries && cityQueries.length > 0) {
      return cityQueries.slice(0, topN);
    }
  }

  return topicData.top_queries.slice(0, topN);
}
