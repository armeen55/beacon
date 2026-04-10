/**
 * Recommendation Engine — synthesizes proven impact into specific next moves.
 *
 * Connects attribution-backed change impact to structural page gaps,
 * producing ranked, evidence-grounded recommendations for the operator.
 */

import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { MinedPattern, PlaybookBrief } from "@/domains/pages/playbook";
import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";

export type RecommendationType =
  | "replicate"
  | "strengthen"
  | "investigate"
  | "strengthen_structure"
  | "improve_internal_links"
  | "refresh_content"
  | "competitive_displacement"
  | "cross_page_pattern"
  | "topic_cluster_gap";

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
}): BeaconRecommendation[] {
  const recs: BeaconRecommendation[] = [];

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
      rationale: `Proven: "${bestProven.change.asset_name}" (${bestProven.verdict}) drove visibility${topics ? ` for ${topics}` : ""}${platforms ? ` on ${platforms}` : ""}. This page has the same structural gap.`,
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

    recs.push({
      id: `rec-strengthen-${row.change.id}`,
      type: "strengthen",
      headline: `Improve changelog: "${row.change.asset_name}"`,
      rationale: `${row.totalEventsLinked} linked event${row.totalEventsLinked !== 1 ? "s" : ""} but ${row.evidenceTier} evidence (${gapStr}). Filling gaps could unlock auto-resolution.${suggestedTopic ? ` Suggested topic: "${suggestedTopic}".` : ""}`,
      sourceEvidence: `${row.evidenceTier} tier, ${gapStr}`,
      targetPageUrl: row.change.url,
      targetPagePath:
        row.change.url?.replace(/^https?:\/\/[^/]+/, "") ?? null,
      sourceChangeId: row.change.id,
      confidence: row.totalEventsLinked >= 2 ? "medium" : "low",
      priority:
        300 + row.totalEventsLinked * 50 + (suggestedTopic ? 100 : 0),
      patternId: null,
      citationOpportunity: 0,
    });
  }

  // ── Investigate: negative impact ──

  const negativeImpact = opts.impactRows.filter(
    (r) => r.impact.direction === "negative" && r.totalEventsLinked > 0,
  );

  for (const row of negativeImpact) {
    recs.push({
      id: `rec-investigate-${row.change.id}`,
      type: "investigate",
      headline: `Investigate: "${row.change.asset_name}"`,
      rationale: `Visibility declined after this change — ${row.totalEventsLinked} negative event${row.totalEventsLinked !== 1 ? "s" : ""}. Check for regression or external factors.`,
      sourceEvidence: `${row.totalEventsLinked} negative event${row.totalEventsLinked !== 1 ? "s" : ""}, ${row.topics.slice(0, 2).join(", ")}`,
      targetPageUrl: row.change.url,
      targetPagePath:
        row.change.url?.replace(/^https?:\/\/[^/]+/, "") ?? null,
      sourceChangeId: row.change.id,
      confidence: row.impact.confidence,
      priority: 800 + row.totalEventsLinked * 100,
      patternId: null,
      citationOpportunity: 0,
    });
  }

  // ── Strengthen structure: cited pages missing FAQ or schema ──

  if (opts.pageSnapshots && opts.citationCountMap) {
    const structureCandidates = opts.pageSnapshots
      .filter((snap) => {
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
        priority: 500 + (topic.competitor_citations - topic.owned_citations) * 2,
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
          headline: `Apply proven pattern to ${targetSnap.title ?? targetUrl.replace(/^https?:\/\/[^/]+/, "")}`,
          rationale: `"${row.change.asset_name}" (${row.verdict}) improved a ${sourceType.replace(/_/g, " ")}. This ${targetType.replace(/_/g, " ")} shares ${overlap} term${overlap !== 1 ? "s" : ""} and has ${targetGaps.join(" + ")} gaps.`,
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
        priority: 380 + topicSummary.owned_citations * 2,
        patternId: null,
        citationOpportunity: topicSummary.total_citations - topicSummary.owned_citations,
      });
    }
    recs.push(...clusterGapRecs);
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

  return recs.sort((a, b) => b.priority - a.priority);
}

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "AI Overviews",
  perplexity: "Perplexity",
};
