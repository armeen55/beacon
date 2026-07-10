import "server-only";

import { cache } from "react";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { AnswerIntelligenceIndex } from "./types";

/**
 * Night-shift rewrite (2026-06-11) — per-tenant, repository-routed.
 * Same two bugs as citation-evidence-store: a process-global `let`
 * cache keyed by NOTHING (first tenant pinned its index for the whole
 * warm process) and disk-only reads (hosted surfaces always saw null
 * while the Supabase row sat unread). Reads now route through
 * `getRepository().forTenant(tenantId)` — ambient per-tenant disk via
 * the file backend locally (lossless), the tenant's own
 * `answer_intelligence_index` row on hosted.
 */

const _byTenant = new Map<string, AnswerIntelligenceIndex | null>();

async function loadForTenant(tenantId: string): Promise<AnswerIntelligenceIndex | null> {
  try {
    return await getRepository().forTenant(tenantId).getAnswerIntelligenceIndex();
  } catch {
    return null; // soft-fail — surfaces treat null as "no index yet"
  }
}

export const getAnswerIntelligenceIndex = cache(
  async (): Promise<AnswerIntelligenceIndex | null> => {
    const tenantId = await currentTenantId();
    return getAnswerIntelligenceIndexForTenant(tenantId);
  },
);

/**
 * Codex P2 (2026-07-09): tenant-EXPLICIT read of the answer-intelligence index.
 * Reuses the same `_byTenant` cache + `loadForTenant` as the ambient
 * `getAnswerIntelligenceIndex` above, but NEVER calls `currentTenantId()` - the
 * caller supplies the tenant, so an /ask fact provider running outside a stable
 * request tenant scope can never resolve (and leak) the wrong tenant's index.
 * Fails CLOSED on an unresolved tenant: an empty tenantId returns null.
 */
export async function getAnswerIntelligenceIndexForTenant(
  tenantId: string,
): Promise<AnswerIntelligenceIndex | null> {
  if (!tenantId) return null;
  if (_byTenant.has(tenantId)) return _byTenant.get(tenantId) ?? null;
  const loaded = await loadForTenant(tenantId);
  _byTenant.set(tenantId, loaded);
  return loaded;
}

/** Call after rebuilding the index (e.g. post-import) to refresh the
 *  CURRENT tenant's in-memory reference. */
export async function refreshAnswerIntelligenceStore(): Promise<void> {
  const tenantId = await currentTenantId();
  _byTenant.set(tenantId, await loadForTenant(tenantId));
}

/** Test-only reset hook. */
export function _resetAnswerIntelligenceForTests(): void {
  _byTenant.clear();
}
