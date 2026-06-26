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

export async function scanImageAltAction(opts: { max?: number } = {}): Promise<ImageAltScanResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    const urls = [...new Set(graph.pageNodes.filter((p) => p.isOwned).map((p) => p.url))].slice(0, opts.max ?? MAX_PAGES);
    if (urls.length === 0) return { ok: false, reason: "No owned pages to scan." };

    const reports: ImageAltPageReport[] = [];
    const productInputs: ProductPageInput[] = [];
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
        // Product-SEO gaps (P8): reuse the SAME fetched HTML — no extra request, $0.
        const seo = extractPageSeoSignals(res.html);
        productInputs.push({
          url,
          title: seo.title,
          metaDescription: seo.metaDescription,
          hasProductSchema: seo.hasProductSchema,
          imagesMissingAlt: findings.length,
        });
      } catch {
        /* per-page fail-soft */
      }
    }
    const productGaps = detectProductSeoGaps(productInputs);
    await saveMoveDraft(tenantId, STORE_REC, "image_alt_findings", JSON.stringify(reports)).catch(() => false);
    await saveMoveDraft(tenantId, STORE_REC, "product_seo_findings", JSON.stringify(productGaps)).catch(() => false);
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
}> {
  const empty = {
    reports: [] as ImageAltPageReport[],
    summary: { total: 0, missing: 0, poor: 0, withSuggestion: 0 },
    productGaps: [] as ProductSeoGap[],
    productSummary: { pages: 0, high: 0, bySchema: 0, byAlt: 0 },
  };
  try {
    const drafts = await getLatestMoveDrafts(tenantId);
    const imgRow = drafts.get(`${STORE_REC}::image_alt_findings`);
    const prodRow = drafts.get(`${STORE_REC}::product_seo_findings`);
    const reports = imgRow ? (JSON.parse(imgRow.content) as ImageAltPageReport[]) : [];
    const productGaps = prodRow ? (JSON.parse(prodRow.content) as ProductSeoGap[]) : [];
    return {
      reports,
      summary: summarizeImageAlt(reports.flatMap((r) => r.findings)),
      productGaps,
      productSummary: summarizeProductSeoGaps(productGaps),
    };
  } catch {
    return empty;
  }
}
