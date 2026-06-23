import "server-only";

/**
 * GA4 Proof window reader (Dollar-ROI proof, audit gap #1).
 *
 * The GSC proof answers "did rank/clicks move?". This adds the TRAFFIC +
 * CONVERSION dimension from GA4 so a shipped change can be judged on sessions,
 * engaged sessions, and conversions — not only Search. Mirrors gsc-window's
 * shape (sum a page's metrics over [start, end)), reading the durable
 * `ga4_url_traffic` table (cols: url=path, date, sessions, engaged_sessions,
 * conversions). Revenue is intentionally absent: the GA4 connector returns no
 * revenue/eventValue for this property, so proof degrades honestly rather than
 * inventing money (see traffic-outcome.ts).
 *
 * Scoped + cheap: filters to the handful of proof pages (treated + controls) in
 * a bounded date window, sums in JS. Fail-soft (empty map on any error).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

export type Ga4WindowMetrics = {
  sessions: number;
  engagedSessions: number;
  conversions: number;
};

/** Host-strip + trailing-slash-strip so a canonical URL and a stored GA4 path
 *  key compare equal ("https://x.com/cities/" → "/cities"; "/" stays "/"). */
export function ga4PathKey(urlOrPath: string): string {
  const noHost = urlOrPath.replace(/^https?:\/\/[^/]+/, "");
  const trimmed = noHost.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Read summed GA4 metrics for several pages over [start, end). `pages` are the
 * proof record's page keys (canonical URLs or paths); the returned map is keyed
 * by the SAME strings passed in. A page with no GA4 rows maps to all-zeros.
 */
export async function readGa4WindowForPages(args: {
  tenantId: string;
  pages: ReadonlyArray<string>;
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD exclusive
}): Promise<Map<string, Ga4WindowMetrics>> {
  const out = new Map<string, Ga4WindowMetrics>();
  const zero = (): Ga4WindowMetrics => ({ sessions: 0, engagedSessions: 0, conversions: 0 });
  for (const p of args.pages) out.set(p, zero());

  // path key → the original page string(s) that map to it (controls + treated
  // could share, but normally distinct).
  const keyToPages = new Map<string, string[]>();
  for (const p of args.pages) {
    const k = ga4PathKey(p);
    const arr = keyToPages.get(k) ?? [];
    arr.push(p);
    keyToPages.set(k, arr);
  }
  // The stored `url` is a FULL URL (e.g. https://iranopedia.com/cities), possibly
  // on a different host than the proof record's canonical page (www vs apex) — so
  // we can't equality-match on path. Filter by path SUFFIX via ilike (anchored to
  // the leading "/" so "/cities" never matches "/california-persian-cities"), then
  // bucket precisely by normalized path in JS. Root "/" is skipped (a bare-host
  // ilike would match everything); home-page proof rows are a rare edge.
  const wantedKeys = [...keyToPages.keys()];
  const orFilter = wantedKeys
    .filter((k) => k !== "/")
    .flatMap((k) => [`url.ilike.*${k}`, `url.ilike.*${k}/`])
    .join(",");
  if (orFilter === "") return out;

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("ga4_url_traffic")
      .select("url, sessions, engaged_sessions, conversions")
      .eq("tenant_id", args.tenantId)
      .gte("date", args.start)
      .lt("date", args.end)
      .or(orFilter);
    if (error || !Array.isArray(data)) return out;

    // Sum per path key.
    const byKey = new Map<string, Ga4WindowMetrics>();
    for (const r of data as Array<{
      url: string;
      sessions: number | string | null;
      engaged_sessions: number | string | null;
      conversions: number | string | null;
    }>) {
      const k = ga4PathKey(r.url);
      const acc = byKey.get(k) ?? zero();
      acc.sessions += Number(r.sessions) || 0;
      acc.engagedSessions += Number(r.engaged_sessions) || 0;
      acc.conversions += Number(r.conversions) || 0;
      byKey.set(k, acc);
    }

    for (const [k, pagesForKey] of keyToPages) {
      const summed = byKey.get(k);
      if (!summed) continue;
      for (const p of pagesForKey) out.set(p, { ...summed });
    }
  } catch {
    /* fail-soft */
  }
  return out;
}

/** Most recent GA4 date present for a tenant (YYYY-MM-DD), or null. Used to gate
 *  whether a GA4 post window has enough data to read — GA4 settles in ~1-2 days,
 *  far faster than GSC's finalization lag. Bounded single-row read; fail-soft. */
export async function readLatestGa4Date(tenantId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("ga4_url_traffic")
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
