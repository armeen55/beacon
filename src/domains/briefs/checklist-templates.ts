import type { BriefType } from "@/lib/constants";

type ChecklistTemplate = {
  label: string;
  sort_order: number;
};

export const CHECKLIST_TEMPLATES: Record<BriefType, ChecklistTemplate[]> = {
  page_rebuild: [
    { label: "Audit existing page content, schema, and internal links", sort_order: 1 },
    { label: "Rewrite copy with entity-first structure", sort_order: 2 },
    { label: "Implement FAQPage JSON-LD with high-intent questions", sort_order: 3 },
    { label: "Add LocalBusiness or Service schema with geo data", sort_order: 4 },
    { label: "Add project gallery / case studies with structured data", sort_order: 5 },
    { label: "Update internal links from related pages", sort_order: 6 },
    { label: "Validate with Rich Results Test", sort_order: 7 },
    { label: "Submit to Google Search Console for re-crawl", sort_order: 8 },
  ],
  new_page: [
    { label: "Define URL slug and add to site navigation", sort_order: 1 },
    { label: "Write comprehensive page content (1,500+ words)", sort_order: 2 },
    { label: "Add city-specific or topic-specific sections", sort_order: 3 },
    { label: "Implement all relevant schema markup", sort_order: 4 },
    { label: "Add project gallery or social proof block", sort_order: 5 },
    { label: "Build internal links to and from related pages", sort_order: 6 },
    { label: "Add page to XML sitemap", sort_order: 7 },
    { label: "Validate schema and submit for indexing", sort_order: 8 },
  ],
  schema_fix: [
    { label: "Audit current schema coverage across target pages", sort_order: 1 },
    { label: "Draft JSON-LD for each target page", sort_order: 2 },
    { label: "Implement schema markup", sort_order: 3 },
    { label: "Validate each page with Rich Results Test", sort_order: 4 },
    { label: "Submit updated pages to Search Console", sort_order: 5 },
    { label: "Verify indexing and rich result appearance", sort_order: 6 },
  ],
  content_update: [
    { label: "Identify content gaps vs. competitor coverage", sort_order: 1 },
    { label: "Draft new or revised content sections", sort_order: 2 },
    { label: "Publish content updates", sort_order: 3 },
    { label: "Update meta title and description", sort_order: 4 },
    { label: "Update or add relevant FAQ entries", sort_order: 5 },
    { label: "Submit for re-crawl", sort_order: 6 },
  ],
  citation_campaign: [
    { label: "Audit current directory and citation presence", sort_order: 1 },
    { label: "Prepare optimized profiles (NAP, descriptions, photos)", sort_order: 2 },
    { label: "Submit to primary directories", sort_order: 3 },
    { label: "Update existing listings with consistent NAP", sort_order: 4 },
    { label: "Secure guest post or editorial placement", sort_order: 5 },
    { label: "Create linkable resource asset on-site", sort_order: 6 },
    { label: "Monitor submission indexing weekly", sort_order: 7 },
  ],
  technical_fix: [
    { label: "Diagnose the technical issue", sort_order: 1 },
    { label: "Implement the fix", sort_order: 2 },
    { label: "Verify fix in staging / local environment", sort_order: 3 },
    { label: "Deploy to production", sort_order: 4 },
    { label: "Validate with relevant testing tool", sort_order: 5 },
    { label: "Monitor for regression over 1 week", sort_order: 6 },
  ],
  off_page: [
    { label: "Identify target sites and outreach list", sort_order: 1 },
    { label: "Draft outreach messaging or content pitch", sort_order: 2 },
    { label: "Send outreach batch", sort_order: 3 },
    { label: "Follow up on pending responses", sort_order: 4 },
    { label: "Secure placement and verify live links", sort_order: 5 },
    { label: "Monitor referral traffic and indexing", sort_order: 6 },
  ],
};
