/**
 * Frontier Planner — computes the next best visibility fronts to attack.
 *
 * Analyzes owned coverage vs competitor pressure per topic,
 * identifies structural/citation gaps, and recommends move types.
 */

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { CitationEvidenceIndex } from "./types";
import type { PageSnapshot } from "./types";
import type { PlaybookBrief, MinedPattern } from "./playbook";
import type { RolloutWave } from "./wave-planner";
import type { FrontierCompetitiveSummary } from "./competitor-evidence";
import type { AssetResponse } from "./asset-response";
import { getSiteConfig } from "@/lib/site-config";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";

// ── Types ──

export type FrontierType =
  | "topic_frontier"
  | "city_frontier"
  | "service_frontier"
  | "page_gap_frontier"
  | "competitor_pressure_frontier";

export type RecommendedMoveType =
  | "repair_existing_pages"
  | "roll_out_validated_pattern"
  | "create_missing_page"
  | "expand_internal_link_cluster"
  | "strengthen_entity_support"
  | "comparison_content_play";

export type FrontierStatus = "opportunity" | "attacking" | "watching" | "dismissed";

export type FrontierOpportunity = {
  frontierOpportunityId: string;
  frontierKey: string;
  frontierType: FrontierType;
  title: string;
  createdAt: string;
  status: FrontierStatus;
  topic: string;
  geography: string | null;
  service: string | null;
  ownedCoverageSummary: string;
  competitorPressureSummary: string;
  citationOpportunity: number;
  ownedShare: number;
  ownedPageCount: number;
  ownedPagesWithFaq: number;
  competitorCitations: number;
  structuralOpportunity: number;
  recommendedMoveType: RecommendedMoveType;
  linkedPages: string[];
  linkedBriefIds: string[];
  linkedWaveIds: string[];
  rationale: string;
  priorityScore: number;
  notes: string | null;
};

// Night-shift cache sweep (2026-06-11): this was a process-global
// mutable cache keyed by NOTHING — in a warm multi-tenant process the
// first tenant pinned its rows for every later tenant (the same class
// fixed across 7 other stores tonight). Per-tenant Map now; the
// underlying read stays ambient-routed (per-tenant on disk), so the
// cache key was the leak. Stable per-tenant array refs preserve the
// in-place mutator semantics.
const _byTenant = new Map<string, FrontierOpportunity[]>();

const ensureLoaded = cache(async (): Promise<FrontierOpportunity[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getFrontierOpportunities();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getFrontierOpportunities = cache(
  async (): Promise<FrontierOpportunity[]> => {
    return ensureLoaded();
  },
);

export async function persistFrontierOpportunities(): Promise<void> {
  await writeStore("frontier-opportunities", await getFrontierOpportunities());
}

export function _resetFrontierOpportunitiesForTests(): void {
  _byTenant.clear();
}

// ── Frontier Computation ──

/** Resolve the current tenant's frontier vocab (cities + services) from
 *  BusinessConfig, for `computeFrontiers`' city/service classification.
 *  Fail-soft to empty (→ topic_frontier classification). De-verticalized
 *  (2026-06-15): callers pass this so frontier classification is per-tenant,
 *  not a hardcoded Bay-Area + builder regex. */
export async function getCurrentTenantFrontierVocab(): Promise<{
  cities: string[];
  services: string[];
}> {
  try {
    const cfg = await getBusinessConfigForCurrentTenant();
    return { cities: cfg.locations ?? [], services: cfg.services ?? [] };
  } catch {
    return { cities: [], services: [] };
  }
}

export function computeFrontiers(
  citationIndex: CitationEvidenceIndex,
  snapshots: PageSnapshot[],
  briefs: PlaybookBrief[],
  waves: RolloutWave[],
  patterns: MinedPattern[],
  competitiveEvidence?: Map<string, FrontierCompetitiveSummary>,
  assetResponses?: Map<string, AssetResponse>,
  /** De-verticalized (2026-06-15): the tenant's OWN city + service vocabulary
   *  (BusinessConfig.locations / .services) for classifying a topic as a
   *  city_frontier / service_frontier — replaces a hardcoded Bay-Area + builder
   *  regex. Omit/empty → no city/service classification (topic_frontier), the
   *  correct neutral default for a tenant with no geo/service vocabulary. */
  vocab?: { cities?: readonly string[]; services?: readonly string[] },
): FrontierOpportunity[] {
  const now = new Date().toISOString();
  const results: FrontierOpportunity[] = [];

  const snapByUrl = new Map<string, PageSnapshot>();
  for (const s of snapshots) snapByUrl.set(s.url.replace(/\/+$/, "").toLowerCase(), s);

  const briefsByTopic = new Map<string, PlaybookBrief[]>();
  for (const b of briefs) {
    const snap = snapByUrl.get(b.pageUrl.replace(/\/+$/, "").toLowerCase());
    if (!snap) continue;
    for (const [url, topics] of Object.entries(citationIndex.page_to_topics)) {
      if (url.replace(/\/+$/, "").toLowerCase() === b.pageUrl.replace(/\/+$/, "").toLowerCase()) {
        for (const t of topics) {
          if (!briefsByTopic.has(t)) briefsByTopic.set(t, []);
          briefsByTopic.get(t)!.push(b);
        }
      }
    }
  }

  const wavesByTopic = new Map<string, RolloutWave[]>();
  for (const w of waves) {
    for (const p of w.targetPages) {
      for (const [url, topics] of Object.entries(citationIndex.page_to_topics)) {
        if (url.replace(/\/+$/, "").toLowerCase() === p.replace(/\/+$/, "").toLowerCase()) {
          for (const t of topics) {
            if (!wavesByTopic.has(t)) wavesByTopic.set(t, []);
            wavesByTopic.get(t)!.push(w);
          }
        }
      }
    }
  }

  const ownedHost = getSiteConfig().siteDomain;
  for (const topic of citationIndex.by_topic) {
    const ownedPages = Object.entries(citationIndex.page_to_topics)
      .filter(([url, topics]) => url.includes(ownedHost) && topics.includes(topic.topic))
      .map(([url]) => url);

    const ownedWithFaq = ownedPages.filter((url) => {
      const snap = snapByUrl.get(url.replace(/\/+$/, "").toLowerCase());
      return snap && snap.faqs.length > 0;
    });

    const ownedShare = topic.total_citations > 0
      ? Math.round((topic.owned_citations / topic.total_citations) * 100)
      : 0;

    const structuralGap = ownedPages.length > 0
      ? 1 - (ownedWithFaq.length / ownedPages.length)
      : 1;

    // ── Classify frontier type ──
    let frontierType: FrontierType;
    let geography: string | null = null;
    let service: string | null = null;

    const topicLower = topic.topic.toLowerCase();
    // De-verticalized (2026-06-15): classify city/service frontier from the
    // tenant's OWN vocabulary (vocab.cities/services), longest-name-first so
    // multi-word terms win — NOT a hardcoded Bay-Area + builder regex. A tenant
    // with no geo/service vocab falls through to topic_frontier.
    const cityHit = (vocab?.cities ?? [])
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length >= 2)
      .sort((a, b) => b.length - a.length)
      .find((c) => topicLower.startsWith(c) || topicLower.includes(` ${c}`));
    const serviceHit = (vocab?.services ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 3)
      .sort((a, b) => b.length - a.length)
      .find((s) => topicLower.includes(s));

    if (cityHit) {
      frontierType = "city_frontier";
      geography = cityHit;
    } else if (serviceHit) {
      frontierType = "service_frontier";
      service = serviceHit;
    } else if (topic.competitor_citations > topic.owned_citations * 10) {
      frontierType = "competitor_pressure_frontier";
    } else {
      frontierType = "topic_frontier";
    }

    // ── Determine recommended move ──
    let recommendedMoveType: RecommendedMoveType;
    let rationale: string;

    const ce = competitiveEvidence?.get(topic.topic);
    const ar = assetResponses?.get(topic.topic);

    const assetContext = ar
      ? ` Best-fit response: ${ar.recommendedAssetType.replace(/_/g, " ")} (${ar.confidenceLabel.replace(/_/g, " ")}).`
      : ce
        ? ` Competitor pressure: ${ce.dominantSourceType.replace(/_/g, " ")} dominant (${ce.responseType.replace(/_/g, " ")}).`
        : "";

    if (ar && ar.confidenceLabel === "strong_fit") {
      const arMoveMap: Partial<Record<string, RecommendedMoveType>> = {
        city_page: "create_missing_page",
        service_page: "create_missing_page",
        structural_refresh_existing_page: "repair_existing_pages",
        directory_profile_strengthening: "strengthen_entity_support",
        entity_profile_strengthening: "strengthen_entity_support",
        comparison_page: "create_missing_page",
        guide_article: "create_missing_page",
      };
      recommendedMoveType = arMoveMap[ar.recommendedAssetType] ?? "strengthen_entity_support";
      rationale = ar.rationale + assetContext;
    } else if (structuralGap > 0.5 && ownedPages.length >= 3) {
      recommendedMoveType = "repair_existing_pages";
      rationale = `${ownedPages.length} owned pages but ${ownedWithFaq.length} have FAQ/schema. Fix structure before expanding.${assetContext}`;
    } else if (ownedPages.length <= 2 && topic.total_citations >= 4000) {
      recommendedMoveType = "create_missing_page";
      rationale = `Only ${ownedPages.length} owned page${ownedPages.length !== 1 ? "s" : ""} for a ${topic.total_citations}-citation topic.${ar ? ` ${ar.rationale}` : assetContext}`;
    } else if (patterns.some((p) => p.evidence.executionConfidence === "execution_validated")) {
      recommendedMoveType = "roll_out_validated_pattern";
      rationale = `Patterns with positive trends available. Roll out the same observed structure to remaining weak pages.${assetContext}`;
    } else if (ownedPages.length >= 5 && ownedWithFaq.length >= 3) {
      recommendedMoveType = "expand_internal_link_cluster";
      rationale = `Good page coverage with structure. Strengthen internal linking.${assetContext}`;
    } else {
      recommendedMoveType = "strengthen_entity_support";
      rationale = `Build entity coverage and structured data support.${assetContext}`;
    }

    // ── Compute priority ──
    const citPressure = Math.min(topic.competitor_citations / 100, 100);
    const shareWeakness = 100 - ownedShare;
    const structScore = structuralGap * 50;
    const linkedBriefs = briefsByTopic.get(topic.topic) ?? [];
    const linkedWaves = [...new Set((wavesByTopic.get(topic.topic) ?? []).map((w) => w.rolloutWaveId))];
    const readinessBoost = linkedBriefs.length > 0 ? 20 : 0;

    const priorityScore = Math.round(citPressure + shareWeakness + structScore + readinessBoost);

    const ownedCoverageSummary = `${ownedPages.length} pages, ${ownedWithFaq.length} with FAQ, ${ownedShare}% citation share`;
    const competitorPressureSummary = `${topic.competitor_citations} competitor citations, ${topic.directory_citations} directory`;

    results.push({
      frontierOpportunityId: `frontier-${topic.topic.replace(/\s+/g, "-").toLowerCase().slice(0, 40)}`,
      frontierKey: topic.topic,
      frontierType,
      title: topic.topic,
      createdAt: now,
      status: linkedWaves.length > 0 ? "attacking" : linkedBriefs.length > 0 ? "watching" : "opportunity",
      topic: topic.topic,
      geography,
      service,
      ownedCoverageSummary,
      competitorPressureSummary,
      citationOpportunity: topic.total_citations,
      ownedShare,
      ownedPageCount: ownedPages.length,
      ownedPagesWithFaq: ownedWithFaq.length,
      competitorCitations: topic.competitor_citations,
      structuralOpportunity: Math.round(structuralGap * 100),
      recommendedMoveType,
      linkedPages: ownedPages,
      linkedBriefIds: linkedBriefs.map((b) => b.id),
      linkedWaveIds: linkedWaves,
      rationale,
      priorityScore,
      notes: null,
    });
  }

  return results.sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── Display config ──

export const FRONTIER_TYPE_LABELS: Record<FrontierType, { label: string; color: string }> = {
  city_frontier: { label: "City", color: "text-accent-primary" },
  service_frontier: { label: "Service", color: "text-status-warning" },
  topic_frontier: { label: "Topic", color: "text-foreground" },
  page_gap_frontier: { label: "Gap", color: "text-status-danger" },
  competitor_pressure_frontier: { label: "Pressure", color: "text-status-danger" },
};

export const MOVE_TYPE_LABELS: Record<RecommendedMoveType, string> = {
  repair_existing_pages: "Repair existing pages",
  roll_out_validated_pattern: "Roll out validated pattern",
  create_missing_page: "Create missing page",
  expand_internal_link_cluster: "Expand link cluster",
  strengthen_entity_support: "Strengthen entity support",
  comparison_content_play: "Comparison content",
};
