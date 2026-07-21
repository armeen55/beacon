/**
 * outreach/types (BEACON_500 item 57, 2026-07-02) - shared shapes for the
 * outreach execution pipeline: candidate leads mined from existing evidence,
 * and the persisted pipeline row that tracks a pitch from draft to close.
 *
 * PURE - types only, no I/O. Tenant-agnostic.
 */

export type OutreachLeadSource =
  | "wiki_gap"
  | "keyword_gap_competitor"
  | "profound_citation"
  // RANK-7 (2026-07-06): a competitor that out-links you for a query so badly you
  // cannot win on content - the digital-PR starting point. Stored as plain text
  // (outreach_pipeline.lead_source has no CHECK constraint), so no migration.
  | "link_gap";

export type OutreachStatus = "draft" | "ready" | "sent" | "replied" | "won" | "dead";

/** A persisted row in outreach_pipeline. Mirrors the migration columns. */
export type OutreachPipelineRow = {
  tenantId: string;
  id: string;
  targetDomain: string;
  targetUrl: string;
  contactEmail: string | null;
  pitchSubject: string;
  pitchBody: string;
  status: OutreachStatus;
  leadSource: OutreachLeadSource;
  sentAt: string | null;
  lastEventAt: string;
  createdAt: string;
};
