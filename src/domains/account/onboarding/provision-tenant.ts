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
 *   /signup with an error param — the user can click the magic link
 *   again and the next attempt will detect the orphan tenant by id +
 *   skip the duplicate insert (per the upsert semantics below).
 *
 * Schema invariants (pinned by tests):
 *   - status = 'pending_onboarding' (NOT 'active') so the cron
 *     ignores the tenant (Gap A's lister filters status='active').
 *   - role = 'beta_customer' (operator-locked default; later flipped
 *     to 'paid_customer' by billing).
 *   - daily_budget_usd = 5 (operator-locked safety default; can be
 *     raised by operator after the customer-2 cost-cap mini-phase).
 *   - id = `tenant-<8-char-uuid-prefix>` (deterministic-from-userId
 *     so repeat magic-link clicks idempotently produce the same id).
 *   - tenant_members.role = 'owner'.
 *
 * Deferred (Gap B does not handle):
 *   - Multi-user-per-tenant (one user invites another).
 *   - Tenant deletion / cancel flow.
 *   - Slug uniqueness against ALL tenants (today derives from userId
 *     which is itself unique, so no collision).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/domains/account/tenants/types";

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

export type ProvisionOutcome =
  | { ok: true; tenantId: string; created: boolean }
  | { ok: false; error: string; phase: "lookup" | "tenant_insert" | "member_insert" };

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
 * name from the signup email. Treated as "no name yet" everywhere it could
 * leak into customer-facing copy.
 */
export const PLACEHOLDER_BUSINESS_NAME = "New Beacon Account";

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
 * Derive a placeholder provisional_name from email. Used as a stub until
 * the user fills in the real name in /onboard/business (Gap C).
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
 * Detect the auto-derived placeholder name so recap blocks never present
 * it back to the user as if they had typed it (#136). Returns true for the
 * stub name and for empty/blank values.
 */
export function isPlaceholderBusinessName(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return true;
  return trimmed === PLACEHOLDER_BUSINESS_NAME;
}

/**
 * Customer-safe business name for recap/summary display. When the stored
 * name is still the provisioner placeholder (or blank), fall back to a
 * neutral label rather than echoing "New Beacon Account" as the user's
 * real business (#136).
 */
export function displayBusinessName(
  name: string | null | undefined,
  fallback = "Your business",
): string {
  return isPlaceholderBusinessName(name) ? fallback : (name as string).trim();
}

/**
 * Returns the existing tenant_id for a user if one exists, else null.
 * Pure read.
 */
export async function lookupExistingMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tenantId: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId);
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
 *   2. INSERT tenants ({ id: derive(userId), status: pending_onboarding, ... })
 *      - On conflict on id (orphaned tenant from prior partial provisioning),
 *        skip — the row already exists.
 *   3. INSERT tenant_members ({ user_id, tenant_id, role: 'owner' })
 *      - On conflict, skip.
 *   4. Return tenantId (created: true).
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
  // Fully generic account row. Legacy vertical columns (segment, project_mix,
  // cities_served, budget_range, publish_target, role, email_frequency,
  // discovered_competitors) are intentionally OMITTED: the database supplies
  // neutral defaults, and application code never writes vertical vocabulary.
  const tenantRow = {
    id: tenantId,
    slug,
    provisional_name: derivePlaceholderBusinessName(input.email),
    domain: "",
    signup_date: ts,
    tos_accepted_at: null,
    daily_budget_usd: PROVISIONING_DEFAULTS.daily_budget_usd,
    growth_goal: null,
    status: PROVISIONING_DEFAULTS.status,
    created_at: ts,
    updated_at: ts,
  } satisfies Omit<Account, "id"> & { id: string };

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
