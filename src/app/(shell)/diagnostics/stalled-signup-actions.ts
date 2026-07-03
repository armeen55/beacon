"use server";

/**
 * stalled-signup-actions (2026-07-03, BEACON_500 R12 / T0e) - the operator's
 * one-click rescue for a signup that went quiet.
 *
 * Safety: operator-gated (same BEACON_OPERATOR_MODE gate as the page that
 * hosts it), crawl-only (a bounded first read or one more frontier batch of
 * the TENANT'S OWN site), no status flips, no paid APIs. Fail-soft: a
 * failed resume logs and leaves the row visible for another try.
 */

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { getTenant } from "@/domains/tenants/store";
import { runFirstLook } from "@/domains/onboarding/url-first";
import { runCrawlBatch } from "@/domains/scanning/crawl-frontier";

export async function resumeStalledSignupAction(formData: FormData): Promise<void> {
  if (!isOperatorModeServer() && process.env.NODE_ENV !== "test") return;

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!tenantId) return;

  try {
    const tenant = await getTenant(tenantId);
    if (!tenant) return;
    if (tenant.status !== "pending_onboarding" && tenant.status !== "active") return;

    if (kind === "continue_crawl") {
      const batch = await runCrawlBatch({ tenantId });
      console.info(
        `[diagnostics/stalled-signups] continued crawl for ${tenantId}: ` +
          `status=${batch.status} crawled=${batch.crawled} remaining=${batch.remaining}`,
      );
    } else {
      const domain = (tenant.domain ?? "").trim();
      if (!domain) return;
      const look = await runFirstLook({ tenantId, domain, force: true });
      console.info(
        `[diagnostics/stalled-signups] first look for ${tenantId}: ` +
          `crawl=${look.crawl.status} pages=${look.crawl.pagesRead}`,
      );
    }
  } catch (e) {
    console.error(
      `[diagnostics/stalled-signups] resume failed for ${tenantId}:`,
      e instanceof Error ? e.message : e,
    );
  }
  revalidatePath("/diagnostics");
}
