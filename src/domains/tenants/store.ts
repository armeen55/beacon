/**
 * Tenant store — CRUD for BeaconTenant records.
 *
 * Persisted to `.data/tenants.json` (global store, not per-tenant).
 * Dual-write to Supabase `tenants` table when DUAL_WRITE=true.
 *
 * This store is intentionally NOT behind the tenant-scoped readStore
 * path — it's the registry OF tenants, not data that belongs to one.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { BeaconTenant } from "./types";

const STORE_NAME = "tenants";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Map a Supabase `tenants` row → BeaconTenant. Inverse of the onboarding
 *  write mapping (column names mirror the field names 1:1). Null arrays
 *  default to []; a null/absent publish_target → undefined (the type's
 *  "safe default: nothing publishes" — executePush then routes dev_note). */
export function mapRowToTenant(r: Record<string, unknown>): BeaconTenant {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const pt = r.publish_target;
  return {
    id: String(r.id),
    slug: String(r.slug ?? ""),
    business_name: String(r.business_name ?? ""),
    domain: String(r.domain ?? ""),
    segment: (r.segment as BeaconTenant["segment"]) ?? "local_service",
    project_mix: arr(r.project_mix) as BeaconTenant["project_mix"],
    cities_served: arr(r.cities_served),
    budget_range: (r.budget_range as BeaconTenant["budget_range"]) ?? "mixed",
    publish_target:
      pt === "wix_cms" || pt === "git_pr" || pt === "dev_note" ? pt : undefined,
    signup_date: String(r.signup_date ?? r.created_at ?? ""),
    role: (r.role as BeaconTenant["role"]) ?? "owner",
    tos_accepted_at: (r.tos_accepted_at as string | null) ?? null,
    discovered_competitors: arr(r.discovered_competitors),
    daily_budget_usd:
      typeof r.daily_budget_usd === "number"
        ? r.daily_budget_usd
        : Number(r.daily_budget_usd ?? 0) || 0,
    status: (r.status as BeaconTenant["status"]) ?? "active",
    email_frequency:
      (r.email_frequency as BeaconTenant["email_frequency"]) ?? "weekly",
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

export async function listTenants(): Promise<BeaconTenant[]> {
  // Hosted (DATA_SOURCE=supabase): the `.data/global/tenants.json` registry
  // file is NOT deployed (gitignored + read-only lambda FS), so the file
  // path returns [] and getTenant() resolves null in production — which
  // breaks the tenant switcher's name lookup AND makes executePush fall back
  // to dev_note (no Wix push). Read the registry from the Supabase `tenants`
  // table (the dual-write target) so the hosted app resolves real tenants.
  // Fail-soft to the file path on any error (covers local file-mode + tests).
  if (process.env.DATA_SOURCE === "supabase") {
    try {
      const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
      const { data, error } = await getSupabaseAdmin()
        .from("tenants")
        .select("*");
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((r) => mapRowToTenant(r as Record<string, unknown>));
      }
    } catch {
      // fall through to the file store
    }
  }
  return await readStore<BeaconTenant>(STORE_NAME);
}

export async function getTenant(id: string): Promise<BeaconTenant | null> {
  return (await listTenants()).find((t) => t.id === id) ?? null;
}

export async function getTenantBySlug(
  slug: string,
): Promise<BeaconTenant | null> {
  return (await listTenants()).find((t) => t.slug === slug) ?? null;
}

export async function getTenantOrThrow(id: string): Promise<BeaconTenant> {
  const tenant = await getTenant(id);
  if (!tenant) {
    throw new Error(
      `Unknown tenant: ${id}. Available: ${(await listTenants()).map((t) => t.id).join(", ") || "(none)"}`,
    );
  }
  return tenant;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createTenant(
  partial: Omit<BeaconTenant, "created_at" | "updated_at">,
): Promise<BeaconTenant> {
  const now = new Date().toISOString();
  const tenant: BeaconTenant = {
    ...partial,
    created_at: now,
    updated_at: now,
  };

  const all = await listTenants();
  const existing = all.findIndex((t) => t.id === tenant.id);
  if (existing >= 0) {
    all[existing] = tenant;
  } else {
    all.push(tenant);
  }

  await writeStore(STORE_NAME, all);
  return tenant;
}

export async function updateTenant(
  id: string,
  patch: Partial<Omit<BeaconTenant, "id" | "slug" | "created_at">>,
): Promise<BeaconTenant> {
  const all = await listTenants();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error(`Tenant not found: ${id}`);

  all[idx] = {
    ...all[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };

  await writeStore(STORE_NAME, all);
  return all[idx];
}
