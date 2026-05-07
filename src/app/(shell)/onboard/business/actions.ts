"use server";

/**
 * /onboard/business — server action — Gap C.1 (2026-05-07).
 *
 * Saves the business-profile step (business_name + domain) to the
 * current user's pending tenant row, then redirects to /onboard/scope.
 *
 * Safety contract (pinned by tests):
 *   - Reads the user from the cookie-backed Supabase client (not from
 *     form input). The form cannot tell us whose row to update.
 *   - Resolves the user's tenant via `lookupExistingMembership`.
 *   - The UPDATE is gated by `WHERE id = <tenant> AND status =
 *     'pending_onboarding'`. If a race flips the tenant to 'active'
 *     between the page render and this action firing, the update
 *     becomes a no-op and we surface 'already_launched' to the user.
 *   - We do NOT flip status to 'active'.
 *   - We do NOT create prompts, tracked_entities, or any other rows.
 *   - We do NOT call OpenAI / Perplexity / paid APIs.
 *   - On success, `redirect('/onboard/scope')` throws — the form's
 *     fetch sees a 303 follow.
 *
 * Validation lives in `src/domains/onboarding/profile-validation.ts`
 * (pure, separately tested).
 */

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "@/domains/onboarding/provision-tenant";
import {
  validateBusinessProfile,
  type BusinessProfileInput,
} from "@/domains/onboarding/profile-validation";

export type SaveBusinessProfileResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: { businessName?: string; domain?: string };
    };

export async function saveBusinessProfile(
  input: BusinessProfileInput,
): Promise<SaveBusinessProfileResult> {
  // 1. Validate input. Pure, no I/O.
  const validation = validateBusinessProfile(input);
  if (!validation.ok) {
    return {
      ok: false,
      error: "validation_failed",
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve current user from session cookie.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "not_authenticated" };
  }

  // 3. Look up the user's tenant via tenant_members. Service-role
  //    admin client because RLS deny-all blocks anon reads on tenants.
  const admin = getSupabaseAdmin();
  const membership = await lookupExistingMembership(admin, user.id);
  if (membership.error) {
    console.error("[onboard/business] membership lookup failed:", membership.error);
    return { ok: false, error: "membership_lookup_failed" };
  }
  if (!membership.tenantId) {
    return { ok: false, error: "no_tenant" };
  }

  // 4. UPDATE tenants WHERE id = ? AND status = 'pending_onboarding'.
  //    Status guard prevents this action from ever mutating an active
  //    customer's row, even if the route guard somehow let an active
  //    user reach the form (e.g., race with operator launching them).
  const { error: updateErr, count } = await admin
    .from("tenants")
    .update(
      {
        business_name: validation.normalized.businessName,
        domain: validation.normalized.domain,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", membership.tenantId)
    .eq("status", "pending_onboarding");

  if (updateErr) {
    console.error("[onboard/business] update failed:", updateErr.message);
    return { ok: false, error: "update_failed" };
  }
  if (count === 0) {
    // Tenant exists but is no longer pending — operator activated it
    // (or paused/cancelled it) between the form render and this action.
    return { ok: false, error: "already_launched" };
  }

  // 5. Success — advance to step 2.
  redirect("/onboard/scope");
}
