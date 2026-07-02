"use server";

/**
 * publish-canary-actions (2026-07-02, master plan item 86) - the read-only
 * server action the publishing-mode card calls to show last night's canary
 * result. Separate file from publish-canary.ts because a "use server" file
 * may only export async functions (that file also exports types).
 */

import { currentTenantId } from "@/lib/tenant-context";
import { readPublishHealth, type PublishHealthRow } from "./publish-canary-store";

export type PublishCanarySummary = {
  /** null = no check has run yet for this tenant (or it aged out past 7 days). */
  row: PublishHealthRow | null;
};

export async function loadPublishCanarySummary(): Promise<PublishCanarySummary> {
  const tenantId = await currentTenantId();
  const row = await readPublishHealth(tenantId);
  return { row };
}
