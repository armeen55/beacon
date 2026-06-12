/**
 * LLM flip-on slice (2026-06-12) — the goal's "re-upping must flip
 * LLM paths on instantly" contract, made real.
 *
 * Before this, the OpenAI specific-edit provider + budget gates +
 * validators were fully built but had NO production caller — flipping
 * BEACON_LLM_PROVIDER=openai (and re-upping the key) changed nothing
 * in the nightly loop. This module is the production caller: the
 * nightly cron invokes it after promotion; it no-ops (zero spend,
 * zero behavior) until the provider env resolves to a paid provider,
 * then upgrades the TOP queue recs with structured-output LLM drafts
 * through the EXISTING machinery:
 *
 *   loadLiveRecommendationQueue → buildPacketForRec →
 *   runProviderAndPersist  (tenant gate → provider resolve → monthly
 *   budget gate → JSON-schema'd provider call → per-edit validator →
 *   idempotent persist + LLM history log)
 *
 * Every safety property is inherited, not re-implemented: the
 * monthly budget cap (shared llm-budget pot), the per-edit validator
 * that rejects hallucinated URLs/element keys/action types, the
 * idempotent (rec_id, action_type, element_key) persist, and the
 * customer queue's Accept-only publish gate downstream.
 *
 * LIMIT discipline: `limit` recs per tenant per night (default 3)
 * bounds worst-case nightly spend regardless of queue size.
 */

import "server-only";

import { resolveLLMProvider } from "@/lib/llm/config";
import { loadLiveRecommendationQueue } from "@/domains/recommendations/load-queue";
import { buildPacketForRec } from "@/domains/recommendations/load-queue";
import { runProviderAndPersist } from "@/domains/recommendations/recommended-edits-persistence";
import { getRepository } from "@/lib/persistence/repositories";
import { log } from "@/lib/logger";

export type LlmQueueUpgradeResult =
  | { ran: false; reason: string }
  | {
      ran: true;
      processed: number;
      accepted: number;
      persisted: number;
      cost_usd: number;
    };

const DEFAULT_LIMIT = 3;

export async function upgradeQueueDraftsWithLlm(args: {
  tenantId: string;
  limit?: number;
}): Promise<LlmQueueUpgradeResult> {
  const { tenantId } = args;
  const limit = args.limit ?? DEFAULT_LIMIT;

  // Gate 1 — provider env. Deterministic (the committed default, and
  // the forced state while OpenAI is over quota) → instant no-op.
  let provider: string;
  try {
    provider = resolveLLMProvider();
  } catch (err) {
    // openai set without a key (or invalid value) — fail-soft skip.
    return {
      ran: false,
      reason: `provider_unconfigured: ${err instanceof Error ? err.message.slice(0, 80) : "invalid"}`,
    };
  }
  if (provider !== "openai") {
    return { ran: false, reason: "provider_deterministic" };
  }

  // Gate 2 — the live queue (same orchestration as the page render).
  const live = await loadLiveRecommendationQueue({ tenantId });
  if (!live.matrix) {
    return { ran: false, reason: "matrix_unavailable" };
  }
  const targets = live.queue.slice(0, Math.max(1, limit));
  if (targets.length === 0) {
    return { ran: false, reason: "queue_empty" };
  }

  let inventory: Awaited<
    ReturnType<ReturnType<ReturnType<typeof getRepository>["forTenant"]>["getPageElementInventory"]>
  > = [];
  try {
    inventory = await getRepository()
      .forTenant(tenantId)
      .getPageElementInventory();
  } catch {
    inventory = []; // generators skip element-targeted actions; honest
  }

  let processed = 0;
  let accepted = 0;
  let persisted = 0;
  let costUsd = 0;
  for (const rec of targets) {
    try {
      const packet = buildPacketForRec({
        rec,
        context: live,
        pageElementInventory: inventory,
        tenantId,
      });
      const result = await runProviderAndPersist({ packet });
      processed += 1;
      accepted += result.acceptedCount;
      if (result.persisted) persisted += 1;
      costUsd += result.bundle.totalCostUsd;
      // The budget gate inside runProviderAndPersist blocks further
      // spend when the monthly cap is hit; its result reports ok:false
      // with zero cost — keep iterating is pointless then.
      if (!result.ok && result.bundle.totalCostUsd === 0) break;
    } catch (err) {
      log.warn("[llm-queue-upgrade] rec failed (continuing)", {
        tenantId,
        recId: rec.stableKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ran: true, processed, accepted, persisted, cost_usd: costUsd };
}
