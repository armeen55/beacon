import "server-only";

/**
 * Clarity Proof window reader (BEACON_500 N4, 2026-07-03) - the Clarity half of
 * the behavior lane's I/O. Mirrors ga4-window.ts's posture exactly: bounded,
 * tenant-scoped, lean-projection reads over the nightly-accumulated
 * `clarity_daily_url_metrics` table (cols: url = FULL page URL, date, sessions,
 * rage_clicks, dead_clicks, quickbacks); fail-soft (zeros / null on any error)
 * so the behavior lane degrades to honest silence, never noise. No paid calls -
 * the nightly Clarity harvester (sync-daily-metrics.ts) already synced the rows.
 *
 * Scoped + cheap: one treated page per read (the behavior lane never reads
 * comparison pages), bounded date window, summed in JS.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

export type ClarityWindowMetrics = {
  visits: number;
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
};

/** Host-strip + trailing-slash-strip so a canonical URL and a stored Clarity
 *  URL compare equal ("https://x.com/cities/" -> "/cities"; "/" stays "/").
 *  Same normalization as ga4-window's ga4PathKey. */
export function clarityPathKey(urlOrPath: string): string {
  const noHost = urlOrPath.replace(/^https?:\/\/[^/]+/, "");
  const trimmed = noHost.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

const ZERO: ClarityWindowMetrics = { visits: 0, rageClicks: 0, deadClicks: 0, quickbacks: 0 };

/**
 * Summed Clarity metrics for ONE page over [start, end). The stored `url` is a
 * full URL possibly on a different host than the proof record's canonical page
 * (www vs apex), so filter by path suffix via ilike (anchored to the leading
 * "/" so "/cities" never matches "/california-persian-cities"), then bucket
 * precisely by normalized path in JS - the same matching ga4-window uses.
 * Root "/" is skipped (a bare-host ilike would match everything). Fail-soft
 * zeros on any error.
 */
export async function readClarityWindowForPage(args: {
  tenantId: string;
  page: string;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD exclusive
}): Promise<ClarityWindowMetrics> {
  const key = clarityPathKey(args.page);
  if (key === "/") return { ...ZERO };
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("clarity_daily_url_metrics")
      .select("url, sessions, rage_clicks, dead_clicks, quickbacks")
      .eq("tenant_id", args.tenantId)
      .gte("date", args.start)
      .lt("date", args.end)
      .or(`url.ilike.*${key},url.ilike.*${key}/`);
    if (error || !Array.isArray(data)) return { ...ZERO };

    const out = { ...ZERO };
    for (const r of data as Array<{
      url: string;
      sessions: number | string | null;
      rage_clicks: number | string | null;
      dead_clicks: number | string | null;
      quickbacks: number | string | null;
    }>) {
      if (clarityPathKey(r.url) !== key) continue;
      out.visits += Number(r.sessions) || 0;
      out.rageClicks += Number(r.rage_clicks) || 0;
      out.deadClicks += Number(r.dead_clicks) || 0;
      out.quickbacks += Number(r.quickbacks) || 0;
    }
    return out;
  } catch {
    return { ...ZERO };
  }
}

/** Most recent Clarity date present for a tenant (YYYY-MM-DD), or null. Gates
 *  how much post window has elapsed on the live_at clock - Clarity accumulates
 *  nightly, far faster than GSC's finalization lag. Bounded 1-row read;
 *  fail-soft null. */
export async function readLatestClarityDate(tenantId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("clarity_daily_url_metrics")
      .select("date")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const d = (data[0] as { date?: string }).date;
    return typeof d === "string" ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}
