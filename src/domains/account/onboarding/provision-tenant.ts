/**
 * provision-tenant — Gap B (2026-05-07).
 *
 * First-login provisioning for a brand-new Beacon user. Idempotent:
 * if `tenant_members` already has a row for the user, returns the
 * existing tenant_id without creating anything new.
 *
 * Pure with injected deps (the Supabase admin client + an optional
 * clock for tests). The caller (auth/callback route) supplies the
 * real admin client; tests inject a mock.
 *
 * Atomicity note (idempotency limit):
 *   The two writes (tenants insert + tenant_members insert) are NOT a
 *   single transaction. If the second write fails, we surface the
 *   error so the caller can decide. The redirect chain stays at
 *   /signup with an error param, which renders a "Try again" card that
 *   re-runs this function; the retry detects the orphan tenant by id and
 *   skips the duplicate insert (per the upsert semantics below).
 *
 * Schema invariants (pinned by tests):
 *   - The upsert payload names PHYSICAL `tenants` columns only. The
 *     canonical Account field `provisional_name` is a READ-side mapping of
 *     the physical `business_name` column; writing the domain name here is
 *     what took every signup down with PGRST204 (2026-07-26).
 *   - business_name is NOT NULL in the database, so the placeholder must
 *     always be a non-empty string.
 *   - status = 'pending_onboarding' (NOT 'active') so background work
 *     ignores the account until onboarding finishes.
 *   - daily_budget_usd = 5 (operator-locked safety default).
 *   - id = `tenant-<8-char-uuid-prefix>` (deterministic-from-userId
 *     so repeat magic-link clicks idempotently produce the same id).
 *   - tenant_members.role = 'owner'.
 *
 * Collision (handled, not deferred): 8 hex chars is a 4-billion space, not a
 * guarantee. Before the upsert we check whether the derived id already carries
 * a membership belonging to a DIFFERENT user; if it does we refuse with
 * phase 'tenant_collision' rather than making this user an owner of someone
 * else's business. A row with zero memberships is this user's own orphan from
 * a half-finished attempt, so the retry adopts it.
 *
 * Deferred (this module does not handle):
 *   - Multi-user-per-tenant (one user invites another).
 *   - Tenant deletion / cancel flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Operator-locked defaults for new accounts. Pinned by behavioral tests
 * so a future regression that changes any of these (e.g., flipping
 * status to 'active' on signup) fails the build. The account record is
 * fully generic: no vertical, publishing, or provider vocabulary. Legacy
 * `tenants` columns not listed here take their neutral database defaults.
 */
export const PROVISIONING_DEFAULTS = {
  status: "pending_onboarding" as const,
  daily_budget_usd: 5,
  member_role: "owner" as const,
};

export type ProvisionInput = {
  /** Supabase auth user id (UUID). */
  userId: string;
  /** User's email (used for slug derivation + provisional_name placeholder). */
  email: string;
};

type ProvisionOutcome =
  | { ok: true; tenantId: string; created: boolean }
  | {
      ok: false;
      error: string;
      phase: "lookup" | "tenant_insert" | "member_insert" | "tenant_collision";
    };

/**
 * The exact PHYSICAL `tenants` columns this module writes. Deliberately NOT
 * derived from the canonical `Account` type: Account is the read-side domain
 * shape (it carries `provisional_name`, which is not a column), and pinning the
 * write payload to it is what forced a nonexistent column into the insert.
 */
type TenantsInsertRow = {
  id: string;
  slug: string;
  business_name: string;
  domain: string;
  signup_date: string;
  tos_accepted_at: string | null;
  daily_budget_usd: number;
  growth_goal: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

/**
 * Derive a deterministic tenant id from the auth user id. First 8 chars
 * of the UUID are unique enough across the foreseeable customer count
 * (16M space). Same userId always maps to same tenantId so repeat
 * magic-link clicks are idempotent at the id level.
 */
export function deriveTenantId(userId: string): string {
  const cleaned = userId.replace(/-/g, "").slice(0, 8).toLowerCase();
  return `tenant-${cleaned}`;
}

/**
 * The generic stub name the provisioner emits when it can't derive a real
 * name from the signup email. `tenants.business_name` is NOT NULL, so this is
 * always a non-empty string; onboarding treats it as "no name yet".
 */
const PLACEHOLDER_BUSINESS_NAME = "New Beacon Account";

/**
 * Free / personal email providers whose domain prefix is NOT a business name
 * ("gmail" → "Gmail"). For these we emit the neutral placeholder so the user
 * names their own business in onboarding, instead of a nonsense auto-name.
 */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail", "googlemail", "yahoo", "ymail", "hotmail", "outlook", "live", "msn",
  "icloud", "me", "mac", "aol", "proton", "protonmail", "pm", "gmx", "zoho",
  "mail", "yandex", "fastmail", "hey",
]);

/**
 * Derive a placeholder business name from email. Used as a stub until the
 * user fills in the real name in /onboard.
 *
 * "joe@acme-builders.com" → "Acme Builders" (best-effort title-cased
 * domain prefix). Personal email (gmail/yahoo/…) and weird emails fall back
 * to "New Beacon Account" — which onboarding treats as "no name yet" and
 * clears, so the user types their real business name.
 */
export function derivePlaceholderBusinessName(email: string): string {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return PLACEHOLDER_BUSINESS_NAME;
  const domainPart = email.slice(at + 1).split(".")[0] ?? "";
  if (!domainPart) return PLACEHOLDER_BUSINESS_NAME;
  if (FREE_EMAIL_DOMAINS.has(domainPart.toLowerCase())) {
    return PLACEHOLDER_BUSINESS_NAME;
  }
  return domainPart
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ") || PLACEHOLDER_BUSINESS_NAME;
}

/**
 * Returns the existing tenant_id for a user if one exists, else null.
 * Pure read. Ordered by created_at so a user who somehow holds two
 * memberships always resolves to the SAME one on every request.
 */
export async function lookupExistingMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tenantId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return { tenantId: null, error: error.message };
  if (!data || data.length === 0) return { tenantId: null, error: null };
  // First tenant wins. Multi-tenant per user is deferred; the middleware
  // already rejects multi-tenant via redirect. We just return the first.
  return { tenantId: data[0].tenant_id ?? null, error: null };
}

/**
 * Idempotent provisioning entry point.
 *
 * Flow:
 *   1. SELECT tenant_members WHERE user_id = ?
 *      - If row exists → return that tenantId (created: false).
 *   2. Collision guard: if a tenants row already holds a membership for a
 *      DIFFERENT user, refuse (phase 'tenant_collision').
 *   3. INSERT tenants ({ id: derive(userId), status: pending_onboarding, ... })
 *      - On conflict on id (orphaned tenant from prior partial provisioning),
 *        skip — the row already exists.
 *   4. INSERT tenant_members ({ user_id, tenant_id, role: 'owner' })
 *      - On conflict, skip.
 *   5. Return tenantId (created: true).
 */
export async function provisionTenantForNewUser(
  supabase: SupabaseClient,
  input: ProvisionInput,
  now: () => string = () => new Date().toISOString(),
): Promise<ProvisionOutcome> {
  // 1. Idempotency check.
  const { tenantId: existing, error: lookupErr } = await lookupExistingMembership(
    supabase,
    input.userId,
  );
  if (lookupErr) return { ok: false, error: lookupErr, phase: "lookup" };
  if (existing) return { ok: true, tenantId: existing, created: false };

  // 2. Derive deterministic tenant id + placeholder fields.
  const tenantId = deriveTenantId(input.userId);
  const slug = tenantId.replace(/^tenant-/, "");
  const ts = now();

  // 2b. Collision guard. Never adopt a tenant that another user already owns.
  const { data: owners, error: ownersErr } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId);
  if (ownersErr) return { ok: false, error: ownersErr.message, phase: "lookup" };
  if ((owners ?? []).some((m: { user_id?: string }) => m.user_id !== input.userId)) {
    return { ok: false, error: "tenant id collision", phase: "tenant_collision" };
  }

  // Fully generic account row, PHYSICAL columns only. Legacy vertical columns
  // (segment, project_mix, cities_served, budget_range, publish_target, role,
  // email_frequency, discovered_competitors) are intentionally OMITTED: the
  // database supplies neutral defaults, and application code never writes
  // vertical vocabulary.
  const tenantRow = {
    id: tenantId,
    slug,
    business_name: derivePlaceholderBusinessName(input.email),
    domain: "",
    signup_date: ts,
    tos_accepted_at: null,
    daily_budget_usd: PROVISIONING_DEFAULTS.daily_budget_usd,
    growth_goal: null,
    status: PROVISIONING_DEFAULTS.status,
    created_at: ts,
    updated_at: ts,
  } satisfies TenantsInsertRow;

  // 3. Insert tenant. `onConflict: 'id', ignoreDuplicates: true` makes
  // this a no-op when the orphaned row already exists.
  const { error: tenantErr } = await supabase
    .from("tenants")
    .upsert(tenantRow, { onConflict: "id", ignoreDuplicates: true });
  if (tenantErr) {
    return { ok: false, error: tenantErr.message, phase: "tenant_insert" };
  }

  // 4. Insert tenant_members. Same idempotency posture.
  const memberRow = {
    user_id: input.userId,
    tenant_id: tenantId,
    role: PROVISIONING_DEFAULTS.member_role,
    created_at: ts,
  };
  const { error: memberErr } = await supabase
    .from("tenant_members")
    .upsert(memberRow, { onConflict: "user_id,tenant_id", ignoreDuplicates: true });
  if (memberErr) {
    return { ok: false, error: memberErr.message, phase: "member_insert" };
  }

  return { ok: true, tenantId, created: true };
}
