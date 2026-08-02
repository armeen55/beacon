/**
 * Recommendation Response Store — persists explicit operator responses
 * to Beacon recommendations (accept / dismiss / defer).
 *
 * Provides deterministic feedback that supplements the probabilistic
 * retroactive matching in recommendation-tracker.ts.
 */

import "server-only";

import { cache } from "react";

import { readStore } from "@/lib/persistence/json-store";
import { getRepository, usesSupabase } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecommendationResponseStatus =
  | "accepted"
  | "dismissed"
  | "deferred";

export type RecommendationResponse = {
  recId: string;
  status: RecommendationResponseStatus;
  respondedAt: string;
  /** ISO date — only set for deferred; re-show after this date */
  deferUntil: string | null;
  /** Fix 2 (2026-04-21) — auto-link context. When the rec has a target URL
   *  and/or pattern at response time, persist it here so `detect-findings`
   *  can match a later-detected change on the same URL back to this
   *  acceptance. Absent on legacy rows. */
  targetPageUrl?: string | null;
  patternId?: string | null;
  /** #54 (2026-06-11): operator's reason on dismiss — the
   *  taste-learning signal. One of a small fixed set or null. */
  dismissReason?: DismissReason | null;
};

/** #54 — fixed reason set (keeps the signal aggregatable; free text
 *  would fragment it). */
type DismissReason =
  | "not_relevant"
  | "already_done"
  | "wrong_page"
  | "bad_suggestion"
  | "too_risky"
  | "other";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORE_NAME = "recommendation-responses";

// Sprint 7 Phase 7.8e-3 (2026-04-26): module-level top-level await replaced
// with cached async getter. Night-shift fix (2026-06-11): the cache was
// a single process-global `_state` keyed by NOTHING — in a warm
// multi-tenant process the first tenant pinned THEIR responses for every
// later tenant (same class as the citation/answer-intel store bugs fixed
// the same night). Now a per-tenant Map; the array reference per tenant
// is stable so the in-place mutator semantics below are preserved.
const _byTenant = new Map<string, RecommendationResponse[]>();

async function loadForTenant(tenantId: string): Promise<RecommendationResponse[]> {
  // Disk read routes per-tenant via the ambient slug (file mode).
  const state = await readStore<RecommendationResponse>(STORE_NAME);

  // Phase 3.5C (2026-04-22): on Vercel / DATA_SOURCE=supabase the disk read
  // returned [] because the JSON file doesn't exist on the read-only FS.
  // Merge from `recommendation_responses` table so getters see real data.
  if (usesSupabase()) {
    try {
      const rows = await getRepository().forTenant(tenantId).getRecommendationResponses();
      const byId = new Map<string, RecommendationResponse>();
      for (const r of state) byId.set(r.recId, r);
      for (const r of rows) {
        const cur = byId.get(r.recId);
        if (!cur || r.respondedAt > cur.respondedAt) byId.set(r.recId, r);
      }
      state.length = 0;
      state.push(...byId.values());
    } catch (e) {
      console.error("[rec-responses] DB seed failed:", e);
    }
  }
  return state;
}

export const getRecommendationResponses = cache(
  async (): Promise<RecommendationResponse[]> => {
    const tenantId = await currentTenantId();
    const cached = _byTenant.get(tenantId);
    if (cached) return cached;
    const loaded = await loadForTenant(tenantId);
    _byTenant.set(tenantId, loaded);
    return loaded;
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

