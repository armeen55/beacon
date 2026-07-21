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

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import { parseSearchQueries } from "@/domains/prompt-answer-observations/search-query-parser";

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

// De-verticalized (2026-06-15): there is NO default city vocabulary. City
// matching is purely per-tenant — callers thread the tenant's own `cities`
// (from BusinessConfig.locations). A tenant with no configured locations (a
// content site, a national brand, any non-local business) gets NO city
// filtering, which is correct: it has no service-area geography. Previously
// this fell back to the founder tenant's Bay-Area list, which silently applied
// "atherton"/"palo alto" relevance filtering to every vertical.

function extractCityFromQuery(
  query: string,
  cities: ReadonlyArray<string>,
): string | null {
  const lower = query.toLowerCase();
  // Check longest first to avoid "los altos" matching before "los altos hills"
  const sorted = [...cities].sort((a, b) => b.length - a.length);
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
  observations: PromptAnswerObservation[],
  /** Tenant city vocabulary (lowercase). Defaults to NONE — a tenant with no
   *  configured service-area locations gets no city-relevance filtering. */
  cities: ReadonlyArray<string> = [],
): QueryKeywordIndex {

  // Step 1: Extract all fan-out queries grouped by topic
  const topicQueryCounts = new Map<string, Map<string, number>>();

  for (const obs of observations) {
    const sq = obs.metadata?.search_queries;
    if (typeof sq !== "string" || sq.length < 3) continue;

    const topic = obs.topic;
    if (!topic) continue;

    // Use the canonical conservative parser. A bare comma split shatters
    // embedded name lists into fake one-word/short "queries", inflating the
    // fan-out corpus and teaching the allocator from fragments.
    const queries = parseSearchQueries(sq);

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
      const city = extractCityFromQuery(q, cities);
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

