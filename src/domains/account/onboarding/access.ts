/**
 * onboarding/access — Gap C.1 (2026-05-07).
 *
 * Server-side access guard for /onboard/* routes.
 *
 * Resolves the current user + their tenant, gates by status, and either
 * returns the resolved context or redirects. Centralizing this in one
 * helper means every onboarding page enforces the same rules:
 *
 *   - No user (no session)         → /login
 *   - User has no tenant_members   → /signup?error=no_tenant
 *   - Tenant lookup error          → /login?error=onboarding_lookup_failed
 *   - Tenant row missing           → /login?error=tenant_missing
 *   - Tenant.status === 'active'   → /  (already launched)
 *   - Tenant.status === 'paused'   → /?error=tenant_paused
 *   - Tenant.status === 'cancelled'→ /?error=tenant_cancelled
 *   - Tenant.status === 'pending_onboarding' → ALLOW
 *
 * Atomicity note: this helper performs READ-ONLY checks. It does not
 * mutate the tenant. The /onboard step server actions perform writes
 * separately, also gated by `WHERE status = 'pending_onboarding'` so a
 * race with operator-driven activation can't corrupt an active tenant.
 */

import "server-only";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "./provision-tenant";
import type { Account } from "@/domains/account/tenants/types";

export type OnboardingTenantContext = {
  user: { id: string; email: string };
  tenantId: string;
  tenant: Pick<
    Account,
    "id" | "slug" | "business_name" | "domain" | "status" | "tos_accepted_at"
  >;
};

/**
 * Resolve the current user's onboarding context, or redirect.
 *
 * Returns context only when:
 *   - The user is authenticated.
 *   - They have a tenant_members row.
 *   - The tenant exists.
 *   - The tenant.status is 'pending_onboarding' (or 'active' when the
 *     caller passes `allowActive` - the /onboard/done scorecard stays
 *     readable right after launch; 2026-07-03 R12/T0e).
 *
 * Otherwise calls Next.js's `redirect()` (which throws); the page
 * never sees control flow continue past the redirect.
 */
export async function requireOnboardingTenant(opts?: {
  allowActive?: boolean;
}): Promise<OnboardingTenantContext> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/onboard");
  }

  const admin = getSupabaseAdmin();
  const { tenantId, error: lookupErr } = await lookupExistingMembership(
    admin,
    user.id,
  );
  if (lookupErr) {
    console.error("[onboard] tenant lookup failed:", lookupErr);
    redirect("/login?error=onboarding_lookup_failed");
  }
  if (!tenantId) {
    redirect("/signup?error=no_tenant");
  }

  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id, slug, business_name, domain, status, tos_accepted_at")
    .eq("id", tenantId)
    .maybeSingle();

  if (tErr) {
    console.error("[onboard] tenant fetch failed:", tErr.message);
    redirect("/login?error=tenant_fetch_failed");
  }
  if (!tenant) {
    redirect("/login?error=tenant_missing");
  }

  if (tenant.status === "active" && !opts?.allowActive) {
    // Already launched — onboarding is over for this customer. Send a notice
    // so the dashboard can explain the redirect instead of bouncing silently
    // (#143). Target stays "/" — only the explanatory param is added.
    redirect("/?notice=already_launched");
  }
  if (tenant.status === "paused") {
    redirect("/?error=tenant_paused");
  }
  if (tenant.status === "cancelled") {
    redirect("/?error=tenant_cancelled");
  }
  // status === "pending_onboarding" — allow.
  return {
    user: { id: user.id, email: user.email ?? "" },
    tenantId,
    tenant: tenant as OnboardingTenantContext["tenant"],
  };
}
