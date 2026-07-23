/**
 * Account store — reads for the canonical Account record.
 *
 * Production reads go through Supabase (`tenants` table) only. There is no
 * file registry, no DATA_SOURCE branch, and no env fallback: a missing or
 * unreadable registry resolves to "no account", never to another business.
 * Tests inject an in-memory repository via setAccountRepositoryForTests.
 *
 * Writes: account rows are created by provision-tenant (signup) and updated
 * by the onboarding launch flow directly against Supabase. This store is
 * read-side; the legacy createTenant/updateTenant file writers are gone.
 */

import "server-only";

import type { Account, AccountStatus } from "./types";

/** Injected read repository. Production default queries Supabase. */
export type AccountRepository = {
  listAccounts(): Promise<Account[]>;
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
    business_name: String(r.business_name ?? ""),
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

const supabaseRepository: AccountRepository = {
  async listAccounts(): Promise<Account[]> {
    try {
      const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
      const { data, error } = await getSupabaseAdmin().from("tenants").select("*");
      if (error) {
        // LOUD: an unreadable registry breaks account resolution. Fail to
        // "no accounts" (callers render generic signed-out/error paths),
        // never to a default or another business.
        console.error(`[account/store] Supabase tenants read FAILED: ${error.message}`);
        return [];
      }
      return (data ?? []).map((r) => mapRowToAccount(r as Record<string, unknown>));
    } catch (e) {
      console.error(
        `[account/store] Supabase tenants read THREW: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  },
};

let repository: AccountRepository = supabaseRepository;

/** Tests inject an in-memory repository; pass null to restore production. */
export function setAccountRepositoryForTests(repo: AccountRepository | null): void {
  repository = repo ?? supabaseRepository;
}

export async function listTenants(): Promise<Account[]> {
  return repository.listAccounts();
}

/**
 * Accounts eligible for background/paid work and switchable-to (status === "active").
 * A paused/cancelled/pending account must still RESOLVE (getTenant keeps working so
 * its stored data is never orphaned) but consumes zero fan-out work. Enumerating
 * callers that DO work must use this helper, not listTenants.
 */
export async function listActiveTenants(): Promise<Account[]> {
  return (await listTenants()).filter((t) => t.status === "active");
}

export async function getTenant(id: string): Promise<Account | null> {
  return (await listTenants()).find((t) => t.id === id) ?? null;
}

export async function getTenantBySlug(slug: string): Promise<Account | null> {
  return (await listTenants()).find((t) => t.slug === slug) ?? null;
}

export async function getTenantOrThrow(id: string): Promise<Account> {
  const tenant = await getTenant(id);
  if (!tenant) {
    throw new Error(`Unknown account: ${id}`);
  }
  return tenant;
}
