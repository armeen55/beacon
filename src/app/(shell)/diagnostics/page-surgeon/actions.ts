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
  getBriefHistory,
  getCachedBriefs,
  saveBrief,
  type BriefHistoryEntry,
} from "@/domains/recommendation-intelligence/page-surgeon/brief-store";
import { judgePageAtomicChange } from "@/domains/recommendation-intelligence/page-surgeon/llm-judge";
import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";
import {
  composeArtifactBundle,
  type ArtifactBundle,
} from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";
import { qaArtifactBundle, type QaVerdict } from "@/domains/recommendation-intelligence/page-surgeon/artifact-qa";
import {
  getLatestReviewDecisions,
  recordReviewDecisionRow,
  type ReviewVerdict,
} from "@/domains/recommendation-intelligence/page-surgeon/review-store";
import type { PageSurgeonContext } from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";

const TOP_N = 8;

/** Real site URLs (with titles) for deterministic internal-link resolution. */
function siteUrlsFromCtx(ctx: PageSurgeonContext): Array<{ url: string; title: string | null }> {
  const out: Array<{ url: string; title: string | null }> = [];
  for (const [, snap] of ctx.snapshotByCanon) out.push({ url: snap.url, title: snap.title ?? null });
  return out;
}

const toPath = (u: string): string => u.replace(/^https?:\/\/[^/]+/, "") || "/";

/** Up to 3 comparable unchanged pages (by demand) to use as diff-in-diff
 *  controls in the measurement plan — excludes the page being changed. */
function controlPathsFor(topUrls: string[], currentCanon: string): string[] {
  return topUrls.filter((u) => u !== currentCanon).map(toPath).slice(0, 3);
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
  /** The operator's last persisted review verdict for this page (null if none). */
  reviewVerdict: ReviewVerdict | null;
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
  const decisions = await getLatestReviewDecisions(tenantId);
  const siteUrls = siteUrlsFromCtx(ctx);
  const hasOpenAi = (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0;

  const topUrls = topPagesByDemand(ctx, TOP_N);
  const rows: PageSurgeonReviewRow[] = topUrls.map((canonUrl) => {
    const packet = assemblePacketForUrl(ctx, canonUrl);
    const hash = evidenceHash(packet);
    const c = cached.get(packet.current.pageUrl);
    let bundle: ArtifactBundle | null = null;
    let qa: QaVerdict | null = null;
    if (c) {
      bundle = composeArtifactBundle(c.decision, packet, siteUrls, controlPathsFor(topUrls, canonUrl));
      qa = qaArtifactBundle(bundle, packet, Date.now());
    }
    return {
      canonUrl,
      pageUrl: packet.current.pageUrl,
      currentTitle: packet.current.currentText,
      gsc: gscRow(packet),
      bundle,
      qa,
      reviewVerdict: decisions.get(packet.current.pageUrl)?.verdict ?? null,
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
  const controls = controlPathsFor(topPagesByDemand(ctx, TOP_N), canonUrl);
  const bundle = composeArtifactBundle(decision, packet, siteUrlsFromCtx(ctx), controls);
  const qa = qaArtifactBundle(bundle, packet, Date.now());
  return { ok: true, bundle, qa };
}

/** Append-only change history for a page (newest first). On-demand read so the
 *  list surface never pays for it. */
export async function getPageSurgeonHistory(pageUrl: string): Promise<BriefHistoryEntry[]> {
  gate();
  const tenantId = await currentTenantId();
  return getBriefHistory(tenantId, pageUrl);
}

/** Record the operator's review decision — now PERSISTED (append-only), tied to
 *  the evidence_hash reviewed so it survives a reload. PUBLISHING IS DISABLED
 *  here — this never pushes to Wix or writes content live. */
export async function recordReviewDecision(
  canonUrl: string,
  verdict: ReviewVerdict,
  note?: string | null,
): Promise<{ ok: true; message: string }> {
  gate();
  const tenantId = await currentTenantId();
  const ctx = await loadPageSurgeonContext(tenantId);
  const packet = assemblePacketForUrl(ctx, canonUrl);
  const pageUrl = packet.current.pageUrl;
  const hash = packet.gsc ? evidenceHash(packet) : "";
  const saved = await recordReviewDecisionRow(tenantId, pageUrl, verdict, hash, note);
  return {
    ok: true,
    message: saved
      ? `Recorded "${verdict}" for ${pageUrl}. Publishing is disabled — nothing was pushed live.`
      : `Captured "${verdict}" (persist unavailable — logged). Publishing is disabled — nothing was pushed live.`,
  };
}
