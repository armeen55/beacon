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
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { MemoryInsight } from "@/domains/attribution/memory";
import type { CompetitorAlert, CompetitorSitemapSnapshot } from "@/domains/competitor-monitoring/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefItemPriority = "need" | "suggested";

export type MorningBriefItem = {
  id: string;
  priority: BriefItemPriority;
  headline: string;
  rationale: string;
  /** Concrete checklist: what to actually do */
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
  /** Attribution memory: "your change X days ago is working" insights */
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
}): MorningBriefData {
  const items: MorningBriefItem[] = [];

  if (opts.primaryAction) {
    items.push(
      toBriefItem(opts.primaryAction, "need", opts.answerIntelligence, opts.citationIndex)
    );
  }

  for (const action of opts.secondaryActions.slice(0, 2)) {
    items.push(
      toBriefItem(action, "suggested", opts.answerIntelligence, opts.citationIndex)
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
): MorningBriefItem {
  const steps = generateSteps(action, ai, citIndex);
  const headline = rewriteHeadline(action);
  const rationale = rewriteRationale(action);
  const aiContext = action.answerContext ?? null;

  return {
    id: action.id,
    priority,
    headline,
    rationale,
    steps,
    pageUrl: action.targetPageUrl,
    pagePath: action.targetPagePath,
    citationCount: action.citationOpportunity,
    confidenceLabel: confidenceToLabel(action.confidence),
    aiContext,
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
      return `AI platforms recommended this page ${action.citationOpportunity} times but can't easily pull answers from it. Adding FAQ and schema makes it easier for ChatGPT, Google AI, and Perplexity to quote you directly.`;
    case "competitive_displacement":
      return action.rationale;
    case "refresh_content":
      return `This page gets AI recommendations but the content is thin. Adding more detail helps AI platforms give better, more specific answers that send people to you.`;
    case "improve_internal_links":
      return `This page gets mentioned by AI but isn't well-connected to your other pages. Linking from your strongest pages tells AI this content matters.`;
    case "topic_cluster_gap":
      return action.rationale;
    case "refresh_stale_citation":
      return `AI platforms are recommending this page less than before. Updating the content signals freshness and can recover lost visibility.`;
    case "replicate":
      return `AI platforms recommended this page ${action.citationOpportunity} times but it's missing elements that your best-performing pages have. Adding them means more people see your name when they ask AI for help.`;
    case "investigate":
      return `AI visibility on this page may have shifted recently. Check if anything changed before taking action.`;
    case "cross_page_pattern":
      return `Something that works on your other pages can be applied here too. Replicating what works means more AI recommendations.`;
    default:
      return action.rationale;
  }
}

// ---------------------------------------------------------------------------
// Step generation — the concrete "what to do" checklist
// ---------------------------------------------------------------------------

function generateSteps(
  action: PrioritizedAction,
  ai: AnswerIntelligenceIndex | null,
  citIndex: CitationEvidenceIndex | null,
): string[] {
  const steps: string[] = [];

  switch (action.type) {
    case "strengthen_structure": {
      const hasFaqGap = action.rationale.includes("FAQ content");
      const hasSchemaGap = action.rationale.includes("structured data");

      if (hasFaqGap) {
        const questions = suggestFaqQuestions(action, ai, citIndex);
        if (questions.length > 0) {
          steps.push(
            `Add FAQ section with these questions: ${questions.map((q) => `"${q}"`).join(", ")}`
          );
        } else {
          steps.push("Add FAQ section addressing common questions about this service/location");
        }
      }

      if (hasSchemaGap) {
        steps.push("Add FAQPage schema (JSON-LD) wrapping the FAQ section");
        if (action.targetPagePath?.includes("locations")) {
          steps.push("Add LocalBusiness schema with address, phone, service area");
        }
      }

      steps.push("Verify schema with Google Rich Results Test after deploying");
      break;
    }

    case "competitive_displacement": {
      const topicMatch = action.headline.match(/"([^"]+)"/);
      const topic = topicMatch?.[1] ?? "this topic";

      steps.push(`Review your existing content for "${topic}" — is it comprehensive?`);
      steps.push("Check if competitors have content you don't (guides, comparisons, case studies)");
      steps.push("Add answer-formatted content that directly addresses common AI queries");
      break;
    }

    case "refresh_content": {
      steps.push("Add 2-3 new H2 sections covering related subtopics");
      steps.push("Include comparison or FAQ blocks that AI can extract directly");
      steps.push("Update any outdated dates, stats, or references");
      break;
    }

    case "improve_internal_links": {
      steps.push("Identify your highest-authority pages (homepage, top service pages)");
      steps.push("Add contextual links from those pages to this one");
      steps.push("Use descriptive anchor text that matches the target topic");
      break;
    }

    case "topic_cluster_gap": {
      steps.push("Create a new informational page covering this topic");
      steps.push("Link it from your existing service/location pages");
      steps.push("Include FAQ schema and answer-formatted content");
      break;
    }

    case "refresh_stale_citation": {
      steps.push("Review page content for outdated information");
      steps.push("Add fresh sections or update existing ones");
      steps.push("Check if competitors have published newer content on this topic");
      break;
    }

    case "replicate":
    case "cross_page_pattern": {
      // Use enrichment-based step generation when actionClass is available
      if (action.actionClass) {
        const enrichedSteps = generateStepsFromActionClass(action);
        steps.push(...enrichedSteps);
      } else {
        // Fallback: parse keywords from headline/rationale
        const gapSteps = generateReplicateSteps(action, ai, citIndex);
        steps.push(...gapSteps);
      }
      break;
    }

    case "investigate": {
      const displayPath = action.targetPagePath ?? action.targetPageUrl ?? "the affected page";
      steps.push(`Check ${displayPath} for any recent content or structural changes`);
      steps.push("Compare current AI citations to previous levels — is the decline significant?");
      steps.push("If no changes were made, monitor for one more cycle before acting");
      break;
    }

    default: {
      // Generic steps for any other rec type
      if (action.targetPageUrl) {
        steps.push(`Review ${action.targetPagePath ?? action.targetPageUrl}`);
      }
      steps.push("Implement the suggested change");
      steps.push("Monitor AI citations for this page over the next 7-14 days");
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Action-class-based step generation (uses enrichment data)
// ---------------------------------------------------------------------------

function generateStepsFromActionClass(
  action: PrioritizedAction,
): string[] {
  const steps: string[] = [];
  const page = action.targetPagePath ?? action.targetPageUrl ?? "the target page";
  const section = action.targetSection
    ? action.targetSection.split(" (")[0]
    : null;
  const insertPoint = action.targetSection?.match(/after "([^"]+)"/)?.[1];

  switch (action.actionClass) {
    case "faq_addition":
      steps.push(
        section
          ? `Add FAQ section to ${page}${insertPoint ? ` after "${insertPoint}"` : ""}`
          : `Add FAQ section to ${page} addressing top questions for this topic`,
      );
      steps.push("Write 5-7 answer-formatted questions (conversational tone, 2-3 sentences each)");
      steps.push("Wrap in FAQPage JSON-LD schema");
      steps.push("Validate schema with Google Rich Results Test");
      break;

    case "faq_expansion":
      steps.push(`Expand existing FAQ answers on ${page} to 3-4 sentences each`);
      steps.push("Add 3-5 new questions based on common AI query patterns");
      steps.push("Update FAQPage schema to include new questions");
      break;

    case "faq_consolidation":
      steps.push(`Consolidate duplicate FAQ blocks on ${page} into a single section`);
      steps.push("Remove duplicate FAQPage JSON-LD blocks");
      steps.push("Verify one clean FAQPage schema with Rich Results Test");
      break;

    case "comparison_table":
      steps.push(
        `Add builder comparison table to ${page}${insertPoint ? ` after "${insertPoint}"` : ""}`,
      );
      steps.push("Include 4-6 comparison criteria (experience, services, certifications, project types)");
      steps.push("Use structured HTML table with clear headers");
      break;

    case "schema_addition":
    case "schema_update":
      steps.push(`Add structured data schema (JSON-LD) to ${page}`);
      steps.push("Include Article, FAQPage, and Service types as applicable");
      steps.push("Validate with Google Rich Results Test after deploying");
      break;

    case "content_section":
    case "general_content":
      if (section) {
        steps.push(
          `Add ${section.toLowerCase()} to ${page}${insertPoint ? ` after "${insertPoint}"` : ""}`,
        );
        steps.push("Structure with answer-formatted H2/H3 headings");
      } else {
        steps.push(`Add new content section to ${page} covering gaps vs top-performing similar pages`);
        steps.push("Use H2 headings that match common AI query patterns");
      }
      steps.push("Include 200+ words of substantive, answer-formatted content");
      break;

    case "hero_update":
    case "subheading_update":
      steps.push(`Update hero/subheading on ${page} with keyword-rich, answer-formatted copy`);
      steps.push("Ensure H1 directly answers the primary query for this page's topic");
      break;

    case "title_update":
      steps.push(`Update title tag on ${page} to include primary topic keyword`);
      steps.push("Keep under 60 characters, front-load the key term");
      break;

    case "meta_update":
      steps.push(`Update meta description on ${page} with answer-formatted summary`);
      steps.push("Include primary keyword and a clear value proposition (under 155 characters)");
      break;

    case "internal_links":
      steps.push(`Add 3-5 contextual internal links to ${page} from high-citation pages`);
      steps.push("Use descriptive anchor text matching the target topic");
      break;

    case "cost_section":
      steps.push(
        `Add cost breakdown section to ${page}${insertPoint ? ` after "${insertPoint}"` : ""}`,
      );
      steps.push("Include price ranges, factors affecting cost, and comparison to alternatives");
      break;

    case "process_section":
      steps.push(
        `Add process overview section to ${page}${insertPoint ? ` after "${insertPoint}"` : ""}`,
      );
      steps.push("Structure as numbered steps with clear outcomes at each stage");
      break;

    case "testimonials":
      steps.push(`Add client testimonials section to ${page}`);
      steps.push("Include 2-3 specific, named testimonials with project details");
      steps.push("Add Review schema (JSON-LD) for rich result eligibility");
      break;

    case "page_creation":
      steps.push(`Create new page at ${page}`);
      steps.push("Include FAQ section + FAQPage schema from day one");
      steps.push("Add internal links from 3+ existing pages");
      break;

    default:
      steps.push(`Review ${page} for structural gaps`);
      steps.push("Apply the pattern from top-performing pages of this type");
      break;
  }

  // Add monitoring step with learned timing when available
  if (action.engineTiming && action.engineTiming.length > 0) {
    const fastest = action.engineTiming.reduce((a, b) =>
      a.medianDays < b.medianDays ? a : b,
    );
    steps.push(
      `Monitor: expect first signal on ${fastest.platform} in ~${fastest.medianDays} days`,
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
): string[] {
  const steps: string[] = [];
  const headline = action.headline.toLowerCase();
  const rationale = action.rationale.toLowerCase();

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
    const questions = suggestFaqQuestions(action, ai, citIndex);
    if (questions.length > 0) {
      steps.push(
        `Add FAQ section with these questions: ${questions.map((q) => `"${q}"`).join(", ")}`
      );
    } else {
      steps.push("Add FAQ section addressing common questions about this service/location");
    }
    steps.push("Add FAQPage schema (JSON-LD) wrapping the FAQ section");
    if (action.targetPagePath?.includes("locations")) {
      steps.push("Add LocalBusiness schema with address, phone, service area");
    }
    steps.push("Verify schema with Google Rich Results Test after deploying");
  } else if (hasFaqGap) {
    const questions = suggestFaqQuestions(action, ai, citIndex);
    if (questions.length > 0) {
      steps.push(
        `Add FAQ section with these questions: ${questions.map((q) => `"${q}"`).join(", ")}`
      );
    } else {
      steps.push("Add FAQ section addressing common questions about this service/location");
    }
    steps.push("Wrap FAQ in FAQPage schema (JSON-LD)");
  } else if (hasSchemaGap) {
    steps.push("Add structured data schema (JSON-LD) matching the page content type");
    steps.push("Verify schema with Google Rich Results Test after deploying");
  } else {
    // Generic playbook action
    steps.push(`Review ${action.targetPagePath ?? action.targetPageUrl ?? "the target page"} for structural gaps`);
    steps.push("Apply the structural pattern from top-performing pages");
    steps.push("Monitor AI citations for this page over the next 7-14 days");
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
): string[] {
  if (!ai || !citIndex) return [];

  // Find the topic(s) this page is cited for
  const pageUrl = action.targetPageUrl?.replace(/\/+$/, "").toLowerCase();
  if (!pageUrl) return [];

  const pageTopics = citIndex.page_to_topics?.[pageUrl]
    ?? citIndex.page_to_topics?.[action.targetPageUrl ?? ""]
    ?? [];

  if (pageTopics.length === 0) {
    // Try to match via path keywords
    const pathParts = (action.targetPagePath ?? "")
      .split("/")
      .filter((p) => p.length > 2)
      .map((p) => p.replace(/-/g, " ").toLowerCase());

    if (pathParts.length > 0) {
      for (const bp of ai.brand_positioning) {
        const topicLower = bp.topic.toLowerCase();
        if (pathParts.some((part) => topicLower.includes(part))) {
          pageTopics.push(bp.topic);
        }
      }
    }

    // For root/homepage or if no path match, use the highest-mention topic
    if (pageTopics.length === 0) {
      const sorted = [...ai.brand_positioning].sort(
        (a, b) => b.mention_count - a.mention_count
      );
      if (sorted.length > 0) pageTopics.push(sorted[0].topic);
    }
  }

  // Find the primary topic and generate questions from it
  const questions: string[] = [];

  for (const topic of pageTopics.slice(0, 2)) {
    const bp = ai.brand_positioning.find(
      (b) => b.topic.toLowerCase() === topic.toLowerCase()
    );
    if (!bp) continue;

    // Generate questions based on topic type
    const topicClean = topic
      .replace(/^Shield: /, "")
      .replace(/ \(Bay Area\)$/, "");

    // Location-based topics: "X Construction" where X is a city
    const cityMatch = topicClean.match(/^(\w[\w\s]*?)\s+Construction$/);
    if (cityMatch) {
      const city = cityMatch[1];
      questions.push(
        `What should I look for in a custom home builder in ${city}?`,
        `How much does it cost to build a custom home in ${city}?`,
        `How long does a custom home build take in ${city}?`
      );
    } else if (topic.includes("Builder") || topic.includes("Home")) {
      // Service-category topics: "Custom Home Builder Bay Area", "Luxury Home Builder"
      questions.push(
        `How do I choose the right ${topicClean.toLowerCase()}?`,
        `What questions should I ask a ${topicClean.toLowerCase()}?`,
        `What does a ${topicClean.toLowerCase()} typically cost?`
      );
    } else if (topic.includes("Renovation") || topic.includes("Remodel")) {
      questions.push(
        `What is the typical timeline for a ${topicClean.toLowerCase()}?`,
        `How do I choose the right contractor for a ${topicClean.toLowerCase()}?`,
        `What permits are needed for a ${topicClean.toLowerCase()}?`
      );
    } else {
      // Generic topic
      questions.push(
        `What makes a good ${topicClean.toLowerCase()}?`,
        `How do I evaluate a ${topicClean.toLowerCase()}?`,
        `What questions should I ask a ${topicClean.toLowerCase()}?`
      );
    }
  }

  return questions.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceToLabel(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Good confidence";
    case "low":
      return "Worth trying";
  }
}

// ---------------------------------------------------------------------------
// Copy-for-devs formatter
// ---------------------------------------------------------------------------

export function formatBriefItemForDevs(item: MorningBriefItem): string {
  const lines = [
    `ACTION: ${item.headline}`,
    `PAGE: ${item.pageUrl ?? "(no specific page)"}`,
    "",
    "STEPS:",
    ...item.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `WHY: ${item.rationale}`,
  ];

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
