import "server-only";

/**
 * GSC Proof ledger — arbitrary-window page metrics (Phase 5, Path B).
 *
 * Reads clicks/impressions/position for a page over ANY [start, end) date window
 * by REUSING the existing `gsc_page_totals_v1` RPC (true page totals incl.
 * anonymized queries). The RPC only takes a single `p_since` (→ today), so a
 * bounded window is the difference of two cumulative reads:
 *
 *   window[start, end)  =  cumulativeSince(start) − cumulativeSince(end)
 *
 * clicks/impressions/pos_weighted are additive sums, so the subtraction is exact.
 * No new migration needed for reads. Fail-soft (empty map on any error).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { GscWindowMetrics } from "./measure";

type Cumulative = { clicks: number; impressions: number; posWeighted: number };

/** Cumulative page totals for all dates >= `since` (YYYY-MM-DD), keyed by canonical URL. */
export async function readCumulativeSince(
  tenantId: string,
  since: string,
): Promise<Map<string, Cumulative>> {
  const out = new Map<string, Cumulative>();
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("gsc_page_totals_v1", {
      p_tenant: tenantId,
      p_since: since,
    });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as Array<{
      page: string;
      clicks: number | string;
      impressions: number | string;
      pos_weighted: number | string;
    }>) {
      const canon = canonicalizeCitationUrl(r.page) ?? r.page;
      const cur: Cumulative = {
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        posWeighted: Number(r.pos_weighted) || 0,
      };
      const prev = out.get(canon);
      if (prev) {
        prev.clicks += cur.clicks;
        prev.impressions += cur.impressions;
        prev.posWeighted += cur.posWeighted;
      } else {
        out.set(canon, cur);
      }
    }
  } catch {
    /* fail-soft */
  }
  return out;
}

/**
 * The most recent date with FINALIZED GSC data for a tenant (YYYY-MM-DD), or
 * null when there is none / on error. The proof engine gates a window's verdict
 * on this so a window is never judged before its days are finalized. Crons are
 * off, so the finalized watermark can lag wall-clock arbitrarily — judging on
 * `today >= checkOn` alone would read a short (3+ days incomplete) post window
 * and bias the verdict. Bounded single-row read; fail-soft.
 */
export async function readLastFinalizedDate(tenantId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("gsc_daily_page_totals")
      .select("date")
      .eq("tenant_id", tenantId)
      .eq("is_final", true)
      .order("date", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const d = (data[0] as { date?: string }).date;
    return typeof d === "string" ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}

function subtract(start: Cumulative | undefined, end: Cumulative | undefined): GscWindowMetrics {
  const clicks = Math.max(0, (start?.clicks ?? 0) - (end?.clicks ?? 0));
  const impressions = Math.max(0, (start?.impressions ?? 0) - (end?.impressions ?? 0));
  const posW = Math.max(0, (start?.posWeighted ?? 0) - (end?.posWeighted ?? 0));
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posW / impressions : 0,
  };
}

/**
 * Read window metrics for several pages at once over [start, end). Pulls the two
 * cumulative snapshots ONCE and derives every page's window from them. `pages`
 * are canonical URLs (the keys the cumulative map uses).
 */
export async function readWindowForPages(args: {
  tenantId: string;
  pages: ReadonlyArray<string>;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD exclusive
}): Promise<Map<string, GscWindowMetrics>> {
  const [startCum, endCum] = await Promise.all([
    readCumulativeSince(args.tenantId, args.start),
    readCumulativeSince(args.tenantId, args.end),
  ]);
  const out = new Map<string, GscWindowMetrics>();
  for (const page of args.pages) {
    const canon = canonicalizeCitationUrl(page) ?? page;
    out.set(canon, subtract(startCum.get(canon), endCum.get(canon)));
  }
  return out;
}
