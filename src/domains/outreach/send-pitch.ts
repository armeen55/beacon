import "server-only";

import { sendEmail } from "@/lib/email/resend";
import { log } from "@/lib/logger";
import { getOutreachRow, markSent } from "./outreach-store";

/**
 * outreach/send-pitch (BEACON_500 item 57, 2026-07-02) - THE ONLY MODULE IN THE
 * ENTIRE CODEBASE THAT MAY SEND AN OUTREACH EMAIL. It is called from exactly one
 * place: the operator's explicit Send button server action
 * (src/app/(shell)/diagnostics/competitor-intel/outreach-actions.ts::sendOutreachPitchAction,
 * moved here FP10b 2026-07-02 when the customer-facing /competitors shell was retired).
 *
 * CRITICAL SAFETY RULE (item 57): every email send is an explicit operator
 * click. Beacon NEVER auto-sends. There is no cron, no batch, no "auto-follow-up"
 * path anywhere that calls this function - follow-ups are drafted and queued as
 * new 'draft' rows the operator must also click Send on. This file, plus the
 * grep-based architecture test in outreach-pipeline.test.ts, is the enforcement
 * boundary: `sendEmail` from resend.ts must appear in the outreach domain ONLY
 * inside this module.
 */

export type SendPitchResult =
  | { ok: true; emailId: string | null }
  | { ok: false; reason: "not_found" | "already_sent" | "no_contact_email" | "not_configured" | "send_failed"; detail?: string };

/** Send one pipeline row's pitch via Resend, then mark it sent. Requires a
 *  contact email on the row (the operator fills this in before sending - a
 *  lead mined automatically has no verified inbox). */
export async function sendOutreachPitch(tenantId: string, id: string, now: Date = new Date()): Promise<SendPitchResult> {
  const row = await getOutreachRow(tenantId, id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "sent" || row.status === "replied" || row.status === "won") {
    return { ok: false, reason: "already_sent" };
  }
  const to = row.contactEmail?.trim();
  if (!to) return { ok: false, reason: "no_contact_email" };

  const result = await sendEmail({ to, subject: row.pitchSubject, text: row.pitchBody });
  if (!result.sent) {
    if (result.reason === "not_configured") {
      log.warn("[outreach] send blocked - email not configured", { tenantId, id, missing: result.missing });
      return { ok: false, reason: "not_configured", detail: result.missing.join(", ") };
    }
    log.warn("[outreach] send failed", { tenantId, id, detail: result.detail });
    return { ok: false, reason: "send_failed", detail: result.detail };
  }

  const marked = await markSent(tenantId, id, now);
  if (!marked) {
    log.warn("[outreach] email sent but markSent failed - row status may be stale", { tenantId, id });
  }
  return { ok: true, emailId: result.id };
}
