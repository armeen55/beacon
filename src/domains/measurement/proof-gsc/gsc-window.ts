import "server-only";

/**
 * GSC Proof ledger - arbitrary-window page metrics (Phase 5, Path B).
 *
 * Reads clicks/impressions/position for a page over ANY [start, end) date window
 * by REUSING the existing `gsc_page_totals_v1` RPC (true page totals incl.
 * anonymized queries). The RPC only takes a single `p_since` (→ today), so a
 * bounded window is the difference of two cumulative reads:
 *
 *   window[start, end)  =  cumulativeSince(start) − cumulativeSince(end)
 *
 * Only successful, validated cumulative reads may be subtracted. Missing rows in
 * a successful response are different from unavailable or inconsistent source data.
 */

import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { log } from "@/lib/logger";
import type { GscWindowMetrics } from "./types";

type Cumulative = { clicks: number; impressions: number; posWeighted: number };
type SourceRead<T> = { status: "available"; data: T } | { status: "unavailable"; reason: string };

/** Cumulative page totals for all dates >= `since` (YYYY-MM-DD), keyed by canonical URL.
 *  Request-memoized like readLastFinalizedDate below: one measured change reads two snapshots per
 *  window across five windows, so a Results pass over 25 changes issued the same RPC 214 times in
 *  one walk. cache() collapses repeated (tenant, since) pairs to one call within a request and is a
 *  passthrough outside one. */
export const readCumulativeSince = cache(async (tenantId: string, since: string): Promise<SourceRead<Map<string, Cumulative>>> => {
  const out = new Map<string, Cumulative>();
  try {
    if (!tenantId.trim()) throw new Error("an account is required");
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("gsc_page_totals_v1", { p_tenant: tenantId, p_since: since });
    if (error || !Array.isArray(data)) throw new Error(error?.message ?? "non-array response");
    for (const r of data as Array<{ page: string; clicks: number | string; impressions: number | string; pos_weighted: number | string }>) {
      if (!r || typeof r.page !== "string" || !r.page.trim()) throw new Error("invalid page identity");
      const canon = canonicalPageKey(r.page);
      const numbers = [r.clicks, r.impressions, r.pos_weighted].map((n) => typeof n === "number" || typeof n === "string" && n.trim() ? Number(n) : NaN);
      if (numbers.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("invalid cumulative metrics");
      const cur: Cumulative = { clicks: numbers[0]!, impressions: numbers[1]!, posWeighted: numbers[2]! };
      const prev = out.get(canon);
      if (prev) { prev.clicks += cur.clicks; prev.impressions += cur.impressions; prev.posWeighted += cur.posWeighted; }
      else out.set(canon, cur);
    }
    return { status: "available", data: out };
  } catch (err) {
    log.warn("gsc-window: cumulative-totals read unavailable", {
      tenant: tenantId, store: "gsc_page_totals_v1", error: err instanceof Error ? err.message : String(err),
    });
    return { status: "unavailable", reason: "Search Console totals could not be read reliably." };
  }
});

/**
 * The most recent date with FINALIZED GSC data for a tenant (YYYY-MM-DD), or
 * null when there is none / on error. The proof engine gates a window's verdict
 * on this so a window is never judged before its days are finalized. Crons are
 * off, so the finalized watermark can lag wall-clock arbitrarily - judging on
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
      tenant: tenantId, store: "gsc_daily_page_totals", error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
});

function subtract(start: Cumulative | undefined, end: Cumulative | undefined): GscWindowMetrics | null {
  const clicks = (start?.clicks ?? 0) - (end?.clicks ?? 0);
  const impressions = (start?.impressions ?? 0) - (end?.impressions ?? 0);
  const rawPosition = (start?.posWeighted ?? 0) - (end?.posWeighted ?? 0);
  const tolerance = Number.EPSILON * Math.max(1, start?.posWeighted ?? 0, end?.posWeighted ?? 0) * 8;
  if (![clicks, impressions, rawPosition].every(Number.isFinite) || clicks < 0 || impressions < 0 || rawPosition < -tolerance) return null;
  const posW = Math.max(0, rawPosition);
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position: impressions > 0 ? posW / impressions : 0 };
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
  /** THE SITE'S OWN MOVEMENT over the same window: every page on file EXCEPT `exclude`, summed into one
   *  series and handed back under `key`. Off the same two snapshots the pages above are read from, so it
   *  costs no extra read. It is what a change is compared against when too few untouched pages match. */
  siteTotal?: { key: string; exclude: string };
}): Promise<SourceRead<Map<string, GscWindowMetrics>>> {
  const [startRead, endRead] = await Promise.all([readCumulativeSince(args.tenantId, args.start), readCumulativeSince(args.tenantId, args.end)]);
  if (startRead.status === "unavailable") return startRead;
  if (endRead.status === "unavailable") return endRead;
  const startCum = startRead.data, endCum = endRead.data;
  const out = new Map<string, GscWindowMetrics>();
  for (const page of args.pages) {
    // THE PAGE IS RESOLVED BEFORE IT IS LOOKED UP, AND ANSWERED UNDER THE NAME IT WAS ASKED BY (operator, 2026-09-02): a scheme-less
    // page key never matched the cumulative map's canonical absolute urls, so 57 of 90 shipments froze a starting point of zeros and
    // measured every later window against it. NOTHING ON FILE IS NOT ZERO: a page with no cumulative row on either side is absent.
    const canon = canonicalPageKey(page), start = startCum.get(canon), end = endCum.get(canon);
    if (start === undefined && end === undefined) continue;
    const metrics = subtract(start, end);
    if (!metrics) return { status: "unavailable", reason: "Search Console cumulative totals are inconsistent across this window." };
    out.set(page, metrics);
  }
  if (args.siteTotal) {
    const skip = canonicalPageKey(args.siteTotal.exclude);
    const total = (m: Map<string, Cumulative>): Cumulative => {
      const t: Cumulative = { clicks: 0, impressions: 0, posWeighted: 0 };
      for (const [page, c] of m) if (page !== skip) { t.clicks += c.clicks; t.impressions += c.impressions; t.posWeighted += c.posWeighted; }
      return t; };
    const metrics = subtract(total(startCum), total(endCum));
    if (!metrics) return { status: "unavailable", reason: "Search Console site totals are inconsistent across this window." };
    out.set(args.siteTotal.key, metrics);
  }
  return { status: "available", data: out };
}

/** The one spelling the cumulative map is keyed by: canonical absolute url, with a scheme supplied for a scheme-less page key. */
function canonicalPageKey(page: string): string {
  const raw = page.trim();
  const absolute = /^https?:\/\//i.test(raw) ? raw : raw.startsWith("/") ? raw : `https://${raw}`;
  return canonicalizeCitationUrl(absolute) ?? raw;
}
