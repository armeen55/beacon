/**
 * Fusion slice (2026-06-12), per-page GA4 value signals. Aggregates the tenant's synced `ga4_url_traffic` rows over the trailing 28-day
 * window into one value object per page, the PIE "Importance" axis from the fusion-math research (page business value weights the
 * priority of work on that page).
 *
 * Fail-soft: missing table / no rows / stale connector (no recent rows) → empty Map → every page weighs neutral (1.0). The weight
 * activates automatically once GA4 syncs fresh rows.
 */

import "server-only";

import { cache } from "react";
import { readThroughDaily } from "@/domains/evidence/readers/daily-read-cache";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { reportingDay } from "@/lib/reporting-day";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { log } from "@/lib/logger";
import {
  normalizePageRevenue,
  type PageRevenueValue,
} from "@/domains/evidence/readers/ga4-revenue";

// Request-memoized: the cockpit now reads GA4 page value from several sections
// (hero post-pass + the money-leak scan) on one render, cache() dedupes the
// full-tenant read to a single query per request. Degrades to a no-op outside a
// React request scope (cron/scripts call it uncached, exactly as before).
export const loadGa4PageValuesForTenant = cache(async (tenantId: string, now: Date = new Date()): Promise<Map<string, Ga4PageValue>> =>
  readThroughDaily<[string, Ga4PageValue][]>({
    tenantId, kind: "ga4-values", watermark: await ga4Watermark(tenantId),
    compute: async () => { const r = await loadGa4PageValuesForTenantUncached(tenantId, now);
      return { payload: [...r.rows], cacheable: r.complete }; },
  }).then((entries) => new Map(entries)));

/** GA4's own clock: the newest synced day on file, so a sync landing rows is the one thing that recomputes. */
async function ga4Watermark(tenantId: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().from("ga4_url_traffic").select("date")
      .eq("tenant_id", tenantId).order("date", { ascending: false }).limit(1);
    if (error) return null;
    return (data?.[0] as { date?: string } | undefined)?.date ?? null;
  } catch { return null; }
}

export type Ga4PageValue = {
  page: string;
  sessions28d: number;
  engaged28d: number;
  conversions28d: number;
};

const WINDOW_DAYS = 28;
// audit-wave #5 (2026-06-23): 25k url×day rows truncated high-traffic tenants (~890 pages × 28d) and dropped the most-recent days, understating the
// business-value weight. Raised to match the sibling per-URL reader (gsc-page-signals MAX_ROWS = 80k ≈ 2850 pages × 28d). Follow-up: a server-side
// GROUP BY RPC (one row per page) would remove the cap entirely.
const MAX_ROWS = 80_000;

/** WHETHER THIS READ FINISHED ITS PAGINATION, CARRIED OUT WITH ITS OWN ROWS. Both readers fail SOFT to a partial or empty map, so a failed read looks exactly like an account with no traffic and must never bank as the day's truth. One module-level flag served BOTH loaders and both run inside the same Promise.all, so whichever started second reset it to true and a truncated aggregate banked under a valid watermark (Codex, 2026-08-28); a completeness travelling with its own rows cannot be reset by a neighbour. */
type Read<T> = { rows: Map<string, T>; complete: boolean };

async function loadGa4PageValuesForTenantUncached(
  tenantId: string,
  now: Date = new Date(),
): Promise<Read<Ga4PageValue>> {
  let complete = true;
  const out = new Map<string, Ga4PageValue>();
  type Row = {
    url: string;
    sessions: number;
    engaged_sessions: number;
    conversions: number;
  };
  const rows: Row[] = [];
  try {
    const since = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);
    const sb = getSupabaseAdmin();
    // audit wave-2 #5 (2026-06-14): PostgREST caps a response at ~1000 rows regardless of .limit(), so the old `.limit(25000)` read silently
    // truncated to an arbitrary 1000 url×day rows, then the per-page SUM below understated sessions/conversions, skewing the GA4 priority
    // weight (a high-value page could weigh neutral because its rows fell past the cut). Page through in 1000-row chunks, stably ordered.
    const PAGE = 1000;
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await sb
        .from("ga4_url_traffic")
        .select("url, sessions, engaged_sessions, conversions")
        .eq("tenant_id", tenantId)
        .gte("date", since)
        .order("date")
        .order("url")
        .range(from, from + PAGE - 1);
      if (error) {
        log.warn("[ga4-page-values] read failed", {
          tenantId,
          error: error.message,
        });
        complete = false;
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch {
    complete = false;
    return { rows: out, complete };
  }
  for (const r of rows) {
    const page = canonicalizeCitationUrl(r.url) ?? r.url;
    const cur = out.get(page) ?? {
      page,
      sessions28d: 0,
      engaged28d: 0,
      conversions28d: 0,
    };
    cur.sessions28d += r.sessions ?? 0;
    cur.engaged28d += r.engaged_sessions ?? 0;
    cur.conversions28d += r.conversions ?? 0;
    out.set(page, cur);
  }
  return { rows: out, complete };
}

/**
 * VISITS IN TWO CONSECUTIVE 28-DAY WINDOWS, per page, so a fall in visits can be read against a ranking that
 * held. The same rows the value read above uses, split on the day 28 days back, and fail-soft to an empty map:
 * a page with no prior window says nothing rather than reading as a page that lost everything.
 */
export const loadGa4SessionSplitForTenant = async (
  tenantId: string,
  now: Date = new Date(),
): Promise<Map<string, { now: number; prior: number }>> =>
  // THE SAME WATERMARK READ-THROUGH ITS TWO SIBLINGS USE, because this was the one heavy GA4 read with no cache
  // of any kind: up to eighty sequential pages of ga4_url_traffic on every release rebuild, roughly ninety-six
  // times a day, against the very table the cached 28-day reader had just paged. Completeness is tracked
  // LOCALLY: a partial read is served live and never banked, and no shared module flag is involved.
  readThroughDaily<[string, { now: number; prior: number }][]>({
    tenantId, kind: "ga4-split", watermark: await ga4Watermark(tenantId),
    compute: async () => {
      const out = new Map<string, { now: number; prior: number }>();
      const split = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);
      const since = reportingDay(now.getTime() - 2 * WINDOW_DAYS * 86_400_000);
      let complete = true;
      try {
        const sb = getSupabaseAdmin();
        const PAGE = 1000;
        for (let from = 0; from < MAX_ROWS; from += PAGE) {
          const { data, error } = await sb
            .from("ga4_url_traffic")
            .select("url, sessions, date")
            .eq("tenant_id", tenantId)
            .gte("date", since)
            .order("date")
            .order("url")
            .range(from, from + PAGE - 1);
          if (error) { log.warn("[ga4-page-values] session split read failed", { tenantId, error: error.message }); complete = false; break; }
          const batch = (data ?? []) as unknown as { url: string; sessions: number; date: string }[];
          for (const r of batch) {
            const page = canonicalizeCitationUrl(r.url) ?? r.url;
            const cur = out.get(page) ?? { now: 0, prior: 0 };
            if (r.date >= split) cur.now += r.sessions ?? 0; else cur.prior += r.sessions ?? 0;
            out.set(page, cur);
          }
          if (batch.length < PAGE) break;
        }
      } catch { complete = false; }
      return { payload: [...out.entries()], cacheable: complete };
    },
  }).then((entries) => new Map(entries));


// ─────────────────────────────────────────────────────────────────────
// 2026-06-26, GA4 REVENUE page values (revenue migration). SEPARATE, ISOLATED read so a pre-migration "column does not exist" error fails ONLY
// revenue (→ empty map → conversion fallback downstream) and NEVER breaks the
// existing traffic read above. Returns normalized PageRevenueValue per page.
// ─────────────────────────────────────────────────────────────────────

export const loadGa4PageRevenueForTenant = cache(async (tenantId: string, now: Date = new Date()): Promise<Map<string, PageRevenueValue>> =>
  readThroughDaily<[string, PageRevenueValue][]>({
    tenantId, kind: "ga4-revenue", watermark: await ga4Watermark(tenantId),
    compute: async () => { const r = await loadGa4PageRevenueForTenantUncached(tenantId, now);
      return { payload: [...r.rows], cacheable: r.complete }; },
  }).then((entries) => new Map(entries)));

async function loadGa4PageRevenueForTenantUncached(
  tenantId: string,
  now: Date = new Date(),
): Promise<Read<PageRevenueValue>> {
  let complete = true;
  const out = new Map<string, PageRevenueValue>();
  type Row = {
    url: string;
    sessions: number;
    engaged_sessions: number;
    conversions: number;
    total_revenue: number | null;
    purchase_revenue: number | null;
    transactions: number | null;
    revenue_currency: string | null;
    revenue_synced_at: string | null;
  };
  // Per-page accumulator BEFORE normalization.
  type Acc = {
    sessions: number;
    engaged: number;
    conversions: number;
    total: number | null;
    purchase: number | null;
    transactions: number | null;
    currency: string | null;
    revenueObserved: boolean;
  };
  const accs = new Map<string, Acc>();
  try {
    const since = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);
    const sb = getSupabaseAdmin();
    const PAGE = 1000;
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await sb
        .from("ga4_url_traffic")
        .select(
          "url, sessions, engaged_sessions, conversions, total_revenue, purchase_revenue, transactions, revenue_currency, revenue_synced_at",
        )
        .eq("tenant_id", tenantId)
        .gte("date", since)
        .order("date")
        .order("url")
        .range(from, from + PAGE - 1);
      if (error) {
        // Pre-migration the revenue columns don't exist (PostgREST 42703) → this
        // read fails entirely. That's FINE: revenue stays unknown everywhere and the scorer falls back to conversions. The existing traffic read
        // (loadGa4PageValuesForTenant) is a SEPARATE query and keeps working.
        log.warn("[ga4-page-revenue] read failed (revenue unknown; conversion fallback)", {
          tenantId,
          error: error.message,
        });
        complete = false;
        return { rows: out, complete }; // empty → all pages "revenue unknown"
      }
      const batch = (data ?? []) as unknown as Row[];
      for (const r of batch) {
        const page = canonicalizeCitationUrl(r.url) ?? r.url;
        const cur = accs.get(page) ?? {
          sessions: 0,
          engaged: 0,
          conversions: 0,
          total: null,
          purchase: null,
          transactions: null,
          currency: null,
          revenueObserved: false,
        };
        cur.sessions += r.sessions ?? 0;
        cur.engaged += r.engaged_sessions ?? 0;
        cur.conversions += r.conversions ?? 0;
        const observed = r.revenue_synced_at != null && r.revenue_synced_at !== "";
        if (observed) {
          cur.revenueObserved = true;
          if (r.total_revenue != null) cur.total = (cur.total ?? 0) + r.total_revenue;
          if (r.purchase_revenue != null) cur.purchase = (cur.purchase ?? 0) + r.purchase_revenue;
          if (r.transactions != null) cur.transactions = (cur.transactions ?? 0) + r.transactions;
          if (cur.currency == null && r.revenue_currency) cur.currency = r.revenue_currency;
        }
        accs.set(page, cur);
      }
      if (batch.length < PAGE) break;
    }
  } catch {
    complete = false;
    return { rows: out, complete }; // fail-soft → revenue unknown everywhere
  }
  for (const [page, a] of accs) {
    out.set(
      page,
      normalizePageRevenue({
        page,
        sessions: a.sessions,
        engagedSessions: a.engaged,
        conversions: a.conversions,
        totalRevenue: a.total,
        purchaseRevenue: a.purchase,
        transactions: a.transactions,
        revenueCurrency: a.currency,
        revenueObserved: a.revenueObserved,
      }),
    );
  }
  return { rows: out, complete };
}
