/**
 * seasonal/family-demand-profile-store (BEACON_500 item 69) - persistence for
 * the per-pageFamily weekly+annual demand profiles, so the event-calendar
 * deriver and the measurement-read seasonal-inflection flag both read a
 * precomputed pass at $0 instead of re-aggregating the archive on every read.
 *
 * Follows the seasonal-windows/peak-calendar sibling pattern exactly: a
 * GLOBAL json-store (rows carry tenant_id - a future nightly pass would fan
 * out across tenants with no ambient request context, same rationale as every
 * other store in this domain), Supabase-mirrored so the write survives
 * Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { FamilyDemandProfile } from "./family-demand-profile";

const STORE = "seasonal-family-profiles";

/** A profile pass older than this is not read anywhere (mirrors
 *  SEASONAL_MAX_AGE_MS / PEAK_CALENDAR_MAX_AGE_MS - nightly reruns keep it
 *  fresh at $0). */
const FAMILY_PROFILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type FamilyProfileSummaryRow = {
  tenant_id: string;
  computed_at: string;
  profiles: FamilyDemandProfile[];
};

/** Persist the latest family demand profiles for a tenant (latest wins; other
 *  tenants untouched). An EMPTY list is written too: "checked, no families
 *  seasonal yet" keeps computed_at fresh and is a different truth from "never
 *  checked". */
export async function writeFamilyDemandProfiles(row: FamilyProfileSummaryRow): Promise<void> {
  const rows = await readStore<FamilyProfileSummaryRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest family profile pass for the tenant, or null when absent / older
 *  than 14 days. Fail-soft -> null. */
export async function readFamilyDemandProfileSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<FamilyProfileSummaryRow | null> {
  try {
    const rows = await readStore<FamilyProfileSummaryRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= FAMILY_PROFILE_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's family demand profiles, or [] when no
 *  fresh pass exists. */
export async function loadFamilyDemandProfiles(
  tenantId: string,
  now: Date = new Date(),
): Promise<FamilyDemandProfile[]> {
  const row = await readFamilyDemandProfileSummary(tenantId, now);
  return row?.profiles ?? [];
}

/** $0 read for a SINGLE family (the measurement-read path only ever needs
 *  one), or null when no fresh pass exists or the family has no profile. */
export async function loadFamilyDemandProfile(
  tenantId: string,
  pageFamily: string,
  now: Date = new Date(),
): Promise<FamilyDemandProfile | null> {
  const profiles = await loadFamilyDemandProfiles(tenantId, now);
  return profiles.find((p) => p.pageFamily === pageFamily) ?? null;
}
