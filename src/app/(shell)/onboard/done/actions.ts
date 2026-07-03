"use server";

/**
 * /onboard/done - actions (2026-07-03, BEACON_500 R12 / T0e).
 *
 * Two bounded, crawl-only continuations of the first look:
 *   - keepScanningAction: one more frontier batch (max 15 pages / 45s),
 *     the on-demand mirror of the nightly continuation phase.
 *   - retryFirstLookAction: reset + re-run the first look after an
 *     unreachable-site failure.
 *
 * Safety: user from session cookie, tenant via membership, no status
 * flips, no paid APIs. Allowed for pending AND active tenants (reading
 * your own site is always safe); both revalidate the scorecard.
 */

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "@/domains/onboarding/provision-tenant";
import { runCrawlBatch } from "@/domains/scanning/crawl-frontier";
import { runFirstLook } from "@/domains/onboarding/url-first";

async function resolveTenant(): Promise<{ tenantId: string; domain: string } | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = getSupabaseAdmin();
  const membership = await lookupExistingMembership(admin, user.id);
  if (membership.error || !membership.tenantId) return null;
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, domain, status")
    .eq("id", membership.tenantId)
    .maybeSingle();
  if (!tenant) return null;
  if (tenant.status !== "pending_onboarding" && tenant.status !== "active") return null;
  return { tenantId: tenant.id as string, domain: (tenant.domain ?? "") as string };
}

/** One more bounded crawl batch, then refresh the scorecard. */
export async function keepScanningAction(): Promise<void> {
  const ctx = await resolveTenant();
  if (!ctx) return;
  try {
    const r = await runCrawlBatch({ tenantId: ctx.tenantId });
    console.info(
      `[onboard/done] keep-scanning batch: status=${r.status} crawled=${r.crawled} ` +
        `total=${r.totalCrawled} remaining=${r.remaining}`,
    );
  } catch (e) {
    console.error("[onboard/done] keep-scanning threw:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/onboard/done");
}

/** Reset the frontier and re-run the bounded first look (the honest retry
 *  after an unreachable-site failure). */
export async function retryFirstLookAction(): Promise<void> {
  const ctx = await resolveTenant();
  if (!ctx || !ctx.domain.trim()) return;
  try {
    const look = await runFirstLook({ tenantId: ctx.tenantId, domain: ctx.domain, force: true });
    console.info(
      `[onboard/done] retry first look: crawl=${look.crawl.status} pages=${look.crawl.pagesRead}`,
    );
  } catch (e) {
    console.error("[onboard/done] retry threw:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/onboard/done");
}
