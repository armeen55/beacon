/**
 * Unified ActionPack worklist loader (2026-06-26, Core Consolidation — Phase D;
 * fast/full mode added Phase F.1 2026-06-27).
 *
 * The ONE ranked worklist: adapts the demand-graph Moves (R&R + GSC/GA4/Clarity +
 * the Profound evidence already fused onto each Move) AND the durable
 * profound-coverage packs into the unified ActionPack, dedupes across sources,
 * and ranks. Read-only, react.cache, fail-soft. NO live Profound API on render
 * (coverage comes from the cached durable store).
 *
 * MODE (Phase F.1):
 *  - "fast"  (default): TIME-BOXES each heavy source read so a slow/huge tenant can
 *            never silently blow maxDuration — a read that overruns degrades to a
 *            visible warning + empty result instead of hanging. Coverage is
 *            otherwise IDENTICAL to full (same reads, same limits) so source-coverage
 *            counts stay honest.
 *  - "full"  : operator deep-diagnostic — no time-box (wait as long as it takes).
 *
 *  Measured (Iranopedia, prod): worklist ≈ 9s end-to-end; `/diagnostics/action-packs`
 *  renders ~8s warm — already under the 10s target. The demand graph (~7.6s) is the
 *  floor and runs in PARALLEL with coverage/change-packs/drafts, so capping
 *  change-packs gives NO wall-clock win (and undercounts gsc coverage, which is
 *  attributed from the packet) — REJECTED after measuring. The old "43–61s" was
 *  dev-mode route COMPILE, not the load. Getting under 5s requires speeding the
 *  demand graph itself (separate work), not the ActionPack envelope.
 */
import "server-only";
import { cache } from "react";

import { log } from "@/lib/logger";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { loadChangePacksForTenant, type LoadChangePacksResult } from "@/domains/demand-graph/gap-compiler";
import { loadCachedProfoundCoverageForTenant } from "@/domains/profound-coverage/load-cached";
import { getLatestMoveDrafts, type MoveDraftRow } from "@/domains/demand-graph/move-draft-store";
import { parsePreparedVerdict } from "@/domains/serp/prepare-create-page-verdicts";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";

import { moveCandidateToActionPack, aeoActionPackToActionPack, dedupeActionPacks } from "./adapters";
import { actionFamily, type ActionPack, type EvidenceSource } from "./types";

export type WorklistMode = "fast" | "full";

/** Change-pack (EvidencePacket) read bound — same in both modes so source coverage
 *  is identical/honest. Capping it per-mode was measured to give no wall-clock win
 *  (it runs parallel to the slower demand-graph read) and to undercount gsc. */
const CHANGE_PACK_LIMIT = 60;

const EMPTY_CHANGE_PACKS: LoadChangePacksResult = {
  packets: [],
  coverage: { moves: 0, withCompetitorTeardown: 0, withOwnedSnapshot: 0, ownedSnapshots: 0, competitorAudits: 0 },
};

/** Fast-mode per-read time-box. Generous headroom over the measured ~7.6s graph /
 *  ~6s coverage so a HEALTHY tenant never trips it, but a pathological one degrades
 *  to a visible warning well before the 60s route maxDuration. */
const FAST_READ_TIMEBOX_MS = 22_000;

/** Race a read against a time-box; on overrun resolve to `fallback` and record a
 *  warning (fail VISIBLE). Only used in fast mode. */
function withTimebox<T>(label: string, p: Promise<T>, fallback: T, mode: WorklistMode, warnings: string[]): Promise<T> {
  if (mode === "full") return p;
  return Promise.race([
    p,
    new Promise<T>((resolve) =>
      setTimeout(() => {
        warnings.push(`${label} exceeded ${Math.round(FAST_READ_TIMEBOX_MS / 1000)}s (fast mode) — degraded to empty; retry or use full mode.`);
        resolve(fallback);
      }, FAST_READ_TIMEBOX_MS),
    ),
  ]);
}

export type ActionPackWorklist = {
  packs: ActionPack[];
  summary: {
    mode: WorklistMode;
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
    /** Visible degradation — a source read failed / was capped. Never silent. */
    warnings: string[];
  };
};

const emptySummary = (mode: WorklistMode): ActionPackWorklist["summary"] => ({
  mode,
  total: 0,
  byFamily: { existing_page: 0, new_page: 0, hub: 0, links: 0, cro: 0 },
  sourceCoverage: { rank_revenue: 0, profound: 0, dataforseo: 0, gsc: 0, ga4: 0, clarity: 0, competitor_teardown: 0 },
  fromRankRevenue: 0,
  fromProfoundCoverage: 0,
  duplicatesRemoved: 0,
  rawFromRankRevenue: 0,
  rawFromProfoundCoverage: 0,
  ignoredNoise: 0,
  warnings: [],
});

const EMPTY: ActionPackWorklist = { packs: [], summary: emptySummary("fast") };

async function loadUncached(tenantId: string, mode: WorklistMode): Promise<ActionPackWorklist> {
  const warnings: string[] = [];

  const [graphRes, packsRes, coverage, drafts] = await Promise.all([
    withTimebox("Demand graph", loadDemandGraphForTenantCached(tenantId), null, mode, warnings).catch((e): null => {
      log.warn("[action-pack] demand graph failed", { tenantId, error: String(e) });
      warnings.push("Demand graph read failed — rank-&-revenue moves are missing from this worklist.");
      return null;
    }),
    withTimebox("Change-pack evidence", loadChangePacksForTenant(tenantId, { limit: CHANGE_PACK_LIMIT }), EMPTY_CHANGE_PACKS, mode, warnings).catch((): LoadChangePacksResult => {
      warnings.push("Change-pack (evidence) read failed — packs shown without deep competitor/evidence enrichment.");
      return EMPTY_CHANGE_PACKS;
    }),
    withTimebox("Cached Profound coverage", loadCachedProfoundCoverageForTenant(tenantId), null, mode, warnings).catch((e): null => {
      log.warn("[action-pack] cached coverage failed", { tenantId, error: String(e) });
      warnings.push("Cached Profound coverage read failed — AEO coverage packs are missing from this worklist.");
      return null;
    }),
    // Cached DataForSEO verdicts live in move_drafts (kind serp_verdict). No live
    // API — just the persisted "Prepare/validate" results from the New Pages work.
    getLatestMoveDrafts(tenantId).catch((): Map<string, MoveDraftRow> => new Map()),
  ]);

  const packetByKey = new Map<string, EvidencePacket>((packsRes?.packets ?? []).map((p) => [p.move.key, p]));

  const moves = graphRes?.graph.moves ?? [];
  const fromMoves = moves
    .map((m) => moveCandidateToActionPack(tenantId, m, packetByKey.get(m.demandKey) ?? null, parsePreparedVerdict(drafts.get(`${m.demandKey}::serp_verdict`)?.content)))
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
      mode,
      total: packs.length,
      byFamily,
      sourceCoverage,
      fromRankRevenue: packs.filter((p) => p.origin === "rank_revenue").length,
      fromProfoundCoverage: packs.filter((p) => p.origin === "profound_coverage").length,
      duplicatesRemoved: removed,
      rawFromRankRevenue: fromMoves.length,
      rawFromProfoundCoverage: fromCoverage.length,
      ignoredNoise: coverage?.summary.ignoredNoise ?? 0,
      warnings,
    },
  };
}

/** Request-memoized unified worklist. react.cache keys on (tenantId, mode) — the
 *  string mode keeps memoization stable (an options object would defeat it). */
const loadCached = cache((tenantId: string, mode: WorklistMode): Promise<ActionPackWorklist> => loadUncached(tenantId, mode));

/**
 * Load the unified ActionPack worklist. Defaults to "fast" — the canonical
 * brain should be resilient; operator deep-diagnostics can pass { mode: "full" }.
 */
export function loadActionPackWorklistForTenant(
  tenantId: string,
  opts?: { mode?: WorklistMode },
): Promise<ActionPackWorklist> {
  return loadCached(tenantId, opts?.mode ?? "fast");
}

export { EMPTY as EMPTY_ACTION_PACK_WORKLIST };
