"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { fetchPageHtml } from "@/domains/competitor-intel/polite-fetch";
import { analyzeImageAlt, summarizeImageAlt, type ImageAltFinding } from "@/domains/page-factory/image-alt-analyzer";
import { classifyCommerceUrl, type CommerceKind } from "@/domains/page-factory/commerce-classifier";
import { extractPageSeoSignals } from "@/domains/page-factory/extract-page-seo";
import { detectProductSeoGaps, summarizeProductSeoGaps, type ProductPageInput, type ProductSeoGap } from "@/domains/page-factory/product-seo-gaps";
import { extractWinnerSignals, type WinnerSignals } from "@/domains/competitor-intel/winner-patterns";
import { saveMoveDraft, getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";

/**
 * image-alt-actions (2026-06-25, Sprint 6) — operator-triggered image-alt scan. One
 * click fetches the top-N OWNED pages (polite-fetch, $0, capped), runs the pure
 * image-alt analyzer, and persists findings (move_drafts kind=image_alt_findings —
 * free text, no migration). NO publish, NO Wix write — read-only analysis the
 * operator acts on manually.
 */

const STORE_REC = "__image_alt_scan__";
const MAX_PAGES = 6;

export type ImageAltScanResult =
  | { ok: false; reason: string }
  | { ok: true; pagesScanned: number; imagesFlagged: number };

export type ImageAltPageReport = { url: string; findings: ImageAltFinding[]; kind?: CommerceKind };
export type EeatPageReport = { url: string; eeat: WinnerSignals };

function hostOf(url: string): string | null {
  const m = url.trim().match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./i, "").toLowerCase() : null;
}

/** Aggregate own-page E-E-A-T coverage (how many scanned pages have each signal). */
function summarizeEeat(pages: EeatPageReport[]): { pages: number; byline: number; credentials: number; dates: number; citations: number; reviewSchema: number } {
  const has = (pick: (e: WinnerSignals) => boolean) => pages.filter((p) => pick(p.eeat)).length;
  return {
    pages: pages.length,
    byline: has((e) => e.hasAuthorByline),
    credentials: has((e) => e.hasAuthorCredentials),
    dates: has((e) => e.hasPublishedDate || e.hasUpdatedDate),
    citations: has((e) => e.outboundCitations >= 3),
    reviewSchema: has((e) => e.hasReviewSchema),
  };
}

export async function scanImageAltAction(opts: { max?: number } = {}): Promise<ImageAltScanResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    const urls = [...new Set(graph.pageNodes.filter((p) => p.isOwned).map((p) => p.url))].slice(0, opts.max ?? MAX_PAGES);
    if (urls.length === 0) return { ok: false, reason: "No owned pages to scan." };

    const reports: ImageAltPageReport[] = [];
    const productInputs: ProductPageInput[] = [];
    const eeatPages: EeatPageReport[] = [];
    let flagged = 0;
    const robotsCache = new Map<string, string[]>();
    for (const url of urls) {
      try {
        const res = await fetchPageHtml(url, robotsCache);
        if (!res.ok) continue;
        const findings = analyzeImageAlt(res.html, { pageTitle: null, max: 20 });
        const kind = classifyCommerceUrl(url).kind;
        if (findings.length > 0) {
          reports.push({ url, findings, kind });
          flagged += findings.length;
        }
        // Product-SEO gaps (P8) + own-page E-E-A-T (P9): reuse the SAME fetched
        // HTML — no extra request, $0.
        const seo = extractPageSeoSignals(res.html);
        productInputs.push({
          url,
          title: seo.title,
          metaDescription: seo.metaDescription,
          hasProductSchema: seo.hasProductSchema,
          imagesMissingAlt: findings.length,
        });
        eeatPages.push({ url, eeat: extractWinnerSignals(res.html, { ownHost: hostOf(url) }) });
      } catch {
        /* per-page fail-soft */
      }
    }
    const productGaps = detectProductSeoGaps(productInputs);
    await saveMoveDraft(tenantId, STORE_REC, "image_alt_findings", JSON.stringify(reports)).catch(() => false);
    await saveMoveDraft(tenantId, STORE_REC, "product_seo_findings", JSON.stringify(productGaps)).catch(() => false);
    await saveMoveDraft(tenantId, STORE_REC, "page_eeat_findings", JSON.stringify(eeatPages)).catch(() => false);
    revalidatePath("/");
    return { ok: true, pagesScanned: urls.length, imagesFlagged: flagged };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 140) : "image scan failed" };
  }
}

/** Read the last persisted scan (image-alt + product-SEO gaps). Fail-soft. */
export async function loadImageAltReports(tenantId: string): Promise<{
  reports: ImageAltPageReport[];
  summary: ReturnType<typeof summarizeImageAlt>;
  productGaps: ProductSeoGap[];
  productSummary: ReturnType<typeof summarizeProductSeoGaps>;
  eeatSummary: ReturnType<typeof summarizeEeat>;
}> {
  const empty = {
    reports: [] as ImageAltPageReport[],
    summary: { total: 0, missing: 0, poor: 0, withSuggestion: 0 },
    productGaps: [] as ProductSeoGap[],
    productSummary: { pages: 0, high: 0, bySchema: 0, byAlt: 0 },
    eeatSummary: { pages: 0, byline: 0, credentials: 0, dates: 0, citations: 0, reviewSchema: 0 },
  };
  try {
    const drafts = await getLatestMoveDrafts(tenantId);
    const imgRow = drafts.get(`${STORE_REC}::image_alt_findings`);
    const prodRow = drafts.get(`${STORE_REC}::product_seo_findings`);
    const eeatRow = drafts.get(`${STORE_REC}::page_eeat_findings`);
    const reports = imgRow ? (JSON.parse(imgRow.content) as ImageAltPageReport[]) : [];
    const productGaps = prodRow ? (JSON.parse(prodRow.content) as ProductSeoGap[]) : [];
    const eeatPages = eeatRow ? (JSON.parse(eeatRow.content) as EeatPageReport[]) : [];
    return {
      reports,
      summary: summarizeImageAlt(reports.flatMap((r) => r.findings)),
      productGaps,
      productSummary: summarizeProductSeoGaps(productGaps),
      eeatSummary: summarizeEeat(eeatPages),
    };
  } catch {
    return empty;
  }
}
