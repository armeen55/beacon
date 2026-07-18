/**
 * Tenant store — CRUD for BeaconTenant records.
 *
 * Persisted to `.data/tenants.json` (global store, not per-tenant).
 * Dual-write to Supabase `tenants` table when DUAL_WRITE=true.
 *
 * This store is intentionally NOT behind the tenant-scoped readStore
 * path — it's the registry OF tenants, not data that belongs to one.
 */

// Registry reads can touch the Supabase service-role client (admin) via the
// dynamic import below; pin this module server-only so it can never be pulled
// into a client bundle (the dynamic import alone is not a hard guarantee).
import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { BeaconTenant } from "./types";

const STORE_NAME = "tenants";

/** Coerce a raw `tenants.role` value to a valid BeaconTenantRole. The DB has
 *  carried legacy/wrong values (e.g. "owner" — that's a tenant_members role,
 *  NOT a tenant tier). Anything outside the tier union defaults to the
 *  LEAST-privileged tier, never "founder": founder gates the legacy
 *  single-tenant fallback in tenant-data.ts, so a wrong founder tag could
 *  attach untagged data to the wrong tenant. */
function coerceTenantRole(v: unknown): BeaconTenant["role"] {
  return v === "founder" || v === "beta_customer" || v === "paid_customer"
    ? v
    : "paid_customer";
}

function coerceTenantSegment(v: unknown): BeaconTenant["segment"] {
  return v === "local_residential_builder" ||
    v === "local_service" ||
    v === "content_publisher" ||
    v === "product_app"
    ? v
    : "unknown";
}

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
    segment: coerceTenantSegment(r.segment),
    project_mix: arr(r.project_mix) as BeaconTenant["project_mix"],
    cities_served: arr(r.cities_served),
    budget_range: (r.budget_range as BeaconTenant["budget_range"]) ?? "mixed",
    publish_target:
      pt === "wix_cms" || pt === "git_pr" || pt === "dev_note" ? pt : undefined,
    signup_date: String(r.signup_date ?? r.created_at ?? ""),
    role: coerceTenantRole(r.role),
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
      if (error) {
        // LOUD: on hosted the file fallback is the (undeployed, gitignored)
        // registry → it returns []. An empty registry silently breaks the
        // tenant switcher's name lookup AND routes every push to dev_note.
        // Never let that fail silently — surface it in the function logs.
        console.error(
          `[tenants/store] Supabase tenants read FAILED (DATA_SOURCE=supabase): ${error.message}. ` +
            `Falling back to the file registry, which is EMPTY on hosted — switcher + push routing will break until this is fixed.`,
        );
      } else if (!Array.isArray(data) || data.length === 0) {
        console.error(
          `[tenants/store] Supabase tenants read returned 0 rows (DATA_SOURCE=supabase). ` +
            `The tenant registry is empty — was the tenants table seeded? Switcher + push routing will break.`,
        );
      } else {
        return data.map((r) => mapRowToTenant(r as Record<string, unknown>));
      }
    } catch (e) {
      console.error(
        `[tenants/store] Supabase tenants read THREW (DATA_SOURCE=supabase): ` +
          `${e instanceof Error ? e.message : String(e)}. Falling back to the file registry (EMPTY on hosted).`,
      );
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
