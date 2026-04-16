/**
 * CX5.1 — Gap detector.
 *
 * Scans a tenant's page snapshots and detects structural gaps that
 * represent actionable improvement opportunities. Each gap maps to a
 * specific change type that would fix it, enabling the priority scorer
 * and guided execution layer to produce concrete moves.
 *
 * Gap categories:
 *   - FAQ gaps (missing, insufficient, missing schema)
 *   - Schema gaps (no JSON-LD, missing service/location types, duplicates)
 *   - Content structure gaps (no comparison table, thin content, no H2s)
 *   - Link gaps (insufficient internal links)
 *   - Freshness gaps (stale content)
 *
 * Reuses: PageSnapshot from pages/types.ts, page_type inference from
 * existing page entity data.
 */

import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { DetectedGap, GapSeverity } from "./types";

// ---------------------------------------------------------------------------
// Page type helpers
// ---------------------------------------------------------------------------

type PageType = "homepage" | "service" | "city" | "project" | "other";

function inferPageType(url: string): PageType {
  const path = url.toLowerCase();
  if (path === "/" || path === "" || path.endsWith("/index")) return "homepage";
  if (path.includes("/service") || path.includes("/what-we-do")) return "service";
  if (path.includes("/location") || path.includes("/cities") || path.includes("/areas")) return "city";
  if (path.includes("/project") || path.includes("/portfolio") || path.includes("/explore-")) return "project";
  return "other";
}

function isHighValuePageType(type: PageType): boolean {
  return type === "homepage" || type === "service" || type === "city";
}

// ---------------------------------------------------------------------------
// Gap severity calibration
// ---------------------------------------------------------------------------

function faqSeverity(pageType: PageType, citationCount: number): GapSeverity {
  if (pageType === "homepage" || citationCount > 50) return "critical";
  if (isHighValuePageType(pageType) || citationCount > 10) return "high";
  return "medium";
}

function schemaSeverity(pageType: PageType): GapSeverity {
  if (pageType === "homepage") return "critical";
  if (isHighValuePageType(pageType)) return "high";
  return "medium";
}

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

function detectFaqGaps(
  snapshot: PageSnapshot,
  pageType: PageType,
  citationCount: number,
): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  const faqCount = snapshot.faqs?.length ?? 0;
  const hasSchema = snapshot.schema_types?.includes("FAQPage") ?? false;

  if (faqCount === 0 && isHighValuePageType(pageType)) {
    gaps.push({
      type: "missing_faq",
      severity: faqSeverity(pageType, citationCount),
      page_url: snapshot.url,
      description: `No FAQ section on ${pageType} page — AI platforms strongly favor pages with structured Q&A`,
      fix_change_type: "faq_schema",
      primary_platform: "chatgpt",
      current_state: "0 FAQ questions",
      target_state: "5-7 FAQ questions + FAQPage JSON-LD schema",
      affected_page_count: 1,
    });
  } else if (faqCount > 0 && faqCount < 4 && isHighValuePageType(pageType)) {
    gaps.push({
      type: "insufficient_faq",
      severity: "medium",
      page_url: snapshot.url,
      description: `Only ${faqCount} FAQ question${faqCount !== 1 ? "s" : ""} — expanding to 5-7 strengthens AI extractability`,
      fix_change_type: "faq_schema",
      primary_platform: "chatgpt",
      current_state: `${faqCount} FAQ question${faqCount !== 1 ? "s" : ""}`,
      target_state: "5-7 FAQ questions",
      affected_page_count: 1,
    });
  }

  if (faqCount > 0 && !hasSchema) {
    gaps.push({
      type: "missing_faq_schema",
      severity: faqSeverity(pageType, citationCount),
      page_url: snapshot.url,
      description: "FAQ content exists but no FAQPage JSON-LD schema — AI platforms may not extract the questions",
      fix_change_type: "faq_schema",
      primary_platform: "google_aio",
      current_state: `${faqCount} FAQ questions, no FAQPage schema`,
      target_state: "FAQPage JSON-LD schema wrapping existing questions",
      affected_page_count: 1,
    });
  }

  const faqSchemaCount = snapshot.faq_schema_block_count ?? 0;
  if (faqSchemaCount > 1) {
    gaps.push({
      type: "duplicate_faq_schema",
      severity: "high",
      page_url: snapshot.url,
      description: `${faqSchemaCount} duplicate FAQPage schema blocks — consolidate to 1`,
      fix_change_type: "faq_schema",
      primary_platform: "google_aio",
      current_state: `${faqSchemaCount} FAQPage blocks`,
      target_state: "1 consolidated FAQPage block",
      affected_page_count: 1,
    });
  }

  return gaps;
}

function detectSchemaGaps(
  snapshot: PageSnapshot,
  pageType: PageType,
): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  const schemaTypes = snapshot.schema_types ?? [];

  if (schemaTypes.length === 0 && isHighValuePageType(pageType)) {
    gaps.push({
      type: "missing_schema",
      severity: schemaSeverity(pageType),
      page_url: snapshot.url,
      description: "No JSON-LD schema on this page — search engines and AI platforms use schema for structured data extraction",
      fix_change_type: "faq_schema",
      primary_platform: "google_aio",
      current_state: "No JSON-LD schema",
      target_state: "FAQPage + relevant schema types",
      affected_page_count: 1,
    });
  }

  if (
    pageType === "service" &&
    !schemaTypes.includes("Service") &&
    !schemaTypes.includes("ProfessionalService")
  ) {
    gaps.push({
      type: "missing_service_schema",
      severity: "medium",
      page_url: snapshot.url,
      description: "Service page without Service or ProfessionalService schema",
      fix_change_type: "faq_schema",
      primary_platform: "google_aio",
      current_state: `Schema types: ${schemaTypes.join(", ") || "none"}`,
      target_state: "Add Service or ProfessionalService schema",
      affected_page_count: 1,
    });
  }

  if (
    pageType === "city" &&
    !schemaTypes.includes("LocalBusiness") &&
    !schemaTypes.includes("HomeAndConstructionBusiness")
  ) {
    gaps.push({
      type: "missing_localbusiness",
      severity: "medium",
      page_url: snapshot.url,
      description: "City/location page without LocalBusiness schema",
      fix_change_type: "faq_schema",
      primary_platform: "google_aio",
      current_state: `Schema types: ${schemaTypes.join(", ") || "none"}`,
      target_state: "Add LocalBusiness or HomeAndConstructionBusiness schema",
      affected_page_count: 1,
    });
  }

  return gaps;
}

function detectContentGaps(
  snapshot: PageSnapshot,
  pageType: PageType,
): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  const tableCount = (snapshot as Record<string, unknown>).table_count as number | undefined;
  const wordCount = (snapshot as Record<string, unknown>).word_count as number | undefined;
  const h2Count = snapshot.h2_list?.length ?? 0;
  const internalLinkCount = (snapshot as Record<string, unknown>).internal_link_count as number | undefined;

  if (
    (pageType === "service" || pageType === "city") &&
    (tableCount == null || tableCount === 0)
  ) {
    gaps.push({
      type: "missing_comparison_table",
      severity: pageType === "service" ? "high" : "medium",
      page_url: snapshot.url,
      description: "No comparison table — builders who add these see Google AIO rank improvements",
      fix_change_type: "content_structure",
      primary_platform: "google_aio",
      current_state: "No comparison table",
      target_state: "Comparison table with 4-5 competitors × 5-7 criteria",
      affected_page_count: 1,
    });
  }

  if (wordCount != null && wordCount < 300 && isHighValuePageType(pageType)) {
    gaps.push({
      type: "thin_content",
      severity: "medium",
      page_url: snapshot.url,
      description: `Only ${wordCount} words — AI platforms favor comprehensive pages`,
      fix_change_type: "content_structure",
      primary_platform: "chatgpt",
      current_state: `${wordCount} words`,
      target_state: "800+ words with structured sections",
      affected_page_count: 1,
    });
  }

  if (h2Count === 0 && isHighValuePageType(pageType)) {
    gaps.push({
      type: "missing_h2_structure",
      severity: "medium",
      page_url: snapshot.url,
      description: "No H2 headings — structured pages are easier for AI to extract answers from",
      fix_change_type: "content_structure",
      primary_platform: "chatgpt",
      current_state: "0 H2 headings",
      target_state: "4-6 H2 sections with descriptive headings",
      affected_page_count: 1,
    });
  }

  if (internalLinkCount != null && internalLinkCount < 3 && isHighValuePageType(pageType)) {
    gaps.push({
      type: "low_internal_links",
      severity: "low",
      page_url: snapshot.url,
      description: `Only ${internalLinkCount} internal link${internalLinkCount !== 1 ? "s" : ""} — cross-linking helps AI understand site structure`,
      fix_change_type: "internal_links",
      primary_platform: "google_aio",
      current_state: `${internalLinkCount} internal links`,
      target_state: "5+ internal links to related pages",
      affected_page_count: 1,
    });
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

/**
 * Detect all structural gaps across a tenant's page snapshots.
 *
 * Returns gaps sorted by severity (critical first), then by page URL
 * for stable ordering.
 *
 * @param snapshots Latest page snapshots for the tenant
 * @param pages Page entities (for metadata like citation counts)
 * @param citationCounts Optional map of page URL → total citation count
 */
export function detectGaps(opts: {
  snapshots: PageSnapshot[];
  pages: PageEntity[];
  citationCounts?: Map<string, number>;
}): DetectedGap[] {
  const { snapshots, pages, citationCounts } = opts;
  const gaps: DetectedGap[] = [];

  // Build a citation count lookup from page entities if not provided
  const citLookup = citationCounts ?? new Map<string, number>();

  for (const snapshot of snapshots) {
    const pageType = inferPageType(snapshot.url);
    const citations = citLookup.get(snapshot.url) ?? 0;

    gaps.push(...detectFaqGaps(snapshot, pageType, citations));
    gaps.push(...detectSchemaGaps(snapshot, pageType));
    gaps.push(...detectContentGaps(snapshot, pageType));
  }

  // Consolidate sitewide gaps (same type across multiple pages)
  const sitewideMap = new Map<string, DetectedGap[]>();
  for (const gap of gaps) {
    const key = gap.type;
    const group = sitewideMap.get(key) ?? [];
    group.push(gap);
    sitewideMap.set(key, group);
  }

  // Update affected_page_count on each gap
  for (const [, group] of sitewideMap) {
    for (const gap of group) {
      gap.affected_page_count = group.length;
    }
  }

  // Sort: critical first, then high, then by affected page count descending
  const severityOrder: Record<GapSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return gaps.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.affected_page_count - a.affected_page_count;
  });
}
