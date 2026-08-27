/**
 * Account store: reads for the canonical Account record.
 *
 * Production reads go through Supabase (`tenants` table) only, and every
 * resolution is an account-scoped query (`eq`), never a load-every-account
 * scan. No account enumeration exists: one login resolves one account, and
 * visit-driven work runs only for the authenticated current account. A missing
 * row resolves to "no account", never to a default or another business, and a
 * read that FAILED resolves there too unless the caller asked strictly, in
 * which case it throws and stays distinguishable. Tests inject an in-memory
 * repository via setAccountRepositoryForTests.
 */

import "server-only";

import type { Account, AccountStatus } from "./types";

export type AccountRepository = {
  /** `strict` asks for the THIRD answer: a read that did not come back throws instead of resolving to "no account". */
  getAccountById(id: string, strict?: boolean): Promise<Account | null>;
  getAccountBySlug(slug: string): Promise<Account | null>;
};

/** Map a Supabase `tenants` row to the canonical Account. Legacy vertical
 *  columns on the row are intentionally ignored. */
export function mapRowToAccount(r: Record<string, unknown>): Account {
  const known =
    r.status === "active" || r.status === "paused" || r.status === "cancelled" || r.status === "pending_onboarding";
  // An unrecognized status is a data anomaly, not a lifecycle: coercing it to
  // "paused" under the lifecycle guards would strand the whole account behind a
  // paused notice. The flag lets the resolver treat it as unavailable instead.
  const status: AccountStatus = known ? (r.status as AccountStatus) : "paused";
  return {
    ...(known ? {} : { status_unrecognized: true as const }),
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
    growth_goal:
      r.growth_goal === "recover" || r.growth_goal === "grow" || r.growth_goal === "balanced"
        ? r.growth_goal
        : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

/** THREE ANSWERS, NOT TWO: a row, `null` for a row that IS NOT THERE, and, for a caller that asked to hear it, a THROW for a read that
 *  did not come back. Collapsing a failed read into "no account" is how a five second outage got reported as a customer who does not
 *  exist, and how /onboard sent a perfectly valid session to /login. The soft answer stays the default because most readers genuinely
 *  cannot act on the difference; account/lifecycle asks strictly and reports which one it got. */
async function scopedRow(column: "id" | "slug", value: string, strict: boolean): Promise<Account | null> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const { data, error } = await getSupabaseAdmin().from("tenants").select("*").eq(column, value).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapRowToAccount(data as Record<string, unknown>) : null;
  } catch (e) {
    console.error(`[account/store] scoped tenants read FAILED (${column}): ${e instanceof Error ? e.message : String(e)}`);
    if (strict) throw e;
    return null;
  }
}

const supabaseRepository: AccountRepository = {
  getAccountById: (id, strict) => scopedRow("id", id, strict === true),
  getAccountBySlug: (slug) => scopedRow("slug", slug, false),
};

let repository: AccountRepository = supabaseRepository;

/** Tests inject an in-memory repository; pass null to restore production. */
export function setAccountRepositoryForTests(repo: AccountRepository | null): void {
  repository = repo ?? supabaseRepository;
}

/** `strict` is for the caller that must tell a missing account from an unreadable one (account/lifecycle). Everyone else keeps the soft
 *  answer: null for both, exactly as before. */
export async function getTenant(id: string, opts?: { strict?: boolean }): Promise<Account | null> {
  if (!id) return null;
  return repository.getAccountById(id, opts?.strict === true);
}

async function getTenantBySlug(slug: string): Promise<Account | null> {
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
