"use server";

import { revalidatePath } from "next/cache";

import { currentTenantId } from "@/lib/tenant-context";
import {
  dismissOpportunity,
  undismissOpportunity,
  type DismissalStatus,
} from "@/domains/recommendation-intelligence/opportunity-dismissal-store";

/**
 * opportunity-actions (2026-06-25) — server actions behind the cockpit worklist's
 * dismiss/undo affordance. Tenant-scoped, fail-soft. Dismissing a site-wide
 * opportunity persists so it stays off the recomputed feed across reloads.
 */

export async function dismissOpportunityAction(
  oppKey: string,
  status: DismissalStatus = "skip",
): Promise<{ ok: boolean }> {
  const tenantId = await currentTenantId();
  const ok = await dismissOpportunity(tenantId, oppKey, status);
  if (ok) revalidatePath("/");
  return { ok };
}

export async function undismissOpportunityAction(oppKey: string): Promise<{ ok: boolean }> {
  const tenantId = await currentTenantId();
  const ok = await undismissOpportunity(tenantId, oppKey);
  if (ok) revalidatePath("/");
  return { ok };
}
