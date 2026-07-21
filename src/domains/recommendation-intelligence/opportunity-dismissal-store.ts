/**
 * opportunity-dismissal-store (2026-06-25) — lets the operator CURATE the cockpit
 * worklist, not just read it: dismiss a site-wide opportunity (a feed row that is
 * noise / already-handled / won't-do) and it stays gone across reloads. The feed
 * is recomputed from live GSC every render, so without this a dismissed row
 * reappears forever; this is the missing "I've dealt with that" state.
 *
 * Keyed by a stable opportunity key (`kind|page|query`, normalized by the caller).
 * A dismissal can carry a horizon — "skip" (permanent until undismissed) or a
 * snooze that auto-expires — but v1 stores a single timestamp + status.
 *
 * DEGRADE-SAFE (mirrors move-draft-store): if `opportunity_dismissals` is absent
 * (fresh install before the additive migration — PostgREST PGRST205 / Postgres
 * 42P01) reads return empty and writes return false; the cockpit just behaves as
 * before (nothing dismissable). Never throws.
 *
 * Only the read side (`loadDismissedKeys`, consumed by
 * `learning/load-dismissal-signals.ts`) is currently wired to a caller. The
 * write API (dismiss/pin/undismiss/done-count) had zero callers left in the
 * tree as of the 2026-07-21 dead-export sweep and was removed; recover it from
 * git history if the curation UI comes back.
 */

import "server-only";

import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

function isMissingTable(code?: string | null): boolean {
  return code === "PGRST205" || code === "42P01";
}

/**
 * The set of dismissed opportunity keys for a tenant. Fail-soft → empty set, so
 * a missing table or DB hiccup never hides the worklist (the safe failure is
 * "show everything", never "show nothing"). Used by the feed loader to filter.
 */
export const loadDismissedKeys = cache(loadDismissedKeysImpl);
async function loadDismissedKeysImpl(tenantId: string, limit = 2000): Promise<Set<string>> {
  const out = new Set<string>();
  if (!tenantId) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("opportunity_dismissals")
      .select("opp_key")
      .eq("tenant_id", tenantId)
      .neq("status", "pinned") // pinned ≠ dismissed; they partition the same table
      .limit(limit);
    if (error || !data) {
      if (error && !isMissingTable(error.code)) {
        log.warn("[opp-dismissal] read failed", { tenantId, error: error.message });
      }
      return out;
    }
    for (const r of data) {
      const k = (r as { opp_key?: string }).opp_key;
      if (k) out.add(k);
    }
    return out;
  } catch (e) {
    log.warn("[opp-dismissal] read threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return out;
  }
}
