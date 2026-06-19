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
import {
  composeArtifactBundle,
  type ArtifactBundle,
} from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";
import { qaArtifactBundle, type QaVerdict } from "@/domains/recommendation-intelligence/page-surgeon/artifact-qa";
import type { PageSurgeonContext } from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";

const TOP_N = 8;

/** Real site URLs (with titles) for deterministic internal-link resolution. */
function siteUrlsFromCtx(ctx: PageSurgeonContext): Array<{ url: string; title: string | null }> {
  const out: Array<{ url: string; title: string | null }> = [];
  for (const [, snap] of ctx.snapshotByCanon) out.push({ url: snap.url, title: snap.title ?? null });
  return out;
}

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

// ── Visual review surface (finished artifact bundle + auto-QA) ──────────────

export type PageSurgeonReviewRow = {
  canonUrl: string;
  pageUrl: string;
  currentTitle: string | null;
  gsc: { impressions: number; clicks: number; ctr: number; position: number; topQuery: string } | null;
  /** Composed finished-artifact bundle (null until the page has been run). */
  bundle: ArtifactBundle | null;
  /** Auto-QA verdict; the surface only shows the artifact when qa.pass. */
  qa: QaVerdict | null;
  stale: boolean;
  hasOpenAi: boolean;
};

function gscRow(packet: ReturnType<typeof assemblePacketForUrl>): PageSurgeonReviewRow["gsc"] {
  const g = packet.gsc;
  return g
    ? { impressions: g.impressions, clicks: g.clicks, ctr: g.ctr, position: g.avgPosition, topQuery: g.topQueries[0]?.query ?? "" }
    : null;
}

export async function listPageSurgeonReview(): Promise<{ rows: PageSurgeonReviewRow[]; tenantId: string }> {
  gate();
  const tenantId = await currentTenantId();
  const ctx = await loadPageSurgeonContext(tenantId);
  const cached = await getCachedBriefs(tenantId);
  const siteUrls = siteUrlsFromCtx(ctx);
  const hasOpenAi = (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0;

  const rows: PageSurgeonReviewRow[] = topPagesByDemand(ctx, TOP_N).map((canonUrl) => {
    const packet = assemblePacketForUrl(ctx, canonUrl);
    const hash = evidenceHash(packet);
    const c = cached.get(packet.current.pageUrl);
    let bundle: ArtifactBundle | null = null;
    let qa: QaVerdict | null = null;
    if (c) {
      bundle = composeArtifactBundle(c.decision, packet, siteUrls);
      qa = qaArtifactBundle(bundle, packet, Date.now());
    }
    return {
      canonUrl,
      pageUrl: packet.current.pageUrl,
      currentTitle: packet.current.currentText,
      gsc: gscRow(packet),
      bundle,
      qa,
      stale: c != null && c.evidence_hash !== hash,
      hasOpenAi,
    };
  });
  return { rows, tenantId };
}

export async function runPageSurgeonReview(
  canonUrl: string,
): Promise<{ ok: true; bundle: ArtifactBundle; qa: QaVerdict } | { ok: false; error: string }> {
  gate();
  const tenantId = await currentTenantId();
  const ctx = await loadPageSurgeonContext(tenantId);
  const packet = assemblePacketForUrl(ctx, canonUrl);
  if (packet.gsc == null) {
    return { ok: false, error: "No GSC demand data for this page — connect/refresh Search Console first." };
  }
  const hash = evidenceHash(packet);
  const cached = await getCachedBriefs(tenantId);
  const c = cached.get(packet.current.pageUrl);
  let decision: PageAtomicDecision;
  if (c != null && c.evidence_hash === hash) {
    decision = c.decision;
  } else {
    decision = await judgePageAtomicChange({ packet, brand: ctx.brand });
    await saveBrief(tenantId, packet.current.pageUrl, hash, decision);
  }
  const bundle = composeArtifactBundle(decision, packet, siteUrlsFromCtx(ctx));
  const qa = qaArtifactBundle(bundle, packet, Date.now());
  return { ok: true, bundle, qa };
}

/** Record the operator's review decision. PUBLISHING IS DISABLED here — this
 *  never pushes to Wix or writes content live; it only acknowledges the call. */
export async function recordReviewDecision(
  canonUrl: string,
  verdict: "approve" | "reject" | "needs_edit",
): Promise<{ ok: true; message: string }> {
  gate();
  return {
    ok: true,
    message: `Recorded "${verdict}" for ${canonUrl}. Publishing is disabled — nothing was pushed live.`,
  };
}
