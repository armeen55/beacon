import "server-only";

import { log } from "@/lib/logger";

import {
  assemblePacketForUrl,
  evidenceHash,
  loadPageSurgeonContext,
  topPagesByDemand,
} from "./assemble-packet";
import { getCachedBriefs, saveBrief } from "./brief-store";
import { judgePageAtomicChange } from "./llm-judge";

export type BatchBriefResult = {
  /** Top-by-demand pages examined this run. */
  considered: number;
  /** Pages where a fresh Page Surgeon brief was generated + saved this run. */
  generated: number;
  /** Pages already covered by an up-to-date cached brief (cost: $0). */
  cachedFresh: number;
  /** Pages skipped because they have no GSC demand to ground a brief. */
  skippedNoGsc: number;
  /** Pages that errored (logged; the batch continues). */
  failed: number;
  /** The per-run LLM-call ceiling applied. */
  cap: number;
};

/**
 * Audit gap #2 — batch-generate Page Surgeon briefs for the top pages by search
 * demand, so the operator's queue is driven by the DEEP engine instead of only
 * the handful of pages someone hand-clicked. Before this, `runPageSurgeonBrief`
 * had exactly one caller (a click), so the "Ready" bucket could only ever be
 * tiny and 39/43 recs fell back to the weaker legacy composer.
 *
 * ADDITIVE + SAFE by construction: it only fills the brief cache (saveBrief).
 * It touches NO existing rec / promotion / legacy path — the surfaces already
 * prefer a Page Surgeon brief over the legacy composer wherever one exists, so
 * filling the cache flips pages from "Standard" to "Ready" with zero changes to
 * the generation pipeline.
 *
 * Bounded TWO ways so it can never run away:
 *   1. `cap` — a hard ceiling on LLM judge calls per run.
 *   2. The LLM monthly budget cap enforced INSIDE judgePageAtomicChange
 *      (fail-closed on Vercel) — when the month's budget is spent, the judge
 *      stops and pages just fall through as `failed`, never overspending.
 * Cache-aware: a page whose evidence hash is unchanged costs $0 (cachedFresh).
 * Fail-soft per page AND overall — never throws; partial progress is kept.
 */
export async function generateTopPageBriefs(
  tenantId: string,
  opts?: { topN?: number; cap?: number },
): Promise<BatchBriefResult> {
  const topN = opts?.topN ?? 24;
  const cap = opts?.cap ?? 6;
  const res: BatchBriefResult = {
    considered: 0,
    generated: 0,
    cachedFresh: 0,
    skippedNoGsc: 0,
    failed: 0,
    cap,
  };

  try {
    const ctx = await loadPageSurgeonContext(tenantId);
    const cached = await getCachedBriefs(tenantId);
    const top = topPagesByDemand(ctx, topN);

    for (const canonUrl of top) {
      if (res.generated >= cap) break; // per-run LLM ceiling reached
      res.considered++;

      let packet: ReturnType<typeof assemblePacketForUrl>;
      try {
        packet = assemblePacketForUrl(ctx, canonUrl);
      } catch {
        res.failed++;
        continue;
      }
      // No GSC demand → nothing to ground a brief on (same gate as the
      // single-page runPageSurgeonBrief). Not an error, just a skip.
      if (packet.gsc == null) {
        res.skippedNoGsc++;
        continue;
      }

      const hash = evidenceHash(packet);
      const c = cached.get(packet.current.pageUrl);
      if (c != null && c.evidence_hash === hash) {
        res.cachedFresh++; // already covered, unchanged → free
        continue;
      }

      try {
        const decision = await judgePageAtomicChange({ packet, brand: ctx.brand });
        await saveBrief(tenantId, packet.current.pageUrl, hash, decision);
        res.generated++;
      } catch (e) {
        // Includes the LLM budget cap tripping — treat as a soft stop for this
        // page; the loop's `generated >= cap` guard + the monthly cap bound cost.
        res.failed++;
        log.warn("[batch-briefs] page brief failed (continuing)", {
          tenantId,
          canonUrl,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    log.warn("[batch-briefs] batch aborted", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  log.info("[batch-briefs] run complete", { tenantId, ...res });
  return res;
}
