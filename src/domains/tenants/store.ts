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

export function listTenants(): BeaconTenant[] {
  return readStore<BeaconTenant>(STORE_NAME);
}

export function getTenant(id: string): BeaconTenant | null {
  return listTenants().find((t) => t.id === id) ?? null;
}

export function getTenantBySlug(slug: string): BeaconTenant | null {
  return listTenants().find((t) => t.slug === slug) ?? null;
}

export function getTenantOrThrow(id: string): BeaconTenant {
  const tenant = getTenant(id);
  if (!tenant) {
    throw new Error(
      `Unknown tenant: ${id}. Available: ${listTenants().map((t) => t.id).join(", ") || "(none)"}`,
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

  const all = listTenants();
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
  const all = listTenants();
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
