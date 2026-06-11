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
  //    `.select` returns the updated row so the prefill step below can
  //    see whether cities were already typed (typed beats derived).
  const { data: updatedRows, error: updateErr } = await admin
    .from("tenants")
    .update({
      business_name: validation.normalized.businessName,
      domain: validation.normalized.domain,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership.tenantId)
    .eq("status", "pending_onboarding")
    .select("cities_served");

  if (updateErr) {
    console.error("[onboard/business] update failed:", updateErr.message);
    return { ok: false, error: "update_failed" };
  }
  if (!updatedRows || updatedRows.length === 0) {
    // Tenant exists but is no longer pending — operator activated it
    // (or paused/cancelled it) between the form render and this action.
    return { ok: false, error: "already_launched" };
  }

  // 4.5 North-star onboarding (2026-06-11): derive a cities SUGGESTION
  //     from the site (homepage only — keeps the submit fast) and
  //     prefill cities_served so the scope step opens with what Beacon
  //     found instead of a blank box. Strictly best-effort and
  //     typed-beats-derived: only fires when the human hasn't entered
  //     cities; they can edit/clear the prefill on the next screen. A
  //     fetch failure or throw never blocks the step.
  const existingCities = (updatedRows[0]?.cities_served ?? []) as string[];
  if (existingCities.length === 0) {
    try {
      const [
        { fetchSiteProfilePages },
        { deriveBusinessProfile },
        { displayCaseLocation },
      ] = await Promise.all([
        import("@/domains/onboarding/fetch-site-profile"),
        import("@/domains/onboarding/derive-business-profile"),
        import("@/domains/onboarding/derive-business-config"),
      ]);
      const fetched = await fetchSiteProfilePages(
        validation.normalized.domain,
        // Homepage-only for speed, but allow slow CMS hosts (real Wix
        // homepages exceed 10s cold — live check 2026-06-11).
        { maxPages: 1, timeoutMs: 20_000 },
      );
      if (fetched.ok) {
        const profile = deriveBusinessProfile(fetched.pages);
        const suggested = profile.locations
          .filter((l) => l.trim().length > 2) // drop bare region codes
          .map(displayCaseLocation)
          .slice(0, 20);
        if (suggested.length > 0) {
          await admin
            .from("tenants")
            .update({
              cities_served: suggested,
              updated_at: new Date().toISOString(),
            })
            .eq("id", membership.tenantId)
            .eq("status", "pending_onboarding");
          console.info(
            `[onboard/business] prefilled ${suggested.length} derived cities for the scope step`,
          );
        }
      }
    } catch (e) {
      console.error(
        "[onboard/business] cities prefill skipped:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 5. Success — advance to step 2.
  redirect("/onboard/scope");
}
