/**
 * Citation Genealogy — traces likely source ancestry of owned AI citations.
 *
 * Stage 1: Matches owned citation URLs against owned page snapshots using
 * URL path matching, title overlap, heading overlap, and FAQ content overlap.
 * Does NOT attempt competitor-content genealogy.
 *
 * Confidence tiers are conservative:
 * - high: URL exact match + verified page snapshot exists
 * - medium: path-based match or strong content overlap
 * - low: partial term overlap only
 * - unknown: no confident match found
 */

import "server-only";

import type { PageSnapshot, CitationPageRollup } from "@/domains/pages/types";
import type {
  GenealogyMatch,
  GenealogyConfidence,
  PageGenealogyResult,
} from "./genealogy-types";
import { stripSiteOrigin } from "@/lib/site-config";

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function overlapScore(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  let hits = 0;
  for (const t of tokensA) {
    if (setB.has(t)) hits++;
  }
  return hits / Math.max(tokensA.length, 1);
}

function matchCitationToSnapshots(
  citationUrl: string,
  snapshots: PageSnapshot[],
  ownedDomainNorm: string,
): GenealogyMatch | null {
  const citNorm = normalizeUrl(citationUrl);
  const citPath = stripSiteOrigin(citationUrl).replace(/\/+$/, "").toLowerCase();

  for (const snap of snapshots) {
    const snapNorm = normalizeUrl(snap.url);
    const snapPath = stripSiteOrigin(snap.url).replace(/\/+$/, "").toLowerCase();

    // Exact URL match
    if (citNorm === snapNorm) {
      return {
        citation_url: citationUrl,
        matched_page_url: snap.url,
        matched_section: identifyBestSection(snap, null),
        match_type: "url_exact",
        confidence: "high",
        explanation: `Citation URL exactly matches owned page "${snap.title ?? snapPath}".`,
        matched_terms: [],
      };
    }

    // Path match (same path, possibly different protocol/www)
    if (citPath && citPath.length > 1 && citPath === snapPath) {
      return {
        citation_url: citationUrl,
        matched_page_url: snap.url,
        matched_section: identifyBestSection(snap, null),
        match_type: "url_path",
        confidence: "high",
        explanation: `Citation path "${citPath}" matches owned page.`,
        matched_terms: [],
      };
    }
  }

  // No URL-based match — try content-based matching
  const citTokens = tokenize(citationUrl.replace(/^https?:\/\/[^/]+/, "").replace(/[/-]/g, " "));
  if (citTokens.length < 2) return null;

  let bestMatch: GenealogyMatch | null = null;
  let bestScore = 0;

  for (const snap of snapshots) {
    // Title overlap
    if (snap.title) {
      const titleTokens = tokenize(snap.title);
      const score = overlapScore(citTokens, titleTokens);
      if (score > bestScore && score >= 0.4) {
        const matched = citTokens.filter((t) => titleTokens.includes(t));
        bestScore = score;
        bestMatch = {
          citation_url: citationUrl,
          matched_page_url: snap.url,
          matched_section: snap.title,
          match_type: "title_overlap",
          confidence: score >= 0.7 ? "medium" : "low",
          explanation: `Citation URL terms overlap with page title "${snap.title}" (${Math.round(score * 100)}% term match).`,
          matched_terms: matched,
        };
      }
    }

    // Heading overlap
    for (const h2 of snap.h2_list) {
      const headingTokens = tokenize(h2);
      const score = overlapScore(citTokens, headingTokens);
      if (score > bestScore && score >= 0.5) {
        const matched = citTokens.filter((t) => headingTokens.includes(t));
        bestScore = score;
        bestMatch = {
          citation_url: citationUrl,
          matched_page_url: snap.url,
          matched_section: h2,
          match_type: "heading_overlap",
          confidence: score >= 0.7 ? "medium" : "low",
          explanation: `Citation URL terms overlap with section heading "${h2}" (${Math.round(score * 100)}% term match).`,
          matched_terms: matched,
        };
      }
    }

    // FAQ overlap
    for (const faq of snap.faqs) {
      const faqTokens = tokenize(faq.question);
      const score = overlapScore(citTokens, faqTokens);
      if (score > bestScore && score >= 0.5) {
        const matched = citTokens.filter((t) => faqTokens.includes(t));
        bestScore = score;
        bestMatch = {
          citation_url: citationUrl,
          matched_page_url: snap.url,
          matched_section: faq.question,
          match_type: "faq_overlap",
          confidence: score >= 0.7 ? "medium" : "low",
          explanation: `Citation URL terms overlap with FAQ "${faq.question}" (${Math.round(score * 100)}% term match).`,
          matched_terms: matched,
        };
      }
    }
  }

  return bestMatch;
}

function identifyBestSection(snap: PageSnapshot, _hint: string | null): string | null {
  if (snap.faqs.length > 0) return `FAQ section (${snap.faqs.length} items)`;
  if (snap.h2_list.length > 0) return snap.h2_list[0];
  if (snap.title) return snap.title;
  return null;
}

/**
 * Compute genealogy results for all owned citations of a given page.
 */
export function computePageGenealogy(
  targetPageUrl: string,
  ownedCitationRollups: CitationPageRollup[],
  allSnapshots: PageSnapshot[],
  ownedDomain: string,
): PageGenealogyResult {
  const normTarget = targetPageUrl.replace(/\/+$/, "").toLowerCase();
  const ownedNorm = ownedDomain.replace(/^www\./, "").toLowerCase();

  const ownedSnapshots = allSnapshots.filter((s) => {
    const domain = normalizeUrl(s.url).split("/")[0];
    return domain === ownedNorm || domain === `www.${ownedNorm}`;
  });

  const relevantRollups = ownedCitationRollups.filter(
    (r) => r.is_owned && r.page_url.replace(/\/+$/, "").toLowerCase() === normTarget,
  );

  const totalOwned = relevantRollups.reduce((s, r) => s + r.total_citations, 0);

  // Get unique citation URLs for this page from rollups
  const citationUrls = new Set(relevantRollups.map((r) => r.page_url));

  const matches: GenealogyMatch[] = [];

  for (const url of citationUrls) {
    const match = matchCitationToSnapshots(url, ownedSnapshots, ownedNorm);
    if (match) {
      matches.push(match);
    }
  }

  return {
    page_url: targetPageUrl,
    total_owned_citations: totalOwned,
    matches,
    unmatched_count: citationUrls.size - matches.length,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Compute genealogy for all owned pages that have citation evidence.
 * Returns a map of page_url → GenealogyResult.
 */
export function computeFullGenealogy(
  citationRollups: CitationPageRollup[],
  snapshots: PageSnapshot[],
  ownedDomain: string,
): Map<string, PageGenealogyResult> {
  const ownedNorm = ownedDomain.replace(/^www\./, "").toLowerCase();
  const ownedSnapshots = snapshots.filter((s) => {
    const domain = normalizeUrl(s.url).split("/")[0];
    return domain === ownedNorm || domain === `www.${ownedNorm}`;
  });

  const ownedRollups = citationRollups.filter((r) => r.is_owned);
  const pageUrls = new Set(ownedRollups.map((r) => r.page_url));

  const results = new Map<string, PageGenealogyResult>();

  for (const pageUrl of pageUrls) {
    const rollups = ownedRollups.filter(
      (r) => r.page_url === pageUrl,
    );
    const totalCitations = rollups.reduce((s, r) => s + r.total_citations, 0);
    if (totalCitations === 0) continue;

    const match = matchCitationToSnapshots(pageUrl, ownedSnapshots, ownedNorm);

    results.set(pageUrl.replace(/\/+$/, "").toLowerCase(), {
      page_url: pageUrl,
      total_owned_citations: totalCitations,
      matches: match ? [match] : [],
      unmatched_count: match ? 0 : 1,
      computed_at: new Date().toISOString(),
    });
  }

  return results;
}

/**
 * Summary statistics for the overall genealogy coverage.
 */
export function summarizeGenealogy(
  results: Map<string, PageGenealogyResult>,
): {
  total_pages: number;
  matched_pages: number;
  by_confidence: Record<GenealogyConfidence, number>;
  by_match_type: Record<string, number>;
  coverage_rate: number;
} {
  const byConfidence: Record<GenealogyConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };
  const byMatchType: Record<string, number> = {};
  let matchedPages = 0;

  for (const [, result] of results) {
    if (result.matches.length > 0) {
      matchedPages++;
      const bestMatch = result.matches.sort(
        (a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence),
      )[0];
      byConfidence[bestMatch.confidence]++;
      byMatchType[bestMatch.match_type] = (byMatchType[bestMatch.match_type] ?? 0) + 1;
    } else {
      byConfidence.unknown++;
    }
  }

  return {
    total_pages: results.size,
    matched_pages: matchedPages,
    by_confidence: byConfidence,
    by_match_type: byMatchType,
    coverage_rate: results.size > 0 ? Math.round((matchedPages / results.size) * 100) / 100 : 0,
  };
}

function confidenceRank(c: GenealogyConfidence): number {
  const map: Record<GenealogyConfidence, number> = { high: 0, medium: 1, low: 2, unknown: 3 };
  return map[c];
}
