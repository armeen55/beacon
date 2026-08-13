/**
 * onboarding/access, Gap C.1 (2026-05-07).
 *
 * Server-side access guard for /onboard/* routes.
 *
 * Resolves the current user + their tenant, gates by status, and either
 * returns the resolved context or redirects. Centralizing this in one
 * helper means every onboarding page enforces the same rules:
 *
 *   - No user (no session)         → /login
 *   - User has no tenant_members   → /signup?error=no_tenant
 *   - Membership lookup error      → /login?error=onboarding_lookup_failed
 *   - Tenant row missing           → /login?error=tenant_missing
 *   - Tenant row UNREADABLE        → AccountUnavailableError (bounded retry boundary, NEVER /login)
 *   - Tenant.status === 'active'   → /  when the one lifecycle gate says setup is finished
 *   - Tenant.status paused/cancelled → /  , where the same gate renders the honest notice
 *   - Tenant.status === 'pending_onboarding' → ALLOW
 *
 * A ROW THAT COULD NOT BE READ IS NOT A ROW THAT IS NOT THERE. Bouncing a transient read failure to /login
 * threw a perfectly valid session out and invited a fresh magic link, which is exactly how sign-in loops are
 * born; the shell error boundary offers Try again instead and the session survives.
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
import { AccountUnavailableError, resolveAccountAccess } from "../lifecycle";
import { mapRowToAccount } from "@/domains/account/tenants/store";
import type { Account } from "@/domains/account/tenants/types";

type OnboardingTenantContext = {
  user: { id: string; email: string };
  tenantId: string;
  tenant: Pick<
    Account,
    "id" | "slug" | "provisional_name" | "domain" | "status" | "tos_accepted_at"
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
  // Local BEACON_AUTH_DISABLED=1 (mirrors the middleware bypass): no Supabase
  // session exists; resolve the explicitly configured env account and run the
  // SAME tenant fetch + status gates below. Never set in hosted environments.
  let user: { id: string; email: string };
  let tenantId: string;
  if (process.env.BEACON_AUTH_DISABLED === "1" && process.env.BEACON_TENANT_ID) {
    user = { id: "local-dev", email: "" };
    tenantId = process.env.BEACON_TENANT_ID;
  } else {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) {
      redirect("/login?next=/onboard");
    }
    const { tenantId: memberTenantId, error: lookupErr } =
      await lookupExistingMembership(getSupabaseAdmin(), authUser.id);
    if (lookupErr) {
      console.error("[onboard] tenant lookup failed:", lookupErr);
      redirect("/login?error=onboarding_lookup_failed");
    }
    if (!memberTenantId) {
      redirect("/signup?error=no_tenant");
    }
    user = { id: authUser.id, email: authUser.email ?? "" };
    tenantId = memberTenantId;
  }

  // The physical column is business_name; the canonical Account field is
  // provisional_name (an internal signup seed). One mapper (mapRowToAccount)
  // owns that translation for every reader, so a column rename can never leave
  // a second hand-rolled copy behind to bounce onboarding to /login.
  const { data: row, error: tErr } = await getSupabaseAdmin()
    .from("tenants")
    .select("id, slug, business_name, domain, status, tos_accepted_at")
    .eq("id", tenantId)
    .maybeSingle();
  const tenant = row ? mapRowToAccount(row as Record<string, unknown>) : null;

  if (tErr) {
    console.error("[onboard] tenant fetch failed:", tErr.message);
    throw new AccountUnavailableError(tenantId);
  }
  if (!tenant) {
    redirect("/login?error=tenant_missing");
  }

  if (tenant.status === "active") {
    // THE ONE GATE, shared with every product surface (account/lifecycle): an active account may stay in setup
    // only while something is genuinely missing, because the product guard sends it back here for the exact
    // step it owes and a door that refused every active account left the operator bouncing between two
    // redirects. A gap that could not be READ is not proof there is none, so it stays and each command below
    // gets its say. Already launched sends the notice so the dashboard can explain the redirect (#143).
    if (!opts?.allowActive || (await resolveAccountAccess(tenantId)).kind === "ready") {
      redirect("/?notice=already_launched");
    }
  }
  // Paused and cancelled are rendered by that same gate on Today, in its own words. A parallel error param here
  // said nothing: nothing on the dashboard ever read it.
  if (tenant.status === "paused" || tenant.status === "cancelled") {
    redirect("/");
  }
  // status === "pending_onboarding": allow.
  return { user, tenantId, tenant };
}
