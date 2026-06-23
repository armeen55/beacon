import "server-only";

/**
 * Batch Experiment Planner — loader (TASK 4).
 *
 * Hydrates the per-page TASK-3 optimizer buckets for the TOP opportunities in a
 * SINGLE pass. The naive approach (call loadWorkbench per page) repeats the three
 * whole-tenant reads (proof plan, cannibalization, shipped ledger) on every page.
 * This loads them ONCE, then runs the pure pipeline per page:
 *   resolveCanon -> assemblePacketForUrl -> buildWorkbenchMatrix -> buildOptimizer.
 * No LLM, no SERP, no paid API. The only heavy read is loadPageSurgeonContext
 * (once). Packs are loaded only for pages that already have a saved brief.
 */

import { loadOpportunityMap } from "./compute-opportunity-map";
import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import {
  loadPageSurgeonForUrl,
  loadProofPlan,
} from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import type { ProofPlanRow } from "@/domains/recommendation-intelligence/page-surgeon/proof-plan";
import type { AtomicChangePack } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import { resolveCanonFromPath } from "@/app/(shell)/workbench/workbench-data";
import { buildWorkbenchMatrix } from "./workbench-matrix";
import { buildOptimizer } from "./workbench-optimizer";
import {
  loadGscCannibalizationForTenant,
  type GscCannibalizationCase,
} from "@/domains/recommendation-intelligence/gsc-cannibalization";
import {
  loadShippedChanges,
  type ShippedChangeRecord,
} from "@/domains/proof-gsc/shipped-change-store";
import type { BatchPageRow } from "./select-experiment-batch";

/** How many top opportunities to hydrate before the selector trims to 5-10.
 *  Wide enough that, after holding out pages already under measurement, the
 *  selector still has a real spread of pages + levers to diversify across. */
const CANDIDATE_WINDOW = 28;

/** Host-strip + trailing-slash trim — matches workbench-data's private toPath so
 *  the proof/shipped/cannibalization joins key the same way the opportunity does. */
function toPath(u: string): string {
  return u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
}

export async function loadBatchExperimentRows(
  tenantId: string,
  now: Date = new Date(),
): Promise<BatchPageRow[]> {
  const items = await loadOpportunityMap(tenantId, now).catch(() => []);
  if (items.length === 0) return [];
  const window = items.slice(0, CANDIDATE_WINDOW);

  // Four tenant-wide reads ONCE. loadPageSurgeonContext is the only heavy one;
  // the other three are the per-page waste this loader exists to collapse.
  let ctx;
  try {
    ctx = await loadPageSurgeonContext(tenantId);
  } catch {
    return [];
  }
  const [cannibalCases, proofRows, shipped] = await Promise.all([
    loadGscCannibalizationForTenant(tenantId, now).catch(() => [] as GscCannibalizationCase[]),
    loadProofPlan(tenantId).catch(() => [] as ProofPlanRow[]),
    loadShippedChanges().catch(() => [] as ShippedChangeRecord[]),
  ]);

  // Pre-index the per-page lists for O(1) lookup (all keyed by the same toPath).
  const measuringByPath = new Map<string, string[]>();
  for (const s of shipped) {
    if (s.verdict !== "measuring") continue;
    const p = toPath(s.path);
    const list = measuringByPath.get(p) ?? [];
    list.push(s.actionType);
    measuringByPath.set(p, list);
  }
  const proofByPath = new Map(proofRows.map((r) => [toPath(r.pageUrl), r]));

  // Load saved Change Packs ONLY for pages that already have a brief (a handful),
  // so their real drafted copy + pushability surface. Everything else stays pure.
  const packByCanon = new Map<string, AtomicChangePack>();
  await Promise.all(
    window
      .filter((i) => i.hasChangePack)
      .map(async (i) => {
        const canon = i.canonUrl ?? resolveCanonFromPath(ctx, i.path);
        if (!canon) return;
        try {
          const r = await loadPageSurgeonForUrl(tenantId, canon, { history: false });
          if (r.status === "pack") packByCanon.set(canon, r.pack);
        } catch {
          /* fail-soft: page falls back to the deterministic / needs-drafting matrix */
        }
      }),
  );

  const rows: BatchPageRow[] = [];
  for (const item of window) {
    const canon = item.canonUrl ?? resolveCanonFromPath(ctx, item.path);
    if (!canon) continue; // missing-source page, skip (not "no opportunity")

    const packet = assemblePacketForUrl(ctx, canon);

    // Worst cannibalization for THIS page (same construction as loadWorkbench).
    const cases = cannibalCases
      .filter((c) => c.competingUrls.some((u) => u.url === canon))
      .sort((a, b) => b.totalImpressions - a.totalImpressions);
    const wc = cases[0];
    const worstCannibal = wc
      ? {
          query: wc.query,
          urlCount: wc.competingUrls.length,
          combinedImpressions: wc.totalImpressions,
          combinedClicks: wc.totalClicks,
          bestPosition: Math.min(...wc.competingUrls.map((u) => u.position)),
        }
      : null;

    const matrix = buildWorkbenchMatrix(packet, packByCanon.get(canon) ?? null, worstCannibal);

    const key = toPath(item.path);
    const proof = proofByPath.get(key) ?? null;
    const measuringActions = measuringByPath.get(key) ?? [];
    const optimizer = buildOptimizer({ matrix, proof, measuringActions, serp: null });

    rows.push({
      item,
      optimizer,
      measuringActions,
      current: {
        title: packet.crawl?.title ?? null,
        meta: packet.crawl?.metaDescription ?? null,
        h1: packet.crawl?.h1 ?? null,
      },
      topQueries: (packet.gsc?.topQueries ?? []).map((q) => q.query),
    });
  }

  return rows;
}
