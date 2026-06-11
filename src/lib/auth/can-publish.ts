import "server-only";

/**
 * 2026-06-10 — per-tenant publish authorization (audit #11/#12/#15).
 *
 * The publish path (Connect, Approve & Push, Wix sync) was gated ONLY by
 * the single global `BEACON_OPERATOR_MODE` env flag — so in a multi-
 * tenant deploy either NO customer could publish (flag off) or EVERY
 * logged-in user shared operator power over all tenants (flag on). There
 * was no per-user, per-tenant authorization.
 *
 * This resolves a real authorization decision for the AMBIENT tenant:
 *   • Operator deploy (BEACON_OPERATOR_MODE=true): allowed — preserves
 *     the single-operator dogfood path (Ritz, env-set, no user session)
 *     byte-identical.
 *   • Otherwise: allowed iff the logged-in user is a member of the
 *     CURRENT tenant with a publishing role (owner / admin / founder).
 *     A stranger can publish for THEIR tenant, never another's.
 *
 * Fail-CLOSED: any resolution error → not allowed. Publishing writes to a
 * customer's live site; ambiguity must never grant it.
 */

import { isOperatorModeServer } from "@/lib/operator-mode";

const PUBLISHING_ROLES = new Set(["owner", "admin", "founder"]);

export type PublishAuth =
  | { allowed: true; via: "operator_mode" | "tenant_role" }
  | { allowed: false; reason: "not_operator" | "no_session" | "not_a_member" | "insufficient_role" | "error" };

export async function resolvePublishAuth(): Promise<PublishAuth> {
  // Operator deploy keeps working with no user session (dogfood / single
  // operator). This is intentional and matches today's posture.
  if (isOperatorModeServer()) return { allowed: true, via: "operator_mode" };

  try {
    const { getSupabaseServerClient } = await import("@/lib/auth/supabase-server");
    const supabase = await getSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return { allowed: false, reason: "no_session" };

    const { currentTenantId } = await import("@/lib/tenant-context");
    const tenantId = await currentTenantId();

    // Membership + role for THIS user on THIS tenant. RLS on
    // tenant_members already restricts a user to their own rows; the
    // explicit filters are defense-in-depth.
    const { data, error } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return { allowed: false, reason: "error" };
    if (!data) return { allowed: false, reason: "not_a_member" };
    if (!PUBLISHING_ROLES.has(String(data.role))) {
      return { allowed: false, reason: "insufficient_role" };
    }
    return { allowed: true, via: "tenant_role" };
  } catch {
    return { allowed: false, reason: "error" };
  }
}

/** Boolean convenience for call sites that only branch allow/deny. */
export async function canPublishForCurrentTenant(): Promise<boolean> {
  return (await resolvePublishAuth()).allowed;
}
