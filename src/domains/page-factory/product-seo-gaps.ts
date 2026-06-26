/**
 * product-seo-gaps (2026-06-25, Sprint 6 · plan P8) — PURE.
 *
 * Once a page is classified as product/collection (commerce-classifier), this engine
 * finds the concrete on-page SEO gaps the plan calls out for store pages: missing
 * product/offer schema, missing/short meta description, a weak title, and images
 * with no alt text. Deterministic, $0, no I/O, tenant-agnostic. It only reports gaps
 * from signals the caller supplies — it never fabricates inventory or invents a fix.
 *
 * Composes with: commerce-classifier (what kind of page), image-alt-analyzer
 * (imagesMissingAlt), and the schema engine (hasProductSchema). Pinned by
 * product-seo-gaps.test.ts.
 */

import { classifyCommerceUrl, type CommercePatterns } from "./commerce-classifier";

export type ProductPageInput = {
  url: string;
  title?: string | null;
  metaDescription?: string | null;
  /** product/offer (or itemList for collections) JSON-LD present on the page */
  hasProductSchema?: boolean;
  /** count of images missing meaningful alt text (from the image-alt analyzer) */
  imagesMissingAlt?: number;
  /** when the caller knows membership from the Wix store */
  isWixProduct?: boolean;
  isWixCollection?: boolean;
};

export type ProductSeoIssue = "missing_schema" | "missing_meta" | "weak_title" | "missing_alt";

export type ProductSeoGap = {
  url: string;
  kind: "product" | "collection";
  issues: ProductSeoIssue[];
  severity: "high" | "medium";
  /** plain-language summary for a card */
  summary: string;
};

const ISSUE_LABEL: Record<ProductSeoIssue, string> = {
  missing_schema: "no product schema (AI/Google can't read price/availability)",
  missing_meta: "no meta description",
  weak_title: "thin title",
  missing_alt: "images missing alt text",
};

const MIN_TITLE_CHARS = 15;
const MIN_META_CHARS = 50;

/** Find on-page SEO gaps for commerce pages. PURE. Content pages are skipped. */
export function detectProductSeoGaps(pages: ProductPageInput[], opts: CommercePatterns = {}): ProductSeoGap[] {
  const out: ProductSeoGap[] = [];

  for (const p of pages) {
    if (!p?.url) continue;
    const cls = classifyCommerceUrl(p.url, { ...opts, isWixProduct: p.isWixProduct, isWixCollection: p.isWixCollection });
    if (cls.kind === "content") continue;

    const issues: ProductSeoIssue[] = [];
    if (p.hasProductSchema === false) issues.push("missing_schema");
    if (!p.metaDescription || p.metaDescription.trim().length < MIN_META_CHARS) issues.push("missing_meta");
    if (!p.title || p.title.trim().length < MIN_TITLE_CHARS) issues.push("weak_title");
    if ((p.imagesMissingAlt ?? 0) > 0) issues.push("missing_alt");
    if (issues.length === 0) continue;

    // High when the machine-readable schema is missing on a product (the costliest
    // commerce gap); otherwise medium.
    const severity: ProductSeoGap["severity"] = issues.includes("missing_schema") && cls.kind === "product" ? "high" : "medium";
    const summary = `${cls.kind === "product" ? "Product" : "Collection"} page: ${issues.map((i) => ISSUE_LABEL[i]).join("; ")}`;
    out.push({ url: p.url, kind: cls.kind, issues, severity, summary });
  }

  // High first, then by issue count.
  return out.sort((a, b) => (a.severity === b.severity ? b.issues.length - a.issues.length : a.severity === "high" ? -1 : 1));
}

/** Roll-up counts for a section header. PURE. */
export function summarizeProductSeoGaps(gaps: ProductSeoGap[]): { pages: number; high: number; bySchema: number; byAlt: number } {
  return {
    pages: gaps.length,
    high: gaps.filter((g) => g.severity === "high").length,
    bySchema: gaps.filter((g) => g.issues.includes("missing_schema")).length,
    byAlt: gaps.filter((g) => g.issues.includes("missing_alt")).length,
  };
}
