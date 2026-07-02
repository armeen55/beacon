/**
 * outreach/types (BEACON_500 item 57, 2026-07-02) - shared shapes for the
 * outreach execution pipeline: candidate leads mined from existing evidence,
 * and the persisted pipeline row that tracks a pitch from draft to close.
 *
 * PURE - types only, no I/O. Tenant-agnostic.
 */

export type OutreachLeadSource = "wiki_gap" | "keyword_gap_competitor" | "profound_citation";

export type OutreachStatus = "draft" | "ready" | "sent" | "replied" | "won" | "dead";

/** One candidate outreach target, before a pitch is drafted. */
export type OutreachLead = {
  /** Stable id derived from targetDomain + targetUrl (dedupe key). */
  id: string;
  targetDomain: string;
  targetUrl: string;
  leadSource: OutreachLeadSource;
  /** Named, honest evidence line - why this domain/url is a real lead. */
  evidence: string;
};

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

export const OUTREACH_STATUSES: readonly OutreachStatus[] = ["draft", "ready", "sent", "replied", "won", "dead"];

/** Silence window before a sent pitch is eligible for a queued follow-up draft. */
export const OUTREACH_FOLLOWUP_SILENCE_DAYS = 7;
