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

// ── Attribution Readiness ──

export type AttributionReadiness = "strong" | "usable" | "weak";

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


