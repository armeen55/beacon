import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import type { OutreachPipelineRow, OutreachStatus, OutreachLeadSource } from "./types";

/**
 * outreach-store (BEACON_500 item 57, 2026-07-02) - durable persistence for the
 * outreach execution pipeline (`outreach_pipeline` table, migrations/2026-07-02_
 * outreach_pipeline.sql). Mirrors move-draft-store.ts: DEGRADE-SAFE, every path
 * fail-soft. If the table is absent (PGRST205/42P01), reads return empty and
 * writes return false - never throws.
 *
 * CRITICAL SAFETY RULE: `markSent` is the ONLY function in this module that may
 * set status='sent' + sent_at. It is called from exactly one place: the
 * operator's Send button action. Pinned by outreach-pipeline.test.ts (an
 * architecture grep test asserts no other call site exists).
 */

type Row = {
  tenant_id: string;
  id: string;
  target_domain: string;
  target_url: string;
  contact_email: string | null;
  pitch_subject: string;
  pitch_body: string;
  status: OutreachStatus;
  lead_source: OutreachLeadSource;
  sent_at: string | null;
  last_event_at: string;
  created_at: string;
};

function isMissingTable(code?: string | null): boolean {
  return code === "PGRST205" || code === "42P01";
}

function fromRow(r: Row): OutreachPipelineRow {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    targetDomain: r.target_domain,
    targetUrl: r.target_url,
    contactEmail: r.contact_email,
    pitchSubject: r.pitch_subject,
    pitchBody: r.pitch_body,
    status: r.status,
    leadSource: r.lead_source,
    sentAt: r.sent_at,
    lastEventAt: r.last_event_at,
    createdAt: r.created_at,
  };
}

/** All pipeline rows for a tenant, most recently active first. Fail-soft -> []. */
export async function listOutreachRows(tenantId: string): Promise<OutreachPipelineRow[]> {
  if (!tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("outreach_pipeline")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("last_event_at", { ascending: false })
      .limit(500);
    if (error) {
      if (!isMissingTable(error.code)) log.warn("[outreach] list failed", { tenantId, error: error.message });
      return [];
    }
    return ((data ?? []) as Row[]).map(fromRow);
  } catch (e) {
    log.warn("[outreach] list threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** One pipeline row by id, or null. Fail-soft. */
export async function getOutreachRow(tenantId: string, id: string): Promise<OutreachPipelineRow | null> {
  if (!tenantId || !id) return null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("outreach_pipeline")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return fromRow(data as Row);
  } catch {
    return null;
  }
}

/** Create or overwrite a draft/ready row for a lead (upsert on tenant_id, id).
 *  Never sets status to 'sent' - a fresh draft always starts at 'draft'. */
export async function upsertOutreachDraft(
  tenantId: string,
  input: {
    id: string;
    targetDomain: string;
    targetUrl: string;
    contactEmail?: string | null;
    pitchSubject: string;
    pitchBody: string;
    leadSource: OutreachLeadSource;
    status?: "draft" | "ready";
  },
  now: Date = new Date(),
): Promise<boolean> {
  if (!tenantId || !input.id) return false;
  try {
    const sb = getSupabaseAdmin();
    const nowIso = now.toISOString();
    const { error } = await sb.from("outreach_pipeline").upsert(
      {
        tenant_id: tenantId,
        id: input.id,
        target_domain: input.targetDomain,
        target_url: input.targetUrl,
        contact_email: input.contactEmail ?? null,
        pitch_subject: input.pitchSubject,
        pitch_body: input.pitchBody,
        status: input.status ?? "draft",
        lead_source: input.leadSource,
        last_event_at: nowIso,
      },
      { onConflict: "tenant_id,id" },
    );
    if (error) {
      if (!isMissingTable(error.code)) log.warn("[outreach] upsert draft failed", { tenantId, id: input.id, error: error.message });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[outreach] upsert draft threw", { tenantId, id: input.id, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * THE ONLY function that may mark a row sent. Called from exactly one place:
 * the operator's explicit Send button action (never a cron, never a batch, never
 * a follow-up drafter). Requires the row to currently be 'draft' or 'ready' -
 * refuses to re-send an already-sent row.
 */
export async function markSent(tenantId: string, id: string, now: Date = new Date()): Promise<boolean> {
  if (!tenantId || !id) return false;
  try {
    const sb = getSupabaseAdmin();
    const nowIso = now.toISOString();
    const { data, error } = await sb
      .from("outreach_pipeline")
      .update({ status: "sent", sent_at: nowIso, last_event_at: nowIso })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .in("status", ["draft", "ready"])
      .select("id");
    if (error) {
      if (!isMissingTable(error.code)) log.warn("[outreach] markSent failed", { tenantId, id, error: error.message });
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    log.warn("[outreach] markSent threw", { tenantId, id, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Manual status transition (replied / won / dead) - operator-driven, never
 *  used to set 'sent' (that is markSent's exclusive job; the check constraint
 *  still allows it, so this function explicitly refuses the value). */
export async function setOutreachStatus(
  tenantId: string,
  id: string,
  status: Exclude<OutreachStatus, "sent">,
  now: Date = new Date(),
): Promise<boolean> {
  if (!tenantId || !id) return false;
  try {
    const sb = getSupabaseAdmin();
    const nowIso = now.toISOString();
    const { error } = await sb
      .from("outreach_pipeline")
      .update({ status, last_event_at: nowIso })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) {
      if (!isMissingTable(error.code)) log.warn("[outreach] setStatus failed", { tenantId, id, status, error: error.message });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[outreach] setStatus threw", { tenantId, id, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Edit the draft subject/body/contact email (operator review/edit textarea).
 *  Refuses to edit a row that has already been sent - a sent pitch is a
 *  historical record. */
export async function updateOutreachDraftText(
  tenantId: string,
  id: string,
  patch: { pitchSubject?: string; pitchBody?: string; contactEmail?: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  if (!tenantId || !id) return false;
  try {
    const sb = getSupabaseAdmin();
    const nowIso = now.toISOString();
    const update: Record<string, unknown> = { last_event_at: nowIso };
    if (patch.pitchSubject != null) update.pitch_subject = patch.pitchSubject;
    if (patch.pitchBody != null) update.pitch_body = patch.pitchBody;
    if (patch.contactEmail !== undefined) update.contact_email = patch.contactEmail;
    const { data, error } = await sb
      .from("outreach_pipeline")
      .update(update)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .in("status", ["draft", "ready"])
      .select("id");
    if (error) {
      if (!isMissingTable(error.code)) log.warn("[outreach] update draft text failed", { tenantId, id, error: error.message });
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    log.warn("[outreach] update draft text threw", { tenantId, id, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
