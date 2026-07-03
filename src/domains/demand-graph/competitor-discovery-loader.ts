/**
 * competitor-discovery-loader (2026-07-03, BEACON_500 P9 v1 420) - the I/O
 * boundary for competitor-discovery.ts. Reads ONLY already-stored
 * dataforseo_serp_history rows ($0 marginal cost - the SERP calls that wrote
 * them were already paid for elsewhere); this loader spends NOTHING and never
 * calls DataForSEO itself.
 *
 * Kept in its own file (not inside the pure detector) so competitor-discovery.ts
 * stays dependency-free and unit-testable with zero mocking - the same boundary
 * split intent-clusters.ts / intent-clusters-loader.ts use.
 *
 * The tenant's own domain is read from the tenant context (for the "beats you"
 * math + own-domain exclusion); when it is unknown the detector still runs and
 * simply treats every top-slot domain as a possible competitor.
 */

import "server-only";

import { cache } from "react";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { currentTenant } from "@/lib/tenant-context";
import type { SerpOrganicItem } from "@/domains/serp/dataforseo-serp";
import {
  discoverCompetitors,
  type CompetitorDiscoveryHistoryRow,
  type CompetitorDiscoveryResult,
} from "./competitor-discovery";

/** Bound how far back the tenant-wide overlap scan looks and how many rows it
 *  can return - a diagnostic read, not an unbounded table scan. Mirrors the
 *  intent-clusters / feature-steal reader bounds. */
const LOOKBACK_DAYS = 90;
const ROW_LIMIT = 3_000;

const EMPTY: CompetitorDiscoveryResult = { competitors: [], queriesWithData: 0, headline: null };

/**
 * Discover the tenant's real competitors end to end: read whatever
 * dataforseo_serp_history already exists in the window ($0, no new paid pulls),
 * resolve the owned domain, and reduce to the honest ranked list. Fails soft to
 * an empty result on any error (no table / no env / no history / read failure) -
 * never throws into a render.
 */
export const loadDiscoveredCompetitorsForTenant = cache(
  async (tenantId: string, now: Date = new Date()): Promise<CompetitorDiscoveryResult> => {
    if (!tenantId || !isSupabaseConfigured()) return EMPTY;
    try {
      const cutoffIso = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await getSupabaseAdmin()
        .from("dataforseo_serp_history")
        .select("query, captured_at, own_rank, top_domains")
        .eq("tenant_id", tenantId)
        .gte("captured_at", cutoffIso)
        .order("captured_at", { ascending: true })
        .limit(ROW_LIMIT);
      if (error || !Array.isArray(data)) return EMPTY;
      const rows: CompetitorDiscoveryHistoryRow[] = (
        data as Array<{ query: string; captured_at: string; own_rank: number | null; top_domains: SerpOrganicItem[] | null }>
      ).map((r) => ({
        query: (r.query ?? "").trim(),
        capturedAt: r.captured_at,
        ownRank: typeof r.own_rank === "number" ? r.own_rank : null,
        topDomains: Array.isArray(r.top_domains) ? r.top_domains : [],
      }));
      if (rows.length === 0) return EMPTY;
      const domain = await currentTenant()
        .then((t) => t.domain ?? null)
        .catch(() => null);
      return discoverCompetitors(rows, domain);
    } catch {
      return EMPTY;
    }
  },
);
