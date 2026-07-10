"use server";

import { revalidatePath } from "next/cache";

import { currentTenantId } from "@/lib/tenant-context";
import { invalidateWorklistSurface } from "./worklist-surface-store";
import { invalidateChangesSurface } from "./changes-surface-store";
import {
  dismissOpportunity,
  undismissOpportunity,
  pinOpportunity,
  unpinOpportunity,
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
  if (ok) {
    await invalidateWorklistSurface().catch(() => {}); // curation changes which moves show → recompute worklist
    await invalidateChangesSurface().catch(() => {}); // ...and the ranked /changes snapshot
    revalidatePath("/");
    revalidatePath("/changes");
  }
  return { ok };
}

export async function undismissOpportunityAction(oppKey: string): Promise<{ ok: boolean }> {
  const tenantId = await currentTenantId();
  const ok = await undismissOpportunity(tenantId, oppKey);
  if (ok) {
    await invalidateWorklistSurface().catch(() => {}); // curation changes which moves show → recompute worklist
    await invalidateChangesSurface().catch(() => {}); // ...and the ranked /changes snapshot
    revalidatePath("/");
    revalidatePath("/changes");
  }
  return { ok };
}

export async function pinOpportunityAction(oppKey: string): Promise<{ ok: boolean }> {
  const tenantId = await currentTenantId();
  const ok = await pinOpportunity(tenantId, oppKey);
  if (ok) {
    await invalidateWorklistSurface().catch(() => {}); // curation changes which moves show → recompute worklist
    await invalidateChangesSurface().catch(() => {}); // ...and the ranked /changes snapshot
    revalidatePath("/");
    revalidatePath("/changes");
  }
  return { ok };
}

export async function unpinOpportunityAction(oppKey: string): Promise<{ ok: boolean }> {
  const tenantId = await currentTenantId();
  const ok = await unpinOpportunity(tenantId, oppKey);
  if (ok) {
    await invalidateWorklistSurface().catch(() => {}); // curation changes which moves show → recompute worklist
    await invalidateChangesSurface().catch(() => {}); // ...and the ranked /changes snapshot
    revalidatePath("/");
    revalidatePath("/changes");
  }
  return { ok };
}
