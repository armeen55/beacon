import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";
import { generateTopPageBriefs } from "./batch-briefs";

/** Per-instance throttle: the recs page can render many times per session, but a
 *  brief backfill spends LLM. One backfill per tenant per this window per warm
 *  lambda; the durable brief cache (evidence-hash) does the real de-dup, this
 *  just collapses rapid navigation. */
const lastBackfillAt = new Map<string, number>();
const MIN_GAP_MS = 15 * 60_000;

/** LLM judge calls per backfill run — small so the cost is gradual + bounded;
 *  the monthly LLM budget cap inside judgePageAtomicChange is the hard ceiling. */
const PER_RUN_CAP = 5;

/**
 * Audit gap #2 — on-USE Page Surgeon brief backfill. Call this from the
 * operator's recommendations render. It schedules (via next/after, so it runs
 * AFTER the response — zero added page latency) a small, capped batch that fills
 * the brief cache for the top-by-demand pages that don't have a fresh brief yet.
 *
 * The effect: the "Ready" queue grows on its own as the operator uses the app —
 * the deep engine progressively takes over from the legacy composer with no
 * "generate" button to remember. Fully fail-soft + cost-bounded (per-run cap +
 * the durable monthly LLM budget cap). Operator-only by caller contract.
 */
export function scheduleBriefBackfill(tenantId: string): void {
  if (!tenantId) return;
  const nowMs = Date.now();
  const last = lastBackfillAt.get(tenantId) ?? 0;
  if (nowMs - last < MIN_GAP_MS) return; // collapse rapid renders
  lastBackfillAt.set(tenantId, nowMs);
  try {
    after(async () => {
      try {
        const res = await generateTopPageBriefs(tenantId, { cap: PER_RUN_CAP });
        if (res.generated > 0) {
          log.info("[brief-backfill] on-use backfill ran", { tenantId, ...res });
        }
      } catch (e) {
        log.warn("[brief-backfill] on-use backfill failed (non-blocking)", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  } catch {
    // after() is only valid inside a request scope — ignore outside one.
  }
}
