"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";

/**
 * execution-actions (2026-06-25, Sprint 5E/5F) — the operator execution bridge.
 *
 * 5E mark-applied: connects the implementation checklist to the Sprint-3 proof loop.
 * It NEVER assumes anything was applied — the operator must explicitly confirm they
 * manually applied/published the change. On confirmation it captures appliedAt + the
 * implementation-plan id + target URL + notes, records a proof-ledger entry (which
 * starts the 7/14/28d measurement clock), and flips the card to "measuring". NO CMS
 * write, NO publish — Beacon only records that the operator says it's live.
 *
 * 5F proof capture: a lightweight, typed manual proof note (live URL checked, visible
 * live?, rollback needed?, before/after text). Stored as a move_drafts row (free-text
 * kind — no migration). No screenshot automation.
 */

export type MarkPlanAppliedResult =
  | { ok: false; reason: string }
  | { ok: true; recorded: boolean; appliedAt: string; reason?: string };

export async function markPlanAppliedAction(args: {
  implementationPlanId: string;
  moveId: string;
  targetUrl: string;
  actionType?: string | null;
  query?: string | null;
  /** HARD gate — the operator must confirm they manually applied + published it. */
  confirmedApplied: boolean;
  notes?: string | null;
}): Promise<MarkPlanAppliedResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  // Fail closed: never assume applied without explicit operator confirmation.
  if (args.confirmedApplied !== true) {
    return { ok: false, reason: "Confirm you manually applied + published this change before marking it applied." };
  }
  if (!args.targetUrl || args.targetUrl.trim().length === 0) {
    return { ok: false, reason: "A target URL is required to mark applied + start measurement." };
  }
  try {
    const tenantId = await currentTenantId();
    const appliedAt = new Date().toISOString();
    const note = [
      `Operator marked applied via execution checklist`,
      `plan=${args.implementationPlanId}`,
      `appliedAt=${appliedAt}`,
      args.notes ? `note: ${args.notes.slice(0, 400)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    // Start measurement via the Sprint-3 ship→proof bridge (verifiedLive = operator confirmed).
    const res = await autoRecordShippedChangeForRec({
      tenantId,
      pageUrl: args.targetUrl,
      actionType: args.actionType ?? null,
      targetQuery: args.query ?? null,
      verifiedLive: true,
      notes: note,
    });

    // Durable audit of the applied plan (free-text kind → no migration). Fail-soft.
    try {
      await saveMoveDraft(
        tenantId,
        args.moveId,
        "execution_applied" as never,
        JSON.stringify({ implementationPlanId: args.implementationPlanId, appliedAt, targetUrl: args.targetUrl, notes: args.notes ?? null }),
      );
    } catch {
      /* audit is best-effort; the proof record is the source of truth */
    }

    revalidatePath("/");
    return { ok: true, recorded: res.recorded, appliedAt, reason: res.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 140) : "mark-applied failed" };
  }
}

export type CaptureProofResult = { ok: false; reason: string } | { ok: true };

export async function captureProofAction(args: {
  moveId: string;
  targetUrl: string;
  liveUrlChecked?: string | null;
  visibleLive?: boolean | null;
  rollbackNeeded?: boolean | null;
  beforeText?: string | null;
  afterText?: string | null;
  notes?: string | null;
}): Promise<CaptureProofResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const proof = {
      capturedAt: new Date().toISOString(),
      targetUrl: args.targetUrl,
      liveUrlChecked: args.liveUrlChecked ?? null,
      visibleLive: args.visibleLive ?? null,
      rollbackNeeded: args.rollbackNeeded ?? null,
      beforeText: args.beforeText ? args.beforeText.slice(0, 1000) : null,
      afterText: args.afterText ? args.afterText.slice(0, 1000) : null,
      notes: args.notes ? args.notes.slice(0, 1000) : null,
    };
    await saveMoveDraft(tenantId, args.moveId, "proof_capture" as never, JSON.stringify(proof));
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 140) : "proof capture failed" };
  }
}
