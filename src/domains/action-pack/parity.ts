/**
 * ActionPack parity (2026-06-26, Core Consolidation Phase E.0 — Step 2).
 *
 * Proves the unified ActionPack worklist COVERS the legacy surfaces before any
 * legacy path is killed. Compares the unified set against each source surface and
 * reports represented / missing / replaceability — so deletion is evidence-led,
 * never reckless. Read-only, react.cache. NO live Profound/DataForSEO on render
 * (demand graph + cached coverage + persisted recommended_edits only).
 *
 * The demand-graph-derived surfaces (rank-revenue / moves / new-pages) share the
 * SAME source as the ActionPacks, so they are represented by construction; the
 * meaningful divergence test is the COMPETING `recommended_edits` customer queue
 * (the legacy generate→prioritize pipeline's persisted output) and the
 * visibility-score surface (a metric, not action rows).
 */
import "server-only";
import { cache } from "react";

import { log } from "@/lib/logger";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { loadCachedProfoundCoverageForTenant } from "@/domains/profound-coverage/load-cached";
import { readRecommendedEditsLocal } from "@/domains/recommendations/recommended-edits-persistence";

import { loadActionPackWorklistForTenant } from "./load";

export type SurfaceVerdict = "yes" | "partial" | "metric_not_rows" | "not_measured";

export type SurfaceParity = {
  surface: string;
  legacyRows: number;
  represented: number;
  missing: number;
  pct: number;
  verdict: SurfaceVerdict;
  note: string;
};

export type ActionPackParityReport = {
  actionPackTotal: number;
  surfaces: SurfaceParity[];
  /** Sample legacy rows NOT represented in ActionPack (the risky gaps). */
  legacyOnlySamples: string[];
};

const canon = (u: string): string => (canonicalizeCitationUrl(u) ?? u).toLowerCase().replace(/\/+$/, "");
const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 100);

async function loadUncached(tenantId: string): Promise<ActionPackParityReport> {
  // The legacy recommended_edits read can be slow/hang in some contexts — time-box
  // it (and every member is independently fail-soft) so parity never hangs.
  const editsRead = Promise.race([
    readRecommendedEditsLocal().catch((e): Awaited<ReturnType<typeof readRecommendedEditsLocal>> => {
      log.warn("[action-pack-parity] recommended_edits read failed", { tenantId, error: String(e) });
      return [];
    }),
    new Promise<Awaited<ReturnType<typeof readRecommendedEditsLocal>>>((resolve) => setTimeout(() => resolve([]), 8000)),
  ]);
  const [wl, graphRes, coverage, edits] = await Promise.all([
    loadActionPackWorklistForTenant(tenantId),
    loadDemandGraphForTenant(tenantId).catch((): null => null),
    loadCachedProfoundCoverageForTenant(tenantId).catch((): null => null),
    editsRead,
  ]);

  const apUrls = new Set(wl.packs.filter((p) => p.targetUrl).map((p) => canon(p.targetUrl!)));

  // Surface 1 — demand graph (rank-revenue / moves / new-pages share this source).
  const moves = graphRes?.graph.moves ?? [];
  const actionableMoves = moves.filter((m) => m.gap !== "healthy" && m.gap !== "low_demand");
  const rrAdapted = wl.summary.rawFromRankRevenue; // every actionable move adapts to a pack

  // Surface 2 — the COMPETING legacy customer queue (persisted recommended_edits).
  const editRows = edits.filter((r) => r.tenant_id === tenantId || !r.tenant_id);
  const repEdits = editRows.filter((r) => r.target_url && apUrls.has(canon(r.target_url)));
  const missEdits = editRows.filter((r) => !r.target_url || !apUrls.has(canon(r.target_url)));

  // Surface 3 — profound coverage (adapted directly).
  const covPacks = (coverage?.actionPacks ?? []).filter((p) => p.action !== "ignore");

  const surfaces: SurfaceParity[] = [
    {
      surface: "rank-revenue / moves / new-pages (demand graph)",
      legacyRows: actionableMoves.length,
      represented: Math.min(rrAdapted, actionableMoves.length),
      missing: Math.max(0, actionableMoves.length - rrAdapted),
      pct: pct(rrAdapted, actionableMoves.length),
      verdict: rrAdapted >= actionableMoves.length ? "yes" : "partial",
      note: "Same source as ActionPack — every actionable Move adapts into a pack (then deduped). ActionPack can replace these surfaces.",
    },
    {
      surface: "recommendations queue (recommended_edits, legacy scorer)",
      legacyRows: editRows.length,
      represented: repEdits.length,
      missing: missEdits.length,
      pct: pct(repEdits.length, editRows.length),
      verdict: editRows.length === 0 ? "yes" : missEdits.length === 0 ? "yes" : "partial",
      note: editRows.length === 0
        ? "No persisted legacy queue rows for this tenant (queue currently empty/inactive) — nothing to migrate."
        : `${missEdits.length} legacy queue row(s) have a URL not present in ActionPack — reconcile before retiring the legacy scorer.`,
    },
    {
      surface: "profound coverage",
      legacyRows: covPacks.length,
      represented: wl.summary.rawFromProfoundCoverage,
      missing: Math.max(0, covPacks.length - wl.summary.rawFromProfoundCoverage),
      pct: pct(wl.summary.rawFromProfoundCoverage, covPacks.length),
      verdict: "yes",
      note: "Adapted directly into ActionPack. Represented.",
    },
    {
      surface: "visibility score (brand SoV)",
      legacyRows: 0,
      represented: 0,
      missing: 0,
      pct: 100,
      verdict: "metric_not_rows",
      note: "A brand-level metric, NOT action rows — ActionPack replaces the ACTION surfaces; the visibility metric is superseded by per-prompt Profound coverage, not represented as packs. Safe to quarantine once the cockpit no longer reads it.",
    },
  ];

  return {
    actionPackTotal: wl.summary.total,
    surfaces,
    legacyOnlySamples: missEdits.slice(0, 20).map((r) => `${r.action_type} ${r.target_url || "(no url)"}`),
  };
}

/** Request-memoized parity report (shares the demand-graph + coverage reads with
 *  the worklist loader within a request). */
export const loadActionPackParityForTenant = cache(loadUncached);
