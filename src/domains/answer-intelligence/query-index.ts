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

/**
 * Multi-property (2026-06-10): DEFAULT city vocabulary — the founder
 * tenant's Bay-Area service area. Tenant-aware callers thread their own
 * `cities` (from BusinessConfig.locations) through the exported
 * functions; this list is only the fallback when none are provided, so
 * Ritz behavior is byte-identical with no caller changes.
 */
const DEFAULT_CITIES = [
  "atherton", "menlo park", "palo alto", "los altos", "los altos hills",
  "cupertino", "saratoga", "woodside", "portola valley", "mountain view",
  "sunnyvale", "san jose", "emerald hills", "bay area",
];

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
  /** Tenant city vocabulary (lowercase). Defaults to the founder list. */
  cities: ReadonlyArray<string> = DEFAULT_CITIES,
): QueryKeywordIndex {

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

// ---------------------------------------------------------------------------
// Intelligent page-relevance filtered queries (Fix 1)
// ---------------------------------------------------------------------------
// The old getQueriesForPage dumped ALL topic queries onto ALL pages.
// This version filters by what the page is actually ABOUT, determined
// from the URL pattern and the snapshot's H1/H2/title content.

const STOP_WORDS = new Set([
  "the", "a", "an", "in", "for", "of", "on", "to", "and", "or", "my",
  "is", "are", "i", "do", "which", "who", "what", "how", "best", "top",
  "should", "hire", "builders", "builder", "home", "homes", "bay", "area",
  "custom", "luxury",
]);

/** Extract meaningful keywords from a text string. */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

/** Extract city name from a URL path like /locations/menlo-park → "menlo park". */
function extractCityFromPath(path: string): string | null {
  const match = path.match(/\/locations?\/([\w-]+)/i);
  if (!match) return null;
  return match[1].replace(/-/g, " ").replace(/custom.*/, "").trim();
}

/** Extract service keywords from a URL path like /services/whole-home-remodel. */
function extractServiceFromPath(path: string): string[] {
  const match = path.match(/\/services?\/([\w-]+)/i);
  if (!match) return [];
  return match[1].split("-").filter((w) => w.length > 3);
}

/** True if the query mentions a specific city (not just "bay area"). */
function queryHasSpecificCity(
  query: string,
  cities: ReadonlyArray<string>,
): boolean {
  const lower = query.toLowerCase();
  // Region-wide labels (e.g. "bay area") are not a SPECIFIC city.
  const specificCities = cities.filter((c) => c !== "bay area");
  return specificCities.some((c) => lower.includes(c));
}

/**
 * Service-specific keywords — the core terms that distinguish a service page.
 * Used to ensure service page queries actually match the service being offered.
 */
const SERVICE_KEYWORD_MAP: Record<string, string[]> = {
  "whole-home-remodel": ["remodel", "renovation", "renovate", "whole home", "whole-home"],
  "new-construction": ["construction", "build", "ground-up", "new home", "custom home"],
  "adu": ["adu", "addition", "accessory dwelling"],
  "design-build": ["design-build", "design build", "architect"],
  "teardown": ["teardown", "tear-down", "tear down", "rebuild", "demolition"],
};

/**
 * Get fan-out queries filtered by relevance to a specific page.
 *
 * Unlike getQueriesForPage (which returns an unfiltered dump), this
 * function understands what the page is ABOUT and only returns queries
 * that match:
 *
 *   City pages (/locations/atherton): query must contain the city name
 *   Service pages (/services/whole-home-remodel): query must contain a
 *     service keyword from the page's H1, H2s, or URL path
 *   Homepage: broad queries without city filter
 *   Other pages: use H1/title keywords for matching
 *
 * Returns queries sorted by frequency. Returns empty if no relevant
 * queries exist — a missing result is better than an irrelevant one.
 */
export function getRelevantQueriesForPage(
  index: QueryKeywordIndex,
  pageUrl: string,
  snap: {
    title?: string | null;
    h1?: string | null;
    h2_list?: string[];
  } | null,
  topN: number = 10,
  /** Tenant city vocabulary (lowercase). Defaults to the founder list. */
  cities: ReadonlyArray<string> = DEFAULT_CITIES,
): string[] {
  const normalizedUrl = pageUrl.replace(/\/+$/, "").toLowerCase();
  const path = normalizedUrl.replace(/^https?:\/\/[^/]+/, "");

  // Collect ALL queries from all topics mapped to this page
  const allPageQueries = index.by_page[normalizedUrl] ?? [];
  if (allPageQueries.length === 0) return [];

  // Determine page type and build relevance filter
  const city = extractCityFromPath(path);
  const serviceWords = extractServiceFromPath(path);
  const isHomepage = path === "" || path === "/";

  // Build page content keywords from snapshot
  const pageKeywords = new Set<string>();
  if (snap?.h1) extractKeywords(snap.h1).forEach((w) => pageKeywords.add(w));
  if (snap?.title) extractKeywords(snap.title).forEach((w) => pageKeywords.add(w));
  if (snap?.h2_list) {
    for (const h2 of snap.h2_list) {
      extractKeywords(h2).forEach((w) => pageKeywords.add(w));
    }
  }
  for (const sw of serviceWords) pageKeywords.add(sw);

  // Determine service-specific required keywords for service pages
  const isServicePage = serviceWords.length > 0;
  let serviceRequiredTerms: string[] = [];
  if (isServicePage) {
    // Find the most specific match from the keyword map
    const pathSlug = path.match(/\/services?\/([\w-]+)/i)?.[1] ?? "";
    serviceRequiredTerms = SERVICE_KEYWORD_MAP[pathSlug] ?? [];
    // Fallback: use the service words from the path itself
    if (serviceRequiredTerms.length === 0) {
      serviceRequiredTerms = serviceWords;
    }
  }

  // Score each query by relevance
  const scored: Array<{ query: string; score: number }> = [];

  for (const query of allPageQueries) {
    const qLower = query.toLowerCase();
    let relevance = 0;

    if (isHomepage) {
      // Homepage: all broad queries are relevant, slight boost for "bay area"
      relevance = qLower.includes("bay area") ? 1.2 : 1.0;
    } else if (city) {
      // City page: query MUST contain the city name
      if (!qLower.includes(city)) continue;
      relevance = 1.5;
    } else if (isServicePage) {
      // Service page: STRICT filtering.
      // 1. Query MUST contain at least one service-relevant keyword
      const hasServiceTerm = serviceRequiredTerms.some((term) =>
        qLower.includes(term),
      );
      if (!hasServiceTerm) continue; // HARD REJECT — no service match

      // 2. REJECT queries with specific city names — those belong on
      //    city pages, not service pages. "best remodel builders Menlo
      //    Park" is for /locations/menlo-park, not /services/whole-home-remodel.
      if (queryHasSpecificCity(qLower, cities)) continue;

      relevance = 1.0;
    } else {
      // Other page: use content keywords for soft matching
      const queryWords = qLower.split(/\s+/);
      const contentMatches = [...pageKeywords].filter((pk) =>
        queryWords.some((qw) => qw.includes(pk) || pk.includes(qw)),
      );
      if (contentMatches.length === 0) continue;
      relevance = 0.3 * contentMatches.length;
    }

    scored.push({ query, score: relevance });
  }

  // Sort by relevance score (frequency is already baked into the order
  // of allPageQueries from the index build step)
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.query);
}
