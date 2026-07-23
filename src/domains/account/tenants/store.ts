/**
 * Account store — reads for the canonical Account record.
 *
 * Production reads go through Supabase (`tenants` table) only, and every
 * resolution is an account-scoped query (`eq`), never a load-every-account
 * scan. No account enumeration exists: one login resolves one account, and
 * visit-driven work runs only for the authenticated current account. A
 * missing or unreadable registry resolves to "no account", never to a
 * default or another business. Tests inject an in-memory repository via
 * setAccountRepositoryForTests.
 */

import "server-only";

import type { Account, AccountStatus } from "./types";

export type AccountRepository = {
  getAccountById(id: string): Promise<Account | null>;
  getAccountBySlug(slug: string): Promise<Account | null>;
};

/** Map a Supabase `tenants` row to the canonical Account. Legacy vertical
 *  columns on the row are intentionally ignored. */
export function mapRowToAccount(r: Record<string, unknown>): Account {
  const status: AccountStatus =
    r.status === "active" || r.status === "paused" || r.status === "cancelled" || r.status === "pending_onboarding"
      ? r.status
      : "paused";
  return {
    id: String(r.id),
    slug: String(r.slug ?? ""),
    provisional_name: String(r.business_name ?? ""),
    domain: String(r.domain ?? ""),
    status,
    signup_date: String(r.signup_date ?? r.created_at ?? ""),
    tos_accepted_at: (r.tos_accepted_at as string | null) ?? null,
    daily_budget_usd:
      typeof r.daily_budget_usd === "number"
        ? r.daily_budget_usd
        : Number(r.daily_budget_usd ?? 0) || 0,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

async function scopedRow(
  column: "id" | "slug",
  value: string,
): Promise<Account | null> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const { data, error } = await getSupabaseAdmin()
      .from("tenants")
      .select("*")
      .eq(column, value)
      .maybeSingle();
    if (error) {
      console.error(`[account/store] scoped tenants read FAILED (${column}): ${error.message}`);
      return null;
    }
    return data ? mapRowToAccount(data as Record<string, unknown>) : null;
  } catch (e) {
    console.error(
      `[account/store] scoped tenants read THREW (${column}): ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

const supabaseRepository: AccountRepository = {
  getAccountById: (id) => scopedRow("id", id),
  getAccountBySlug: (slug) => scopedRow("slug", slug),
};

let repository: AccountRepository = supabaseRepository;

/** Tests inject an in-memory repository; pass null to restore production. */
export function setAccountRepositoryForTests(repo: AccountRepository | null): void {
  repository = repo ?? supabaseRepository;
}

export async function getTenant(id: string): Promise<Account | null> {
  if (!id) return null;
  return repository.getAccountById(id);
}

export async function getTenantBySlug(slug: string): Promise<Account | null> {
  if (!slug) return null;
  return repository.getAccountBySlug(slug);
}

export async function getTenantOrThrow(id: string): Promise<Account> {
  const tenant = await getTenant(id);
  if (!tenant) {
    throw new Error(`Unknown account: ${id}`);
  }
  return tenant;
}
