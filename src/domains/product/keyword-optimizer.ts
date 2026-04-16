/**
 * Keyword Optimization Scanner — finds exact title/H1/H2 rewrites
 * by comparing page headings against AI search query fan-outs.
 *
 * Each recommendation is ONE atomic change on ONE page:
 *   "Change title from X to Y" or "Change H2 from X to Y"
 *
 * Priority = query_frequency × citation_count — high-citation pages
 * with high-frequency keyword mismatches rank first.
 *
 * False-positive filters:
 *   - "builder" vs "contractor" → brand identity, not a keyword gap
 *   - "build" vs "construction" → same reason
 *   - Bigrams that are just city-name fragments on non-city pages
 *   - Bigrams with <5x frequency (noise)
 */

import type { PageSnapshot, CitationEvidenceIndex } from "@/domains/pages/types";
import type { BeaconRecommendation } from "./recommendation-engine";
import type { QueryKeywordIndex } from "@/domains/answer-intelligence/query-index";
import { getRelevantQueriesForPage } from "@/domains/answer-intelligence/query-index";

// ---------------------------------------------------------------------------
// Synonym table — only ACTIONABLE swaps, NOT brand identity
// ---------------------------------------------------------------------------

const ACTIONABLE_SYNONYMS: Record<string, string> = {
  remodeling: "renovation",
  remodel: "renovation",
  // NOT included: builder↔contractor, build↔construction (brand identity)
};

// Words to exclude from bigram gap analysis
const BIGRAM_STOP = new Set([
  "best", "top", "which", "who", "what", "how", "should", "hire",
  "builders", "builder", "home", "homes", "custom", "luxury", "the",
  "for", "and", "bay", "area", "firms", "firm", "that", "are",
  "this", "with", "from", "your", "their", "contractors", "contractor",
  "construction", "build", "building",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KeywordFinding = {
  pageUrl: string;
  pagePath: string;
  citations: number;
  changeType: "title" | "h1" | "h2";
  currentText: string;
  suggestedText: string;
  queryEvidence: string;
  queryFrequency: number;
  impactScore: number; // queryFrequency × log(citations + 1)
};

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

export function scanKeywordOptimizations(opts: {
  pageSnapshots: PageSnapshot[];
  citationCountMap: Map<string, number>;
  queryIndex: QueryKeywordIndex;
  citationIndex: CitationEvidenceIndex | null;
  experimentUrls?: Set<string>;
}): KeywordFinding[] {
  const { pageSnapshots, citationCountMap, queryIndex, experimentUrls } = opts;
  const findings: KeywordFinding[] = [];

  for (const snap of pageSnapshots) {
    if (snap.extraction_certainty === "uncertain") continue;

    const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
    const pagePath = snap.url.replace(/^https?:\/\/[^/]+/, "");
    const cit = citationCountMap.get(normUrl) ?? 0;
    if (cit < 1) continue; // Only optimize pages with citations

    // Skip pages with active experiments
    if (experimentUrls?.has(normUrl)) continue;

    const title = snap.title ?? "";
    const h1 = snap.h1 ?? "";
    const h2s = snap.h2_list ?? [];

    // Get relevant queries for this page (filtered by page type)
    const relevantQueries = getRelevantQueriesForPage(queryIndex, snap.url, snap, 20);

    // ALSO get ALL queries for this page's topics — the relevance filter
    // caps at 20 which can miss synonym signals. For synonym detection we
    // need to count how many queries use "renovation" vs "remodel" across
    // the FULL topic corpus, not just 20 filtered samples.
    const pageTopics = opts.citationIndex?.page_to_topics
      ? Object.entries(opts.citationIndex.page_to_topics)
          .filter(([url]) => url.replace(/\/+$/, "").toLowerCase() === normUrl)
          .flatMap(([, topics]) => topics)
      : [];
    const allTopicQueries: string[] = [];
    for (const topic of pageTopics) {
      const tq = queryIndex.by_topic[topic];
      if (tq) allTopicQueries.push(...tq.top_queries);
    }

    // For synonym detection, use the FULL topic query set (not capped at 20)
    const synonymCheckQueries = allTopicQueries.length > 0 ? allTopicQueries : relevantQueries;
    if (synonymCheckQueries.length === 0 && relevantQueries.length === 0) continue;

    // --- Synonym detection on title ---
    const titleFindings = findSynonymSwaps(title, "title", synonymCheckQueries, snap, pagePath, cit);
    findings.push(...titleFindings);

    // --- Synonym detection on H1 ---
    const h1Findings = findSynonymSwaps(h1, "h1", synonymCheckQueries, snap, pagePath, cit);
    findings.push(...h1Findings);

    // --- Synonym detection on each H2 ---
    for (const h2 of h2s) {
      const h2Findings = findSynonymSwaps(h2, "h2", synonymCheckQueries, snap, pagePath, cit);
      findings.push(...h2Findings);
    }

    // --- Bigram gap detection: phrases in queries but not in any heading ---
    // Use the filtered relevant queries (not full topic corpus) to avoid
    // irrelevant bigrams from non-matching topics
    const allText = [title, h1, ...h2s].join(" ").toLowerCase();
    const bigramCounts = new Map<string, number>();

    for (const query of relevantQueries) {
      const words = query.toLowerCase().split(/\s+/).filter(
        (w) => w.length > 3 && !BIGRAM_STOP.has(w),
      );
      for (let i = 0; i < words.length - 1; i++) {
        const bg = `${words[i]} ${words[i + 1]}`;
        if (!allText.includes(bg)) {
          bigramCounts.set(bg, (bigramCounts.get(bg) ?? 0) + 1);
        }
      }
    }

    const topBigrams = [...bigramCounts.entries()]
      .filter(([, count]) => count >= 5) // Higher bar than the step-level fallback
      .sort((a, b) => b[1] - a[1]);

    if (topBigrams.length > 0) {
      const [phrase, freq] = topBigrams[0];

      // Find the closest H2 to suggest as the rewrite target
      const phraseWords = phrase.split(/\s+/);
      let bestH2 = "";
      let bestOverlap = 0;
      for (const h2 of h2s) {
        const h2Lower = h2.toLowerCase();
        const overlap = phraseWords.filter((pw) => h2Lower.includes(pw)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestH2 = h2;
        }
      }

      // Extract city from path
      const cityMatch = pagePath.match(/\/locations?\/([\w-]+)/i);
      const cityName = cityMatch
        ? cityMatch[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
        : null;

      const phraseTitle = phrase.split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      if (bestH2 && bestOverlap > 0) {
        const newH2 = cityName
          ? `${phraseTitle} in ${cityName}`
          : `${phraseTitle} — ${bestH2}`;

        if (newH2.toLowerCase() !== bestH2.toLowerCase()) {
          findings.push({
            pageUrl: snap.url,
            pagePath,
            citations: cit,
            changeType: "h2",
            currentText: bestH2,
            suggestedText: newH2,
            queryEvidence: phrase,
            queryFrequency: freq,
            impactScore: freq * Math.log10(cit + 1),
          });
        }
      } else if (!allText.includes(phrase)) {
        // Suggest as title addition if no close H2
        const siteName = title.match(/\|\s*(.+)$/)?.[1]?.trim() ?? "";
        const suffix = siteName ? ` | ${siteName}` : "";
        const newTitle = cityName
          ? `Best ${phraseTitle} in ${cityName}${suffix}`
          : `${phraseTitle} Bay Area${suffix}`;

        if (newTitle.length <= 65 && newTitle.toLowerCase() !== title.toLowerCase()) {
          findings.push({
            pageUrl: snap.url,
            pagePath,
            citations: cit,
            changeType: "title",
            currentText: title,
            suggestedText: newTitle,
            queryEvidence: phrase,
            queryFrequency: freq,
            impactScore: freq * Math.log10(cit + 1) * 1.5, // Title changes get 1.5x boost
          });
        }
      }
    }
  }

  // Sort by impact score (highest first)
  findings.sort((a, b) => b.impactScore - a.impactScore);

  // Dedup: one finding per page PER change type (title, h1, h2).
  // A page can have BOTH a title rewrite AND an H2 rewrite as
  // separate atomic actions — they're different changes.
  const seenKeys = new Set<string>();
  const deduped: KeywordFinding[] = [];
  for (const f of findings) {
    const dedupKey = `${f.pagePath}::${f.changeType}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    deduped.push(f);
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Synonym swap detection
// ---------------------------------------------------------------------------

function findSynonymSwaps(
  text: string,
  changeType: "title" | "h1" | "h2",
  queries: string[],
  snap: PageSnapshot,
  pagePath: string,
  citations: number,
): KeywordFinding[] {
  if (!text) return [];
  const findings: KeywordFinding[] = [];
  const textLower = text.toLowerCase();

  for (const [from, to] of Object.entries(ACTIONABLE_SYNONYMS)) {
    if (!textLower.includes(from)) continue;
    if (textLower.includes(to)) continue; // Already has the target word

    // Check if queries actually use the "to" word
    const queryFreq = queries.filter((q) => q.toLowerCase().includes(to)).length;
    if (queryFreq < 3) continue; // Not enough query evidence

    // Build the swapped text preserving original casing
    const regex = new RegExp(from, "gi");
    const swapped = text.replace(regex, (match) => {
      // Preserve case pattern
      if (match[0] === match[0].toUpperCase()) {
        return to.charAt(0).toUpperCase() + to.slice(1);
      }
      return to;
    });

    if (swapped !== text) {
      findings.push({
        pageUrl: snap.url,
        pagePath,
        citations,
        changeType,
        currentText: text,
        suggestedText: swapped,
        queryEvidence: `"${to}" appears in ${queryFreq} relevant AI queries; "${from}" is used on this page instead`,
        queryFrequency: queryFreq,
        impactScore: queryFreq * Math.log10(citations + 1) * (changeType === "title" ? 2.0 : changeType === "h1" ? 1.5 : 1.0),
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Convert findings to BeaconRecommendations
// ---------------------------------------------------------------------------

export function keywordFindingsToRecs(
  findings: KeywordFinding[],
  limit: number = 5,
): BeaconRecommendation[] {
  return findings.slice(0, limit).map((f, i) => {
    const changeLabel = f.changeType === "title"
      ? "title tag"
      : f.changeType === "h1"
        ? "H1"
        : "H2";

    return {
      id: `rec-keyword-${f.pagePath.replace(/[^a-z0-9]/gi, "-")}-${f.changeType}-${i}`,
      type: "keyword_optimization" as const,
      headline: `Change ${changeLabel} on ${f.pagePath}`,
      rationale: `Change ${changeLabel}:\n  Current:  "${f.currentText}"\n  Change to: "${f.suggestedText}"\n\n${f.queryEvidence}. This is one isolated change — make it, scan, and measure.`,
      sourceEvidence: `${f.queryFrequency} query matches, ${f.citations} citations`,
      targetPageUrl: f.pageUrl,
      targetPagePath: f.pagePath,
      sourceChangeId: null,
      confidence: f.citations >= 100 ? "high" : f.citations >= 20 ? "medium" : "low",
      // Priority: above comparison table (750-849), below investigate (800+)
      // Title changes get highest priority within keyword_optimization
      priority: Math.min(
        900 + Math.round(f.impactScore),
        999,
      ),
      patternId: null,
      citationOpportunity: f.citations,
      actionClass: `${f.changeType}_rewrite`,
      targetPlatforms: ["chatgpt", "google_aio"],
    };
  });
}
