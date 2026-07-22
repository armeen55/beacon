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

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "@/domains/onboarding/provision-tenant";
import { runCrawlBatch } from "@/domains/scanning/crawl-frontier";
import { runFirstLook } from "@/domains/onboarding/url-first";
import { executeLaunchTransaction } from "../launch-flow";

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

export type LaunchTenantResult =
  | { ok: true } // success also redirects, so this is mostly the race-won case
  | { ok: false; error: string };

/**
 * Finish setup: the FIRST and ONLY code path that flips the tenant from
 * 'pending_onboarding' to 'active'. Persists the minimal per-tenant config,
 * seeds the starter prompts, accepts TOS, and flips the tenant. Delegates
 * the DB work to the testable `executeLaunchTransaction` helper.
 *
 * Safety: user from session cookie, tenant via membership, TOS required.
 */
export async function launchTenant(input: {
  tosAccepted: boolean;
}): Promise<LaunchTenantResult> {
  if (!input?.tosAccepted) {
    return { ok: false, error: "tos_not_accepted" };
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "not_authenticated" };
  }

  const admin = getSupabaseAdmin();
  const membership = await lookupExistingMembership(admin, user.id);
  if (membership.error) {
    console.error(
      "[onboard/done] launchTenant membership lookup failed:",
      membership.error,
    );
    return { ok: false, error: "membership_lookup_failed" };
  }
  if (!membership.tenantId) {
    return { ok: false, error: "no_tenant" };
  }

  const outcome = await executeLaunchTransaction({
    admin,
    tenantId: membership.tenantId,
    now: new Date().toISOString(),
  });

  if (outcome.kind === "error") {
    return { ok: false, error: outcome.error };
  }

  // outcome.kind === "redirect" — call Next.js redirect (throws).
  redirect(outcome.to);
}
