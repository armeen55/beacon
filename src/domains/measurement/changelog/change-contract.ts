/**
 * Change Contract System, attribution-ready changelog backbone.
 *
 * Every logged change is a verification contract, not a history note.
 * The system makes it hard to create vague entries and easy to verify
 * whether changes actually shipped and helped.
 */

// ── Change Type Taxonomy ──

type ChangeType =
  | "faq_addition"
  | "schema_addition"
  | "title_meta_change"
  | "hero_rewrite"
  | "comparison_table"
  | "internal_linking"
  | "new_page_creation"
  | "page_reconstruction"
  | "service_page_upgrade"
  | "city_page_upgrade"
  | "homepage_change"
  | "project_page_creation"
  | "trust_page_creation"
  | "entity_profile_update"
  | "directory_profile_update"
  | "technical_rendering_fix"
  | "prerender_fix"
  | "url_migration"
  | "sitewide_title_meta"
  | "sitewide_structural_update"
  | "guide_page_creation"
  | "llms_txt_update"
  | "image_optimization"
  | "nav_footer_update"
  | "other";

// ── Page Type Taxonomy ──

export type PageType =
  | "homepage"
  | "city_page"
  | "service_page"
  | "guide_page"
  | "project_page"
  | "hub_page"
  | "trust_page"
  | "listing_page"
  | "technical"
  | "profile"
  | "other";

// ── Source Input Type ──

type SourceInputType = "manual" | "pdf_upload" | "csv_import" | "pasted_instructions" | "duplicated_entry";

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

type VerificationStatus = "pending" | "verified_match" | "verified_mismatch" | "not_applicable";

// ── Attribution Readiness ──

type AttributionReadiness = "strong" | "usable" | "weak";
