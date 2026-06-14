/**
 * Morning Brief — curates the top 3 actions for the operator's daily ritual.
 *
 * Consumes BeaconRecommendation[] from the recommendation engine and
 * translates them into operator-language actions with specific checklists.
 *
 * Design principle: Profound-simple on the surface, attribution brain underneath.
 */

import type { BeaconRecommendation, RecommendationType } from "./recommendation-engine";
import type { PrioritizedAction } from "./priority-engine";
import type { AnswerIntelligenceIndex, BrandPositioningByTopic } from "@/domains/answer-intelligence/types";
import type { CitationEvidenceIndex, PageSnapshot, FaqItem } from "@/domains/pages/types";
import type { MemoryInsight } from "@/domains/attribution/memory";
import type { CompetitorAlert, CompetitorSitemapSnapshot } from "@/domains/competitor-monitoring/types";
import { recConfidenceLabel } from "@/lib/confidence-labels";
import { type QueryKeywordIndex, getQueriesForPage, getQueriesForTopic, getTopQueryForTopicCity, getRelevantQueriesForPage } from "@/domains/answer-intelligence/query-index";

// ---------------------------------------------------------------------------
// Config type for industry-specific FAQ generation
// ---------------------------------------------------------------------------

export type FaqTemplate = {
  topicPattern: string;
  questions: string[];
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefItemPriority = "need" | "suggested";

export type MorningBriefItem = {
  id: string;
  priority: BriefItemPriority;
  headline: string;
  rationale: string;
  /** Intelligence context: citations, prior success, AI positioning — displayed as compact header */
  contextLines: string[];
  /** Pure execution steps: what to actually do (3-4 max) */
  steps: string[];
  /** Target page URL (null for topic-level recs) */
  pageUrl: string | null;
  /** Short path for display */
  pagePath: string | null;
  /** Citation count driving this recommendation */
  citationCount: number;
  /** Human-readable confidence */
  confidenceLabel: string;
  /** AI context: what platforms say about this topic */
  aiContext: string | null;
  /** Single strongest proof point — always visible under headline */
  keyReason: string | null;
  /** Monitoring expectation — separated from execution steps */
  monitorLine: string | null;
  /** Original recommendation type for styling */
  recType: RecommendationType;
};

export type CompetitorSummary = {
  domain: string;
  displayName: string;
  totalPages: number;
  addedPages: number;
  removedPages: number;
  /** Individual page changes for this competitor */
  changes: CompetitorAlert[];
};

export type MorningBriefData = {
  items: MorningBriefItem[];
  /** Attribution memory: "after your update X days ago — metrics moved" insights */
  memoryInsights: SerializedMemoryInsight[];
  /** Competitor monitoring alerts */
  competitorAlerts: CompetitorAlert[];
  /** Competitor summaries: grouped by competitor with page counts */
  competitorSummaries: CompetitorSummary[];
  /** 30-day trend direction for the sparkline */
  trendPct: number | null;
  /** Total citations across all owned pages */
  totalOwnedCitations: number;
  /** Data freshness: latest observation date */
  latestDataDate: string | null;
};

export type SerializedMemoryInsight = {
  changeId: string;
  headline: string;
  detail: string;
  direction: "improving" | "stable" | "declining";
  daysSince: number;
  pagePath: string | null;
  trendLine: { date: string; mentions: number; citations: number }[];
  changeIndex: number;
  /** Before/after metrics for ROI display */
  mentionsBefore: number;
  mentionsAfter: number;
  mentionsDeltaPct: number;
};

// ---------------------------------------------------------------------------
// Brief builder
// ---------------------------------------------------------------------------

export function buildMorningBrief(opts: {
  primaryAction: PrioritizedAction | null;
  secondaryActions: PrioritizedAction[];
  answerIntelligence: AnswerIntelligenceIndex | null;
  citationIndex: CitationEvidenceIndex | null;
  trendPct: number | null;
  totalOwnedCitations: number;
  latestDataDate: string | null;
  memoryInsights?: MemoryInsight[];
  competitorAlerts?: CompetitorAlert[];
  competitorSnapshots?: CompetitorSitemapSnapshot[];
  faqTemplates?: FaqTemplate[];
  /** Page snapshots for generating paste-ready code blocks in steps. */
  pageSnapshots?: PageSnapshot[];
  /** Fan-out query keyword index for query-driven recommendations. */
  queryIndex?: QueryKeywordIndex;
  /** Tenant city vocabulary (lowercase) for query-relevance filtering.
   *  Absent → the founder default inside query-index (parity). */
  cities?: ReadonlyArray<string>;
  /** Tenant vocabulary for title-intent extraction (2026-06-11): the
   *  intent ladder tries the tenant's own services, then the builder
   *  patterns (no-op for other verticals), then industry — and returns
   *  NO suggestion rather than fabricate vocabulary. */
  industry?: string | null;
  services?: ReadonlyArray<string>;
}): MorningBriefData {
  const items: MorningBriefItem[] = [];
  const pageSnaps = opts.pageSnapshots ?? [];
  const qIdx = opts.queryIndex ?? null;
  const tenantCities = opts.cities;
  const tenantVocab = { industry: opts.industry ?? null, services: opts.services ?? [] };

  if (opts.primaryAction) {
    items.push(
      toBriefItem(opts.primaryAction, "need", opts.answerIntelligence, opts.citationIndex, opts.faqTemplates, pageSnaps, qIdx, tenantCities, tenantVocab)
    );
  }

  for (const action of opts.secondaryActions.slice(0, 2)) {
    items.push(
      toBriefItem(action, "suggested", opts.answerIntelligence, opts.citationIndex, opts.faqTemplates, pageSnaps, qIdx, tenantCities, tenantVocab)
    );
  }

  // Serialize memory insights (top 2 — keep it focused)
  const serializedMemory: SerializedMemoryInsight[] = (opts.memoryInsights ?? [])
    .slice(0, 2)
    .map((m) => {
      const before = m.metricsBefore.avgMentions;
      const after = m.metricsAfter.avgMentions;
      const deltaPct = before > 0 ? Math.round(((after - before) / before) * 100) : 0;
      return {
        changeId: m.changeId,
        headline: m.headline,
        detail: m.detail,
        direction: m.direction,
        daysSince: m.daysSince,
        pagePath: m.pagePath,
        trendLine: m.trendLine,
        changeIndex: m.changeIndex,
        mentionsBefore: Math.round(before * 10) / 10,
        mentionsAfter: Math.round(after * 10) / 10,
        mentionsDeltaPct: deltaPct,
      };
    });

  // Build competitor summaries: group alerts by domain, add page counts from snapshots
  const alerts = (opts.competitorAlerts ?? []).slice(0, 25);
  const snapshots = opts.competitorSnapshots ?? [];
  const summaryMap = new Map<string, CompetitorSummary>();
  for (const snap of snapshots) {
    if (snap.error) continue;
    summaryMap.set(snap.domain, {
      domain: snap.domain,
      displayName: snap.displayName,
      totalPages: snap.pageCount,
      addedPages: 0,
      removedPages: 0,
      changes: [],
    });
  }
  for (const alert of alerts) {
    let entry = summaryMap.get(alert.domain);
    if (!entry) {
      entry = {
        domain: alert.domain,
        displayName: alert.displayName,
        totalPages: 0,
        addedPages: 0,
        removedPages: 0,
        changes: [],
      };
      summaryMap.set(alert.domain, entry);
    }
    entry.changes.push(alert);
    if (alert.changeType === "added") entry.addedPages++;
    if (alert.changeType === "removed") entry.removedPages++;
  }
  // Sort: most changes first, then alphabetical
  const competitorSummaries = [...summaryMap.values()]
    .filter((s) => s.changes.length > 0 || s.totalPages > 0)
    .sort((a, b) => (b.addedPages + b.removedPages) - (a.addedPages + a.removedPages) || a.displayName.localeCompare(b.displayName))
    .slice(0, 5);

  // If we have fewer than 3, that's okay — don't pad with junk
  return {
    items,
    memoryInsights: serializedMemory,
    competitorAlerts: alerts,
    competitorSummaries,
    trendPct: opts.trendPct,
    totalOwnedCitations: opts.totalOwnedCitations,
    latestDataDate: opts.latestDataDate,
  };
}

// ---------------------------------------------------------------------------
// Translate recommendation into operator-language brief item
// ---------------------------------------------------------------------------

function toBriefItem(
  action: PrioritizedAction,
  priority: BriefItemPriority,
  ai: AnswerIntelligenceIndex | null,
  citIndex: CitationEvidenceIndex | null,
  faqTemplates?: FaqTemplate[],
  pageSnapshots?: PageSnapshot[],
  queryIndex?: QueryKeywordIndex | null,
  cities?: ReadonlyArray<string>,
  vocab?: TenantTitleVocab,
): MorningBriefItem {
  const { contextLines, steps: rawSteps } = generateSteps(action, ai, citIndex, faqTemplates, pageSnapshots, queryIndex ?? undefined, cities, vocab);
  const headline = rewriteHeadline(action);
  const rationale = rewriteRationale(action);
  const aiContext = action.answerContext ?? null;

  // Separate monitoring line from execution steps
  const monitorIdx = rawSteps.findIndex((s) => s.startsWith("Monitor:"));
  const monitorLine = monitorIdx >= 0 ? rawSteps[monitorIdx] : null;
  const coreSteps = monitorIdx >= 0
    ? [...rawSteps.slice(0, monitorIdx), ...rawSteps.slice(monitorIdx + 1)]
    : rawSteps;

  // Cap at 2 core execution steps — merge extras into step 2 if needed
  const steps = coreSteps.length <= 2
    ? coreSteps
    : [coreSteps[0], coreSteps.slice(1).join(". ")];

  // Pick the single strongest proof point for inline display
  const keyReason = pickKeyReason(action);

  return {
    id: action.id,
    priority,
    headline,
    rationale,
    contextLines,
    steps,
    pageUrl: action.targetPageUrl,
    pagePath: action.targetPagePath,
    citationCount: action.citationOpportunity,
    confidenceLabel: recConfidenceLabel(action.confidence),
    aiContext,
    keyReason,
    monitorLine,
    recType: action.type,
  };
}

// ---------------------------------------------------------------------------
// Headline rewriting — make it operator-language
// ---------------------------------------------------------------------------

function rewriteHeadline(action: PrioritizedAction): string {
  const pageName = action.targetPagePath
    ? action.targetPagePath.replace(/^\//, "").replace(/-/g, " ").replace(/\//g, " > ")
    : null;

  switch (action.type) {
    case "strengthen_structure": {
      const gaps = extractStructuralGaps(action.rationale);
      const displayPath = action.targetPagePath?.replace(/^\/+/, "") ?? null;
      if (displayPath) {
        return `Add ${gaps} to /${displayPath}`;
      }
      return action.headline;
    }
    case "competitive_displacement":
      return action.headline; // Already good: "Close competitive gap for X"
    case "refresh_content":
      return pageName
        ? `Expand content on ${action.targetPagePath?.startsWith("/") ? action.targetPagePath : `/${action.targetPagePath}`}`
        : action.headline;
    case "improve_internal_links":
      return pageName
        ? `Add internal links to ${action.targetPagePath?.startsWith("/") ? action.targetPagePath : `/${action.targetPagePath}`}`
        : action.headline;
    case "topic_cluster_gap":
      return action.headline; // Already good: "Add guide/comparison page for X"
    case "refresh_stale_citation":
      return pageName
        ? `Refresh declining page ${action.targetPagePath?.startsWith("/") ? action.targetPagePath : `/${action.targetPagePath}`}`
        : action.headline;
    case "replicate":
      return action.headline; // Playbook brief titles are already good
    case "cross_page_pattern":
      return action.headline;
    case "keyword_optimization":
      return action.headline; // Already specific: "Change title tag on /path"
    default:
      return action.headline;
  }
}

function extractStructuralGaps(rationale: string): string {
  if (rationale.includes("FAQ content") && rationale.includes("structured data")) {
    return "FAQ + schema";
  }
  if (rationale.includes("FAQ content")) return "FAQ content";
  if (rationale.includes("structured data")) return "schema markup";
  return "structured content";
}

// ---------------------------------------------------------------------------
// Rationale rewriting — one sentence, operator-focused
// ---------------------------------------------------------------------------

function rewriteRationale(action: PrioritizedAction): string {
  switch (action.type) {
    case "strengthen_structure":
      return `AI platforms cited this page ${action.citationOpportunity} times but can't easily pull answers from it. Adding FAQ and schema makes it easier for ChatGPT, Google AI, and Perplexity to quote you directly. Beacon tracks direction, not cause.`;
    case "competitive_displacement":
      return action.rationale;
    case "refresh_content":
      return `This page gets AI citations but the content is thin. Adding more detail helps AI platforms give better, more specific answers that send people to you.`;
    case "improve_internal_links":
      return `This page gets mentioned by AI but isn't well-connected to your other pages. Linking from your strongest pages signals to AI that this content matters.`;
    case "topic_cluster_gap":
      return action.rationale;
    case "refresh_stale_citation":
      return `AI platforms are citing this page less than before. Updating the content signals freshness and may recover lost visibility. Beacon tracks direction, not cause.`;
    case "replicate":
      return `AI platforms cited this page ${action.citationOpportunity} times but it's missing elements that your best-performing pages have. Adding them may increase how often AI mentions you. Beacon tracks direction, not cause.`;
    case "investigate":
      return `AI visibility on this page may have shifted recently. Check if anything changed before taking action.`;
    case "cross_page_pattern":
      return `A pattern observed on your other pages can be applied here too. Replicating patterns with positive trends may increase AI citations. Beacon tracks direction, not cause.`;
    case "keyword_optimization":
      // Rationale already contains the exact before/after + query evidence
      return action.rationale;
    default:
      return action.rationale;
  }
}

// ---------------------------------------------------------------------------
// Helpers for step specificity — answer intelligence extraction
// ---------------------------------------------------------------------------

/** Get the primary topic(s) for a page from citation evidence index. */
function getPageTopics(
  action: PrioritizedAction,
  citIndex: CitationEvidenceIndex | null,
): string[] {
  if (!citIndex) return [];
  const pageUrl = action.targetPageUrl?.replace(/\/+$/, "").toLowerCase();
  if (!pageUrl) return [];
  return citIndex.page_to_topics?.[pageUrl] ?? [];
}

/** Get the primary topic display name for a page. */
function getPageTopicLine(
  action: PrioritizedAction,
  ai: AnswerIntelligenceIndex | null,
  citIndex: CitationEvidenceIndex | null,
): string | null {
  const topics = getPageTopics(action, citIndex);
  if (topics.length === 0) return null;
  // Clean up topic for display
  const clean = topics[0]
    .replace(/^Shield: /, "")
    .replace(/ \([^)]+\)$/, "");
  return `"${clean}"`;
}

/** Get brand positioning data for a topic from answer intelligence. */
function getTopicPositioning(
  topic: string,
  ai: AnswerIntelligenceIndex | null,
): BrandPositioningByTopic | null {
  if (!ai) return null;
  return ai.brand_positioning.find(
    (b) => b.topic.toLowerCase() === topic.toLowerCase(),
  ) ?? null;
}

/** Get co-citation topic breakdown. */
function getTopicCoCitation(
  topic: string,
  ai: AnswerIntelligenceIndex | null,
): import("@/domains/answer-intelligence/types").CoCitationTopicBreakdown | null {
  if (!ai?.co_citation?.by_topic) return null;
  return ai.co_citation.by_topic.find(
    (t) => t.topic.toLowerCase() === topic.toLowerCase(),
  ) ?? null;
}

/**
 * Get top N pages by citation count for a topic — used for internal link source suggestions.
 * Returns owned pages sorted by citation count descending.
 */
function getTopCitedPages(
  topic: string,
  citIndex: CitationEvidenceIndex | null,
  excludeUrl?: string | null,
  limit = 3,
): { url: string; count: number }[] {
  if (!citIndex?.by_topic) return [];
  const topicSummary = citIndex.by_topic.find(
    (t) => t.topic.toLowerCase() === topic.toLowerCase(),
  );
  if (!topicSummary) return [];
  const excludeNorm = excludeUrl?.replace(/\/+$/, "").toLowerCase();
  return topicSummary.top_owned_pages
    .filter((p) => !excludeNorm || p.url.replace(/\/+$/, "").toLowerCase() !== excludeNorm)
    .slice(0, limit);
}

/**
 * Extract AI-observed descriptors/phrases for a topic.
 * These are how AI platforms actually describe the brand for this topic.
 */
/**
 * Get AI-derived keywords for a topic.
 *
 * Priority: fan-out queries from query index (real search keywords) →
 * brand_descriptors from answer intelligence (usually EMPTY for Ritz data).
 * Fan-out queries are the actual keywords AI platforms search on.
 */
function getAIDescriptors(
  topic: string,
  ai: AnswerIntelligenceIndex | null,
  queryIndex?: QueryKeywordIndex,
): string[] {
  // Priority 1: fan-out queries — the actual search keywords
  if (queryIndex) {
    const topicQueries = getQueriesForTopic(queryIndex, topic, null, 5);
    if (topicQueries.length > 0) return topicQueries.slice(0, 3);
  }

  // Priority 2: brand_descriptors (usually empty for Ritz data)
  const bp = getTopicPositioning(topic, ai);
  if (!bp || bp.brand_descriptors.length === 0) return [];
  return bp.brand_descriptors
    .filter((d) => d.source_count >= 2)
    .slice(0, 3)
    .map((d) => d.fragment);
}

/**
 * Get per-platform mention rate for display context.
 */
function getPlatformContext(
  topic: string,
  ai: AnswerIntelligenceIndex | null,
): string | null {
  if (!ai?.topic_platform_summary) return null;
  const platforms = ai.topic_platform_summary[topic];
  if (!platforms) return null;
  const entries = Object.entries(platforms)
    .filter(([, v]) => v.latest_mention_rate > 0)
    .sort((a, b) => b[1].latest_mention_rate - a[1].latest_mention_rate)
    .slice(0, 3);
  if (entries.length === 0) return null;
  return entries
    .map(([platform, v]) => {
      const trend = v.trend_direction === "up" ? " ↑" : v.trend_direction === "down" ? " ↓" : "";
      return `${platform}: ${Math.round(v.latest_mention_rate * 100)}% mention rate${trend}`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Key reason — single strongest proof point for inline display
// ---------------------------------------------------------------------------

/** Pick the ONE most compelling reason this action matters — priority order. */
/** Short platform suffix: "· primarily ChatGPT + Google AIO" */
function platformSuffix(action: PrioritizedAction): string {
  const platforms = action.targetPlatforms ?? [];
  if (platforms.length === 0) return "";
  const labels: Record<string, string> = {
    chatgpt: "ChatGPT",
    google_aio: "Google AIO",
    perplexity: "Perplexity",
  };
  const names = platforms.map((p) => labels[p] ?? p).join(" + ");
  return ` · primarily ${names}`;
}

function pickKeyReason(action: PrioritizedAction): string | null {
  // 0. FAQ without schema — highest-leverage finding, data-proven
  if (action.sourceEvidence?.includes("visible FAQs, 0 FAQPage schema")) {
    const faqMatch = action.sourceEvidence.match(/^(\d+) visible FAQs/);
    const n = faqMatch?.[1] ?? "multiple";
    return `${n} FAQ questions visible, no schema — FAQPage JSON-LD strongly correlated with higher ChatGPT citation rates in your data`;
  }
  // 1. Prior success with delta (strongest proof)
  if (action.priorSuccess && action.priorSuccess.citationDelta > 0) {
    return `+${Math.round(action.priorSuccess.citationDelta)}% when applied to ${action.priorSuccess.pagePath}${platformSuffix(action)}`;
  }
  // 2. Expected metric from pattern data
  if (action.expectedMetric) {
    return `${action.expectedMetric}${platformSuffix(action)}`;
  }
  // 3. Competitive gap (for displacement recs)
  if (action.competitorContext) {
    const cc = action.competitorContext;
    return `${cc.competitorDomain} has ${cc.competitorCitations} citations, you have ${cc.ownedCitations}${platformSuffix(action)}`;
  }
  // 4. Citation count + section gap percentage (for structural recs)
  if (action.sectionGaps && action.sectionGaps.length > 0 && action.citationOpportunity > 0) {
    return `${action.citationOpportunity} citations · ${action.sectionGaps[0].display} missing (${Math.round(action.sectionGaps[0].pct * 100)}% of peers have it)${platformSuffix(action)}`;
  }
  // 5. Citation count alone
  if (action.citationOpportunity > 0) {
    return `${action.citationOpportunity} AI citations on this page${platformSuffix(action)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step generation — the concrete "what to do" checklist
// ---------------------------------------------------------------------------

function generateSteps(
  action: PrioritizedAction,
  ai: AnswerIntelligenceIndex | null,
  citIndex: CitationEvidenceIndex | null,
  faqTemplates?: FaqTemplate[],
  pageSnapshots?: PageSnapshot[],
  queryIndex?: QueryKeywordIndex,
  cities?: ReadonlyArray<string>,
  vocab?: TenantTitleVocab,
): { contextLines: string[]; steps: string[] } {
  const ctx: string[] = [];   // Intelligence context (displayed as header)
  const steps: string[] = []; // Pure execution steps (3-4 max)
  const page = action.targetPagePath ?? action.targetPageUrl ?? null;
  const citations = action.citationOpportunity;

  // --- Resolve page topics and AI intel once for the whole function ---
  const pageTopics = getPageTopics(action, citIndex);
  const primaryTopic = pageTopics[0] ?? null;

  // --- Intelligence context → compact header, not action steps ---
  if (page && citations > 0) {
    const topicLine = getPageTopicLine(action, ai, citIndex);
    const platformLine = primaryTopic ? getPlatformContext(primaryTopic, ai) : null;
    ctx.push(`${citations} AI citations${topicLine ? ` for ${topicLine}` : ""}`);
    if (platformLine) ctx.push(platformLine);
  }
  if (action.priorSuccess) {
    ctx.push(`Prior result: +${Math.round(action.priorSuccess.citationDelta)}% on ${action.priorSuccess.pagePath}`);
  }
  if (primaryTopic) {
    const bp = getTopicPositioning(primaryTopic, ai);
    if (bp && bp.mention_rate > 0) {
      ctx.push(`Mentioned in ${Math.round(bp.mention_rate * 100)}% of AI answers${bp.avg_position_when_mentioned ? ` (avg #${Math.round(bp.avg_position_when_mentioned)})` : ""}`);
    }
  }

  switch (action.type) {
    case "strengthen_structure": {
      const hasFaqGap = action.rationale.includes("FAQ content");
      const hasSchemaGap = action.rationale.includes("structured data");
      const snap = findSnapshot(action, pageSnapshots);
      const pagePath = action.targetPagePath ?? action.targetPageUrl ?? "the target page";

      // ── FAQ-specific recs: generate actual JSON-LD when page has FAQ questions ──
      if (action.id.startsWith("rec-faq-schema-") && snap) {
        // This is the high-value FAQ-without-schema rec — generate paste-ready code
        const faqSteps = generateFaqSchemaStep(snap, pagePath);
        steps.push(...faqSteps);
        break;
      }

      // Section gaps → structured content skeleton with H2, bullets, why
      if (action.sectionGaps && action.sectionGaps.length > 0) {
        const primaryGap = action.sectionGaps[0];
        const skeleton = generateSectionSkeleton(primaryGap, pagePath, pageTopics);
        steps.push(skeleton);
        if (action.sectionGaps.length > 1) {
          // Secondary gaps: shorter but still structured
          for (const gap of action.sectionGaps.slice(1, 3)) {
            const miniSkeleton = generateSectionSkeleton(gap, pagePath, pageTopics);
            steps.push(miniSkeleton);
          }
        }
      } else if (hasFaqGap) {
        // Try snapshot-based code generation first
        if (snap && snap.faqs.length > 0 && hasSchemaGap) {
          const faqSteps = generateFaqSchemaStep(snap, pagePath);
          steps.push(...faqSteps);
        } else {
          const aiDescriptors = primaryTopic ? getAIDescriptors(primaryTopic, ai, queryIndex) : [];
          const questions = aiDescriptors.length > 0
            ? aiDescriptors.map((d) => `What does "${d}" mean for your project?`)
            : suggestFaqQuestions(action, ai, citIndex, faqTemplates, queryIndex);
          const schemaNote = hasSchemaGap ? " + schema" : "";
          const proof = citations > 0 ? ` — ${citations} citations, no extractable Q&A` : "";
          if (questions.length > 0) {
            steps.push(`Add FAQ${schemaNote}: ${questions.slice(0, 3).map((q) => `"${q}"`).join(", ")}`);
          } else {
            steps.push(`Add FAQ section${schemaNote}${proof}`);
          }
        }
      } else if (hasSchemaGap) {
        steps.push(`Add FAQPage schema (JSON-LD)${citations > 0 ? ` — ${citations} citations but no schema` : ""}`);
      }

      // Phase B: add title/H2 specificity when snapshot is available
      if (snap && pageTopics.length > 0) {
        const titleSuggestion = suggestTitleRewrite(snap, pageTopics, queryIndex, cities, vocab);
        if (titleSuggestion) {
          steps.push(titleSuggestion);
        }
        const h2Suggestions = suggestH2Rewrites(snap, pageTopics);
        if (h2Suggestions.length > 0) {
          steps.push(...h2Suggestions.slice(0, 2));
        }
      }

      // Fallback: if no specific step was generated, find EXACT keyword
      // mismatches between the page's H2s/title and the top fan-out queries.
      // Produce "Change H2 from X to Y" instructions, not vague directions.
      if (steps.length === 0) {
        const relevantQueries = queryIndex
          ? getRelevantQueriesForPage(queryIndex, action.targetPageUrl ?? "", snap, 10, cities)
          : [];

        if (relevantQueries.length > 0 && snap) {
          const specificSteps = generateQueryGapSteps(snap, relevantQueries, pagePath);
          if (specificSteps.length > 0) {
            steps.push(...specificSteps);
          } else {
            steps.push(
              `This page has ${citations} AI citations and is well-structured. Monitor for changes — no specific gap detected against current AI queries.`,
            );
          }
        } else {
          const gapDesc = hasFaqGap ? "FAQ content" : hasSchemaGap ? "structured data" : "structured content";
          steps.push(
            `Add ${gapDesc} to ${pagePath} — this page has ${citations} AI citations but is missing elements that top-performing pages have.`,
          );
        }
      }
      break;
    }

    case "competitive_displacement": {
      const cc = action.competitorContext;
      const topicForCC = cc?.topic ?? action.headline.match(/"([^"]+)"/)?.[1] ?? "this topic";

      // Context: competitive intelligence
      if (cc) {
        ctx.push(`${cc.competitorDomain}: ${cc.competitorCitations} citations vs your ${cc.ownedCitations}`);
      }
      const topicCoCit = getTopicCoCitation(topicForCC, ai);
      if (topicCoCit) {
        if (topicCoCit.top_when_absent.length > 0) {
          ctx.push(`When you're absent, AI cites: ${topicCoCit.top_when_absent.slice(0, 3).map((d) => d.domain).join(", ")}`);
        }
        const total = topicCoCit.answers_with_owned + topicCoCit.answers_without_owned;
        if (total > 0) {
          ctx.push(`Absent from ${topicCoCit.answers_without_owned}/${total} AI answers`);
        }
      }

      // Actions with inline proof
      const descriptors = getAIDescriptors(topicForCC, ai, queryIndex);
      const absenceProof = topicCoCit
        ? ` — you're absent from ${topicCoCit.answers_without_owned}/${topicCoCit.answers_with_owned + topicCoCit.answers_without_owned} AI answers`
        : cc ? ` — ${cc.competitorDomain} has ${cc.competitorCitations} citations vs your ${cc.ownedCitations}` : "";
      if (descriptors.length > 0) {
        steps.push(`Create content using AI's framing: ${descriptors.slice(0, 2).map((d) => `"${d}"`).join(", ")}${absenceProof}`);
      } else {
        steps.push(`Add FAQ + comparison for "${topicForCC}"${absenceProof}`);
      }
      break;
    }

    case "refresh_content": {
      const refreshDesc = primaryTopic ? getAIDescriptors(primaryTopic, ai, queryIndex) : (action.observedQueries ?? []);
      if (refreshDesc.length > 0) {
        ctx.push(`AI frames this as: ${refreshDesc.slice(0, 2).map((d) => `"${d}"`).join(", ")}`);
      }
      if (action.sectionGaps && action.sectionGaps.length > 0) {
        // Use content skeletons instead of generic "add missing sections"
        for (const gap of action.sectionGaps.slice(0, 2)) {
          const skeleton = generateSectionSkeleton(gap, page ?? "this page", pageTopics);
          steps.push(skeleton);
        }
      } else {
        steps.push(`Expand content on ${page ?? "this page"} — ${citations > 0 ? `${citations} citations but content is thin` : "content is thin"}`);
      }
      break;
    }

    case "improve_internal_links": {
      // Phase D: try snapshot-based link generation with actual <a> tags
      const linkSnap = findSnapshot(action, pageSnapshots);
      if (linkSnap && pageSnapshots && pageSnapshots.length > 0) {
        const linkSteps = generateInternalLinkSteps(linkSnap, pageSnapshots, citIndex);
        if (linkSteps.length > 0) {
          steps.push(...linkSteps);
          break;
        }
      }
      // Fallback: suggest linking from high-citation pages
      if (primaryTopic) {
        const topPages = getTopCitedPages(primaryTopic, citIndex, action.targetPageUrl);
        if (topPages.length > 0) {
          const sources = topPages.slice(0, 2).map((p) => p.url.replace(/^https?:\/\/[^/]+/, "")).join(", ");
          steps.push(`Link to ${page ?? "this page"} from ${sources} — your highest-citation pages for this topic`);
        } else {
          steps.push(`Add internal links to ${page ?? "this page"} from your highest-citation pages`);
        }
      } else {
        steps.push(`Add internal links to ${page ?? "this page"} from your highest-citation pages`);
      }
      break;
    }

    case "topic_cluster_gap": {
      const topicMatch = action.headline.match(/"([^"]+)"/);
      const topic = topicMatch?.[1] ?? "this topic";

      // Context: AI intel + competition
      const clusterDesc = getAIDescriptors(topic, ai, queryIndex);
      if (clusterDesc.length > 0) {
        ctx.push(`AI frames this space as: ${clusterDesc.slice(0, 2).map((d) => `"${d}"`).join(", ")}`);
      }
      const coCit = getTopicCoCitation(topic, ai);
      if (coCit?.top_when_absent?.[0]) {
        ctx.push(`${coCit.top_when_absent[0].domain} fills ${coCit.top_when_absent[0].count} answers where you're absent`);
      }

      // Actions with inline proof
      const clusterCompetitor = coCit?.top_when_absent?.[0];
      const clusterProof = clusterCompetitor
        ? ` — ${clusterCompetitor.domain} fills ${clusterCompetitor.count} answers where you're absent`
        : "";
      steps.push(`Create new page for "${topic}" with FAQ + schema${clusterProof}`);
      const topPages = getTopCitedPages(topic, citIndex, null, 3);
      if (topPages.length > 0) {
        steps.push(`Link from: ${topPages.map((p) => p.url.replace(/^https?:\/\/[^/]+/, "")).join(", ")}`);
      }
      break;
    }

    case "refresh_stale_citation": {
      // Context: narrative shifts
      if (primaryTopic && ai?.narrative_shifts) {
        const shifts = ai.narrative_shifts
          .filter((s) => s.topic.toLowerCase() === primaryTopic.toLowerCase())
          .filter((s) => s.shift_type === "brand_lost" || s.shift_type === "position_declined")
          .slice(0, 1);
        if (shifts.length > 0) {
          ctx.push(`AI shift on ${shifts[0].platform}: ${shifts[0].detail}`);
        }
      }

      // Actions with inline proof
      const staleDesc = primaryTopic ? getAIDescriptors(primaryTopic, ai, queryIndex) : (action.observedQueries ?? []);
      if (staleDesc.length > 0) {
        steps.push(`Refresh content to match current AI framing: ${staleDesc.slice(0, 2).map((d) => `"${d}"`).join(", ")} — citations declining`);
      } else {
        steps.push(`Refresh content on ${page ?? "this page"} — citations declining, update to signal freshness`);
      }
      break;
    }

    case "replicate":
    case "cross_page_pattern": {
      // Prior success is now in context header — don't repeat in steps
      if (action.actionClass) {
        const enrichedSteps = generateStepsFromActionClass(action, pageSnapshots, pageTopics);
        steps.push(...enrichedSteps);
      } else {
        const gapSteps = generateReplicateSteps(action, ai, citIndex, faqTemplates, pageSnapshots, queryIndex);
        steps.push(...gapSteps);
      }
      break;
    }

    case "keyword_optimization": {
      // The rationale already contains the exact before/after text.
      // Use it directly as the step — it's already paste-ready.
      steps.push(action.rationale);
      break;
    }

    case "investigate": {
      const displayPath = action.targetPagePath ?? action.targetPageUrl ?? "the affected page";
      steps.push(`Check ${displayPath} for any recent content or structural changes`);
      steps.push(`Compare current citations (${citations}) to previous levels — is the decline sustained?`);
      steps.push("If no changes were made, monitor for one more import cycle before acting");
      break;
    }

    default: {
      if (page) {
        steps.push(`Insufficient data to generate specific steps for ${page} — review manually`);
      } else {
        steps.push("Insufficient data to generate specific steps — review the affected area manually");
      }
    }
  }

  return { contextLines: ctx, steps };
}

// ---------------------------------------------------------------------------
// Snapshot lookup + paste-ready code generation
// ---------------------------------------------------------------------------

/** Find the snapshot matching a recommendation's target page. */
function findSnapshot(
  action: PrioritizedAction,
  snapshots?: PageSnapshot[],
): PageSnapshot | null {
  if (!snapshots || snapshots.length === 0) return null;
  const targetUrl = action.targetPageUrl?.replace(/\/+$/, "").toLowerCase();
  if (!targetUrl) return null;
  return snapshots.find(
    (s) => s.url.replace(/\/+$/, "").toLowerCase() === targetUrl,
  ) ?? null;
}

/**
 * Generate a valid FAQPage JSON-LD block from actual FAQ items on the page.
 * Returns the full <script> tag ready to paste into the page <head>.
 */
function generateFaqSchemaJsonLd(faqs: FaqItem[]): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer_excerpt,
      },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

/**
 * Suggest a title rewrite using RELEVANT fan-out queries.
 *
 * This function is INTELLIGENT, not a keyword stuffer:
 *   1. Filters queries to those that match THIS page's purpose
 *   2. Extracts the intent (what the searcher wants) from the top query
 *   3. Builds a natural-sounding title under 60 chars
 *   4. Returns null if no relevant query exists or the current title is fine
 *
 * A bad suggestion is worse than no suggestion.
 */
type TenantTitleVocab = {
  industry: string | null;
  services: ReadonlyArray<string>;
};

function suggestTitleRewrite(
  snap: PageSnapshot,
  citedTopics: string[],
  queryIndex?: QueryKeywordIndex,
  cities?: ReadonlyArray<string>,
  vocab?: TenantTitleVocab,
): string | null {
  const title = snap.title;
  if (!title) return null;

  const titleLower = title.toLowerCase();
  const siteName = title.match(/\|\s*(.+)$/)?.[1]?.trim() ?? "";
  const suffix = siteName ? ` | ${siteName}` : "";

  // Use RELEVANT queries filtered by page content, not the unfiltered dump
  if (queryIndex) {
    const relevantQueries = getRelevantQueriesForPage(
      queryIndex,
      snap.url,
      snap, // snapshot provides H1/H2/title for relevance matching
      10,
      cities,
    );

    if (relevantQueries.length === 0) return null; // No relevant queries → no suggestion

    const topQuery = relevantQueries[0];
    const topQueryLower = topQuery.toLowerCase();

    // Check if the current title already contains the key differentiating
    // words from the top query. If yes, the title is already good.
    const queryContentWords = topQueryLower
      .split(/\s+/)
      // De-verticalized (2026-06-15): generic English query stopwords ONLY.
      // Removed builder/Bay-Area words (builders/home/custom/luxury/bay/area) —
      // those are meaningful content words for other verticals, not stopwords.
      .filter((w) => w.length > 3 && !["best", "top", "the", "for", "and", "which", "who", "should", "hire"].includes(w));

    const missingWords = queryContentWords.filter((w) => !titleLower.includes(w));
    if (missingWords.length < 2) return null; // Title already has the keywords

    // Build a natural-sounding title from the query's intent.
    // De-verticalized (2026-06-15): extract a city ONLY from this tenant's
    // configured locations (no hardcoded Bay-Area regex). A non-local / non-geo
    // tenant has no cities → no city in the title.
    const cityHit = (cities ?? [])
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
      .find((c) => topQueryLower.includes(c));
    const city = cityHit
      ? cityHit.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : null;

    // Extract the core intent (what kind of service) purely from the tenant's
    // OWN vocabulary — no hardcoded builder service patterns.
    const intentWords: string[] = [];
    // Tenant vocabulary FIRST (2026-06-11): the tenant's own service
    // phrases beat the builder patterns — "best catering in tucson"
    // yields "catering", never builder vocabulary.
    if (vocab && vocab.services.length > 0) {
      const phrases = [...vocab.services]
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 3)
        .sort((a, b) => b.length - a.length);
      for (const phrase of phrases) {
        if (topQueryLower.includes(phrase)) { intentWords.push(phrase); break; }
      }
    }
    if (intentWords.length === 0 && vocab?.industry) {
      intentWords.push(vocab.industry);
    }
    if (intentWords.length === 0) {
      // 2026-06-11: pre-fix this fabricated "Custom Home Builder" for
      // EVERY tenant. No intent signal → no suggestion (honest blank),
      // never another vertical's vocabulary.
      return null;
    }

    // Title case the intent
    const intentPhrase = intentWords[0]
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    // Build the suggested title — keep under 60 chars
    // 2026-06-11: the no-city branch used to fabricate "Bay Area" into
    // every tenant's suggestion. No city → no region word (the suffix
    // already carries the brand).
    let suggested: string;
    if (city) {
      suggested = `Best ${intentPhrase} in ${city}${suffix}`;
    } else {
      suggested = `Best ${intentPhrase}${suffix}`;
    }

    // Truncate if over 60 chars (drop "Best " prefix first, then suffix)
    if (suggested.length > 65) {
      suggested = city
        ? `${intentPhrase} in ${city}${suffix}`
        : `${intentPhrase}${suffix}`;
    }
    if (suggested.length > 65 && suffix.length > 0) {
      suggested = suggested.replace(suffix, "").trim();
    }

    // Don't suggest if it's basically the same as the current title
    if (suggested.toLowerCase().replace(/[^a-z0-9]/g, "") === titleLower.replace(/[^a-z0-9]/g, "")) {
      return null;
    }

    return `Current: <title>${title}</title>\nSuggested: <title>${suggested}</title>\nBased on: "${topQuery}" — the most frequent relevant AI search query for this page.`;
  }

  // Fallback: no query index available
  if (citedTopics.length > 0) {
    const primaryTopic = citedTopics[0]
      .replace(/^Shield: /, "")
      .replace(/ \([^)]+\)$/, "");
    const topicWords = primaryTopic.toLowerCase().split(/\s+/)
      // De-verticalized (2026-06-15): drop the Bay-Area-specific "bay"/"area".
      .filter((w) => w.length > 3 && !["the"].includes(w));
    const titleHasKeys = topicWords.filter((w) => titleLower.includes(w));
    if (titleHasKeys.length >= topicWords.length * 0.6) return null;

    return `Current: <title>${title}</title>\nSuggested: <title>${primaryTopic}${suffix}</title>\nReason: top cited topic "${primaryTopic}" is not reflected in the title.`;
  }

  return null;
}

/**
 * Suggest H2 rewrites for generic headings that don't match cited topics.
 * Returns rewrite suggestions or empty array if all H2s are already specific.
 */
function suggestH2Rewrites(
  snap: PageSnapshot,
  citedTopics: string[],
): string[] {
  if (!snap.h2_list || snap.h2_list.length === 0 || citedTopics.length === 0) return [];

  const genericPatterns = [
    /^our services$/i,
    /^about us$/i,
    /^learn more$/i,
    /^what we do$/i,
    /^our team$/i,
    /^get started$/i,
    /^contact$/i,
    /^overview$/i,
    /^services$/i,
    /^about$/i,
  ];

  const primaryTopic = citedTopics[0]
    .replace(/^Shield: /, "")
    .replace(/ \([^)]+\)$/, "");

  const rewrites: string[] = [];
  for (const h2 of snap.h2_list) {
    if (genericPatterns.some((p) => p.test(h2.trim()))) {
      rewrites.push(`H2 "${h2}" is generic — change to something specific like "${primaryTopic} — ${h2}"`);
    }
  }

  return rewrites;
}

/**
 * Generate a content skeleton for a section gap — not full copy, but a
 * structured outline with H2, bullet structure, and why.
 */
function generateSectionSkeleton(
  gap: { label: string; display: string; pct: number; insertAfter: string | null },
  pagePath: string,
  citedTopics: string[],
): string {
  const placement = gap.insertAfter ? `after "${gap.insertAfter}"` : "in the main content area";
  const topic = citedTopics[0]?.replace(/^Shield: /, "").replace(/ \([^)]+\)$/, "") ?? "";
  const pct = Math.round(gap.pct * 100);
  const label = gap.display;

  // City extraction from page path
  const cityMatch = pagePath.match(/\/locations?\/([\w-]+)/i);
  const city = cityMatch
    ? cityMatch[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : null;

  const lines: string[] = [];
  lines.push(`Add "${label}" section to ${pagePath} ${placement}:`);
  lines.push("");

  // Generate section-specific skeletons
  const labelLower = gap.label.toLowerCase();
  // De-verticalized (2026-06-15): vertical-neutral section skeletons — no
  // builder/construction nouns ("per sq ft", "permits → construction",
  // "design-build", "homeowner"). The scaffolds work for any vertical;
  // {topic} carries the tenant's own subject.
  if (labelLower.includes("neighborhood") || labelLower.includes("area")) {
    lines.push(`- H2: "Areas We Serve${city ? ` — ${city}` : ""}"`);
    lines.push("- Paragraph: 2-3 sentences about your coverage area (you write this)");
    lines.push("- List: link to each area or sub-region you serve");
    lines.push("- Include internal links to adjacent location pages");
  } else if (labelLower.includes("cost") || labelLower.includes("pricing")) {
    lines.push(`- H2: "How Much Does ${topic || "This"} Cost?"`);
    lines.push("- Paragraph: typical price ranges with context (e.g., $X–$Y)");
    lines.push("- Factors list: scope, complexity, options, and what's included");
    lines.push("- Note: do NOT give a single number — give ranges with context");
  } else if (labelLower.includes("process") || labelLower.includes("timeline")) {
    lines.push(`- H2: "Our ${topic || "Service"} Process"`);
    lines.push("- Numbered steps: inquiry → consultation → delivery → follow-up");
    lines.push("- Include a typical timeline for each phase");
  } else if (labelLower.includes("testimonial") || labelLower.includes("review")) {
    lines.push(`- H2: "What Our Clients Say${city ? ` in ${city}` : ""}"`);
    lines.push("- 2-3 client quotes with names and context");
    lines.push("- Add Review schema (JSON-LD) for each testimonial");
  } else if (labelLower.includes("comparison") || labelLower.includes("vs")) {
    lines.push(`- H2: "How We Compare${city ? ` in ${city}` : ""}"`);
    lines.push("- Comparison table with your top 4-5 competitors (see comparison table rec)");
  } else {
    // Generic fallback — still structured, not just "add X"
    lines.push(`- H2: "${label}${city ? ` — ${city}` : ""}"`);
    lines.push("- 2-3 paragraphs of relevant content (you write this)");
    lines.push("- Include at least one internal link to a related page");
  }

  lines.push("");
  lines.push(`Why: ${pct}% of similar pages ranking for "${topic || "this topic"}" have this section. Yours doesn't.`);

  return lines.join("\n");
}

/**
 * Generate exact internal link <a> tags for a city page that's missing
 * links to other city pages. Uses actual page snapshot data to find
 * which city pages exist and which aren't linked from this page.
 */
function generateInternalLinkSteps(
  snap: PageSnapshot,
  allSnapshots: PageSnapshot[],
  citIndex: CitationEvidenceIndex | null,
): string[] {
  const pagePath = snap.url.replace(/^https?:\/\/[^/]+/, "");

  // Find all city/location pages in the snapshot set
  const cityPages = allSnapshots
    .filter((s) => {
      const path = s.url.replace(/^https?:\/\/[^/]+/, "").toLowerCase();
      return path.includes("/location") && path !== pagePath.toLowerCase();
    })
    .map((s) => ({
      path: s.url.replace(/^https?:\/\/[^/]+/, ""),
      title: s.title ?? s.url,
    }));

  if (cityPages.length === 0) return [];

  // Check which city pages this page already links to
  const existingHrefs = new Set(
    (snap.internal_links ?? []).map((l) => l.href.replace(/\/+$/, "").toLowerCase()),
  );

  const missingLinks = cityPages.filter(
    (cp) => !existingHrefs.has(cp.path.replace(/\/+$/, "").toLowerCase()),
  );

  if (missingLinks.length === 0) return [];

  // Generate <a> tags with topic-relevant anchor text
  const links = missingLinks.slice(0, 5).map((cp) => {
    // Extract city name from path
    const cityMatch = cp.path.match(/\/locations?\/([\w-]+)/i);
    const cityName = cityMatch
      ? cityMatch[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : cp.title.replace(/\s*\|.*$/, "").trim();

    // Use citation topic to make anchor text specific
    const normalizedUrl = cp.path.replace(/\/+$/, "").toLowerCase();
    // Search for pages matching this path in citation index
    const topicKey = citIndex?.page_to_topics
      ? Object.keys(citIndex.page_to_topics).find((k) =>
          k.toLowerCase().includes(normalizedUrl),
        )
      : null;
    const citedTopic = topicKey
      ? citIndex!.page_to_topics[topicKey]?.[0]
          ?.replace(/^Shield: /, "")
          ?.replace(/ \([^)]+\)$/, "")
      : null;

    // De-verticalized (2026-06-15): the anchor falls back to the linked page's
    // own name/location (cityName = its /locations/<city> segment or cleaned
    // title), never a hardcoded "Custom Home Builder" vertical noun.
    const anchorText = citedTopic ?? cityName;
    return `<a href="${cp.path}">${anchorText}</a>`;
  });

  const linkedCount = existingHrefs.size;
  const steps: string[] = [];
  steps.push(
    `${pagePath} links to ${linkedCount} other city page${linkedCount !== 1 ? "s" : ""} but NOT to ${missingLinks.length} others.\n\nAdd these links in a "Service Areas" or footer section:\n\n${links.join("\n")}\n\nUse descriptive anchor text — not "click here" or "learn more."`,
  );

  return steps;
}

/**
 * Find exact keyword gaps between a page's H2s/title and the top fan-out
 * queries. Produces "Change H2 from X to Y" instructions.
 *
 * This is the core specificity engine: it compares what the page SAYS
 * against what AI platforms SEARCH FOR, and finds the exact words that
 * are missing. Each step is one isolated, testable change.
 */
function generateQueryGapSteps(
  snap: PageSnapshot,
  relevantQueries: string[],
  pagePath: string,
): string[] {
  const steps: string[] = [];
  const title = snap.title ?? "";
  const h1 = snap.h1 ?? "";
  const h2s = snap.h2_list ?? [];

  // Combine all page text for keyword presence check
  const allPageText = [title, h1, ...h2s].join(" ").toLowerCase();

  // Significant keywords from top queries that are NOT generic
  const GENERIC = new Set([
    "best", "top", "which", "who", "what", "how", "should", "hire",
    "builders", "builder", "home", "homes", "custom", "luxury", "the",
    "for", "and", "bay", "area", "firms", "firm", "that", "are",
    "this", "with", "from", "your", "their", "have", "been", "most",
  ]);

  // Extract significant multi-word PHRASES from queries
  // (e.g., "major structural renovation", "steep hillside lots",
  //  "teardown rebuild", "architect-designed")
  const phraseCounts = new Map<string, number>();
  for (const query of relevantQueries) {
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !GENERIC.has(w));
    // Try 2-word and 3-word phrases
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (!allPageText.includes(bigram)) {
        phraseCounts.set(bigram, (phraseCounts.get(bigram) ?? 0) + 1);
      }
    }
  }

  // Sort by frequency — most-mentioned missing phrases first
  const missingPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= 3) // Must appear in 3+ queries
    .sort((a, b) => b[1] - a[1]);

  if (missingPhrases.length === 0) return [];

  const topMissing = missingPhrases[0];
  const [phrase, freq] = topMissing;

  // Find the H2 that's CLOSEST to this phrase (most word overlap) — that's
  // the one to rewrite. If no H2 is close, suggest the title instead.
  let bestH2 = "";
  let bestOverlap = 0;
  const phraseWords = phrase.split(/\s+/);

  for (const h2 of h2s) {
    const h2Lower = h2.toLowerCase();
    const overlap = phraseWords.filter((pw) => h2Lower.includes(pw)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestH2 = h2;
    }
  }

  // Capitalize the phrase naturally
  const phraseTitle = phrase
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Extract city from the page path
  const cityMatch = pagePath.match(/\/locations?\/([\w-]+)/i);
  const cityName = cityMatch
    ? cityMatch[1].split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : null;

  if (bestH2 && bestOverlap > 0) {
    // Try to produce a natural rewrite by substituting or inserting
    // the missing phrase into the existing H2, not awkwardly prepending.
    let newH2: string;

    // Strategy 1: If the H2 contains a near-synonym of a phrase word,
    // swap it. E.g., "Home Remodeling" → "Home Renovation" when
    // "renovation" is the missing keyword.
    const synonymSwaps: Record<string, string> = {
      remodeling: "renovation", remodel: "renovation",
      renovation: "remodel", build: "construction",
      construction: "build",
    };
    let swapped = bestH2;
    let didSwap = false;
    for (const pw of phraseWords) {
      for (const [from, to] of Object.entries(synonymSwaps)) {
        if (pw === to && swapped.toLowerCase().includes(from) && !swapped.toLowerCase().includes(to)) {
          // Swap the synonym — preserve original casing
          const regex = new RegExp(from, "gi");
          swapped = swapped.replace(regex, to.charAt(0).toUpperCase() + to.slice(1));
          didSwap = true;
        }
      }
    }

    if (didSwap) {
      newH2 = swapped;
    } else if (cityName) {
      // Strategy 2: For city pages, build a clean heading
      newH2 = `${phraseTitle} in ${cityName}`;
    } else {
      // Strategy 3: Insert the phrase naturally — replace the most
      // generic part of the H2 with the specific phrase
      newH2 = `${phraseTitle} — ${bestH2}`;
    }

    // Don't suggest if the rewrite is basically the same
    if (newH2.toLowerCase().replace(/[^a-z0-9]/g, "") !== bestH2.toLowerCase().replace(/[^a-z0-9]/g, "")) {
      steps.push(
        `Change H2:\n  Current:  "${bestH2}"\n  Change to: "${newH2}"\n\nAI platforms search "${phrase}" (${freq}+ queries) but this exact phrasing doesn't appear in any heading on your page.`,
      );
    }
  } else {
    // No close H2 — check the title
    const titleLower = title.toLowerCase();
    if (!titleLower.includes(phrase)) {
      const siteName = title.match(/\|\s*(.+)$/)?.[1]?.trim() ?? "";
      const suffix = siteName ? ` | ${siteName}` : "";
      // De-verticalized (2026-06-15): no fabricated "Bay Area" region word when
      // there's no city signal (cityName comes only from a /locations/<city>
      // URL segment). The brand suffix already carries identity — a non-Bay-Area
      // tenant must never get "… Bay Area" injected into a suggested title.
      const newTitle = cityName
        ? `Best ${phraseTitle} in ${cityName}${suffix}`
        : `${phraseTitle}${suffix}`;

      steps.push(
        `Change title from:\n  <title>${title}</title>\nto:\n  <title>${newTitle}</title>\n\nAI platforms search "${phrase}" (${freq}x frequency) but this phrase doesn't appear in your title or any H2. Adding it aligns the page with the most-searched query.`,
      );
    }
  }

  // If there's a second missing phrase, add it as a secondary suggestion
  if (missingPhrases.length > 1) {
    const [phrase2, freq2] = missingPhrases[1];
    steps.push(
      `Also missing from all headings: "${phrase2}" (${freq2}x frequency in AI searches). Consider adding an H2 section that addresses this topic.`,
    );
  }

  return steps;
}

/**
 * Generate a paste-ready comparison table HTML with real competitor names.
 * Columns: Your Business + top competitors. Rows: standard comparison criteria.
 */
function generateComparisonTableHtml(competitors: string[]): string {
  const cols = ["Your Business", ...competitors.slice(0, 4)];
  const criteria = [
    "Years in Business",
    "Project Types",
    "Service Area",
    "Budget Range",
    "Licensed & Insured",
    "Design-Build Capability",
    "Notable Projects",
  ];

  const headerCells = ["Criteria", ...cols].map((c) => `    <th>${c}</th>`).join("\n");
  const rows = criteria
    .map(
      (criterion) =>
        `  <tr>\n    <td>${criterion}</td>\n${cols.map(() => "    <td></td>").join("\n")}\n  </tr>`,
    )
    .join("\n");

  return `<table>\n<thead>\n  <tr>\n${headerCells}\n  </tr>\n</thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

/**
 * Generate a paste-ready FAQ step with actual JSON-LD code from the page's
 * existing FAQ content. This is the difference between "Add FAQ schema"
 * (vague direction) and "Paste this exact code" (executable instruction).
 */
function generateFaqSchemaStep(
  snap: PageSnapshot,
  pagePath: string,
): string[] {
  const steps: string[] = [];
  const faqCount = snap.faqs.length;

  if (faqCount > 0) {
    const jsonLd = generateFaqSchemaJsonLd(snap.faqs);
    steps.push(
      `${pagePath} has ${faqCount} FAQ question${faqCount !== 1 ? "s" : ""} in the HTML but no FAQPage JSON-LD schema.\n\nPaste this into the page <head>:\n\n${jsonLd}\n\nVerify at https://search.google.com/test/rich-results`,
    );
  } else {
    steps.push(
      `${pagePath} has no FAQ content. Add 5-7 questions relevant to this page's topic, then wrap them in FAQPage JSON-LD schema.`,
    );
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Action-class-based step generation (uses enrichment data)
// ---------------------------------------------------------------------------

function generateStepsFromActionClass(
  action: PrioritizedAction,
  pageSnapshots?: PageSnapshot[],
  citedTopics?: string[],
): string[] {
  const steps: string[] = [];
  const page = action.targetPagePath ?? action.targetPageUrl ?? "the target page";
  const section = action.targetSection
    ? action.targetSection.split(" (")[0]
    : null;
  const insertPoint = action.targetSection?.match(/after "([^"]+)"/)?.[1];

  // Each case: 1 primary move, optionally 1 secondary. No fluff.
  const loc = insertPoint ? ` after "${insertPoint}"` : "";

  // Try to get the actual page snapshot for code generation
  const snap = findSnapshot(action, pageSnapshots);

  switch (action.actionClass) {
    case "faq_addition": {
      if (snap) {
        const faqSteps = generateFaqSchemaStep(snap, page);
        steps.push(...faqSteps);
      } else {
        steps.push(`Add FAQ section (5-7 questions) + FAQPage schema to ${page}${loc}`);
      }
      break;
    }
    case "faq_expansion":
      steps.push(`Expand FAQ on ${page}: add 3-5 new questions, extend answers to 3-4 sentences`);
      break;
    case "faq_consolidation": {
      const dupCount = snap?.faq_schema_block_count ?? 0;
      if (dupCount > 1) {
        steps.push(`${page} has ${dupCount} FAQPage JSON-LD blocks — consolidate into one. Remove the duplicate <script type="application/ld+json"> block.`);
      } else {
        steps.push(`Consolidate duplicate FAQ blocks on ${page} into one section with one schema`);
      }
      break;
    }
    case "comparison_table": {
      // Generate paste-ready comparison table HTML with real competitor names
      const competitors = action.competitorContext
        ? [action.competitorContext.competitorDomain]
        : [];
      // Also pull from rationale if it mentions competitor domains
      const rationaleMatch = action.rationale.match(/Include: ([^.]+)/);
      if (rationaleMatch) {
        const names = rationaleMatch[1].split(",").map((s) => s.replace(" and your business", "").trim()).filter(Boolean);
        for (const n of names) {
          if (!competitors.includes(n)) competitors.push(n);
        }
      }
      if (competitors.length > 0) {
        const tableHtml = generateComparisonTableHtml(competitors);
        steps.push(
          `Add this comparison table to ${page}${loc}:\n\n${tableHtml}\n\nFill in your business data in the first column. Competitor data sourced from AI co-citation analysis.`,
        );
      } else {
        steps.push(`Add comparison table to ${page}${loc} — include your top 4-5 competitors`);
      }
      break;
    }
    case "schema_addition":
    case "schema_update":
      steps.push(`Add JSON-LD schema to ${page} (FAQPage, Article, Service as applicable)`);
      break;
    case "content_section":
    case "general_content": {
      // Use section skeleton with query-driven content when available
      if (action.sectionGaps && action.sectionGaps.length > 0) {
        const skeleton = generateSectionSkeleton(
          action.sectionGaps[0],
          page,
          citedTopics ?? [],
        );
        steps.push(skeleton);
      } else if (section) {
        steps.push(`Add ${section.toLowerCase()} to ${page}${loc}`);
      } else {
        steps.push(`Add content section to ${page}${loc}`);
      }
      break;
    }
    case "hero_update":
    case "subheading_update":
      steps.push(`Update H1 on ${page} to directly answer the primary AI query`);
      break;
    case "title_update":
      steps.push(`Update title tag on ${page} — include primary topic, under 60 chars`);
      break;
    case "meta_update":
      steps.push(`Update meta description on ${page} — answer-formatted, under 155 chars`);
      break;
    case "internal_links": {
      if (snap && pageSnapshots && pageSnapshots.length > 0) {
        const linkSteps = generateInternalLinkSteps(snap, pageSnapshots, null);
        if (linkSteps.length > 0) {
          steps.push(...linkSteps);
        } else {
          steps.push(`Add internal links to ${page} from your highest-citation pages`);
        }
      } else {
        steps.push(`Add internal links to ${page} from your highest-citation pages`);
      }
      break;
    }
    case "cost_section":
      steps.push(`Add cost breakdown section to ${page}${loc}`);
      break;
    case "process_section":
      steps.push(`Add process overview section to ${page}${loc}`);
      break;
    case "testimonials":
      steps.push(`Add testimonials section + Review schema to ${page}`);
      break;
    case "page_creation":
      steps.push(`Create ${page} with FAQ + schema + internal links from day one`);
      break;
    default:
      steps.push(`Review ${page} for structural gaps`);
      break;
  }

  // Add monitoring step with learned timing when available
  if (action.engineTiming && action.engineTiming.length > 0) {
    const fastest = action.engineTiming.reduce((a, b) =>
      a.medianDays < b.medianDays ? a : b,
    );
    steps.push(
      `Monitor: expect first signal on ${fastest.platform} in ~${fastest.medianDays} days (based on ${fastest.sampleCount} prior observations)`,
    );
  } else {
    steps.push("Monitor AI citations for this page over the next 7-14 days");
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Replicate/cross-page-pattern step generation (keyword-based fallback)
// ---------------------------------------------------------------------------

function generateReplicateSteps(
  action: PrioritizedAction,
  ai: AnswerIntelligenceIndex | null,
  citIndex: CitationEvidenceIndex | null,
  faqTemplates?: FaqTemplate[],
  pageSnapshots?: PageSnapshot[],
  queryIndex?: QueryKeywordIndex,
): string[] {
  const steps: string[] = [];
  const headline = action.headline.toLowerCase();
  const rationale = action.rationale.toLowerCase();
  const snap = findSnapshot(action, pageSnapshots);
  const pagePath = action.targetPagePath ?? "this page";

  // Detect gap type from headline/rationale
  const hasSchemaGap =
    headline.includes("schema") || rationale.includes("schema") || rationale.includes("structured data");
  const hasFaqGap =
    headline.includes("faq") || rationale.includes("faq") || rationale.includes("faq content");
  const hasMultiSchema =
    headline.includes("multi-schema") || rationale.includes("multi-schema");

  if (hasMultiSchema) {
    steps.push("Add Article, Review, and Service schema (JSON-LD) alongside existing FAQPage schema");
    steps.push("Ensure each schema type has complete required properties");
    steps.push("Verify all schemas with Google Rich Results Test after deploying");
  } else if (hasFaqGap && hasSchemaGap) {
    // Paste-ready path: if snapshot has FAQ questions, generate the exact JSON-LD
    if (snap && snap.faqs.length > 0) {
      const faqSteps = generateFaqSchemaStep(snap, pagePath);
      steps.push(...faqSteps);
    } else {
      const questions = suggestFaqQuestions(action, ai, citIndex, faqTemplates, queryIndex);
      if (questions.length > 0) {
        steps.push(
          `Add FAQ section with these questions: ${questions.map((q) => `"${q}"`).join(", ")}`
        );
      } else {
        steps.push(`Add FAQ section to ${pagePath} — ${action.citationOpportunity} citations but no extractable Q&A`);
      }
      steps.push("Add FAQPage schema (JSON-LD) wrapping the FAQ section");
    }
    steps.push("Verify schema with Google Rich Results Test after deploying");
  } else if (hasFaqGap) {
    if (snap && snap.faqs.length > 0) {
      const faqSteps = generateFaqSchemaStep(snap, pagePath);
      steps.push(...faqSteps);
    } else {
      const questions = suggestFaqQuestions(action, ai, citIndex, faqTemplates, queryIndex);
      if (questions.length > 0) {
        steps.push(
          `Add FAQ section with these questions: ${questions.map((q) => `"${q}"`).join(", ")}`,
        );
      } else {
        steps.push(`Add FAQ section to ${pagePath} — ${action.citationOpportunity} citations but no extractable Q&A`);
      }
      steps.push("Wrap FAQ in FAQPage schema (JSON-LD)");
    }
  } else if (hasSchemaGap) {
    steps.push("Add structured data schema (JSON-LD) matching the page content type");
    steps.push("Verify schema with Google Rich Results Test after deploying");
  } else {
    // No keyword match — use section gaps if available
    if (action.sectionGaps && action.sectionGaps.length > 0) {
      for (const gap of action.sectionGaps.slice(0, 2)) {
        const placement = gap.insertAfter ? ` after "${gap.insertAfter}"` : "";
        steps.push(`Add ${gap.display} (${Math.round(gap.pct * 100)}% of similar pages have this)${placement}`);
      }
    } else {
      steps.push(`Insufficient data to generate specific steps for ${action.targetPagePath ?? "this page"} — review manually`);
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// FAQ question suggestions from answer intelligence
// ---------------------------------------------------------------------------

function suggestFaqQuestions(
  action: PrioritizedAction,
  ai: AnswerIntelligenceIndex | null,
  citIndex: CitationEvidenceIndex | null,
  faqTemplates?: FaqTemplate[],
  queryIndex?: QueryKeywordIndex,
): string[] {
  // Priority 1: Use REAL FAN-OUT QUERIES from the query index
  // These are the actual search keywords AI platforms digest — converting
  // them into FAQ questions means the page answers the EXACT queries
  // that drive citations.
  if (queryIndex) {
    const pageUrl = action.targetPageUrl?.replace(/\/+$/, "").toLowerCase();
    if (pageUrl) {
      const pageQueries = getQueriesForPage(queryIndex, pageUrl, 7);
      if (pageQueries.length >= 3) {
        // Convert fan-out queries into FAQ questions
        return pageQueries.slice(0, 5).map((q) => {
          // Capitalize first letter and add question mark if missing
          const clean = q.charAt(0).toUpperCase() + q.slice(1);
          return clean.endsWith("?") ? clean : `${clean}?`;
        });
      }
    }

    // Fallback: try topic-level queries
    const pageTopics = getPageTopics(action, citIndex ?? null);
    for (const topic of pageTopics.slice(0, 2)) {
      const topicQueries = getQueriesForTopic(queryIndex, topic, null, 7);
      if (topicQueries.length >= 3) {
        return topicQueries.slice(0, 5).map((q) => {
          const clean = q.charAt(0).toUpperCase() + q.slice(1);
          return clean.endsWith("?") ? clean : `${clean}?`;
        });
      }
    }
  }

  // Priority 2: config-driven templates (if provided)
  if (!ai || !citIndex) return [];

  const pageUrl = action.targetPageUrl?.replace(/\/+$/, "").toLowerCase();
  if (!pageUrl) return [];

  const pageTopics = citIndex.page_to_topics?.[pageUrl]
    ?? citIndex.page_to_topics?.[action.targetPageUrl ?? ""]
    ?? [];

  if (pageTopics.length === 0) {
    const pathParts = (action.targetPagePath ?? "")
      .split("/")
      .filter((p) => p.length > 2)
      .map((p) => p.replace(/-/g, " ").toLowerCase());
    if (pathParts.length > 0) {
      for (const bp of ai.brand_positioning) {
        if (pathParts.some((part) => bp.topic.toLowerCase().includes(part))) {
          pageTopics.push(bp.topic);
        }
      }
    }
    if (pageTopics.length === 0) {
      const sorted = [...ai.brand_positioning].sort((a, b) => b.mention_count - a.mention_count);
      if (sorted.length > 0) pageTopics.push(sorted[0].topic);
    }
  }

  const questions: string[] = [];
  for (const topic of pageTopics.slice(0, 2)) {
    const topicClean = topic.replace(/^Shield: /, "").replace(/ \([^)]+\)$/, "");
    if (faqTemplates && faqTemplates.length > 0) {
      const matched = matchFaqTemplate(topic, topicClean, faqTemplates);
      if (matched.length > 0) { questions.push(...matched); continue; }
    }
    // Generic fallback
    questions.push(
      `What should I know about ${topicClean.toLowerCase()}?`,
      `How do I choose the right ${topicClean.toLowerCase()}?`,
      `What does ${topicClean.toLowerCase()} typically cost?`,
    );
  }
  return questions.slice(0, 3);
}

/**
 * Match a topic against config-driven FAQ templates.
 * Templates use {topic} and {city} placeholders.
 * City is extracted via the first capture group in topicPattern if present.
 */
function matchFaqTemplate(
  rawTopic: string,
  cleanTopic: string,
  templates: FaqTemplate[],
): string[] {
  for (const tmpl of templates) {
    const re = new RegExp(tmpl.topicPattern);
    const match = cleanTopic.match(re) ?? rawTopic.match(re);
    if (match) {
      const city = match[1] ?? "";
      return tmpl.questions.map((q) =>
        q
          .replace(/\{topic\}/g, cleanTopic.toLowerCase())
          .replace(/\{city\}/g, city),
      );
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Copy-for-devs formatter
// ---------------------------------------------------------------------------

export function formatBriefItemForDevs(item: MorningBriefItem): string {
  const lines = [
    `ACTION: ${item.headline}`,
    `PAGE: ${item.pageUrl ?? "(no specific page)"}`,
  ];

  if (item.contextLines.length > 0) {
    lines.push("", "CONTEXT:", ...item.contextLines.map((c) => `  ${c}`));
  }

  lines.push("", "DO:", ...item.steps.map((s, i) => `${i + 1}. ${s}`));
  if (item.monitorLine) {
    lines.push("", `MONITOR: ${item.monitorLine}`);
  }
  lines.push("", `WHY: ${item.rationale}`);

  if (item.aiContext) {
    lines.push("", `AI CONTEXT: ${item.aiContext}`);
  }

  lines.push("", `CITATIONS: ${item.citationCount} | CONFIDENCE: ${item.confidenceLabel}`);

  return lines.join("\n");
}

export function formatAllBriefsForEmail(items: MorningBriefItem[], date: string): {
  subject: string;
  body: string;
} {
  const subject = `Beacon Daily Brief — ${date}`;
  const sections = items.map((item, i) => {
    const label = item.priority === "need" ? "DO THIS FIRST" : `NEXT UP #${i}`;
    return `--- ${label} ---\n\n${formatBriefItemForDevs(item)}`;
  });

  const body = [
    `Beacon Daily Brief for ${date}`,
    "=" .repeat(40),
    "",
    ...sections.map((s) => s + "\n"),
    "---",
    "Generated by Beacon — AI Visibility Operating System",
  ].join("\n");

  return { subject, body };
}
