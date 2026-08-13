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

import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { log } from "@/lib/logger";
import type { GscWindowMetrics } from "./types";

type Cumulative = { clicks: number; impressions: number; posWeighted: number };

/** Cumulative page totals for all dates >= `since` (YYYY-MM-DD), keyed by canonical URL.
 *  Request-memoized like readLastFinalizedDate below: one measured change reads two snapshots per
 *  window across five windows, so a Results pass over 25 changes issued the same RPC 214 times in
 *  one walk. cache() collapses repeated (tenant, since) pairs to one call within a request and is a
 *  passthrough outside one. */
export const readCumulativeSince = cache(async (
  tenantId: string,
  since: string,
): Promise<Map<string, Cumulative>> => {
  const out = new Map<string, Cumulative>();
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("gsc_page_totals_v1", {
      p_tenant: tenantId,
      p_since: since,
    });
    if (error || !Array.isArray(data)) {
      // A DB error silently returns an empty map (every page reads as "no
      // clicks") - make the failure visible instead of a quiet zero.
      log.warn("gsc-window: cumulative-totals query errored; returning no page totals", {
        tenant: tenantId,
        store: "gsc_page_totals_v1",
        error: error?.message ?? "non-array response",
      });
      return out;
    }
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
  } catch (err) {
    // Fail-soft returns an empty map, which downstream reads as "no clicks" -
    // a real read failure would silently zero every page's traffic proof.
    log.warn("gsc-window: cumulative-totals read failed; returning no page totals", {
      tenant: tenantId,
      store: "gsc_page_totals_v1",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
});

/**
 * The most recent date with FINALIZED GSC data for a tenant (YYYY-MM-DD), or
 * null when there is none / on error. The proof engine gates a window's verdict
 * on this so a window is never judged before its days are finalized. Crons are
 * off, so the finalized watermark can lag wall-clock arbitrarily — judging on
 * `today >= checkOn` alone would read a short (3+ days incomplete) post window
 * and bias the verdict. Bounded single-row read; fail-soft.
 *
 * Request-memoized (React.cache): on /results the page's initialContext and the
 * proof-summary section both probe this watermark; the cache collapses them to
 * one single-row query per request. Outside a request scope cache() is a
 * passthrough, so background/cron callers re-read as before.
 */
export const readLastFinalizedDate = cache(async (tenantId: string): Promise<string | null> => {
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
  } catch (err) {
    log.warn("gsc-window: last-finalized-date probe failed; window gate reads as no data", {
      tenant: tenantId,
      store: "gsc_daily_page_totals",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
});

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
