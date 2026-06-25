"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { runKeywordVolume } from "@/domains/serp/dataforseo-keywords";

/**
 * discoverDemandAction (2026-06-25, Sprint 4F) — operator-triggered demand
 * discovery. Seeds the DataForSEO keyword call from the tenant's OWN demand graph
 * (its real topics — tenant-agnostic, no hardcoding), runs the capped/cached
 * keyword connector (DRY-RUN default; one budgeted call; cache-first so re-runs
 * are $0), and revalidates "/" so the New Opportunities panel refreshes. NO
 * publish, NO content change. Fires only on an explicit click. Spend is attributed
 * to the ACTIVE tenant (explicit tenantId dep).
 */

export type DiscoverDemandResult =
  | { ok: false; reason: string }
  | { ok: true; status: string; costUsd: number; requested: number; returned: number; detail: string };

export async function discoverDemandAction(opts: { maxSeeds?: number } = {}): Promise<DiscoverDemandResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    // Seeds = the tenant's top real demand topics (deduped, bounded).
    const seeds = [...new Set(graph.moves.map((m) => m.label.trim().toLowerCase()).filter((s) => s.length >= 3))].slice(
      0,
      opts.maxSeeds ?? 25,
    );
    if (seeds.length === 0) return { ok: false, reason: "No demand-graph topics to seed discovery." };

    const run = await runKeywordVolume(seeds, {}, { tenantId: async () => tenantId });
    revalidatePath("/");
    return {
      ok: true,
      status: run.status,
      costUsd: run.costUsd,
      requested: run.plan.keywords.length,
      returned: run.keywords.length,
      detail: run.detail,
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "discover failed" };
  }
}
