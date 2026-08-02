import "server-only";

/**
 * Account-owner authorization — the ONE fail-closed mutation gate.
 *
 * A mutation (publishing, implementation marking, Results mutations,
 * connector ownership) is allowed only when the authenticated user is a
 * member of the CURRENT account with the owner role. The
 * tenant_members.role CHECK constraint allows exactly {owner, member}, so
 * `owner` is the only mutating role; `member` is read-only.
 *
 * No environment flag grants authorization: BEACON_OPERATOR_MODE is
 * presentation-only and carries no power here (2026-07-23 account-isolation
 * contraction; the prior operator bypass let a global env var authorize
 * mutations with no session at all).
 *
 * Fail-CLOSED: any resolution error → not allowed. Mutations touch a
 * customer's live product; ambiguity must never grant them.
 */

// Aligned to the tenant_members.role CHECK constraint: {owner, member}.
const OWNER_ROLES = new Set(["owner"]);

type AccountOwnerAuth =
  | { allowed: true; via: "account_owner" }
  | { allowed: false; reason: "no_session" | "not_a_member" | "insufficient_role" | "error" };

async function resolveAccountOwnerAuth(): Promise<AccountOwnerAuth> {
  try {
    const { getSupabaseServerClient } = await import("@/lib/auth/supabase-server");
    const supabase = await getSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return { allowed: false, reason: "no_session" };

    const { currentTenantId } = await import("@/lib/tenant-context");
    const tenantId = await currentTenantId();

    // Membership + role for THIS user on THIS account. RLS on tenant_members
    // already restricts a user to their own rows; the explicit filters are
    // defense-in-depth.
    const { data, error } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return { allowed: false, reason: "error" };
    if (!data) return { allowed: false, reason: "not_a_member" };
    if (!OWNER_ROLES.has(String(data.role))) {
      return { allowed: false, reason: "insufficient_role" };
    }
    return { allowed: true, via: "account_owner" };
  } catch {
    return { allowed: false, reason: "error" };
  }
}

/** Boolean convenience for mutation call sites that only branch allow/deny. */
export async function isAccountOwner(): Promise<boolean> {
  return (await resolveAccountOwnerAuth()).allowed;
}

/** Publishing is an owner mutation; kept as a named alias for its call sites. */
export async function canPublishForCurrentTenant(): Promise<boolean> {
  return isAccountOwner();
}
