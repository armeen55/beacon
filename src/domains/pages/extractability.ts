/**
 * Extractability Intelligence — structured data / AI-readiness analysis.
 *
 * Evaluates how well a page's content is structured for AI extraction.
 * Generates specific, grounded recommendations for improving
 * extractability based on what the page actually contains.
 *
 * Does NOT generate spammy SEO advice. Recommendations are tied to
 * observed structural gaps on pages that already earn citations.
 */

import "server-only";

import type { PageSnapshot, FaqItem } from "./types";

export type ExtractabilityFactor =
  | "has_faq"
  | "has_schema"
  | "has_h2_structure"
  | "has_meta_description"
  | "sufficient_word_count"
  | "has_direct_answers";

export type ExtractabilityGrade = "good" | "fair" | "needs_work" | "poor";

export type ExtractabilitySuggestion = {
  type: "add_faq" | "add_schema" | "add_headings" | "add_meta" | "deepen_content" | "add_direct_answers";
  priority: "high" | "medium" | "low";
  summary: string;
  detail: string;
};

export type PageExtractability = {
  page_url: string;
  page_title: string | null;
  grade: ExtractabilityGrade;
  score: number;
  factors: Record<ExtractabilityFactor, boolean>;
  suggestions: ExtractabilitySuggestion[];
  citation_count: number;
};

const FACTOR_WEIGHTS: Record<ExtractabilityFactor, number> = {
  has_faq: 25,
  has_schema: 20,
  has_h2_structure: 15,
  has_meta_description: 10,
  sufficient_word_count: 15,
  has_direct_answers: 15,
};

function hasDirectAnswerSignals(snap: PageSnapshot): boolean {
  if (snap.faqs.length > 0) return true;
  for (const h2 of snap.h2_list) {
    const lower = h2.toLowerCase();
    if (
      lower.startsWith("what ") ||
      lower.startsWith("how ") ||
      lower.startsWith("why ") ||
      lower.startsWith("who ") ||
      lower.startsWith("when ") ||
      lower.includes("answer") ||
      lower.includes("overview")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Analyze a single page's extractability.
 */
export function analyzeExtractability(
  snap: PageSnapshot,
  citationCount: number,
): PageExtractability {
  const factors: Record<ExtractabilityFactor, boolean> = {
    has_faq: snap.faqs.length > 0,
    has_schema: snap.schema_types.length > 0,
    has_h2_structure: snap.h2_list.length >= 2,
    has_meta_description: !!snap.meta_description && snap.meta_description.length >= 30,
    sufficient_word_count: snap.word_count >= 600,
    has_direct_answers: hasDirectAnswerSignals(snap),
  };

  let score = 0;
  for (const [factor, has] of Object.entries(factors) as [ExtractabilityFactor, boolean][]) {
    if (has) score += FACTOR_WEIGHTS[factor];
  }

  let grade: ExtractabilityGrade;
  if (score >= 80) grade = "good";
  else if (score >= 55) grade = "fair";
  else if (score >= 30) grade = "needs_work";
  else grade = "poor";

  const suggestions: ExtractabilitySuggestion[] = [];
  const isHighCit = citationCount >= 20;

  if (!factors.has_faq) {
    suggestions.push({
      type: "add_faq",
      priority: isHighCit ? "high" : "medium",
      summary: "Add FAQ / Q&A content blocks",
      detail: `This page ${isHighCit ? `earns ${citationCount} citations but ` : ""}has no FAQ-style content. Adding structured Q&A blocks makes answers directly extractable by AI models.`,
    });
  }

  if (!factors.has_schema) {
    suggestions.push({
      type: "add_schema",
      priority: isHighCit ? "high" : "medium",
      summary: "Add structured data (JSON-LD)",
      detail: `No structured data detected. Adding FAQPage, LocalBusiness, or Service schema helps AI platforms identify and extract key information.`,
    });
  }

  if (!factors.has_h2_structure) {
    suggestions.push({
      type: "add_headings",
      priority: "medium",
      summary: "Improve section structure with H2 headings",
      detail: `Only ${snap.h2_list.length} H2 heading${snap.h2_list.length !== 1 ? "s" : ""}. Clear section headings help AI parse page content into discrete answer units.`,
    });
  }

  if (!factors.has_meta_description) {
    suggestions.push({
      type: "add_meta",
      priority: "low",
      summary: "Add or improve meta description",
      detail: "Missing or very short meta description. A concise summary helps AI understand page purpose.",
    });
  }

  if (!factors.sufficient_word_count) {
    suggestions.push({
      type: "deepen_content",
      priority: isHighCit ? "high" : "medium",
      summary: `Deepen content (currently ${snap.word_count} words)`,
      detail: `Thin content limits extractable material. Adding comparison sections, process explanations, or detailed service descriptions improves AI coverage.`,
    });
  }

  if (!factors.has_direct_answers && factors.sufficient_word_count) {
    suggestions.push({
      type: "add_direct_answers",
      priority: "medium",
      summary: "Add direct answer sections",
      detail: "Content exists but no clear question-answer formatted sections. Adding 'What is...', 'How does...' headings with direct answers improves extractability.",
    });
  }

  return {
    page_url: snap.url,
    page_title: snap.title,
    grade,
    score,
    factors,
    suggestions,
    citation_count: citationCount,
  };
}

/**
 * Analyze extractability for all owned pages with citations.
 * Returns pages sorted by priority: high citations + low score first.
 */
export function analyzeAllExtractability(
  snapshots: PageSnapshot[],
  citationCountMap: Map<string, number>,
): PageExtractability[] {
  const results: PageExtractability[] = [];

  for (const snap of snapshots) {
    const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
    const cit = citationCountMap.get(normUrl) ?? 0;
    if (cit === 0) continue;

    results.push(analyzeExtractability(snap, cit));
  }

  results.sort((a, b) => {
    // Prioritize: high citations + low extractability score
    const priorityA = a.citation_count * (100 - a.score);
    const priorityB = b.citation_count * (100 - b.score);
    return priorityB - priorityA;
  });

  return results;
}

/**
 * Generate a draft llms.txt recommendation based on page content.
 */
export function generateLlmsTxtDraft(
  snapshots: PageSnapshot[],
  siteDomain: string,
  brandName: string,
): string {
  const lines: string[] = [
    `# ${brandName}`,
    "",
    `> ${brandName} — information for AI assistants and language models.`,
    "",
    "## About",
    "",
  ];

  const services = new Set<string>();
  const locations = new Set<string>();

  for (const snap of snapshots) {
    for (const svc of snap.service_terms) services.add(svc);
    for (const loc of snap.location_terms) locations.add(loc);
  }

  if (services.size > 0) {
    lines.push(`Services: ${[...services].sort().join(", ")}`);
  }
  if (locations.size > 0) {
    lines.push(`Service areas: ${[...locations].sort().join(", ")}`);
  }
  lines.push(`Website: https://${siteDomain}`);
  lines.push("");
  lines.push("## Key pages");
  lines.push("");

  for (const snap of snapshots.slice(0, 10)) {
    const title = snap.title ?? snap.url.replace(/^https?:\/\/[^/]+/, "");
    lines.push(`- [${title}](${snap.url})`);
  }

  lines.push("");
  lines.push("## FAQs");
  lines.push("");

  const allFaqs: FaqItem[] = [];
  for (const snap of snapshots) {
    for (const faq of snap.faqs) allFaqs.push(faq);
  }

  for (const faq of allFaqs.slice(0, 10)) {
    lines.push(`**Q: ${faq.question}**`);
    lines.push(`A: ${faq.answer_excerpt}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Summary of extractability across all analyzed pages.
 */
export function summarizeExtractability(
  results: PageExtractability[],
): {
  total: number;
  good: number;
  fair: number;
  needs_work: number;
  poor: number;
  avg_score: number;
  top_opportunity: string | null;
} {
  let good = 0, fair = 0, needsWork = 0, poor = 0;
  let totalScore = 0;
  let topOpp: string | null = null;
  let topOppPriority = 0;

  for (const r of results) {
    totalScore += r.score;
    switch (r.grade) {
      case "good": good++; break;
      case "fair": fair++; break;
      case "needs_work": needsWork++; break;
      case "poor": poor++; break;
    }
    const priority = r.citation_count * (100 - r.score);
    if (priority > topOppPriority) {
      topOppPriority = priority;
      topOpp = r.page_title ?? r.page_url;
    }
  }

  return {
    total: results.length,
    good,
    fair,
    needs_work: needsWork,
    poor,
    avg_score: results.length > 0 ? Math.round(totalScore / results.length) : 0,
    top_opportunity: topOpp,
  };
}
