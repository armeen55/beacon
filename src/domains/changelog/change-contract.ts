/**
 * Change Contract System, attribution-ready changelog backbone.
 *
 * Every logged change is a verification contract, not a history note.
 * The system makes it hard to create vague entries and easy to verify
 * whether changes actually shipped and helped.
 */

import { cache } from "react";

import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";

// ── Change Type Taxonomy ──

export const CHANGE_TYPES = [
  "faq_addition",
  "schema_addition",
  "title_meta_change",
  "hero_rewrite",
  "comparison_table",
  "internal_linking",
  "new_page_creation",
  "page_reconstruction",
  "service_page_upgrade",
  "city_page_upgrade",
  "homepage_change",
  "project_page_creation",
  "trust_page_creation",
  "entity_profile_update",
  "directory_profile_update",
  "technical_rendering_fix",
  "prerender_fix",
  "url_migration",
  "sitewide_title_meta",
  "sitewide_structural_update",
  "guide_page_creation",
  "llms_txt_update",
  "image_optimization",
  "nav_footer_update",
  "other",
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

// ── Page Type Taxonomy ──

export const PAGE_TYPES = [
  "homepage",
  "city_page",
  "service_page",
  "guide_page",
  "project_page",
  "hub_page",
  "trust_page",
  "listing_page",
  "technical",
  "profile",
  "other",
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

// ── Source Input Type ──

export type SourceInputType = "manual" | "pdf_upload" | "csv_import" | "pasted_instructions" | "duplicated_entry";

// ── Change Contract (the core type) ──

export type ChangeContract = {
  contractId: string;
  accountId: string;
  dateRequested: string;
  dateLive: string | null;
  sourceDocument: string | null;
  sourceInputType: SourceInputType;
  pageUrl: string;
  pageType: PageType;
  city: string | null;
  service: string | null;
  topic: string | null;
  changeType: ChangeType;
  changeSummary: string;
  businessGoal: string;
  intendedHypothesis: string;
  faqCountExpected: number | null;
  schemaTypesExpected: string[];
  h1Expected: string | null;
  titleExpected: string | null;
  metaExpected: string | null;
  internalLinksExpected: string[];
  expectedVerification: string[];
  expectedOutcomeWindowDays: number;
  attributionReadiness: AttributionReadiness;
  linkedIssueId: string | null;
  linkedPlanId: string | null;
  linkedWaveId: string | null;
  linkedFrontierId: string | null;
  linkedChangelogEntryId: string | null;
  verificationStatus: VerificationStatus;
  verificationResult: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  /** Owning tenant. */
  tenant_id: string;
};

// ── Verification ──

export type VerificationStatus = "pending" | "verified_match" | "verified_mismatch" | "not_applicable";

export function generateVerificationChecks(contract: ChangeContract): string[] {
  const checks: string[] = [];

  if (contract.faqCountExpected != null) {
    checks.push(`Page should have ${contract.faqCountExpected} Q&A items`);
  }
  if (contract.schemaTypesExpected?.length > 0) {
    checks.push(`Page should have structured data: ${contract.schemaTypesExpected.join(", ")}`);
  }
  if (contract.h1Expected) {
    checks.push(`Page heading should be: "${contract.h1Expected}"`);
  }
  if (contract.titleExpected) {
    checks.push(`Page title should be: "${contract.titleExpected}"`);
  }
  if (contract.internalLinksExpected?.length > 0) {
    checks.push(`Page should link to: ${contract.internalLinksExpected.join(", ")}`);
  }
  if (contract.changeType === "new_page_creation" || contract.changeType === "guide_page_creation" || contract.changeType === "project_page_creation") {
    checks.push("Page should exist and be in the sitemap");
    checks.push("Page should be scannable by Beacon");
  }
  if (contract.changeType === "prerender_fix" || contract.changeType === "technical_rendering_fix") {
    checks.push("Page should pass Beacon's render check (raw matches rendered)");
  }

  return checks.length > 0 ? checks : ["Beacon should scan the page and confirm the change is live"];
}

// ── Attribution Readiness ──

export type AttributionReadiness = "strong" | "usable" | "weak";

export function scoreAttributionReadiness(contract: Partial<ChangeContract>): {
  score: AttributionReadiness;
  issues: string[];
} {
  const issues: string[] = [];

  if (!contract.pageUrl || contract.pageUrl === "/") {
    // homepage is OK but flag generic
  } else if (!contract.pageUrl?.startsWith("/") && !contract.pageUrl?.startsWith("http")) {
    issues.push("Page URL is vague. Use an exact path like /locations/menlo-park");
  }

  if (!contract.changeSummary || contract.changeSummary.length < 15) {
    issues.push("Change description is too short. Describe what specifically changed");
  }

  const bannedPhrases = ["applied edits", "optimized pages", "updated content and structure", "based on PDF", "various improvements"];
  for (const phrase of bannedPhrases) {
    if (contract.changeSummary?.toLowerCase().includes(phrase)) {
      issues.push(`Description contains vague phrase "${phrase}". Be more specific`);
    }
  }

  if (!contract.businessGoal || contract.businessGoal.length < 10) {
    issues.push("Business goal is missing. Explain why this change matters");
  }

  if (!contract.intendedHypothesis || contract.intendedHypothesis.length < 10) {
    issues.push("Expected outcome is missing. What should improve?");
  }

  if (!contract.changeType || contract.changeType === "other") {
    issues.push("Change type is generic. Pick a specific type");
  }

  if (!contract.city && !contract.service && !contract.topic) {
    issues.push("No city, service, or topic tagged. Attribution will be weaker");
  }

  const score: AttributionReadiness =
    issues.length === 0 ? "strong"
    : issues.length <= 2 ? "usable"
    : "weak";

  return { score, issues };
}

// ── Outcome Windows ──

export const DEFAULT_OUTCOME_WINDOWS: Record<ChangeType, number> = {
  faq_addition: 14,
  schema_addition: 14,
  title_meta_change: 7,
  hero_rewrite: 14,
  comparison_table: 21,
  internal_linking: 14,
  new_page_creation: 28,
  page_reconstruction: 21,
  service_page_upgrade: 21,
  city_page_upgrade: 21,
  homepage_change: 14,
  project_page_creation: 28,
  trust_page_creation: 28,
  entity_profile_update: 21,
  directory_profile_update: 21,
  technical_rendering_fix: 7,
  prerender_fix: 7,
  url_migration: 14,
  sitewide_title_meta: 14,
  sitewide_structural_update: 21,
  guide_page_creation: 28,
  llms_txt_update: 14,
  image_optimization: 21,
  nav_footer_update: 14,
  other: 21,
};

// ── Persistence ──

// Night-shift fix (2026-06-11): 5th instance of the process-global
// cache class, `_changeContracts` was keyed by NOTHING (first tenant
// pinned its contracts for every later tenant in a warm process) AND
// the unscoped base read pulled EVERY tenant's rows on hosted. Now a
// per-tenant Map over the tenant-scoped repository read; stable array
// references preserve the in-place mutator semantics.
const _contractsByTenant = new Map<string, ChangeContract[]>();

export const getChangeContracts = cache(
  async (): Promise<ChangeContract[]> => {
    const tenantId = await currentTenantId();
    const cached = _contractsByTenant.get(tenantId);
    if (cached) return cached;
    const loaded = await getRepository().forTenant(tenantId).getChangeContracts();
    _contractsByTenant.set(tenantId, loaded);
    return loaded;
  },
);

// ── Auto-parsing helpers ──

export function inferChangeTypeFromText(text: string): ChangeType {
  const lower = text.toLowerCase();
  if (lower.includes("faq") || lower.includes("q&a")) return "faq_addition";
  if (lower.includes("schema") || lower.includes("json-ld") || lower.includes("structured data")) return "schema_addition";
  if (lower.includes("title") && lower.includes("meta")) return "title_meta_change";
  if (lower.includes("hero") || lower.includes("h1")) return "hero_rewrite";
  if (lower.includes("comparison table") || lower.includes("builder comparison")) return "comparison_table";
  if (lower.includes("internal link")) return "internal_linking";
  if (lower.includes("new page") || lower.includes("created") || lower.includes("built and published")) return "new_page_creation";
  if (lower.includes("reconstruction") || lower.includes("rebuilt") || lower.includes("overhaul")) return "page_reconstruction";
  if (lower.includes("service page") || lower.includes("/services/")) return "service_page_upgrade";
  if (lower.includes("city page") || lower.includes("/locations/")) return "city_page_upgrade";
  if (lower.includes("homepage") || lower.includes("home page")) return "homepage_change";
  if (lower.includes("project") || lower.includes("portfolio")) return "project_page_creation";
  if (lower.includes("award")) return "trust_page_creation";
  if (lower.includes("prerender") || lower.includes("server-side") || lower.includes("ssr")) return "prerender_fix";
  if (lower.includes("llms.txt")) return "llms_txt_update";
  if (lower.includes("guide")) return "guide_page_creation";
  return "other";
}

export function inferPageTypeFromUrl(url: string): PageType {
  if (url === "/" || url === "") return "homepage";
  if (url.includes("/locations/")) return "city_page";
  if (url.includes("/services/")) return "service_page";
  if (url.includes("/explore-projects/")) return "project_page";
  if (url.includes("/available-homes/")) return "listing_page";
  if (url.includes("custom-home-builder") || url.includes("luxury-home-builder")) return "guide_page";
  if (url.includes("/our-awards")) return "trust_page";
  if (url === "/services" || url === "/locations") return "hub_page";
  return "other";
}

export function inferFaqCountFromText(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:faq|q&a|question)/i);
  return match ? parseInt(match[1], 10) : null;
}

export function inferSchemaFromText(text: string): string[] {
  const schemas: string[] = [];
  const checks: [RegExp, string][] = [
    [/faqpage/i, "FAQPage"],
    [/homeandconstructionbusiness/i, "HomeAndConstructionBusiness"],
    [/article/i, "Article"],
    [/review/i, "Review"],
    [/service\b/i, "Service"],
    [/breadcrumblist/i, "BreadcrumbList"],
    [/singlefamilyresidence/i, "SingleFamilyResidence"],
    [/videoobject/i, "VideoObject"],
    [/professionalservice/i, "ProfessionalService"],
  ];
  for (const [pattern, name] of checks) {
    if (pattern.test(text) && !schemas.includes(name)) schemas.push(name);
  }
  return schemas;
}

export function suggestOutcomeWindow(changeType: ChangeType): number {
  return DEFAULT_OUTCOME_WINDOWS[changeType] ?? 21;
}

