import "server-only";

/** readers/gsc-query-universe - the COMPLETE page-query universe for Decision, not the top-40 grain that hid three quarters of the account's real pairs from every corroboration and ownership question. One server-side GROUP BY, strongest pairs first, paginated, bounded, and it SAYS when it cut. Decision-only: no surface renders twenty thousand rows. A failed read hands back null, never an empty universe: the caller treats null as corroboration UNKNOWN. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { reportingDay } from "@/lib/reporting-day";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";

type GscQueryUniverse = {
  /** Canonical query keys with any real demand on file, for the one-line corroboration ask. */
  keys: Set<string>;
  /** Distinct pairs read. */ pairs: number;
  /** TRUE when the bound cut the tail; the strongest pairs are still all here. */ incomplete: boolean;
};

const WINDOW_DAYS = 90, PAGE_SIZE = 1000, MAX_PAIRS = 25_000;
/** One read per tenant per reporting day: the universe changes when the sync lands, not per caller. */
const memo = new Map<string, { day: string; value: GscQueryUniverse | null }>();

export async function loadGscQueryUniverse(tenantId: string, now: Date): Promise<GscQueryUniverse | null> {
  const day = reportingDay(now.getTime());
  const held = memo.get(tenantId);
  if (held && held.day === day) return held.value;
  const since = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);
  const keys = new Set<string>();
  let read = 0, incomplete = false;
  try {
    for (let offset = 0; offset < MAX_PAIRS; offset += PAGE_SIZE) {
      const { data, error } = await getSupabaseAdmin()
        .rpc("gsc_query_universe_v1", { p_tenant: tenantId, p_since: since })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error != null) throw new Error(error.message);
      const batch = (data ?? []) as Array<{ query: string }>;
      read += batch.length;
      for (const r of batch) { const k = canonicalQueryKey(String(r.query)); if (k) keys.add(k); }
      if (batch.length < PAGE_SIZE) { incomplete = false; break; }
      if (offset + PAGE_SIZE >= MAX_PAIRS) incomplete = true; // the bound cut a tail that exists
    }
  } catch (error) {
    log.warn("[gsc-query-universe] the full page-query read did not answer, so Google corroboration is unknown this pass", { tenantId, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    memo.set(tenantId, { day, value: null });
    return null;
  }
  if (incomplete) log.warn("[gsc-query-universe] the universe read hit its bound, so the weakest tail is not represented", { tenantId, pairs: read, bound: MAX_PAIRS });
  const value = { keys, pairs: read, incomplete };
  memo.set(tenantId, { day, value });
  return value;
}
