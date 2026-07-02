"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import {
  mineLeadsForTenant,
  draftPitchForLead,
  loadOutreachPipeline,
  transitionOutreachStatus,
  editOutreachDraft,
  draftFollowupForRow,
} from "@/domains/outreach/pipeline";
import { sendOutreachPitch } from "@/domains/outreach/send-pitch";
import type { OutreachLead, OutreachPipelineRow, OutreachStatus } from "@/domains/outreach/types";

/**
 * outreach-actions (BEACON_500 item 57, 2026-07-02) - the operator-gated server
 * actions behind the outreach pipeline section on /competitors. Every action
 * checks isOperatorModeServer() first. The ONLY action that can send an email is
 * sendOutreachPitchAction, which calls send-pitch.ts's sendOutreachPitch - the
 * exclusive, operator-click-only send path (see send-pitch.ts's module comment).
 */

async function ownContext(): Promise<{ name: string; domain: string; context: string }> {
  const cfg = await getBusinessConfigForCurrentTenant();
  return {
    name: cfg.name || cfg.domain || "our site",
    domain: cfg.domain || "",
    context: cfg.industry ? `a ${cfg.industry} site` : "our site's relevant content",
  };
}

export async function loadOutreachPipelineAction(): Promise<OutreachPipelineRow[]> {
  if (!(await isOperatorModeServer())) return [];
  const tenantId = await currentTenantId();
  return loadOutreachPipeline(tenantId);
}

export type MineLeadsActionResponse =
  | { ok: false; reason: string }
  | { ok: true; leads: OutreachLead[]; message: string };

export async function mineOutreachLeadsAction(): Promise<MineLeadsActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const cfg = await getBusinessConfigForCurrentTenant();
  const r = await mineLeadsForTenant(tenantId, cfg.domain || "");
  return { ok: true, leads: r.leads, message: r.message };
}

export type DraftPitchActionResponse =
  | { ok: false; reason: string }
  | { ok: true; row: OutreachPipelineRow };

export async function draftOutreachPitchAction(lead: OutreachLead): Promise<DraftPitchActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const own = await ownContext();
  const r = await draftPitchForLead(tenantId, lead, own);
  if (r.ok) revalidatePath("/competitors");
  return r;
}

export async function draftOutreachFollowupAction(row: OutreachPipelineRow): Promise<DraftPitchActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const own = await ownContext();
  const r = await draftFollowupForRow(tenantId, row, own);
  if (r.ok) revalidatePath("/competitors");
  return r;
}

export async function editOutreachDraftAction(
  id: string,
  patch: { pitchSubject?: string; pitchBody?: string; contactEmail?: string | null },
): Promise<{ ok: boolean }> {
  if (!(await isOperatorModeServer())) return { ok: false };
  const tenantId = await currentTenantId();
  const ok = await editOutreachDraft(tenantId, id, patch);
  if (ok) revalidatePath("/competitors");
  return { ok };
}

export async function setOutreachStatusAction(
  id: string,
  status: Exclude<OutreachStatus, "sent">,
): Promise<{ ok: boolean }> {
  if (!(await isOperatorModeServer())) return { ok: false };
  const tenantId = await currentTenantId();
  const ok = await transitionOutreachStatus(tenantId, id, status);
  if (ok) revalidatePath("/competitors");
  return { ok };
}

export type SendOutreachActionResponse = { ok: true } | { ok: false; reason: string };

/**
 * THE operator's Send click. This is the only server action in the app that may
 * cause an outreach email to leave Beacon - it exists to require an explicit,
 * per-row, per-click confirmation (CRITICAL SAFETY RULE, item 57).
 */
export async function sendOutreachPitchAction(id: string): Promise<SendOutreachActionResponse> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator only." };
  const tenantId = await currentTenantId();
  const r = await sendOutreachPitch(tenantId, id);
  if (r.ok) {
    revalidatePath("/competitors");
    return { ok: true };
  }
  const reasons: Record<string, string> = {
    not_found: "I could not find that pitch.",
    already_sent: "That pitch was already sent.",
    no_contact_email: "Add a contact email before sending.",
    not_configured: "Email is not connected yet, so I cannot send this.",
    send_failed: "The send failed. Try again in a minute.",
  };
  return { ok: false, reason: reasons[r.reason] ?? "The send failed." };
}
