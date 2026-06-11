import { cache } from "react";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { CitationEvidenceIndex } from "./types";

/**
 * Night-shift rewrite (2026-06-11) — per-tenant, repository-routed.
 *
 * Two production bugs lived here:
 *   1. The process cache was a single `let _state` keyed by NOTHING —
 *      in a warm multi-tenant process the first tenant to render
 *      pinned THEIR index for every later tenant (same class as
 *      audit #4/#5 module caches).
 *   2. Reads went through readDotDataJson (disk-only) — on Vercel
 *      there is no disk, so EVERY hosted surface importing this store
 *      (today-data, /changes, /diagnostics, visibility-read, why-them)
 *      silently rendered with a null index while the nightly cron kept
 *      rebuilding a Supabase row nothing read.
 *
 * Now: cache is a per-tenant Map; reads route through
 * `getRepository().forTenant(tenantId).getCitationEvidenceIndex()` —
 * the file backend resolves the same per-tenant disk file as before
 * (lossless locally), the Supabase backend reads the tenant's own
 * `citation_evidence_index` row (hosted surfaces finally see it).
 */

const _byTenant = new Map<string, CitationEvidenceIndex | null>();

async function loadForTenant(tenantId: string): Promise<CitationEvidenceIndex | null> {
  try {
    return await getRepository().forTenant(tenantId).getCitationEvidenceIndex();
  } catch {
    // Soft-fail (missing table/row, transient DB error) — surfaces treat
    // a null index as "no citation evidence yet", same as before.
    return null;
  }
}

export const getCitationEvidenceIndex = cache(
  async (): Promise<CitationEvidenceIndex | null> => {
    const tenantId = await currentTenantId();
    if (_byTenant.has(tenantId)) return _byTenant.get(tenantId) ?? null;
    const loaded = await loadForTenant(tenantId);
    _byTenant.set(tenantId, loaded);
    return loaded;
  },
);

/** Call after rebuilding the index (e.g. post-import) to refresh the
 *  CURRENT tenant's in-memory reference. */
export async function refreshCitationEvidenceStore(): Promise<void> {
  const tenantId = await currentTenantId();
  _byTenant.set(tenantId, await loadForTenant(tenantId));
}

/** Test-only reset hook. */
export function _resetCitationEvidenceForTests(): void {
  _byTenant.clear();
}
