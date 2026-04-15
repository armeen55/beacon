/**
 * Recommendation Engine — synthesizes observed impact into specific next moves.
 *
 * Connects attribution-backed change impact to structural page gaps,
 * producing ranked, evidence-grounded recommendations for the operator.
 */

import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { MinedPattern, PlaybookBrief } from "@/domains/pages/playbook";
import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { CitationDecayResult } from "@/domains/attribution/decay-types";
import type { AnswerIntelligenceIndex } from "@/domains/answer-intelligence/types";
import type { ChangePattern } from "@/domains/learning/change-patterns";
import { absoluteUrlForPath } from "@/lib/site-config";

export type RecommendationType =
  | "replicate"
  | "strengthen"
  | "investigate"
  | "strengthen_structure"
  | "improve_internal_links"
  | "refresh_content"
  | "competitive_displacement"
  | "cross_page_pattern"
  | "topic_cluster_gap"
  | "refresh_stale_citation";

export type BeaconRecommendation = {
  id: string;
  type: RecommendationType;
  headline: string;
  rationale: string;
  sourceEvidence: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  sourceChangeId: string | null;
  confidence: "high" | "medium" | "low";
  priority: number;
  patternId: string | null;
  citationOpportunity: number;
  /** Answer-intelligence enrichment: what the AI actually says about this topic. */
  answerContext?: string | null;
  /** Specific action to take (e.g., "Add comparison table") */
  specificMove?: string | null;
  /** Action class for programmatic use */
  actionClass?: string | null;
  /** Which page section to target (e.g., "between Process and Testimonials") */
  targetSection?: string | null;
  /** Prior change where this move worked, with measured delta */
  priorSuccess?: {
    changeId: string;
    pagePath: string;
    description: string;
    citationDelta: number;
  } | null;
  /** Per-engine expected signal timing */
  engineTiming?: { platform: string; medianDays: number; sampleCount: number }[] | null;
  /** Concrete expected metric from pattern data */
  expectedMetric?: string | null;
  /** Secondary recs bundled during dedup — shown separately, not in rationale */
  alsoConsider?: string[];
};

// ---------------------------------------------------------------------------
// Pattern matching: link a proven change to a structural pattern
// ---------------------------------------------------------------------------

function matchChangeToPattern(
  change: ChangelogEntry,
  patterns: MinedPattern[],
): MinedPattern | null {
  const changeUrl = change.url?.replace(/\/+$/, "").toLowerCase();

  if (changeUrl) {
    for (const pattern of patterns) {
      if (
        pattern.sourcePages.some(
          (sp) => sp.url.replace(/\/+$/, "").toLowerCase() === changeUrl,
        )
      ) {
        return pattern;
      }
    }

    if (changeUrl.includes("/locations/")) {
      return patterns.find((p) => p.type === "city_page_module") ?? null;
    }
    if (changeUrl.includes("/services/")) {
      return patterns.find((p) => p.type === "service_page_module") ?? null;
    }
  }

  const desc = (change.change_description ?? "").toLowerCase();
  if (
    desc.includes("faq") ||
    desc.includes("schema") ||
    desc.includes("json-ld")
  ) {
    return patterns.find((p) => p.type === "faq_schema_package") ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

export function computeRecommendations(opts: {
  impactRows: ScorecardRowWithImpact[];
  patterns: MinedPattern[];
  briefs: PlaybookBrief[];
  pageSnapshots?: PageSnapshot[];
  citationCountMap?: Map<string, number>;
  citationIndex?: CitationEvidenceIndex | null;
  allPages?: PageEntity[];
  decayResults?: CitationDecayResult[];
  answerIntelligence?: AnswerIntelligenceIndex | null;
  changelogEntries?: ChangelogEntry[];
  changePatterns?: ChangePattern[];
  activeExperimentUrls?: Set<string>;
  changeOutcomes?: import("@/domains/attribution/change-outcome").ChangeOutcome[];
}): BeaconRecommendation[] {
  const recs: BeaconRecommendation[] = [];

  // Pages with active experiments should not get new recommendations
  const experimentUrls = opts.activeExperimentUrls ?? new Set();

  const provenPositive = opts.impactRows.filter(
    (r) =>
      (r.verdict === "validated" || r.verdict === "partial") &&
      r.impact.direction === "positive" &&
      r.totalEventsLinked > 0,
  );

  const pagesWithProvenChange = new Set(
    provenPositive
      .filter((r) => r.change.url)
      .map((r) => r.change.url!.replace(/\/+$/, "").toLowerCase()),
  );

  // ── Replicate: proven changes × structural gaps ──

  const provenByPattern = new Map<string, ScorecardRowWithImpact[]>();

  for (const row of provenPositive) {
    const matched = matchChangeToPattern(row.change, opts.patterns);
    if (!matched) continue;
    const existing = provenByPattern.get(matched.id) ?? [];
    existing.push(row);
    provenByPattern.set(matched.id, existing);
  }

  const provenPatternIds = new Set(provenByPattern.keys());

  for (const brief of opts.briefs) {
    if (!provenPatternIds.has(brief.patternId)) continue;

    const briefUrl = brief.pageUrl.replace(/\/+$/, "").toLowerCase();
    if (pagesWithProvenChange.has(briefUrl)) continue;

    const provenChanges = provenByPattern.get(brief.patternId) ?? [];
    const bestProven = [...provenChanges].sort(
      (a, b) => (b.topScore ?? 0) - (a.topScore ?? 0),
    )[0];
    if (!bestProven) continue;

    const confidence: BeaconRecommendation["confidence"] =
      bestProven.verdict === "validated"
        ? "high"
        : bestProven.impact.confidence === "high"
          ? "high"
          : bestProven.impact.confidence === "medium"
            ? "medium"
            : "low";

    const platforms = bestProven.platforms
      .map((p) => PLATFORM_LABELS[p] ?? p)
      .join(", ");
    const topics = bestProven.topics.slice(0, 2).join(", ");

    recs.push({
      id: `rec-replicate-${brief.id}`,
      type: "replicate",
      headline: brief.title,
      rationale: `Observed: "${bestProven.change.asset_name}" (${bestProven.verdict}) aligned with visibility change${topics ? ` for ${topics}` : ""}${platforms ? ` on ${platforms}` : ""}. This page has the same structural gap.`,
      sourceEvidence: `${bestProven.totalEventsLinked} event${bestProven.totalEventsLinked !== 1 ? "s" : ""}, score ${Math.round(bestProven.topScore ?? 0)}, ${bestProven.evidenceTier} evidence`,
      targetPageUrl: brief.pageUrl,
      targetPagePath: brief.pagePath,
      sourceChangeId: bestProven.change.id,
      confidence,
      priority:
        brief.priority + (confidence === "high" ? 500 : confidence === "medium" ? 200 : 0),
      patternId: brief.patternId,
      citationOpportunity: brief.citationOpportunity,
    });
  }

  // ── Strengthen: weak evidence with positive signal ──

  const weakPositive = opts.impactRows.filter(
    (r) =>
      r.totalEventsLinked > 0 &&
      r.impact.direction !== "negative" &&
      (r.evidenceTier === "weak" || r.evidenceTier === "inferred"),
  );

  for (const row of weakPositive) {
    const gaps: string[] = [];
    if (!row.change.url) gaps.push("no URL");
    if (
      !row.change.topic_targeted ||
      row.change.topic_targeted.length < 3
    )
      gaps.push("no topic");
    if (!row.change.hypothesis) gaps.push("no hypothesis");
    if (gaps.length === 0) continue;

    const suggestedTopic =
      row.topics[0] &&
      (!row.change.topic_targeted || row.change.topic_targeted.length < 3)
        ? row.topics[0]
        : null;

    const gapStr = gaps.join(", ");

    const strengthenUrl = row.change.url;
    const strengthenFullUrl = strengthenUrl
      ? (strengthenUrl.startsWith("/") ? absoluteUrlForPath(strengthenUrl) : strengthenUrl)
      : null;
    recs.push({
      id: `rec-strengthen-${row.change.id}`,
      type: "strengthen",
      headline: `Improve changelog: "${row.change.asset_name}"`,
      rationale: `${row.totalEventsLinked} linked event${row.totalEventsLinked !== 1 ? "s" : ""} but ${row.evidenceTier} evidence (${gapStr}). Filling gaps could unlock auto-resolution.${suggestedTopic ? ` Suggested topic: "${suggestedTopic}".` : ""}`,
      sourceEvidence: `${row.evidenceTier} tier, ${gapStr}`,
      targetPageUrl: strengthenFullUrl,
      targetPagePath:
        strengthenUrl?.replace(/^https?:\/\/[^/]+/, "") ?? null,
      sourceChangeId: row.change.id,
      confidence: row.totalEventsLinked >= 2 ? "medium" : "low",
      // Cap at 499 — strengthen recs are metadata cleanup, never the primary action
      priority: Math.min(
        300 + row.totalEventsLinked * 50 + (suggestedTopic ? 100 : 0),
        499,
      ),
      patternId: null,
      citationOpportunity: 0,
    });
  }

  // ── Investigate: negative impact ──

  const negativeImpact = opts.impactRows.filter(
    (r) => r.impact.direction === "negative" && r.totalEventsLinked > 0,
  );

  for (const row of negativeImpact) {
    // Skip investigate recs for pages with no meaningful citation evidence
    const rawUrl = row.change.url;
    if (rawUrl && opts.citationCountMap) {
      const normUrl = (rawUrl.startsWith("/") ? absoluteUrlForPath(rawUrl) : rawUrl)
        .replace(/\/+$/, "").toLowerCase();
      const pageCitations = opts.citationCountMap.get(normUrl) ?? 0;
      if (pageCitations < 5) continue; // Not enough signal to investigate
    }
    const fullUrl = rawUrl
      ? (rawUrl.startsWith("/") ? absoluteUrlForPath(rawUrl) : rawUrl)
      : null;
    recs.push({
      id: `rec-investigate-${row.change.id}`,
      type: "investigate",
      headline: `Investigate: "${row.change.asset_name}"`,
      rationale: `Visibility declined in the same observation window as this change — ${row.totalEventsLinked} negative event${row.totalEventsLinked !== 1 ? "s" : ""}. Check for regression or external factors.`,
      sourceEvidence: `${row.totalEventsLinked} negative event${row.totalEventsLinked !== 1 ? "s" : ""}, ${row.topics.slice(0, 2).join(", ")}`,
      targetPageUrl: fullUrl,
      targetPagePath:
        rawUrl?.replace(/^https?:\/\/[^/]+/, "") ?? null,
      sourceChangeId: row.change.id,
      confidence: row.impact.confidence,
      priority: 800 + row.totalEventsLinked * 100,
      patternId: null,
      citationOpportunity: 0,
    });
  }

  // ── Strengthen structure: cited pages missing FAQ or schema ──
  //    Skip pages with uncertain extraction — we can't trust that "missing"
  //    is real if the parser couldn't verify structural content.

  if (opts.pageSnapshots && opts.citationCountMap) {
    const structureCandidates = opts.pageSnapshots
      .filter((snap) => {
        // Do NOT recommend structural changes when extraction is uncertain
        if (snap.extraction_certainty === "uncertain") return false;
        const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
        const cit = opts.citationCountMap!.get(normUrl) ?? 0;
        if (cit < 10) return false;
        const missingFaq = snap.faqs.length === 0;
        const missingSchema = snap.schema_types.length === 0;
        return missingFaq || missingSchema;
      })
      .sort((a, b) => {
        const cA = opts.citationCountMap!.get(a.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        const cB = opts.citationCountMap!.get(b.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        return cB - cA;
      })
      .slice(0, 3);

    for (const snap of structureCandidates) {
      const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
      const cit = opts.citationCountMap!.get(normUrl) ?? 0;
      const gaps: string[] = [];
      if (snap.faqs.length === 0) gaps.push("FAQ content");
      if (snap.schema_types.length === 0) gaps.push("structured data");

      // Hard suppression: if changelog already records FAQ/schema work for
      // this page, do NOT recommend adding the same thing again — even if
      // the scan snapshot couldn't detect it (JS rendering inconsistency).
      if (opts.changelogEntries && opts.changelogEntries.length > 0) {
        const snapPath = snap.url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
        const pageChanges = opts.changelogEntries.filter((c) => {
          const cp = (c.url ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
          return cp === snapPath;
        });
        if (pageChanges.length > 0) {
          const hasLoggedFaq = pageChanges.some(
            (c) =>
              c.signal_type === "faq" ||
              c.signal_type === "technical" ||
              c.change_description.toLowerCase().includes("faq") ||
              c.change_description.toLowerCase().includes("schema") ||
              c.change_description.toLowerCase().includes("json-ld"),
          );
          if (hasLoggedFaq) continue; // Already done — skip entirely
        }
      }

      recs.push({
        id: `rec-structure-${snap.page_id}`,
        type: "strengthen_structure",
        headline: `Add ${gaps.join(" + ")} to ${snap.title ?? snap.url.replace(/^https?:\/\/[^/]+/, "")}`,
        rationale: `This page has ${cit} citations but is missing ${gaps.join(" and ")}. Strengthening structure protects existing visibility and improves AI extractability.`,
        sourceEvidence: `${cit} citations, ${gaps.length} structural gap${gaps.length !== 1 ? "s" : ""}`,
        targetPageUrl: snap.url,
        targetPagePath: snap.url.replace(/^https?:\/\/[^/]+/, ""),
        sourceChangeId: null,
        confidence: cit >= 50 ? "high" : "medium",
        priority: 600 + cit,
        patternId: null,
        citationOpportunity: cit,
      });
    }
  }

  // ── Internal links: cited pages with very few internal links ──

  if (opts.pageSnapshots && opts.citationCountMap) {
    const linkCandidates = opts.pageSnapshots
      .filter((snap) => {
        const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
        const cit = opts.citationCountMap!.get(normUrl) ?? 0;
        if (snap.extraction_certainty === "uncertain") return false;
        return cit >= 5 && snap.internal_link_count < 5;
      })
      .sort((a, b) => {
        const cA = opts.citationCountMap!.get(a.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        const cB = opts.citationCountMap!.get(b.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        return cB - cA;
      })
      .slice(0, 3);

    for (const snap of linkCandidates) {
      const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
      const cit = opts.citationCountMap!.get(normUrl) ?? 0;

      recs.push({
        id: `rec-links-${snap.page_id}`,
        type: "improve_internal_links",
        headline: `Add internal links to ${snap.title ?? snap.url.replace(/^https?:\/\/[^/]+/, "")}`,
        rationale: `This page has ${cit} citations but only ${snap.internal_link_count} internal link${snap.internal_link_count !== 1 ? "s" : ""}. Linking from stronger pages reinforces authority and helps AI crawlers discover related content.`,
        sourceEvidence: `${cit} citations, ${snap.internal_link_count} internal links`,
        targetPageUrl: snap.url,
        targetPagePath: snap.url.replace(/^https?:\/\/[^/]+/, ""),
        sourceChangeId: null,
        confidence: cit >= 20 ? "medium" : "low",
        priority: 400 + cit * 2,
        patternId: null,
        citationOpportunity: cit,
      });
    }
  }

  // ── Refresh content: cited pages with thin content ──

  if (opts.pageSnapshots && opts.citationCountMap) {
    const refreshCandidates = opts.pageSnapshots
      .filter((snap) => {
        const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
        const cit = opts.citationCountMap!.get(normUrl) ?? 0;
        if (snap.extraction_certainty === "uncertain") return false;
        if (cit < 20) return false;
        const thinContent = snap.word_count < 800;
        const weakStructure = snap.h2_list.length < 2;
        return thinContent || weakStructure;
      })
      .sort((a, b) => {
        const cA = opts.citationCountMap!.get(a.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        const cB = opts.citationCountMap!.get(b.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        return cB - cA;
      })
      .slice(0, 2);

    for (const snap of refreshCandidates) {
      const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
      const cit = opts.citationCountMap!.get(normUrl) ?? 0;
      const issues: string[] = [];
      if (snap.word_count < 800) issues.push(`only ${snap.word_count} words`);
      if (snap.h2_list.length < 2) issues.push(`${snap.h2_list.length} H2 headings`);

      recs.push({
        id: `rec-refresh-${snap.page_id}`,
        type: "refresh_content",
        headline: `Refresh content on ${snap.title ?? snap.url.replace(/^https?:\/\/[^/]+/, "")}`,
        rationale: `This page earns ${cit} citations but has thin content (${issues.join(", ")}). Deepening content with additional sections, comparisons, or answer-formatted blocks improves extractability without creating a new page.`,
        sourceEvidence: `${cit} citations, ${issues.join(", ")}`,
        targetPageUrl: snap.url,
        targetPagePath: snap.url.replace(/^https?:\/\/[^/]+/, ""),
        sourceChangeId: null,
        confidence: cit >= 50 ? "high" : "medium",
        priority: 550 + cit,
        patternId: null,
        citationOpportunity: cit,
      });
    }
  }

  // ── Competitive displacement: topics where we're present but losing ──

  if (opts.citationIndex) {
    const displacementCandidates = opts.citationIndex.by_topic
      .filter((t) => {
        if (t.owned_citations === 0) return false;
        if (t.competitor_citations <= t.owned_citations) return false;
        return t.competitor_citations >= t.owned_citations * 2 && t.total_citations >= 10;
      })
      .sort((a, b) => {
        const gapA = a.competitor_citations - a.owned_citations;
        const gapB = b.competitor_citations - b.owned_citations;
        return gapB - gapA;
      })
      .slice(0, 3);

    for (const topic of displacementCandidates) {
      const ownPct = topic.total_citations > 0
        ? Math.round((topic.owned_citations / topic.total_citations) * 100)
        : 0;
      const compPct = topic.total_citations > 0
        ? Math.round((topic.competitor_citations / topic.total_citations) * 100)
        : 0;
      const shortTopic = topic.topic
        .replace(/^Shield: /, "")
        .replace(/ \(Bay Area\)$/, "");

      recs.push({
        id: `rec-displace-${topic.topic.replace(/[^a-z0-9]/gi, "-").slice(0, 40)}`,
        type: "competitive_displacement",
        headline: `Close competitive gap for "${shortTopic}"`,
        rationale: `Competitors hold ${compPct}% of citations for "${shortTopic}" vs your ${ownPct}%. You already appear in results — strengthening your content, structure, or authority for this topic could shift share.`,
        sourceEvidence: `${topic.owned_citations} your citations vs ${topic.competitor_citations} competitor, ${topic.total_citations} total`,
        targetPageUrl: null,
        targetPagePath: null,
        sourceChangeId: null,
        confidence: topic.owned_citations >= 5 ? "medium" : "low",
        // Topic-level recs rank below page-level recs (cap at 599)
        // They're strategic context, not immediate actionable tests
        priority: Math.min(599, 500 + Math.round(Math.log2(topic.competitor_citations - topic.owned_citations + 1) * 10)),
        patternId: null,
        citationOpportunity: topic.competitor_citations - topic.owned_citations,
      });
    }
  }

  // ── Cross-page pattern transfer: proven pattern on type A → apply to type B ──

  if (opts.pageSnapshots && opts.citationCountMap) {
    const existingTargets = new Set(recs.filter((r) => r.targetPageUrl).map((r) => r.targetPageUrl!.replace(/\/+$/, "").toLowerCase()));

    const snapByUrl = new Map<string, PageSnapshot>();
    for (const s of opts.pageSnapshots) snapByUrl.set(s.url.replace(/\/+$/, "").toLowerCase(), s);

    const pageTypeByUrl = new Map<string, string>();
    if (opts.allPages) {
      for (const p of opts.allPages) pageTypeByUrl.set(p.url.replace(/\/+$/, "").toLowerCase(), p.page_type);
    }

    const crossRecs: BeaconRecommendation[] = [];

    for (const row of provenPositive) {
      if (crossRecs.length >= 3) break;
      const sourceUrl = row.change.url?.replace(/\/+$/, "").toLowerCase();
      if (!sourceUrl) continue;
      const sourceSnap = snapByUrl.get(sourceUrl);
      if (!sourceSnap) continue;
      const sourceType = pageTypeByUrl.get(sourceUrl) ?? "other";
      const sourceTopics = new Set([
        ...sourceSnap.location_terms,
        ...sourceSnap.service_terms,
      ]);
      if (sourceTopics.size === 0) continue;

      const sourceGaps: string[] = [];
      if (sourceSnap.faqs.length > 0) sourceGaps.push("faq");
      if (sourceSnap.schema_types.length > 0) sourceGaps.push("schema");

      for (const [targetUrl, targetSnap] of snapByUrl) {
        if (crossRecs.length >= 3) break;
        if (targetUrl === sourceUrl) continue;
        if (existingTargets.has(targetUrl)) continue;

        const targetType = pageTypeByUrl.get(targetUrl) ?? "other";
        if (targetType === sourceType) continue;

        const targetCit = opts.citationCountMap!.get(targetUrl) ?? 0;
        if (targetCit < 3) continue;

        const targetTerms = new Set([...targetSnap.location_terms, ...targetSnap.service_terms]);
        let overlap = 0;
        for (const t of sourceTopics) { if (targetTerms.has(t)) overlap++; }
        if (overlap === 0) continue;

        const targetGaps: string[] = [];
        if (targetSnap.faqs.length === 0 && sourceGaps.includes("faq")) targetGaps.push("FAQ");
        if (targetSnap.schema_types.length === 0 && sourceGaps.includes("schema")) targetGaps.push("schema");
        if (targetSnap.word_count < 800) targetGaps.push("thin content");
        if (targetGaps.length === 0) continue;

        const matched = matchChangeToPattern(row.change, opts.patterns);
        existingTargets.add(targetUrl);

        crossRecs.push({
          id: `rec-cross-${targetSnap.page_id}`,
          type: "cross_page_pattern",
          headline: `Apply observed pattern to ${targetSnap.title ?? targetUrl.replace(/^https?:\/\/[^/]+/, "")}`,
          rationale: `"${row.change.asset_name}" (${row.verdict}) aligned with gains on a ${sourceType.replace(/_/g, " ")}. This ${targetType.replace(/_/g, " ")} shares ${overlap} term${overlap !== 1 ? "s" : ""} and has ${targetGaps.join(" + ")} gaps.`,
          sourceEvidence: `Source: ${row.totalEventsLinked} event${row.totalEventsLinked !== 1 ? "s" : ""}, ${row.evidenceTier} evidence · Target: ${targetCit} citations, ${targetGaps.join(", ")}`,
          targetPageUrl: targetSnap.url,
          targetPagePath: targetSnap.url.replace(/^https?:\/\/[^/]+/, ""),
          sourceChangeId: row.change.id,
          confidence: row.verdict === "validated" ? "medium" : "low",
          priority: 450 + targetCit * 2 + overlap * 30,
          patternId: matched?.id ?? null,
          citationOpportunity: targetCit,
        });
      }
    }
    recs.push(...crossRecs);
  }

  // ── Topic cluster gap: cited topic with narrow page-type coverage ──

  if (opts.citationIndex && opts.allPages) {
    const ownedPages = opts.allPages.filter((p) => p.is_owned);
    const topicToPageTypes = new Map<string, Set<string>>();

    const pageTopics = opts.citationIndex.page_to_topics;
    for (const [pageUrl, topics] of Object.entries(pageTopics)) {
      const normUrl = pageUrl.replace(/\/+$/, "").toLowerCase();
      const page = ownedPages.find((p) => p.url.replace(/\/+$/, "").toLowerCase() === normUrl);
      if (!page) continue;
      for (const topic of topics) {
        const types = topicToPageTypes.get(topic) ?? new Set();
        types.add(page.page_type);
        topicToPageTypes.set(topic, types);
      }
    }

    const clusterGapRecs: BeaconRecommendation[] = [];

    for (const topicSummary of opts.citationIndex.by_topic) {
      if (clusterGapRecs.length >= 2) break;
      if (topicSummary.owned_citations < 15) continue;

      const pageTypes = topicToPageTypes.get(topicSummary.topic);
      if (!pageTypes || pageTypes.size === 0) continue;
      if (pageTypes.size >= 3) continue;

      const hasOnlyTransactional = [...pageTypes].every((t) => t === "service_page" || t === "city_page");
      if (!hasOnlyTransactional) continue;

      const shortTopic = topicSummary.topic
        .replace(/^Shield: /, "")
        .replace(/ \(Bay Area\)$/, "");
      const existingTypes = [...pageTypes].map((t) => t.replace(/_/g, " ")).join(", ");
      const suggestedType = pageTypes.has("service_page") ? "guide or comparison page" : "informational guide";

      clusterGapRecs.push({
        id: `rec-cluster-${topicSummary.topic.replace(/[^a-z0-9]/gi, "-").slice(0, 40)}`,
        type: "topic_cluster_gap",
        headline: `Add ${suggestedType} for "${shortTopic}"`,
        rationale: `You earn ${topicSummary.owned_citations} citations for "${shortTopic}" but only from ${existingTypes} pages. A ${suggestedType} could capture informational intent and strengthen the topic cluster.`,
        sourceEvidence: `${topicSummary.owned_citations} owned citations, ${topicSummary.total_citations} total, ${pageTypes.size} page type${pageTypes.size !== 1 ? "s" : ""}`,
        targetPageUrl: null,
        targetPagePath: null,
        sourceChangeId: null,
        confidence: topicSummary.owned_citations >= 30 ? "medium" : "low",
        // Topic-level: cap below page-level recs
        priority: Math.min(499, 380 + Math.round(Math.log2(topicSummary.owned_citations + 1) * 10)),
        patternId: null,
        citationOpportunity: topicSummary.total_citations - topicSummary.owned_citations,
      });
    }
    recs.push(...clusterGapRecs);
  }

  // ── Refresh stale citations: pages with meaningful citation decay ──

  if (opts.decayResults) {
    const decaying = opts.decayResults
      .filter((d) => d.status === "meaningful_decline" && d.current_period_citations >= 3)
      .slice(0, 2);

    for (const decay of decaying) {
      const normUrl = decay.page_url.replace(/\/+$/, "").toLowerCase();
      if (recs.some((r) => r.targetPageUrl?.replace(/\/+$/, "").toLowerCase() === normUrl)) continue;

      const snap = opts.pageSnapshots?.find(
        (s) => s.url.replace(/\/+$/, "").toLowerCase() === normUrl,
      );
      const changePctStr = decay.change_pct !== null
        ? `${Math.abs(Math.round(decay.change_pct * 100))}%`
        : "notable";

      recs.push({
        id: `rec-decay-${normUrl.replace(/[^a-z0-9]/gi, "-").slice(0, 40)}`,
        type: "refresh_stale_citation",
        headline: `Refresh: ${snap?.title ?? decay.page_url.replace(/^https?:\/\/[^/]+/, "")}`,
        rationale: `Citations for this page declined ${changePctStr} (from ${decay.previous_period_citations} to ${decay.current_period_citations}). Refreshing content, updating dates, or adding new answer-formatted sections may help recover visibility.`,
        sourceEvidence: `${decay.previous_period_citations} → ${decay.current_period_citations} citations across ${decay.periods_analyzed} observation periods`,
        targetPageUrl: decay.page_url,
        targetPagePath: decay.page_url.replace(/^https?:\/\/[^/]+/, ""),
        sourceChangeId: null,
        confidence: decay.change_pct !== null && decay.change_pct <= -0.4 ? "medium" : "low",
        priority: 480 + decay.previous_period_citations,
        patternId: null,
        citationOpportunity: decay.previous_period_citations,
      });
    }
  }

  // ── Pattern-driven recommendations: use learning data to suggest proven
  //    signal types on pages that haven't been optimized recently ──
  // Pattern-driven recs always run — the dedup pass handles any overlap
  if (
    opts.changePatterns &&
    opts.changePatterns.length > 0 &&
    opts.pageSnapshots &&
    opts.citationCountMap
  ) {
    const highPatterns = opts.changePatterns
      .filter(
        (p) => p.confidence !== "low" && p.success_rate >= 0.7 && p.sample_count >= 5,
      )
      // Prioritize page-level patterns (city/service/project) over infrastructure
      .sort((a, b) => {
        const pageTypes = ["city_page", "service_page", "project_page"];
        const aPage = pageTypes.includes(a.asset_type) ? 1 : 0;
        const bPage = pageTypes.includes(b.asset_type) ? 1 : 0;
        if (bPage !== aPage) return bPage - aPage;
        return b.sample_count - a.sample_count;
      });
    const twentyOneDaysAgo = Date.now() - 21 * 86_400_000;

    for (const pattern of highPatterns.slice(0, 5)) {
      // Find pages matching this asset type that haven't been changed recently
      const assetType = pattern.asset_type;
      const matchingPages = opts.pageSnapshots.filter((snap) => {
        if (snap.extraction_certainty === "uncertain") return false;
        const normUrl = snap.url.replace(/\/+$/, "").toLowerCase();
        const cit = opts.citationCountMap!.get(normUrl) ?? 0;
        if (cit < 10) return false;

        // Match asset type to page path
        const path = snap.url.replace(/^https?:\/\/[^/]+/, "").toLowerCase();
        const isCity = path.includes("/locations/");
        const isService = path.includes("/services/");
        const isProject = path.includes("/explore-projects/") || path.includes("/project");
        const isHomepage = path === "/" || path === "";
        const isInfra = !isCity && !isService && !isProject && !isHomepage;
        const matchesType =
          (assetType === "city_page" && isCity) ||
          (assetType === "service_page" && isService) ||
          (assetType === "project_page" && isProject) ||
          (assetType === "homepage" && isHomepage) ||
          (assetType === "infrastructure" && isInfra);
        if (!matchesType) return false;

        // Skip pages with active experiments
        const snapPath = path.replace(/\/+$/, "");
        if (experimentUrls.has(snapPath)) return false;

        // Skip pages with recent changelog entries (last 21 days)
        if (opts.changelogEntries) {
          const recentWork = opts.changelogEntries.some((c) => {
            const cp = (c.url ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
            return cp === snapPath && new Date(c.timestamp).getTime() > twentyOneDaysAgo;
          });
          if (recentWork) return false;
        }

        return true;
      });

      // Pick the page with highest citations
      const bestPage = matchingPages.sort((a, b) => {
        const cA = opts.citationCountMap!.get(a.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        const cB = opts.citationCountMap!.get(b.url.replace(/\/+$/, "").toLowerCase()) ?? 0;
        return cB - cA;
      })[0];

      if (bestPage) {
        const normUrl = bestPage.url.replace(/\/+$/, "").toLowerCase();
        const cit = opts.citationCountMap!.get(normUrl) ?? 0;
        const pagePath = bestPage.url.replace(/^https?:\/\/[^/]+/, "");
        recs.push({
          id: `rec-pattern-${pattern.id.replace(/[^a-z0-9]/gi, "-").slice(0, 30)}-${bestPage.page_id}`,
          type: "replicate",
          headline: `Enhance ${pagePath} (${pattern.signal_type} on ${pattern.asset_type.replace(/_/g, " ")})`,
          rationale: `This page has ${cit} citations and matches a proven pattern: ${pattern.signal_type} changes on ${pattern.asset_type.replace(/_/g, " ")}s have a ${Math.round(pattern.success_rate * 100)}% success rate across ${pattern.sample_count} samples (avg +${pattern.avg_citation_delta}% citations).`,
          sourceEvidence: `${cit} citations, ${pattern.sample_count} similar changes at ${Math.round(pattern.success_rate * 100)}% success`,
          targetPageUrl: bestPage.url,
          targetPagePath: pagePath,
          sourceChangeId: null,
          confidence: pattern.confidence === "high" ? "high" : "medium",
          priority: 700 + cit,
          patternId: pattern.id,
          citationOpportunity: cit,
        });
      }
    }
  }

  // ── Fallback: top structural briefs when no proven patterns exist ──

  if (!recs.some((r) => r.type === "replicate")) {
    for (const brief of opts.briefs.slice(0, 3)) {
      recs.push({
        id: `rec-explore-${brief.id}`,
        type: "replicate",
        headline: brief.title,
        rationale: `Structural gap: ${brief.gapTrigger}. Pattern "${brief.patternName}" observed on ${brief.sourcePages.length} page${brief.sourcePages.length !== 1 ? "s" : ""}.`,
        sourceEvidence: brief.patternEvidence.evidenceSummary,
        targetPageUrl: brief.pageUrl,
        targetPagePath: brief.pagePath,
        sourceChangeId: null,
        confidence:
          brief.patternEvidence.executionConfidence === "execution_validated"
            ? "high"
            : "medium",
        priority: brief.priority,
        patternId: brief.patternId,
        citationOpportunity: brief.citationOpportunity,
      });
    }
  }

  // ── Answer intelligence enrichment pass ──
  // Attach real AI context to each recommendation so the operator sees
  // what the AI actually says, not just structural gap heuristics.
  if (opts.answerIntelligence) {
    enrichRecsWithAnswerIntelligence(recs, opts.answerIntelligence);
  }

  // ── Hyper-specific enrichment: action class, section gap, prior success, timing ──
  enrichWithSpecifics(recs, opts);
  // (enrichment pass populated specificMove, targetSection, priorSuccess, engineTiming, expectedMetric)

  // ── Cross-reference changelog: if a change was logged for the same page +
  // same type of work, adjust the recommendation to flag it as a deploy check ──
  if (opts.changelogEntries && opts.changelogEntries.length > 0) {
    const recentChanges = opts.changelogEntries
      .filter((c) => c.url)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    for (const rec of recs) {
      if (!rec.targetPageUrl) continue;
      const recPath = rec.targetPageUrl.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();

      // Find changelog entries for the same page
      const matchingChanges = recentChanges.filter((c) => {
        const changePath = (c.url ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
        return changePath === recPath;
      });

      if (matchingChanges.length === 0) continue;

      // Check if the changelog mentions the same kind of work
      const desc = matchingChanges.map((c) => c.change_description.toLowerCase()).join(" ");
      const recType = rec.type;

      // Check if the changelog mentions the same kind of work by signal_type or keywords
      const signalTypes = matchingChanges.map((c) => c.signal_type);
      const hasFaqOrSchema =
        signalTypes.includes("faq") ||
        signalTypes.includes("technical") ||
        desc.includes("faq") ||
        desc.includes("schema") ||
        desc.includes("json-ld");
      const hasContent = desc.includes("content") || signalTypes.includes("content");

      let isDeployCheck = false;
      if (recType === "strengthen_structure" && hasFaqOrSchema) {
        isDeployCheck = true;
      }
      // Replicate: suppress if RECENT changelog entries (last 30 days) match
      const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
      const recentMatchingChanges = matchingChanges.filter(
        (c) => new Date(c.timestamp).getTime() > thirtyDaysAgo,
      );
      if (recType === "replicate" && recentMatchingChanges.length >= 2) {
        isDeployCheck = true;
      }
      if (recType === "replicate" && recentMatchingChanges.length > 0 && (hasFaqOrSchema || hasContent)) {
        isDeployCheck = true;
      }
      if (recType === "refresh_content" && hasContent) {
        isDeployCheck = true;
      }
      if (recType === "improve_internal_links" && (desc.includes("link") || signalTypes.includes("content"))) {
        isDeployCheck = true;
      }
      if (recType === "cross_page_pattern" && (hasFaqOrSchema || hasContent)) {
        isDeployCheck = true;
      }

      if (isDeployCheck) {
        rec.priority = -1;
      }
    }
  }

  // ── Experiment suppression: don't recommend changes on pages being tested ──
  if (experimentUrls.size > 0) {
    for (const rec of recs) {
      if (rec.priority < 0 || !rec.targetPageUrl) continue;
      const recPath = rec.targetPageUrl
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
      if (experimentUrls.has(recPath)) {
        rec.priority = -1;
      }
    }
  }

  // ── Pattern-backed confidence boost ──
  if (opts.changePatterns && opts.changePatterns.length > 0) {
    const patternMap = new Map(opts.changePatterns.map((p) => [p.id, p]));
    for (const rec of recs) {
      if (!rec.sourceChangeId || rec.priority < 0) continue;
      // Don't boost "strengthen" recs — they're changelog cleanup, not page signals
      if (rec.type === "strengthen") continue;
      const sourceChange = opts.changelogEntries?.find(
        (c) => c.id === rec.sourceChangeId,
      );
      if (!sourceChange) continue;
      const patternKey = `${sourceChange.signal_type}::${sourceChange.asset_type}`;
      const pattern = patternMap.get(patternKey);
      if (pattern && pattern.confidence !== "low" && pattern.success_rate > 0.5) {
        rec.priority += Math.round(pattern.success_rate * 200);
        rec.rationale += ` Historical: ${Math.round(pattern.success_rate * 100)}% success rate across ${pattern.sample_count} similar changes (avg +${pattern.avg_citation_delta}% citations).`;
        if (pattern.confidence === "high") rec.confidence = "high";
      }
    }
  }

  // ── "Why now" temporal context ──
  if (opts.changelogEntries && opts.changelogEntries.length > 0) {
    for (const rec of recs) {
      if (rec.priority < 0 || !rec.targetPageUrl) continue;
      const recPath = rec.targetPageUrl
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
      const pageChanges = opts.changelogEntries
        .filter((c) => {
          const cp = (c.url ?? "")
            .replace(/^https?:\/\/[^/]+/, "")
            .replace(/\/+$/, "")
            .toLowerCase();
          return cp === recPath;
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (pageChanges.length > 0) {
        const days = Math.floor(
          (Date.now() - new Date(pageChanges[0].timestamp).getTime()) / 86_400_000,
        );
        // Use learned timing if available, otherwise state the fact without hardcoded thresholds
        if (rec.engineTiming && rec.engineTiming.length > 0) {
          const fastest = rec.engineTiming.reduce(
            (a, b) => (a.medianDays < b.medianDays ? a : b),
          );
          if (days > fastest.medianDays) {
            rec.rationale += ` Last change was ${days} days ago — beyond the typical ${fastest.platform} signal window (~${fastest.medianDays} days).`;
          } else {
            rec.rationale += ` Last change was ${days} days ago — within the expected signal window for ${fastest.platform} (~${fastest.medianDays} days).`;
          }
        } else if (days > 14) {
          rec.rationale += ` Last change: ${days} days ago.`;
        }
      } else {
        rec.rationale += ` No prior changes logged for this page — this is an untested opportunity.`;
      }
    }
  }

  // ── Diversity enforcement: demote duplicate actionClasses across pages ──
  // Sort by priority first so highest-priority recs claim their actionClass
  const sortedForDiversity = recs
    .filter((r) => r.priority >= 0)
    .sort((a, b) => b.priority - a.priority);
  const claimedActionClasses = new Set<string>();
  for (const r of sortedForDiversity) {
    if (!r.actionClass || !r.targetPageUrl) continue;
    if (claimedActionClasses.has(r.actionClass)) {
      // Same action class on a different page — demote priority
      r.priority = Math.max(r.priority - 300, 10);
    } else {
      claimedActionClasses.add(r.actionClass);
    }
  }

  // ── Final dedup: one rec per target URL (or per sourceChangeId for null-URL recs) ──
  const filtered = sortedForDiversity.filter((r) => r.priority >= 0);
  const seen = new Map<string, number>();
  const deduped: BeaconRecommendation[] = [];
  for (const r of filtered) {
    if (!r.targetPageUrl) {
      // For recs without a URL, dedup by sourceChangeId
      const changeKey = r.sourceChangeId ? `change:${r.sourceChangeId}` : null;
      if (changeKey) {
        const existingIdx = seen.get(changeKey);
        if (existingIdx !== undefined) {
          if (r.priority > deduped[existingIdx].priority) {
            deduped[existingIdx] = r;
          }
          continue;
        }
        seen.set(changeKey, deduped.length);
      }
      deduped.push(r);
      continue;
    }
    const key = r.targetPageUrl
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    const existingIdx = seen.get(key);
    if (existingIdx === undefined) {
      seen.set(key, deduped.length);
      deduped.push(r);
    } else if (r.priority > deduped[existingIdx].priority) {
      const prev = deduped[existingIdx];
      const also = [...(r.alsoConsider ?? []), prev.headline];
      deduped[existingIdx] = { ...r, alsoConsider: also };
    } else {
      const also = deduped[existingIdx].alsoConsider ?? [];
      also.push(r.headline);
      deduped[existingIdx].alsoConsider = also;
    }
  }

  return deduped.sort((a, b) => b.priority - a.priority);
}

// ---------------------------------------------------------------------------
// Hyper-specific enrichment — action class, section gap, prior success, timing
// ---------------------------------------------------------------------------

import { classifyChangeDescription, inferMoveFromSignalType } from "./action-classifier";
import { analyzeSectionGaps } from "./section-analyzer";

function enrichWithSpecifics(
  recs: BeaconRecommendation[],
  opts: {
    changelogEntries?: ChangelogEntry[];
    changePatterns?: ChangePattern[];
    changeOutcomes?: import("@/domains/attribution/change-outcome").ChangeOutcome[];
    pageSnapshots?: PageSnapshot[];
  },
): void {
  // Pre-classify all changelog entries for prior success lookup
  const classifiedChanges = new Map<
    string,
    { actionClass: string; entry: ChangelogEntry }
  >();
  if (opts.changelogEntries) {
    for (const entry of opts.changelogEntries) {
      const classified = classifyChangeDescription(entry.change_description);
      classifiedChanges.set(entry.id, {
        actionClass: classified.actionClass,
        entry,
      });
    }
  }

  for (const rec of recs) {
    if (rec.priority < 0) continue;

    // 1. Action classification
    if (rec.sourceChangeId && classifiedChanges.has(rec.sourceChangeId)) {
      const { actionClass, entry } = classifiedChanges.get(rec.sourceChangeId)!;
      const classified = classifyChangeDescription(entry.change_description);
      rec.specificMove = classified.label;
      rec.actionClass = classified.actionClass;
    } else if (rec.patternId && opts.changePatterns) {
      const pattern = opts.changePatterns.find((p) => p.id === rec.patternId);
      if (pattern) {
        const inferred = inferMoveFromSignalType(
          pattern.signal_type,
          pattern.asset_type,
        );
        rec.specificMove = inferred.label;
        rec.actionClass = inferred.actionClass;
      }
    }

    // 2. Section gap targeting
    if (rec.targetPageUrl && opts.pageSnapshots) {
      const normRecUrl = rec.targetPageUrl
        .replace(/\/+$/, "")
        .toLowerCase();
      const targetSnap = opts.pageSnapshots.find(
        (s) => s.url.replace(/\/+$/, "").toLowerCase() === normRecUrl,
      );
      if (targetSnap) {
        const gaps = analyzeSectionGaps(targetSnap, opts.pageSnapshots);
        // Pick the gap that best matches the action class
        const matchedGap =
          gaps.find((g) => g.sectionLabel === rec.actionClass) ?? gaps[0];
        if (matchedGap) {
          rec.targetSection = matchedGap.insertAfter
            ? `${matchedGap.displayName} (after "${matchedGap.insertAfter}")`
            : matchedGap.displayName;
        }
      }
    }

    // 3. Prior success reference — diversified across pages
    if (rec.actionClass && opts.changeOutcomes && opts.changeOutcomes.length > 0) {
      const CONTENT_FAMILY = new Set([
        "content_section", "general_content", "page_creation",
        "hero_update", "subheading_update", "neighborhoods_section",
      ]);
      const isCompatibleAction = (a: string, b: string) =>
        a === b || (CONTENT_FAMILY.has(a) && CONTENT_FAMILY.has(b));

      // Collect ALL compatible successes, deduplicated by page
      const successesByPage = new Map<
        string,
        { changeId: string; pagePath: string; description: string; citationDelta: number }
      >();

      for (const [changeId, classified] of classifiedChanges) {
        if (!isCompatibleAction(classified.actionClass, rec.actionClass!)) continue;
        const changePath = (classified.entry.url ?? "")
          .replace(/^https?:\/\/[^/]+/, "")
          .replace(/\/+$/, "")
          .toLowerCase();
        const recPath = (rec.targetPagePath ?? "")
          .replace(/\/+$/, "")
          .toLowerCase();
        if (changePath === recPath) continue;

        const outcome = opts.changeOutcomes.find(
          (o) => o.change_id === changeId && o.direction === "improving",
        );
        if (!outcome || outcome.citation_delta_pct <= 0) continue;

        const existing = successesByPage.get(changePath);
        if (!existing || outcome.citation_delta_pct > existing.citationDelta) {
          successesByPage.set(changePath, {
            changeId,
            pagePath: changePath || classified.entry.asset_name,
            description: classified.entry.change_description.slice(0, 80),
            citationDelta: outcome.citation_delta_pct,
          });
        }
      }

      const allSuccesses = [...successesByPage.values()]
        .sort((a, b) => b.citationDelta - a.citationDelta);

      if (allSuccesses.length > 0) {
        // Use the median success (not the max outlier) for expectedMetric
        const medianIdx = Math.floor(allSuccesses.length / 2);
        const medianSuccess = allSuccesses[medianIdx];
        const bestSuccess = allSuccesses[0];

        rec.priorSuccess = {
          ...bestSuccess,
          // Annotate with evidence breadth
          description: allSuccesses.length === 1
            ? `${bestSuccess.description} (1 prior example — limited evidence)`
            : `${bestSuccess.description} (${allSuccesses.length} prior examples)`,
        };

        // Use median delta for expectedMetric to avoid outlier overfit
        if (allSuccesses.length >= 3) {
          rec.expectedMetric = `+${Math.round(medianSuccess.citationDelta)}% citations (median of ${allSuccesses.length} similar changes, range ${Math.round(allSuccesses[allSuccesses.length - 1].citationDelta)}–${Math.round(bestSuccess.citationDelta)}%)`;
        } else if (allSuccesses.length === 2) {
          rec.expectedMetric = `+${Math.round((allSuccesses[0].citationDelta + allSuccesses[1].citationDelta) / 2)}% citations (avg of 2 prior examples)`;
        } else {
          rec.expectedMetric = `+${Math.round(bestSuccess.citationDelta)}% citations based on 1 prior example — treat as directional`;
        }

        // Reduce confidence when only 1 example
        if (allSuccesses.length === 1 && rec.confidence === "high") {
          rec.confidence = "medium";
        }
      }
    }

    // 4. Engine timing — match patternId against changePattern IDs
    //    Mined pattern IDs use "pattern-city-page" format, change patterns use "content::city_page"
    if (opts.changePatterns && opts.changePatterns.length > 0) {
      let matchedPattern: typeof opts.changePatterns[0] | undefined;
      if (rec.patternId) {
        // Direct ID match first
        matchedPattern = opts.changePatterns.find((p) => p.id === rec.patternId);
        // Fallback: match via action class + asset type inference
        if (!matchedPattern && rec.actionClass) {
          const signalFamily: Record<string, string[]> = {
            faq_addition: ["faq"], faq_expansion: ["faq"], faq_consolidation: ["faq", "technical"],
            schema_addition: ["technical"], schema_update: ["technical"],
            content_section: ["content"], general_content: ["content"], page_creation: ["content"],
            hero_update: ["content"], comparison_table: ["content"],
            title_update: ["technical"], meta_update: ["technical"],
            internal_links: ["content", "technical"],
          };
          const signals = signalFamily[rec.actionClass] ?? ["content"];
          const recPath = (rec.targetPagePath ?? "").toLowerCase();
          const assetGuess = recPath.includes("/locations/") ? "city_page"
            : recPath.includes("/services/") ? "service_page"
            : recPath.includes("/explore-projects/") ? "project_page"
            : "infrastructure";
          for (const sig of signals) {
            const candidate = opts.changePatterns.find((p) => p.signal_type === sig && p.asset_type === assetGuess);
            if (candidate) { matchedPattern = candidate; break; }
          }
        }
      }
      const timing = matchedPattern?.engine_timing ?? [];
      if (timing.length > 0) {
        rec.engineTiming = timing.map((t) => ({
          platform: t.platform,
          medianDays: t.median_days,
          sampleCount: t.sample_count,
        }));
      }
      // Also set expectedMetric from pattern if not already set via prior success
      if (!rec.expectedMetric && matchedPattern && matchedPattern.avg_citation_delta > 0) {
        rec.expectedMetric = `+${matchedPattern.avg_citation_delta}% avg citation delta across ${matchedPattern.sample_count} similar changes`;
      }
    }

    // 5. Expected metric (only if not already set by diversified prior success in step 3)
    if (!rec.expectedMetric) {
      if (rec.priorSuccess) {
        rec.expectedMetric = `+${Math.round(rec.priorSuccess.citationDelta)}% citations based on prior result on ${rec.priorSuccess.pagePath}`;
      } else if (rec.patternId && opts.changePatterns) {
        const pattern = opts.changePatterns.find((p) => p.id === rec.patternId);
        if (pattern && pattern.avg_citation_delta > 0) {
          rec.expectedMetric = `+${pattern.avg_citation_delta}% avg citation delta across ${pattern.sample_count} similar changes`;
        }
      }
    }

    // 6. Upgrade headline with specific move
    if (rec.specificMove && rec.targetPagePath) {
      // Upgrade generic labels using real H2 text from successful pages
      if (
        (rec.specificMove === "Enhance content sections" ||
          rec.specificMove === "Update content") &&
        rec.targetSection
      ) {
        const sectionName = rec.targetSection.split(" (")[0].toLowerCase();
        rec.specificMove = `Add ${sectionName}`;
      }

      // Try to derive a concrete section title from successful pages' H2s
      if (rec.priorSuccess && opts.pageSnapshots) {
        const successSnap = opts.pageSnapshots.find(
          (s) =>
            s.url
              .replace(/^https?:\/\/[^/]+/, "")
              .replace(/\/+$/, "")
              .toLowerCase() === rec.priorSuccess!.pagePath,
        );
        if (successSnap && rec.targetSection) {
          const gapLabel = rec.targetSection.split(" (")[0].toLowerCase();
          // Find the matching H2 from the success page
          const matchingH2 = successSnap.h2_list.find((h2) => {
            const lower = h2.toLowerCase();
            return (
              lower.includes(gapLabel.replace(/\s+section$/, "")) ||
              (gapLabel === "design-build overview" &&
                lower.includes("design-build")) ||
              (gapLabel === "comparison table" &&
                (lower.includes("comparison") || lower.includes("vs"))) ||
              (gapLabel === "cost breakdown" && lower.includes("cost")) ||
              (gapLabel === "process overview" && lower.includes("process"))
            );
          });
          if (matchingH2) {
            // Replace city/location names in the H2 with the target page's context
            const targetCity =
              rec.targetPagePath
                .split("/")
                .filter(Boolean)
                .pop()
                ?.replace(/-/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase()) ?? "";
            const successCity =
              rec.priorSuccess.pagePath
                .split("/")
                .filter(Boolean)
                .pop()
                ?.replace(/-/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase()) ?? "";
            if (targetCity && successCity && targetCity !== successCity) {
              const adapted = matchingH2.replace(
                new RegExp(successCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
                targetCity,
              );
              rec.specificMove = `Add "${adapted}"`;
            } else {
              rec.specificMove = `Add "${matchingH2}"`;
            }
          }
        }
      }

      if (rec.targetSection) {
        rec.headline = `${rec.specificMove} on ${rec.targetPagePath}`;
      } else {
        rec.headline = `${rec.specificMove} on ${rec.targetPagePath}`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Answer intelligence enrichment
// ---------------------------------------------------------------------------

function enrichRecsWithAnswerIntelligence(
  recs: BeaconRecommendation[],
  ai: AnswerIntelligenceIndex,
): void {
  // Build topic lookup from page_to_topics in citation index isn't available here,
  // so we match via recommendation's source evidence / headline topic references.
  const positionByTopic = new Map(
    ai.brand_positioning.map((bp) => [bp.topic.toLowerCase(), bp]),
  );

  // Build topic summary lookup
  const summaryByTopic = new Map<string, Record<string, import("@/domains/answer-intelligence/types").TopicPlatformSummary>>();
  for (const [topic, platforms] of Object.entries(ai.topic_platform_summary)) {
    summaryByTopic.set(topic.toLowerCase(), platforms);
  }

  // Recent narrative losses (brand_lost in last 14 days)
  const recentLosses = ai.narrative_shifts.filter(
    (s) =>
      s.shift_type === "brand_lost" &&
      daysSince(s.to_date) <= 14,
  );
  const lossTopics = new Set(recentLosses.map((s) => s.topic.toLowerCase()));

  for (const rec of recs) {
    // Try to find a matching topic from the recommendation text
    const matchedTopic = findMatchingTopic(rec, positionByTopic);
    if (!matchedTopic) continue;

    const bp = positionByTopic.get(matchedTopic);
    if (!bp) continue;

    const parts: string[] = [];
    const mentionPct = Math.round(bp.mention_rate * 100);

    // Only surface context when there's real signal — skip low-mention topics
    if (mentionPct === 0 && bp.brand_descriptors.length === 0) continue;

    // Mention rate — the core number
    if (mentionPct > 0) {
      parts.push(
        `Mentioned in ${mentionPct}% of ${bp.total_observations.toLocaleString()} AI answers for this topic`,
      );
    }

    // Position context — only when meaningful
    if (bp.avg_position_when_mentioned != null && bp.avg_position_when_mentioned <= 10) {
      parts.push(`typically listed #${bp.avg_position_when_mentioned}`);
    }

    // Competitive context — only top competitor with meaningful overlap
    const topCompetitor = bp.top_co_appearing_competitors[0];
    if (topCompetitor && topCompetitor.co_appearance_count >= 10) {
      parts.push(
        `most often alongside ${topCompetitor.domain}`,
      );
    }

    // Trend context from topic_platform_summary — only declining (actionable)
    const summaries = summaryByTopic.get(matchedTopic);
    if (summaries) {
      const declining = Object.entries(summaries).filter(
        ([, s]) => s.trend_direction === "down",
      );
      if (declining.length > 0) {
        parts.push(
          `declining on ${declining.map(([p]) => p).join(", ")}`,
        );
      }
    }

    // Recent brand losses — only when there are several (not single-day noise)
    if (lossTopics.has(matchedTopic)) {
      const topicLosses = recentLosses.filter(
        (s) => s.topic.toLowerCase() === matchedTopic,
      );
      if (topicLosses.length >= 3) {
        parts.push(
          `dropped from ${topicLosses.length} answers in last 14 days`,
        );
      }
    }

    // Only attach if we have at least the mention rate + one other signal
    if (parts.length >= 2) {
      rec.answerContext = parts.join(". ") + ".";
    }
  }
}

function findMatchingTopic(
  rec: BeaconRecommendation,
  topicMap: Map<string, unknown>,
): string | null {
  // Try matching the recommendation's text content against known topics
  const searchText = `${rec.headline} ${rec.rationale} ${rec.sourceEvidence}`.toLowerCase();

  let bestMatch: string | null = null;
  let bestLength = 0;

  for (const topic of topicMap.keys()) {
    // Check if the topic name (or substantial part) appears in the rec text
    const topicWords = topic.split(/\s+/).filter((w) => w.length > 3);
    const matchingWords = topicWords.filter((w) => searchText.includes(w));
    if (matchingWords.length >= Math.max(1, topicWords.length * 0.5)) {
      if (topic.length > bestLength) {
        bestMatch = topic;
        bestLength = topic.length;
      }
    }
  }

  return bestMatch;
}

function daysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 86_400_000,
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "AI Overviews",
  perplexity: "Perplexity",
};
