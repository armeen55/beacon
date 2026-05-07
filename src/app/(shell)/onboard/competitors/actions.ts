"use server";

/**
 * /onboard/competitors — server action — Gap C.3 (2026-05-07).
 *
 * Saves the competitors-step (discovered_competitors) to the current
 * user's pending tenant row, then redirects to /onboard/review (step 4
 * placeholder).
 *
 * Same safety contract as Gap C.1's saveBusinessProfile and Gap C.2's
 * saveScopeProfile:
 *   - Reads the user from the cookie-backed Supabase client.
 *   - Resolves the user's tenant via lookupExistingMembership.
 *   - UPDATE gated by `WHERE id = ? AND status = 'pending_onboarding'`.
 *     Race with operator activation → count === 0 → already_launched.
 *   - We do NOT flip status to 'active'.
 *   - We do NOT create prompts, tracked_entities, or any other rows.
 *   - We do NOT call OpenAI / Perplexity / paid APIs.
 *   - Touches ONLY the `tenants` table.
 *   - Field-set: discovered_competitors + updated_at — nothing else.
 *   - On success, redirect('/onboard/review') throws NEXT_REDIRECT.
 */

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership } from "@/domains/onboarding/provision-tenant";
import {
  validateCompetitorsProfile,
  type CompetitorsProfileInput,
} from "@/domains/onboarding/competitors-validation";

export type SaveCompetitorsProfileResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: { competitors?: string };
    };

export async function saveCompetitorsProfile(
  input: CompetitorsProfileInput,
): Promise<SaveCompetitorsProfileResult> {
  // 1. Validate input. Pure, no I/O.
  const validation = validateCompetitorsProfile(input);
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

  // 3. Look up the user's tenant via tenant_members.
  const admin = getSupabaseAdmin();
  const membership = await lookupExistingMembership(admin, user.id);
  if (membership.error) {
    console.error(
      "[onboard/competitors] membership lookup failed:",
      membership.error,
    );
    return { ok: false, error: "membership_lookup_failed" };
  }
  if (!membership.tenantId) {
    return { ok: false, error: "no_tenant" };
  }

  // 4. UPDATE tenants WHERE id = ? AND status = 'pending_onboarding'.
  //    Status guard prevents this action from ever mutating an active
  //    customer's row.
  const { error: updateErr, count } = await admin
    .from("tenants")
    .update(
      {
        discovered_competitors: validation.normalized.competitors,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", membership.tenantId)
    .eq("status", "pending_onboarding");

  if (updateErr) {
    console.error("[onboard/competitors] update failed:", updateErr.message);
    return { ok: false, error: "update_failed" };
  }
  if (count === 0) {
    return { ok: false, error: "already_launched" };
  }

  // 5. Success — advance to step 4 (review placeholder).
  redirect("/onboard/review");
}
