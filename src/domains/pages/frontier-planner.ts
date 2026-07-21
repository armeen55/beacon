/**
 * Frontier Planner — computes the next best visibility fronts to attack.
 *
 * Analyzes owned coverage vs competitor pressure per topic,
 * identifies structural/citation gaps, and recommends move types.
 */

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";

import { getRepository } from "@/lib/persistence/repositories";

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

