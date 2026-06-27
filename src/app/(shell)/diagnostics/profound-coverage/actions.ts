"use server";

/**
 * Profound Prompt-to-Page Coverage — server action: ON-DEMAND durable sync.
 * Operator-gated. Pulls the tenant's Iranopedia-topic prompts + answers +
 * query-fanouts ONCE and persists them to the durable tables so the cached
 * reader (and downstream surfaces) are fast. This is the ONLY place that hits the
 * live Profound API for coverage; NOT a cron. Revalidates the page so the freshly
 * synced rows render immediately.
 */
import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { syncProfoundPromptIntelligenceForTenant, type ProfoundSyncResult } from "@/lib/connectors/profound/sync-prompt-intelligence";

export type RefreshCoverageResult =
  | { ok: true; result: ProfoundSyncResult }
  | { ok: false; reason: string };

export async function refreshProfoundCoverageAction(): Promise<RefreshCoverageResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  try {
    const result = await syncProfoundPromptIntelligenceForTenant({ tenantId });
    if (!result.ok) {
      return { ok: false, reason: result.reason ?? "Sync returned no rows (check Profound key / scope)." };
    }
    revalidatePath("/diagnostics/profound-coverage");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Sync failed." };
  }
}
