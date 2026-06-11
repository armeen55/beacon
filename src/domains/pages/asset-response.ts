/**
 * Source-to-Asset Response Engine.
 *
 * Translates external source pressure into the correct owned asset response.
 * Sits above frontiers and attack packages — improves their recommendations
 * with explicit asset-type mapping grounded in competitive evidence.
 */

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { FrontierCompetitiveSummary, SourceType, ResponseType } from "./competitor-evidence";
import type { FrontierOpportunity } from "./frontier-planner";
import { getSiteConfig } from "@/lib/site-config";

// ── Types ──

export type RecommendedAssetType =
  | "city_page"
  | "service_page"
  | "comparison_page"
  | "guide_article"
  | "entity_profile_strengthening"
  | "directory_profile_strengthening"
  | "roundup_outreach_target"
  | "internal_link_support_package"
  | "structural_refresh_existing_page";

export type ConfidenceLabel = "strong_fit" | "probable_fit" | "weak_fit" | "mixed";

export type AssetResponse = {
  assetResponseId: string;
  frontierKey: string;
  topic: string;
  createdAt: string;
  dominantSourceType: SourceType;
  responseType: ResponseType;
  recommendedAssetType: RecommendedAssetType;
  confidenceLabel: ConfidenceLabel;
  rationale: string;
  ownedEquivalentExists: boolean;
  ownedEquivalentPages: string[];
  missingAssetSignals: string[];
  supportingSourcePatterns: string[];
  linkedFrontierOpportunityId: string | null;
  linkedAttackPackageId: string | null;
  notes: string | null;
};

// Night-shift cache sweep (2026-06-11): this was a process-global
// mutable cache keyed by NOTHING — in a warm multi-tenant process the
// first tenant pinned its rows for every later tenant (the same class
// fixed across 7 other stores tonight). Per-tenant Map now; the
// underlying read stays ambient-routed (per-tenant on disk), so the
// cache key was the leak. Stable per-tenant array refs preserve the
// in-place mutator semantics.
const _byTenant = new Map<string, AssetResponse[]>();

const ensureLoaded = cache(async (): Promise<AssetResponse[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getAssetResponses();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getAssetResponses = cache(async (): Promise<AssetResponse[]> => {
  return ensureLoaded();
});

export async function persistAssetResponses(): Promise<void> {
  await writeStore("asset-responses", await getAssetResponses());
}

export async function getAssetResponse(topic: string): Promise<AssetResponse | null> {
  const assetResponses = await getAssetResponses();
  return assetResponses.find((a) => a.topic === topic) ?? null;
}

export async function getAssetResponsesMap(): Promise<Map<string, AssetResponse>> {
  const assetResponses = await getAssetResponses();
  return new Map(assetResponses.map((a) => [a.topic, a]));
}

export async function persistComputedAssetResponses(responses: AssetResponse[]): Promise<void> {
  const assetResponses = await getAssetResponses();
  assetResponses.length = 0;
  assetResponses.push(...responses);
  await persistAssetResponses();
}

export function _resetAssetResponsesForTests(): void {
  _byTenant.clear();
}

// ── Mapping Logic ──

type MappingInput = {
  competitive: FrontierCompetitiveSummary;
  frontier: FrontierOpportunity;
  hasOwnedCityPage: boolean;
  hasOwnedServicePage: boolean;
  ownedPageCount: number;
  ownedPagesWithFaq: number;
};

const SOURCE_TO_ASSET: Record<SourceType, { primary: RecommendedAssetType; secondary: RecommendedAssetType | null; confidence: ConfidenceLabel }> = {
  competitor_city_page:   { primary: "city_page",                      secondary: "structural_refresh_existing_page", confidence: "strong_fit" },
  competitor_service_page:{ primary: "service_page",                   secondary: "structural_refresh_existing_page", confidence: "strong_fit" },
  editorial_roundup:      { primary: "roundup_outreach_target",        secondary: "comparison_page",                  confidence: "probable_fit" },
  guide_article:          { primary: "guide_article",                  secondary: "comparison_page",                  confidence: "probable_fit" },
  comparison_article:     { primary: "comparison_page",                secondary: null,                               confidence: "probable_fit" },
  directory:              { primary: "directory_profile_strengthening", secondary: null,                               confidence: "strong_fit" },
  review_platform:        { primary: "entity_profile_strengthening",   secondary: "directory_profile_strengthening",   confidence: "strong_fit" },
  entity_profile:         { primary: "entity_profile_strengthening",   secondary: null,                               confidence: "probable_fit" },
  forum:                  { primary: "guide_article",                  secondary: "comparison_page",                  confidence: "weak_fit" },
  other:                  { primary: "structural_refresh_existing_page",secondary: null,                               confidence: "weak_fit" },
};

export function computeAssetResponse(input: MappingInput): AssetResponse {
  const { competitive, frontier, hasOwnedCityPage, hasOwnedServicePage, ownedPageCount, ownedPagesWithFaq } = input;
  const now = new Date().toISOString();
  const dominant = competitive.dominantSourceType;
  const mapping = SOURCE_TO_ASSET[dominant];
  const brand = getSiteConfig().ownedBrandShort;
  const hasNoCity = brand === "You" ? "You have" : `${brand} has`;
  const hasCity = brand === "You" ? "you already have" : `${brand} already has`;
  const hasNoSvc = brand === "You" ? "You have" : `${brand} has`;
  const hasSvc = brand === "You" ? "you already have one" : `${brand} already has one`;
  const decentCov = brand === "You" ? "You have" : `${brand} has`;
  const thinCov = brand === "You" ? "you have" : `${brand} has`;
  const brandForCompare = brand === "You" ? "your brand" : brand;

  let recommendedAssetType: RecommendedAssetType;
  let confidenceLabel: ConfidenceLabel;
  let rationale: string;
  const missingAssetSignals: string[] = [];

  if (dominant === "competitor_city_page") {
    if (!hasOwnedCityPage) {
      recommendedAssetType = "city_page";
      confidenceLabel = "strong_fit";
      rationale = `Competitor city pages dominate (${competitive.sourcePatterns.find(s => s.sourceType === dominant)?.citationShare ?? 0}% of external citations). ${hasNoCity} no equivalent city page. Creating one is the direct parity response.`;
      missingAssetSignals.push("No owned city page exists for this topic");
    } else {
      recommendedAssetType = "structural_refresh_existing_page";
      confidenceLabel = "strong_fit";
      rationale = `Competitor city pages dominate but ${hasCity} a city page. Structural refresh (FAQ + schema) is the catch-up response.`;
    }
  } else if (dominant === "competitor_service_page") {
    if (!hasOwnedServicePage) {
      recommendedAssetType = "service_page";
      confidenceLabel = "strong_fit";
      rationale = `Competitor service pages lead. ${hasNoSvc} no equivalent. Create a dedicated service page.`;
      missingAssetSignals.push("No owned service page for this topic");
    } else {
      recommendedAssetType = "structural_refresh_existing_page";
      confidenceLabel = "strong_fit";
      rationale = `Competitor service pages lead but ${hasSvc}. Refresh structure to match competitor quality.`;
    }
  } else if (dominant === "editorial_roundup" || dominant === "guide_article") {
    if (ownedPageCount >= 3 && ownedPagesWithFaq >= 2) {
      recommendedAssetType = "roundup_outreach_target";
      confidenceLabel = "probable_fit";
      rationale = `Editorial roundups/guides dominate. ${decentCov} decent page coverage — pursue listing in existing roundups and create supporting comparison content.`;
    } else {
      recommendedAssetType = "guide_article";
      confidenceLabel = "probable_fit";
      rationale = `Editorial content dominates and ${thinCov} thin coverage. Build guide-style content first, then pursue roundup listings.`;
      missingAssetSignals.push("Owned coverage is too thin to pursue outreach effectively");
    }
  } else if (dominant === "directory") {
    recommendedAssetType = "directory_profile_strengthening";
    confidenceLabel = "strong_fit";
    rationale = `Directory listings (Houzz, Yelp, Angi) dominate. Strengthen directory profiles with complete descriptions, photos, and service areas.`;
  } else if (dominant === "review_platform" || dominant === "entity_profile") {
    recommendedAssetType = "entity_profile_strengthening";
    confidenceLabel = "probable_fit";
    rationale = `Entity/review profiles dominate. Build entity authority through reviews, structured data, and consistent NAP across platforms.`;
  } else if (dominant === "comparison_article") {
    recommendedAssetType = "comparison_page";
    confidenceLabel = "probable_fit";
    rationale = `Comparison content is dominant. Create owned comparison pages that position ${brandForCompare} against competitors.`;
    missingAssetSignals.push("No owned comparison content exists");
  } else {
    // Mixed / forum / other
    const sourceTypes = competitive.sourcePatterns.filter(s => s.citationShare >= 15);
    if (sourceTypes.length >= 3) {
      recommendedAssetType = mapping.primary;
      confidenceLabel = "mixed";
      rationale = `Mixed source environment — ${sourceTypes.map(s => `${s.sourceType.replace(/_/g, " ")} (${s.citationShare}%)`).join(", ")}. No single dominant asset type. Focus on structural improvements across existing pages.`;
    } else {
      recommendedAssetType = mapping.primary;
      confidenceLabel = mapping.confidence;
      rationale = `${dominant.replace(/_/g, " ")} sources lead. ${mapping.confidence === "weak_fit" ? "Evidence is limited — recommendation is directional only." : ""}`;
    }
  }

  const ownedEquivalentPages = frontier.linkedPages.filter(url => {
    if (recommendedAssetType === "city_page") return url.includes("/locations/");
    if (recommendedAssetType === "service_page") return url.includes("/services/");
    return false;
  });

  return {
    assetResponseId: `ar-${frontier.frontierKey.replace(/\s+/g, "-").toLowerCase().slice(0, 30)}`,
    frontierKey: frontier.frontierKey,
    topic: frontier.topic,
    createdAt: now,
    dominantSourceType: dominant,
    responseType: competitive.responseType,
    recommendedAssetType,
    confidenceLabel,
    rationale,
    ownedEquivalentExists: ownedEquivalentPages.length > 0,
    ownedEquivalentPages: ownedEquivalentPages.map(u => u.replace(/^https?:\/\/[^/]+/, "")),
    missingAssetSignals,
    supportingSourcePatterns: competitive.sourcePatterns.slice(0, 3).map(s => `${s.sourceType.replace(/_/g, " ")} (${s.citationShare}%)`),
    linkedFrontierOpportunityId: frontier.frontierOpportunityId,
    linkedAttackPackageId: null,
    notes: confidenceLabel === "weak_fit" ? "Evidence is limited — recommendation is directional, not definitive" : null,
  };
}

export function computeAllAssetResponses(
  competitiveEvidence: Map<string, FrontierCompetitiveSummary>,
  frontiers: FrontierOpportunity[]
): AssetResponse[] {
  const responses: AssetResponse[] = [];

  for (const frontier of frontiers) {
    const ce = competitiveEvidence.get(frontier.topic);
    if (!ce) continue;

    const hasOwnedCityPage = frontier.linkedPages.some(u => u.includes("/locations/"));
    const hasOwnedServicePage = frontier.linkedPages.some(u => u.includes("/services/"));

    responses.push(computeAssetResponse({
      competitive: ce,
      frontier,
      hasOwnedCityPage,
      hasOwnedServicePage,
      ownedPageCount: frontier.ownedPageCount,
      ownedPagesWithFaq: frontier.ownedPagesWithFaq,
    }));
  }

  return responses.sort((a, b) => {
    const confRank: Record<ConfidenceLabel, number> = { strong_fit: 0, probable_fit: 1, weak_fit: 2, mixed: 3 };
    return confRank[a.confidenceLabel] - confRank[b.confidenceLabel];
  });
}

// ── Display config ──

export const ASSET_TYPE_LABELS: Record<RecommendedAssetType, string> = {
  city_page: "Create city page",
  service_page: "Create service page",
  comparison_page: "Create comparison page",
  guide_article: "Create guide article",
  entity_profile_strengthening: "Strengthen entity profiles",
  directory_profile_strengthening: "Strengthen directory profiles",
  roundup_outreach_target: "Pursue roundup listings",
  internal_link_support_package: "Internal link package",
  structural_refresh_existing_page: "Refresh existing page",
};

export const CONFIDENCE_LABELS: Record<ConfidenceLabel, { label: string; color: string }> = {
  strong_fit: { label: "Strong fit", color: "text-status-success" },
  probable_fit: { label: "Probable fit", color: "text-accent-primary" },
  weak_fit: { label: "Weak fit", color: "text-muted-foreground" },
  mixed: { label: "Mixed", color: "text-status-warning" },
};
