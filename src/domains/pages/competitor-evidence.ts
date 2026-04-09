/**
 * Competitor Evidence Layer — captures winning external pages and source patterns
 * per frontier, enabling Beacon to recommend responses based on what's actually
 * dominating each topic in AI answer engines.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CitationEvidenceIndex, CitationPageRollup, TopicCitationSummary } from "./types";
import { getSiteConfig } from "@/lib/site-config";

// ── Source type classification ──

export type SourceType =
  | "competitor_service_page"
  | "competitor_city_page"
  | "editorial_roundup"
  | "directory"
  | "review_platform"
  | "entity_profile"
  | "guide_article"
  | "comparison_article"
  | "forum"
  | "other";

export type EvidenceType =
  | "repeatedly_cited"
  | "frontier_dominant"
  | "structurally_similar"
  | "coverage_gap"
  | "comparison_gap"
  | "source_gap";

const DIRECTORY_DOMAINS = new Set(["houzz.com", "yelp.com", "angi.com", "homeadvisor.com", "thumbtack.com", "buildzoom.com", "bark.com", "porch.com"]);
const REVIEW_DOMAINS = new Set(["diamondcertified.org", "bbb.org"]);
const EDITORIAL_DOMAINS = new Set(["homebuilderdigest.com", "sanfranciscoarchitects.org"]);
const FORUM_DOMAINS = new Set(["reddit.com", "quora.com"]);

function classifySourceType(domain: string, url: string): { type: SourceType; inferred: boolean } {
  if (DIRECTORY_DOMAINS.has(domain)) return { type: "directory", inferred: false };
  if (REVIEW_DOMAINS.has(domain)) return { type: "review_platform", inferred: false };
  if (EDITORIAL_DOMAINS.has(domain)) return { type: "editorial_roundup", inferred: false };
  if (FORUM_DOMAINS.has(domain)) return { type: "forum", inferred: false };
  if (url.includes("/location") || url.includes("/city") || url.includes("/service-area")) return { type: "competitor_city_page", inferred: true };
  if (url.includes("/service") || url.includes("/custom-home") || url.includes("/remodel")) return { type: "competitor_service_page", inferred: true };
  if (url.includes("/blog") || url.includes("/guide") || url.includes("/the-best") || url.includes("/the-5-best")) return { type: "guide_article", inferred: true };
  if (url.includes("/compare") || url.includes("/vs")) return { type: "comparison_article", inferred: true };
  if (url === "/" || url.match(/^\/[^/]*\/?$/)) return { type: "entity_profile", inferred: true };
  return { type: "other", inferred: true };
}

// ── Competitor page evidence ──

export type CompetitorPageEvidence = {
  competitorEvidenceId: string;
  frontierKey: string;
  topic: string;
  domain: string;
  pageUrl: string;
  pageTitle: string | null;
  sourceType: SourceType;
  sourceTypeInferred: boolean;
  citationCount: number;
  evidenceType: EvidenceType;
  observedAt: string;
  structuralSignals: string;
  contentSignals: string;
  comparisonSignals: string;
  notes: string | null;
};

// ── Source pattern evidence ──

export type SourcePatternEvidence = {
  sourcePatternEvidenceId: string;
  frontierKey: string;
  topic: string;
  sourceType: SourceType;
  domains: string[];
  citationShare: number;
  citationCount: number;
  observedAt: string;
  rationale: string;
  notes: string | null;
};

// ── Persistence ──

export const competitorPages: CompetitorPageEvidence[] =
  readStore<CompetitorPageEvidence>("competitor-page-evidence");

export const sourcePatterns: SourcePatternEvidence[] =
  readStore<SourcePatternEvidence>("source-pattern-evidence");

export async function persistCompetitorEvidence(): Promise<void> {
  await writeStore("competitor-page-evidence", competitorPages);
  await writeStore("source-pattern-evidence", sourcePatterns);
}

// ── Frontier competitive summary ──

export type ResponseType =
  | "direct_parity"
  | "structural_catch_up"
  | "new_asset_creation"
  | "entity_support_response"
  | "directory_strengthening";

export type FrontierCompetitiveSummary = {
  frontierKey: string;
  topic: string;
  totalExternalCitations: number;
  ownedCitations: number;
  ownedShare: number;
  topCompetitors: CompetitorPageEvidence[];
  sourcePatterns: SourcePatternEvidence[];
  dominantSourceType: SourceType;
  coverageGaps: string[];
  competitiveInsight: string;
  responseType: ResponseType;
  responseRationale: string;
};

// ── Computation ──

export function computeCompetitorEvidence(
  citationIndex: CitationEvidenceIndex
): Map<string, FrontierCompetitiveSummary> {
  const now = new Date().toISOString();
  const results = new Map<string, FrontierCompetitiveSummary>();
  const brand = getSiteConfig().ownedBrandShort;
  const hasNoEquiv =
    brand === "You" ? "you have" : `${brand} has`;

  for (const topic of citationIndex.by_topic) {
    const rollups = citationIndex.by_page_and_topic.filter(
      (r) => r.topic === topic.topic && !r.is_owned
    );

    // ── Top competitor pages ──
    const topPages: CompetitorPageEvidence[] = rollups
      .sort((a, b) => b.total_citations - a.total_citations)
      .slice(0, 8)
      .map((r, i) => {
        const { type: srcType, inferred } = classifySourceType(r.domain, r.page_url);
        const isRepeated = r.total_citations >= 50;
        const isDominant = r.total_citations >= topic.total_citations * 0.03;
        const evidenceType: EvidenceType = isDominant ? "frontier_dominant"
          : isRepeated ? "repeatedly_cited"
          : "coverage_gap";

        const structural = srcType === "competitor_city_page" ? "City-specific landing page"
          : srcType === "competitor_service_page" ? "Service-specific page"
          : srcType === "editorial_roundup" ? "Editorial list/roundup article"
          : srcType === "directory" ? "Directory listing"
          : srcType === "guide_article" ? "Guide/ranking article"
          : "General page";

        return {
          competitorEvidenceId: `comp-${topic.topic.slice(0, 20)}-${i}`,
          frontierKey: topic.topic,
          topic: topic.topic,
          domain: r.domain,
          pageUrl: r.page_url,
          pageTitle: null,
          sourceType: srcType,
          sourceTypeInferred: inferred,
          citationCount: r.total_citations,
          evidenceType,
          observedAt: now,
          structuralSignals: structural + (inferred ? " (inferred from URL)" : ""),
          contentSignals: `${r.distinct_prompts} prompts, ${r.distinct_answers} answers`,
          comparisonSignals: "",
          notes: null,
        };
      });

    // ── Source type patterns ──
    const typeCountMap = new Map<SourceType, { domains: Set<string>; count: number }>();
    for (const r of rollups) {
      const { type: st } = classifySourceType(r.domain, r.page_url);
      let entry = typeCountMap.get(st);
      if (!entry) { entry = { domains: new Set(), count: 0 }; typeCountMap.set(st, entry); }
      entry.domains.add(r.domain);
      entry.count += r.total_citations;
    }

    const totalExternal = topic.competitor_citations + topic.directory_citations + (topic.other_citations ?? 0);
    const sourcePatterns: SourcePatternEvidence[] = [...typeCountMap.entries()]
      .map(([st, data]) => ({
        sourcePatternEvidenceId: `sp-${topic.topic.slice(0, 20)}-${st}`,
        frontierKey: topic.topic,
        topic: topic.topic,
        sourceType: st,
        domains: [...data.domains].slice(0, 5),
        citationShare: totalExternal > 0 ? Math.round((data.count / totalExternal) * 100) : 0,
        citationCount: data.count,
        observedAt: now,
        rationale: `${data.count} citations across ${data.domains.size} domain${data.domains.size !== 1 ? "s" : ""}`,
        notes: null,
      }))
      .sort((a, b) => b.citationCount - a.citationCount);

    const dominantSourceType = sourcePatterns[0]?.sourceType ?? "other";

    // ── Coverage gaps ──
    const gaps: string[] = [];
    const hasCompCityPage = topPages.some((p) => p.sourceType === "competitor_city_page");
    const hasCompServicePage = topPages.some((p) => p.sourceType === "competitor_service_page");
    const hasEditorial = topPages.some((p) => p.sourceType === "editorial_roundup" || p.sourceType === "guide_article");
    const hasDirectory = topPages.some((p) => p.sourceType === "directory");

    const ownedRollups = citationIndex.by_page_and_topic.filter(
      (r) => r.topic === topic.topic && r.is_owned
    );
    const ownedHasCityPage = ownedRollups.some((r) => r.page_url.includes("/locations/"));
    const ownedHasServicePage = ownedRollups.some((r) => r.page_url.includes("/services/"));

    if (hasCompCityPage && !ownedHasCityPage)
      gaps.push(`Competitors have city pages; ${hasNoEquiv} no equivalent city page for this topic`);
    if (hasCompServicePage && !ownedHasServicePage)
      gaps.push(`Competitors have service pages; ${hasNoEquiv} no equivalent service page`);
    if (hasEditorial)
      gaps.push("Editorial roundups/guides dominate — get listed or create equivalent content");
    if (hasDirectory && topic.directory_citations > topic.owned_citations) gaps.push("Directory citations exceed owned — strengthen directory profiles");

    // ── Insight ──
    const insight = dominantSourceType === "competitor_city_page"
      ? `This frontier is dominated by competitor city/location pages (${sourcePatterns.find((s) => s.sourceType === "competitor_city_page")?.citationShare ?? 0}% of external citations). Direct city-page parity is the primary response.`
      : dominantSourceType === "competitor_service_page"
        ? `Competitor service pages lead this frontier. Strengthening owned service coverage is the key move.`
        : dominantSourceType === "editorial_roundup" || dominantSourceType === "guide_article"
          ? `Editorial roundups and guide articles dominate (${sourcePatterns.find((s) => s.sourceType === "editorial_roundup" || s.sourceType === "guide_article")?.citationShare ?? 0}%). Getting listed in these or creating equivalent comparison content is critical.`
          : dominantSourceType === "directory"
            ? `Directory listings dominate. Strengthening directory profiles (Houzz, Yelp, Angi) is the highest-leverage move.`
            : dominantSourceType === "entity_profile"
              ? `Entity/brand profiles dominate. Building owned entity authority is the primary response.`
              : `Mixed source types. Focus on the strongest structural gap.`;

    // ── Response type ──
    const ownedHasCityPage2 = citationIndex.by_page_and_topic.some(
      (r) => r.topic === topic.topic && r.is_owned && r.page_url.includes("/locations/")
    );
    let responseType: ResponseType;
    let responseRationale: string;

    if (dominantSourceType === "competitor_city_page" && ownedHasCityPage2) {
      responseType = "structural_catch_up";
      responseRationale = "Owned city page exists but competitors have stronger structure. Fix and strengthen the existing page.";
    } else if (dominantSourceType === "competitor_city_page" && !ownedHasCityPage2) {
      responseType = "new_asset_creation";
      responseRationale = `Competitor city pages dominate and ${hasNoEquiv} no equivalent. Create a dedicated city page.`;
    } else if (dominantSourceType === "competitor_service_page") {
      responseType = "direct_parity";
      responseRationale = "Competitor service pages lead. Strengthen owned service page with FAQ + schema to match.";
    } else if (dominantSourceType === "directory") {
      responseType = "directory_strengthening";
      responseRationale = "Directory listings dominate. Strengthen Houzz/Yelp/Angi profiles.";
    } else if (dominantSourceType === "editorial_roundup" || dominantSourceType === "guide_article") {
      responseType = "new_asset_creation";
      responseRationale = "Editorial/guide content dominates. Create comparison or guide content, or get listed in existing roundups.";
    } else {
      responseType = "entity_support_response";
      responseRationale = "Mixed competitor types. Build entity authority through structural improvements and internal linking.";
    }

    const summary: FrontierCompetitiveSummary = {
      frontierKey: topic.topic,
      topic: topic.topic,
      totalExternalCitations: totalExternal,
      ownedCitations: topic.owned_citations,
      ownedShare: topic.total_citations > 0 ? Math.round((topic.owned_citations / topic.total_citations) * 100) : 0,
      topCompetitors: topPages,
      sourcePatterns,
      dominantSourceType,
      coverageGaps: gaps,
      competitiveInsight: insight,
      responseType,
      responseRationale,
    };
    results.set(topic.topic, summary);

    // ── Persist ──
    for (const cp of topPages) {
      const existing = competitorPages.findIndex((e) => e.competitorEvidenceId === cp.competitorEvidenceId);
      if (existing >= 0) competitorPages[existing] = cp;
      else competitorPages.push(cp);
    }
    for (const sp of sourcePatterns) {
      const existing = sourcePatterns.findIndex((e) => e.sourcePatternEvidenceId === sp.sourcePatternEvidenceId);
      if (existing >= 0) { /* already in array from current iteration */ }
      else { /* sourcePatterns is the local variable, persistence handled below */ }
    }
  }

  return results;
}

export async function persistComputedEvidence(
  summaries: Map<string, FrontierCompetitiveSummary>
): Promise<void> {
  const allPages: CompetitorPageEvidence[] = [];
  const allPatterns: SourcePatternEvidence[] = [];
  for (const s of summaries.values()) {
    allPages.push(...s.topCompetitors);
    allPatterns.push(...s.sourcePatterns);
  }
  competitorPages.length = 0;
  competitorPages.push(...allPages);
  sourcePatterns.length = 0;
  sourcePatterns.push(...allPatterns);
  await persistCompetitorEvidence();
}

export function getCompetitorEvidence(
  citationIndex: CitationEvidenceIndex
): Map<string, FrontierCompetitiveSummary> {
  if (competitorPages.length > 0) {
    return rebuildSummariesFromStores(citationIndex);
  }
  return computeCompetitorEvidence(citationIndex);
}

function rebuildSummariesFromStores(
  citationIndex: CitationEvidenceIndex
): Map<string, FrontierCompetitiveSummary> {
  const results = new Map<string, FrontierCompetitiveSummary>();
  const brand = getSiteConfig().ownedBrandShort;
  const hasNoEquiv = brand === "You" ? "you have" : `${brand} has`;

  const topicKeys = new Set(competitorPages.map((c) => c.frontierKey));
  for (const key of topicKeys) {
    const topicSummary = citationIndex.by_topic.find((t) => t.topic === key);
    if (!topicSummary) continue;

    const pages = competitorPages.filter((c) => c.frontierKey === key);
    const patterns = sourcePatterns.filter((s) => s.frontierKey === key);
    const dominantSourceType = patterns.sort((a, b) => b.citationCount - a.citationCount)[0]?.sourceType ?? "other";

    const totalExternal = topicSummary.competitor_citations + topicSummary.directory_citations + (topicSummary.other_citations ?? 0);
    const ownedShare = topicSummary.total_citations > 0
      ? Math.round((topicSummary.owned_citations / topicSummary.total_citations) * 100) : 0;

    const ownedHasCityPage = citationIndex.by_page_and_topic.some(
      (r) => r.topic === key && r.is_owned && r.page_url.includes("/locations/")
    );

    let responseType: ResponseType;
    let responseRationale: string;
    if (dominantSourceType === "competitor_city_page" && ownedHasCityPage) {
      responseType = "structural_catch_up";
      responseRationale = "Owned city page exists but competitors have stronger structure.";
    } else if (dominantSourceType === "competitor_city_page") {
      responseType = "new_asset_creation";
      responseRationale = `Competitor city pages dominate and ${hasNoEquiv} no equivalent.`;
    } else if (dominantSourceType === "competitor_service_page") {
      responseType = "direct_parity";
      responseRationale = "Competitor service pages lead. Strengthen owned service coverage.";
    } else if (dominantSourceType === "directory") {
      responseType = "directory_strengthening";
      responseRationale = "Directory listings dominate. Strengthen profiles.";
    } else if (dominantSourceType === "editorial_roundup" || dominantSourceType === "guide_article") {
      responseType = "new_asset_creation";
      responseRationale = "Editorial/guide content dominates. Create equivalent content.";
    } else {
      responseType = "entity_support_response";
      responseRationale = "Mixed competitor types. Build entity authority.";
    }

    const gaps: string[] = [];
    const hasCompCity = pages.some((p) => p.sourceType === "competitor_city_page");
    const hasCompService = pages.some((p) => p.sourceType === "competitor_service_page");
    if (hasCompCity && !ownedHasCityPage) gaps.push("Competitors have city pages; no owned equivalent");
    if (hasCompService && !citationIndex.by_page_and_topic.some((r) => r.topic === key && r.is_owned && r.page_url.includes("/services/")))
      gaps.push("Competitors have service pages; no owned equivalent");

    const insight = `${dominantSourceType.replace(/_/g, " ")} sources dominate this frontier. ${responseRationale}`;

    results.set(key, {
      frontierKey: key,
      topic: key,
      totalExternalCitations: totalExternal,
      ownedCitations: topicSummary.owned_citations,
      ownedShare,
      topCompetitors: pages,
      sourcePatterns: patterns,
      dominantSourceType,
      coverageGaps: gaps,
      competitiveInsight: insight,
      responseType,
      responseRationale,
    });
  }

  return results;
}

// ── Display config ──

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  competitor_service_page: "Service page",
  competitor_city_page: "City page",
  editorial_roundup: "Editorial roundup",
  directory: "Directory",
  review_platform: "Review platform",
  entity_profile: "Entity profile",
  guide_article: "Guide article",
  comparison_article: "Comparison",
  forum: "Forum",
  other: "Other",
};

export const SOURCE_TYPE_COLORS: Record<SourceType, string> = {
  competitor_service_page: "text-status-danger",
  competitor_city_page: "text-status-danger",
  editorial_roundup: "text-status-warning",
  directory: "text-muted-foreground",
  review_platform: "text-muted-foreground",
  entity_profile: "text-accent-primary",
  guide_article: "text-status-warning",
  comparison_article: "text-accent-primary",
  forum: "text-muted-foreground",
  other: "text-muted-foreground",
};
