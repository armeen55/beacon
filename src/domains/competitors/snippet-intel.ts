/**
 * Snippet Intelligence — safe extractability comparison.
 *
 * Identifies patterns on owned pages that likely help earn citations,
 * and areas where competitor citation patterns suggest stronger
 * extractability structures. Does NOT scrape competitors, fabricate
 * copied snippets, or overclaim exact extraction provenance.
 *
 * All signals are labeled as "grounded" (directly observable) or
 * "inferred" (reasoned from indirect evidence).
 */

import "server-only";

import type { PageSnapshot } from "@/domains/pages/types";
import type { CitationEvidenceIndex, TopicCitationSummary } from "@/domains/pages/types";
import type { PageExtractability } from "@/domains/pages/extractability";
import type { SnippetSignal, SnippetIntelligence } from "./snippet-types";

const MAX_SIGNALS = 12;

/**
 * Compute snippet intelligence from owned page analysis + citation context.
 */
export function computeSnippetIntelligence(opts: {
  ownedExtractability: PageExtractability[];
  citationIndex: CitationEvidenceIndex;
  snapshots: PageSnapshot[];
  ownedDomain: string;
}): SnippetIntelligence {
  const signals: SnippetSignal[] = [];
  const ownedNorm = opts.ownedDomain.replace(/^www\./, "").toLowerCase();

  // 1. Owned extractable patterns — pages with good extractability that earn many citations
  const strongOwned = opts.ownedExtractability
    .filter((e) => e.grade === "good" && e.citation_count >= 20)
    .slice(0, 3);

  for (const page of strongOwned) {
    const factors: string[] = [];
    if (page.factors.has_faq) factors.push("FAQ content");
    if (page.factors.has_schema) factors.push("structured data");
    if (page.factors.has_direct_answers) factors.push("direct answer sections");
    if (page.factors.has_h2_structure) factors.push("clear section headings");

    signals.push({
      id: `owned-pattern-${page.page_url.replace(/[^a-z0-9]/gi, "-").slice(0, 80)}`,
      type: "owned_extractable_pattern",
      page_url: page.page_url,
      page_title: page.page_title,
      summary: `Strong extractability on "${page.page_title ?? page.page_url.replace(/^https?:\/\/[^/]+/, "")}"`,
      detail: `This page earns ${page.citation_count} citations with ${factors.join(", ")}. These structural patterns likely contribute to AI extractability. Consider replicating on similar pages.`,
      confidence: "grounded",
      priority: "medium",
      competitor_domain: null,
      topic: null,
    });
  }

  // 2. Extractability gaps — high-citation owned pages with poor structure
  const weakOwned = opts.ownedExtractability
    .filter((e) => (e.grade === "needs_work" || e.grade === "poor") && e.citation_count >= 10)
    .slice(0, 4);

  for (const page of weakOwned) {
    const missing: string[] = [];
    if (!page.factors.has_faq) missing.push("FAQ content");
    if (!page.factors.has_schema) missing.push("structured data");
    if (!page.factors.has_direct_answers) missing.push("direct answer sections");

    signals.push({
      id: `gap-${page.page_url.replace(/[^a-z0-9]/gi, "-").slice(0, 80)}`,
      type: "extractability_gap",
      page_url: page.page_url,
      page_title: page.page_title,
      summary: `Extractability gap: "${page.page_title ?? page.page_url.replace(/^https?:\/\/[^/]+/, "")}"`,
      detail: `Earns ${page.citation_count} citations but missing ${missing.join(", ")}. Adding these structures could make content more reliably extractable.`,
      confidence: "grounded",
      priority: page.citation_count >= 30 ? "high" : "medium",
      competitor_domain: null,
      topic: null,
    });
  }

  // 3. Competitor citation context — topics where competitors dominate
  const compDominated = opts.citationIndex.by_topic
    .filter((t) => {
      if (t.owned_citations === 0) return false;
      return t.competitor_citations >= t.owned_citations * 3 && t.competitor_citations >= 15;
    })
    .sort((a, b) => b.competitor_citations - a.competitor_citations)
    .slice(0, 3);

  for (const topic of compDominated) {
    const topComp = topic.top_competitor_pages[0];
    const compDomain = topComp ? new URL(topComp.url).hostname.replace(/^www\./, "") : null;

    signals.push({
      id: `comp-context-${topic.topic.replace(/[^a-z0-9]/gi, "-").slice(0, 80)}`,
      type: "competitor_citation_context",
      page_url: null,
      page_title: null,
      summary: `Competitor content may be more extractable for "${topic.topic.replace(/^Shield: /, "").replace(/ \(Bay Area\)$/, "")}"`,
      detail: `Competitors earn ${topic.competitor_citations} citations vs your ${topic.owned_citations} for this topic. ${compDomain ? `Top competitor source: ${compDomain}.` : ""} Their pages may have stronger answer-formatted content or more comprehensive coverage.`,
      confidence: "inferred",
      priority: topic.competitor_citations >= 50 ? "high" : "medium",
      competitor_domain: compDomain,
      topic: topic.topic,
    });
  }

  // 4. Strengthening opportunities — owned pages that could strengthen by adding extractable sections
  for (const page of weakOwned.slice(0, 2)) {
    const topSuggestion = page.suggestions[0];
    if (!topSuggestion) continue;

    signals.push({
      id: `strengthen-${page.page_url.replace(/[^a-z0-9]/gi, "-").slice(0, 80)}`,
      type: "strengthening_opportunity",
      page_url: page.page_url,
      page_title: page.page_title,
      summary: topSuggestion.summary,
      detail: topSuggestion.detail,
      confidence: "grounded",
      priority: topSuggestion.priority,
      competitor_domain: null,
      topic: null,
    });
  }

  signals.sort((a, b) => {
    const priOrder = { high: 0, medium: 1, low: 2 };
    return (priOrder[a.priority] ?? 3) - (priOrder[b.priority] ?? 3);
  });

  return {
    computed_at: new Date().toISOString(),
    signals: signals.slice(0, MAX_SIGNALS),
    total_owned_pages_analyzed: opts.ownedExtractability.length,
    data_note: opts.ownedExtractability.length > 0
      ? `Analyzed ${opts.ownedExtractability.length} cited owned pages.`
      : "No cited owned pages with snapshot data available for analysis.",
  };
}
