"use server";

/**
 * /onboard/review — server action — Gap C.4 (2026-05-07).
 *
 * launchTenant() — the FIRST and ONLY code path that flips a
 * tenants.status from 'pending_onboarding' to 'active'. Inserts
 * starter tracked_prompts for the tenant, accepts TOS, and flips
 * the tenant. From this point forward, the next 07:00 UTC cron will
 * include the tenant in its matrix (Gap A's lister filters
 * status='active') and poll the prompts that were just persisted.
 *
 * This wrapper is thin by design: it resolves the user from the
 * session cookie, looks up the tenant via tenant_members, and then
 * delegates to `executeLaunchTransaction` (in launch-flow.ts) for
 * the testable DB work. The transaction helper lives in a separate
 * module because Next.js Server Actions files must export only
 * async functions — we want to also export sync helpers + types.
 *
 * Safety guards (pinned by tests):
 *   - Requires authenticated user with a tenant_members row.
 *   - Operates only on the current user's pending_onboarding tenant.
 *   - Re-generates prompts server-side from saved tenant fields
 *     (does NOT trust client-submitted prompts).
 *   - Refuses to flip if prompt list is empty.
 *   - Never mutates Ritz tenant prompts (account_id scoping in helper).
 *   - Never calls paid APIs.
 *   - Never triggers an immediate poll (Gap F's job).
 */

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "@/domains/onboarding/provision-tenant";
import { executeLaunchTransaction } from "./launch-flow";

export type LaunchTenantInput = {
  tosAccepted: boolean;
};

export type LaunchTenantResult =
  | { ok: true } // success path also redirects, so this is mostly the race-won case
  | { ok: false; error: string };

export async function launchTenant(
  input: LaunchTenantInput,
): Promise<LaunchTenantResult> {
  // 1. Validate TOS consent (server-side; do not trust client alone).
  if (!input?.tosAccepted) {
    return { ok: false, error: "tos_not_accepted" };
  }

  // 2. Resolve current user from session cookie.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "not_authenticated" };
  }

  // 3. Resolve user's tenant via tenant_members.
  const admin = getSupabaseAdmin();
  const membership = await lookupExistingMembership(admin, user.id);
  if (membership.error) {
    console.error(
      "[onboard/review] launchTenant membership lookup failed:",
      membership.error,
    );
    return { ok: false, error: "membership_lookup_failed" };
  }
  if (!membership.tenantId) {
    return { ok: false, error: "no_tenant" };
  }

  // 4. Execute the transaction (testable helper).
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
