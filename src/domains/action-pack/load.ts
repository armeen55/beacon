/**
 * Unified ActionPack worklist loader (2026-06-26, Core Consolidation — Phase D).
 *
 * The ONE ranked worklist: adapts the demand-graph Moves (R&R + GSC/GA4/Clarity +
 * the Profound evidence already fused onto each Move) AND the durable
 * profound-coverage packs into the unified ActionPack, dedupes across sources,
 * and ranks. Read-only, react.cache, fail-soft. NO live Profound API on render
 * (coverage comes from the cached durable store).
 */
import "server-only";
import { cache } from "react";

import { log } from "@/lib/logger";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { loadCachedProfoundCoverageForTenant } from "@/domains/profound-coverage/load-cached";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

import { moveCandidateToActionPack, aeoActionPackToActionPack, dedupeActionPacks } from "./adapters";
import { actionFamily, type ActionPack, type EvidenceSource } from "./types";

export type ActionPackWorklist = {
  packs: ActionPack[];
  summary: {
    total: number;
    byFamily: { existing_page: number; new_page: number; hub: number; links: number; cro: number };
    /** How many packs each evidence source backs (source coverage). */
    sourceCoverage: Record<EvidenceSource, number>;
    fromRankRevenue: number;
    fromProfoundCoverage: number;
    duplicatesRemoved: number;
    /** Raw pre-dedupe pack count from each source (the "old moves" that collapse). */
    rawFromRankRevenue: number;
    rawFromProfoundCoverage: number;
    /** Coverage compiler's ignored-noise count (never surfaced as a pack). */
    ignoredNoise: number;
  };
};

const EMPTY: ActionPackWorklist = {
  packs: [],
  summary: {
    total: 0,
    byFamily: { existing_page: 0, new_page: 0, hub: 0, links: 0, cro: 0 },
    sourceCoverage: { rank_revenue: 0, profound: 0, dataforseo: 0, gsc: 0, ga4: 0, clarity: 0, competitor_teardown: 0 },
    fromRankRevenue: 0,
    fromProfoundCoverage: 0,
    duplicatesRemoved: 0,
    rawFromRankRevenue: 0,
    rawFromProfoundCoverage: 0,
    ignoredNoise: 0,
  },
};

async function loadUncached(tenantId: string): Promise<ActionPackWorklist> {
  const [graphRes, packsRes, coverage] = await Promise.all([
    loadDemandGraphForTenant(tenantId).catch((e): null => {
      log.warn("[action-pack] demand graph failed", { tenantId, error: String(e) });
      return null;
    }),
    loadChangePacksForTenant(tenantId, { limit: 60 }).catch((): { packets: EvidencePacket[] } => ({ packets: [] })),
    loadCachedProfoundCoverageForTenant(tenantId).catch((e): null => {
      log.warn("[action-pack] cached coverage failed", { tenantId, error: String(e) });
      return null;
    }),
  ]);

  const packetByKey = new Map<string, EvidencePacket>((packsRes?.packets ?? []).map((p) => [p.move.key, p]));

  const moves = graphRes?.graph.moves ?? [];
  const fromMoves = moves
    .map((m) => moveCandidateToActionPack(tenantId, m, packetByKey.get(m.demandKey) ?? null))
    .filter((p): p is ActionPack => p != null);

  const coveragePacks = coverage?.actionPacks ?? [];
  const fromCoverage = coveragePacks
    .map((p) => aeoActionPackToActionPack(tenantId, p))
    .filter((p): p is ActionPack => p != null);

  const { packs, removed } = dedupeActionPacks([...fromMoves, ...fromCoverage]);

  const byFamily = { existing_page: 0, new_page: 0, hub: 0, links: 0, cro: 0 };
  const sourceCoverage: Record<EvidenceSource, number> = { rank_revenue: 0, profound: 0, dataforseo: 0, gsc: 0, ga4: 0, clarity: 0, competitor_teardown: 0 };
  for (const p of packs) {
    byFamily[actionFamily(p.actionType)]++;
    for (const s of p.evidenceSources) sourceCoverage[s]++;
  }

  return {
    packs,
    summary: {
      total: packs.length,
      byFamily,
      sourceCoverage,
      fromRankRevenue: packs.filter((p) => p.origin === "rank_revenue").length,
      fromProfoundCoverage: packs.filter((p) => p.origin === "profound_coverage").length,
      duplicatesRemoved: removed,
      rawFromRankRevenue: fromMoves.length,
      rawFromProfoundCoverage: fromCoverage.length,
      ignoredNoise: coverage?.summary.ignoredNoise ?? 0,
    },
  };
}

/** Request-memoized unified worklist. */
export const loadActionPackWorklistForTenant = cache(loadUncached);

export { EMPTY as EMPTY_ACTION_PACK_WORKLIST };
