"use server";

/**
 * Page Surgeon diagnostic actions (W1a wiring). Operator-only. NEVER calls
 * OpenAI on load — `listPageSurgeonBriefs` is pure reads (real evidence + cached
 * decisions). `runPageSurgeonBrief` is the ONLY LLM entry point: one judge call
 * per explicit click, cached by evidence hash so an unchanged re-run spends
 * nothing. Does not regenerate the queue, publish, arm, or touch composeTitle.
 */

import { notFound } from "next/navigation";

import { currentTenantId } from "@/lib/tenant-context";
import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  assemblePacketForUrl,
  evidenceHash,
  loadPageSurgeonContext,
  topPagesByDemand,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import {
  getCachedBriefs,
  saveBrief,
} from "@/domains/recommendation-intelligence/page-surgeon/brief-store";
import { judgePageAtomicChange } from "@/domains/recommendation-intelligence/page-surgeon/llm-judge";
import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";

const TOP_N = 8;

function gate(): void {
  if (!isOperatorModeServer() && process.env.NODE_ENV !== "test") notFound();
}

export type PageSurgeonRow = {
  canonUrl: string;
  pageUrl: string;
  currentTitle: string | null;
  gsc: { impressions: number; clicks: number; ctr: number; position: number; topQuery: string } | null;
  cached: PageAtomicDecision | null;
  /** cached decision exists but the underlying evidence changed since. */
  stale: boolean;
  hasOpenAi: boolean;
};

export async function listPageSurgeonBriefs(): Promise<{
  rows: PageSurgeonRow[];
  tenantId: string;
}> {
  gate();
  const tenantId = await currentTenantId();
  const ctx = await loadPageSurgeonContext(tenantId);
  const cached = await getCachedBriefs(tenantId);
  const hasOpenAi = (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0;

  const urls = topPagesByDemand(ctx, TOP_N);
  const rows: PageSurgeonRow[] = urls.map((canonUrl) => {
    const packet = assemblePacketForUrl(ctx, canonUrl);
    const hash = evidenceHash(packet);
    const c = cached.get(packet.current.pageUrl);
    const g = packet.gsc;
    return {
      canonUrl,
      pageUrl: packet.current.pageUrl,
      currentTitle: packet.current.currentText,
      gsc: g
        ? {
            impressions: g.impressions,
            clicks: g.clicks,
            ctr: g.ctr,
            position: g.avgPosition,
            topQuery: g.topQueries[0]?.query ?? "",
          }
        : null,
      cached: c?.decision ?? null,
      stale: c != null && c.evidence_hash !== hash,
      hasOpenAi,
    };
  });
  return { rows, tenantId };
}

export async function runPageSurgeonBrief(
  canonUrl: string,
): Promise<{ ok: true; decision: PageAtomicDecision } | { ok: false; error: string }> {
  gate();
  const tenantId = await currentTenantId();
  const ctx = await loadPageSurgeonContext(tenantId);
  const packet = assemblePacketForUrl(ctx, canonUrl);
  if (packet.gsc == null) {
    return { ok: false, error: "No GSC demand data for this page — connect/refresh Search Console first." };
  }
  const hash = evidenceHash(packet);

  // Cache hit (same evidence) → return without spending OpenAI.
  const cached = await getCachedBriefs(tenantId);
  const c = cached.get(packet.current.pageUrl);
  if (c != null && c.evidence_hash === hash) {
    return { ok: true, decision: c.decision };
  }

  const decision = await judgePageAtomicChange({ packet, brand: ctx.brand });
  await saveBrief(tenantId, packet.current.pageUrl, hash, decision);
  return { ok: true, decision };
}
