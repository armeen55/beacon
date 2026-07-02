import "server-only";

import { log } from "@/lib/logger";
import { mineOutreachLeads } from "./mine-leads";
import { draftOutreachPitch, draftOutreachFollowup } from "./draft-pitch";
import {
  listOutreachRows,
  upsertOutreachDraft,
  setOutreachStatus,
  updateOutreachDraftText,
} from "./outreach-store";
import { leadId } from "./compute-leads";
import type { OutreachLead, OutreachPipelineRow, OutreachStatus } from "./types";
import { OUTREACH_FOLLOWUP_SILENCE_DAYS } from "./types";

/**
 * outreach/pipeline (BEACON_500 item 57, 2026-07-02) - the orchestration facade
 * the surface (server actions) calls into. Ties together: lead mining (mine-
 * leads.ts, $0, reads existing evidence), pitch drafting (draft-pitch.ts,
 * budget-gated LLM), and the persisted pipeline (outreach-store.ts). Does NOT
 * import sendEmail - sending lives exclusively in send-pitch.ts, triggered only
 * by the operator's Send click in the surface layer.
 */

export type MineLeadsForTenantResult = {
  leads: OutreachLead[];
  alreadyInPipeline: number;
  message: string;
};

/** Mine leads and report which ones are already tracked (vs net-new). Does not
 *  write anything - drafting a pitch is a separate, explicit operator step. */
export async function mineLeadsForTenant(tenantId: string, ownDomain: string): Promise<MineLeadsForTenantResult> {
  const [{ leads, sourcesChecked }, existingRows] = await Promise.all([
    mineOutreachLeads(tenantId, ownDomain),
    listOutreachRows(tenantId),
  ]);
  const existingIds = new Set(existingRows.map((r) => r.id));
  const alreadyInPipeline = leads.filter((l) => existingIds.has(l.id)).length;

  if (leads.length === 0) {
    const ranAny = sourcesChecked.wikiGap || sourcesChecked.keywordGap || sourcesChecked.profound;
    return {
      leads: [],
      alreadyInPipeline: 0,
      message: ranAny
        ? "I checked your existing wiki-gap, keyword-gap, and AI citation data but did not find a pitchable domain yet. Run those checks again once you have more data."
        : "I do not have wiki-gap, keyword-gap, or AI citation data to mine yet. Run those checks on this page first, then come back here.",
    };
  }

  const newCount = leads.length - alreadyInPipeline;
  return {
    leads,
    alreadyInPipeline,
    message: `I found ${leads.length} outreach lead${leads.length === 1 ? "" : "s"} from your existing data (${newCount} new, ${alreadyInPipeline} already tracked). Draft a pitch for the ones you want to pursue.`,
  };
}

export type DraftPitchForLeadResult =
  | { ok: true; row: OutreachPipelineRow }
  | { ok: false; reason: string };

/** Operator-triggered: draft (or re-draft) a pitch for one lead and persist it
 *  as a 'draft' row. Never sends. */
export async function draftPitchForLead(
  tenantId: string,
  lead: OutreachLead,
  own: { name: string; domain: string; context: string },
): Promise<DraftPitchForLeadResult> {
  const result = await draftOutreachPitch({
    lead,
    ownName: own.name,
    ownDomain: own.domain,
    ownContext: own.context,
  });

  if (result.status !== "drafted") {
    const reason =
      result.status === "off"
        ? "The AI drafter is off. Turn on BEACON_LLM_PROVIDER to draft pitches."
        : result.status === "blocked_budget"
          ? result.reason
          : `I could not draft a trustworthy pitch (${result.reason}). Try again.`;
    log.warn("[outreach] draft failed", { tenantId, leadId: lead.id, status: result.status });
    return { ok: false, reason };
  }

  const id = lead.id || leadId(lead.leadSource, lead.targetDomain, lead.targetUrl);
  const saved = await upsertOutreachDraft(tenantId, {
    id,
    targetDomain: lead.targetDomain,
    targetUrl: lead.targetUrl,
    pitchSubject: result.value.subject,
    pitchBody: result.value.body,
    leadSource: lead.leadSource,
    status: "draft",
  });
  if (!saved) return { ok: false, reason: "I drafted the pitch but could not save it. Try again." };

  return {
    ok: true,
    row: {
      tenantId,
      id,
      targetDomain: lead.targetDomain,
      targetUrl: lead.targetUrl,
      contactEmail: null,
      pitchSubject: result.value.subject,
      pitchBody: result.value.body,
      status: "draft",
      leadSource: lead.leadSource,
      sentAt: null,
      lastEventAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  };
}

/** All pipeline rows for the tenant (the surface's table). */
export async function loadOutreachPipeline(tenantId: string): Promise<OutreachPipelineRow[]> {
  return listOutreachRows(tenantId);
}

/** Manual status transition (ready/replied/won/dead) - never 'sent'. */
export async function transitionOutreachStatus(
  tenantId: string,
  id: string,
  status: Exclude<OutreachStatus, "sent">,
): Promise<boolean> {
  return setOutreachStatus(tenantId, id, status);
}

/** Save an operator's manual edit to a draft's subject/body/contact email. */
export async function editOutreachDraft(
  tenantId: string,
  id: string,
  patch: { pitchSubject?: string; pitchBody?: string; contactEmail?: string | null },
): Promise<boolean> {
  return updateOutreachDraftText(tenantId, id, patch);
}

/** True when a sent row has gone silent long enough to be worth a follow-up. */
export function isFollowupEligible(row: OutreachPipelineRow, now: Date = new Date()): boolean {
  if (row.status !== "sent" || !row.sentAt) return false;
  const days = (now.getTime() - Date.parse(row.sentAt)) / (24 * 60 * 60 * 1000);
  return days >= OUTREACH_FOLLOWUP_SILENCE_DAYS;
}

/**
 * Operator-triggered: draft a follow-up for a silent-N-days row as a NEW queued
 * draft row (id suffixed `-followup`) - it does NOT touch the original sent row
 * and it does NOT send anything. The operator reviews and clicks Send on it like
 * any other draft.
 */
export async function draftFollowupForRow(
  tenantId: string,
  row: OutreachPipelineRow,
  own: { name: string; domain: string; context: string },
  now: Date = new Date(),
): Promise<DraftPitchForLeadResult> {
  if (!isFollowupEligible(row, now)) {
    return { ok: false, reason: "This pitch has not been silent long enough yet for a follow-up." };
  }
  const days = Math.floor((now.getTime() - Date.parse(row.sentAt!)) / (24 * 60 * 60 * 1000));
  const lead: OutreachLead = {
    id: row.id,
    targetDomain: row.targetDomain,
    targetUrl: row.targetUrl,
    leadSource: row.leadSource,
    evidence: `Original pitch sent ${days} days ago, no reply yet.`,
  };
  const result = await draftOutreachFollowup({
    lead,
    ownName: own.name,
    ownDomain: own.domain,
    ownContext: own.context,
    originalSubject: row.pitchSubject,
    daysSinceSent: days,
  });

  if (result.status !== "drafted") {
    const reason =
      result.status === "off"
        ? "The AI drafter is off. Turn on BEACON_LLM_PROVIDER to draft follow-ups."
        : result.status === "blocked_budget"
          ? result.reason
          : `I could not draft a trustworthy follow-up (${result.reason}). Try again.`;
    return { ok: false, reason };
  }

  const followupId = `${row.id}-followup-${Date.now()}`;
  const saved = await upsertOutreachDraft(tenantId, {
    id: followupId,
    targetDomain: row.targetDomain,
    targetUrl: row.targetUrl,
    contactEmail: row.contactEmail,
    pitchSubject: result.value.subject,
    pitchBody: result.value.body,
    leadSource: row.leadSource,
    status: "draft",
  });
  if (!saved) return { ok: false, reason: "I drafted the follow-up but could not save it. Try again." };

  return {
    ok: true,
    row: {
      tenantId,
      id: followupId,
      targetDomain: row.targetDomain,
      targetUrl: row.targetUrl,
      contactEmail: row.contactEmail,
      pitchSubject: result.value.subject,
      pitchBody: result.value.body,
      status: "draft",
      leadSource: row.leadSource,
      sentAt: null,
      lastEventAt: now.toISOString(),
      createdAt: now.toISOString(),
    },
  };
}
