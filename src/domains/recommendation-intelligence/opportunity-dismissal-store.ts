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
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

export type DismissalStatus = "skip" | "done";

export type OpportunityDismissal = {
  oppKey: string;
  status: DismissalStatus;
  dismissedAt: string;
};

function isMissingTable(code?: string | null): boolean {
  return code === "PGRST205" || code === "42P01";
}

/** Persist (upsert) a dismissal. Fail-soft → false (never throws). */
export async function dismissOpportunity(
  tenantId: string,
  oppKey: string,
  status: DismissalStatus,
): Promise<boolean> {
  const key = (oppKey ?? "").trim();
  if (!tenantId || !key) return false;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("opportunity_dismissals")
      .upsert(
        { tenant_id: tenantId, opp_key: key.slice(0, 500), status },
        { onConflict: "tenant_id,opp_key" },
      );
    if (error) {
      if (!isMissingTable(error.code)) {
        log.warn("[opp-dismissal] save failed", { tenantId, oppKey: key, error: error.message });
      }
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[opp-dismissal] save threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Remove a dismissal (operator un-dismisses). Fail-soft → false. */
export async function undismissOpportunity(tenantId: string, oppKey: string): Promise<boolean> {
  const key = (oppKey ?? "").trim();
  if (!tenantId || !key) return false;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("opportunity_dismissals")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("opp_key", key);
    if (error) {
      if (!isMissingTable(error.code)) {
        log.warn("[opp-dismissal] delete failed", { tenantId, oppKey: key, error: error.message });
      }
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[opp-dismissal] delete threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * The set of dismissed opportunity keys for a tenant. Fail-soft → empty set, so
 * a missing table or DB hiccup never hides the worklist (the safe failure is
 * "show everything", never "show nothing"). Used by the feed loader to filter.
 */
export async function loadDismissedKeys(tenantId: string, limit = 2000): Promise<Set<string>> {
  const out = new Set<string>();
  if (!tenantId) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("opportunity_dismissals")
      .select("opp_key")
      .eq("tenant_id", tenantId)
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

/** Stable key for a feed opportunity — must match between render + dismiss. */
export function opportunityKey(kind: string, page: string, query: string): string {
  const p = (page || "").split("?")[0]!.replace(/\/$/, "").toLowerCase();
  const q = (query || "").toLowerCase().trim();
  return `${kind}|${p}|${q}`;
}
