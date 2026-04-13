"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { opportunities } from "@/lib/seed-data.server";
import { now } from "@/lib/actions";
import type { OpportunityStatus, CloseReason } from "@/lib/constants";

export async function updateOpportunityStatus(
  opportunityId: string,
  newStatus: OpportunityStatus
): Promise<{ success: boolean; error?: string }> {
  const action = "updateOpportunityStatus";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { opportunityId, newStatus },
  });
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "opportunity not found",
    });
    return { success: false, error: "Opportunity not found" };
  }

  opp.current_status = newStatus;
  const timestamp = now();
  opp.updated_at = timestamp;

  switch (newStatus) {
    case "executing":
      if (!opp.activated_at) opp.activated_at = timestamp;
      break;
    case "captured":
      opp.captured_at = timestamp;
      break;
    case "deferred":
      opp.deferred_at = timestamp;
      break;
    case "closed":
      opp.closed_at = timestamp;
      break;
    case "regressed":
      opp.regressed_at = timestamp;
      break;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function captureOpportunity(
  opportunityId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const action = "captureOpportunity";
  const t0 = Date.now();
  log.info("Action started", { action, params: { opportunityId } });
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "opportunity not found",
    });
    return { success: false, error: "Opportunity not found" };
  }

  const timestamp = now();
  opp.current_status = "captured";
  opp.captured_at = timestamp;
  opp.updated_at = timestamp;
  if (notes?.trim()) {
    opp.notes = opp.notes ? `${opp.notes}\n\n[Captured] ${notes.trim()}` : `[Captured] ${notes.trim()}`;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function deferOpportunity(
  opportunityId: string,
  until?: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const action = "deferOpportunity";
  const t0 = Date.now();
  log.info("Action started", { action, params: { opportunityId } });
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "opportunity not found",
    });
    return { success: false, error: "Opportunity not found" };
  }

  const timestamp = now();
  opp.current_status = "deferred";
  opp.deferred_at = timestamp;
  opp.deferred_until = until?.trim() || null;
  opp.updated_at = timestamp;
  if (notes?.trim()) {
    opp.notes = opp.notes ? `${opp.notes}\n\n[Deferred] ${notes.trim()}` : `[Deferred] ${notes.trim()}`;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function closeOpportunity(
  opportunityId: string,
  reason: CloseReason,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const action = "closeOpportunity";
  const t0 = Date.now();
  log.info("Action started", { action, params: { opportunityId, reason } });
  const opp = opportunities.find((o) => o.id === opportunityId);
  if (!opp) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "opportunity not found",
    });
    return { success: false, error: "Opportunity not found" };
  }

  const timestamp = now();
  opp.current_status = "closed";
  opp.closed_at = timestamp;
  opp.close_reason = reason;
  opp.updated_at = timestamp;
  if (notes?.trim()) {
    opp.notes = opp.notes ? `${opp.notes}\n\n[Closed: ${reason}] ${notes.trim()}` : `[Closed: ${reason}] ${notes.trim()}`;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
