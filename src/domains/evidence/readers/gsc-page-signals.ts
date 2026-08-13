/**
 * Per-page Search Console signals: the account's synced page+query grain aggregated over the trailing 90 days
 * into one signal per page, the pure input every GSC-driven predicate consumes. Single-day rates are too noisy
 * to recommend on, and the longer window steadies CTR and position; the `*90d` field names track WINDOW_DAYS.
 *
 * A READ THAT FAILED IS NOT A SITE WITH NO SEARCH DATA. A total failure THROWS and a partial one is handed
 * back marked incomplete, so the caller can say "the search data did not answer" instead of judging every
 * page against an empty Map. Both readers here are memoized on (account, reporting day), so the several
 * loaders that need this same 90-day aggregate during one rebuild share ONE statement.
 */

import "server-only";

import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { reportingDay } from "@/lib/reporting-day";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { readLastFinalizedDate } from "@/domains/measurement/proof-gsc/gsc-window";
import { log } from "@/lib/logger";
import { densifyDailyClicks } from "@/domains/evidence/gsc/densify-daily-series";

export type GscQuerySignal = {
  query: string;
  clicks: number;
  impressions: number;
  /** 0–1 fraction (Search Analytics convention). */
  ctr: number;
  /** Impressions-weighted average position (1-based). */
  position: number;
};

export type GscPageSignal = {
  /** Canonicalized page URL (map key, repeated for convenience). */
  page: string;
  clicks90d: number;
  impressions90d: number;
  /** clicks/impressions over the window (0–1). */
  ctr90d: number;
  /** Impressions-weighted average position over the window. */
  position90d: number;
  /** Top queries by impressions (capped). */
  topQueries: GscQuerySignal[];
  /** Impressions over the VISIBLE page+query grain only, before the page-totals override below. The true
   *  totals include the queries GSC anonymizes, so total minus this is the anonymized share. */
  queryVisibleImpressions90d?: number;
};

/** The fuller history GSC holds: more pages, steadier CTR and position. */
const WINDOW_DAYS = 90;
const TOP_QUERIES_CAP = 8;
/** Bounded read. The result is one row per page, so this is a safety net, never the working size. */
const MAX_ROWS = 80_000;
/** PostgREST response cap — page through in chunks of this size. */
const PAGE_SIZE = 1_000;
/** EVERY ONE OF THESE AGGREGATES CARRIES ITS OWN DEADLINE. They are the heaviest statements this product
 *  issues, and an abandoned request held its connection until Postgres noticed, so a slow night stacked
 *  copies of one GROUP BY until a statement timed out. Above the ~20s a rebuild allows itself, so a read
 *  that would still have answered in time does. */
const RPC_DEADLINE_MS = 25_000;
/** Noon UTC on a reporting day. Pacific runs seven to eight hours behind UTC, so noon UTC always lands on
 *  the same reporting day: every caller that asked with its own clock derives the same window. */
const dayInstant = (day: string): number => Date.parse(`${day}T12:00:00.000Z`) || Date.now();
/** A function or table that is not there yet is the pre-backfill window, never an outage. */
const isMissingObject = (code: string | null | undefined): boolean =>
  code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01";

/** One page-signal read, and whether it is the WHOLE window. `incomplete` means an error cut the paging
 *  short after some rows landed: the signals are real but partial, and a surface that treats partial as
 *  complete judges every unread page clean. A read that got nothing at all throws instead. */
type GscPageSignalsRead = { signals: Map<string, GscPageSignal>; incomplete: boolean };

async function readGscPageSignalsForDayUncached(tenantId: string, day: string): Promise<GscPageSignalsRead> {
  const out = new Map<string, GscPageSignal>();
  const now = new Date(dayInstant(day));
  // ONE server-side GROUP BY returns complete per-page totals plus that page's top queries; the RESULT is
  // paged by `page` purely as a safety net for a site with more than a thousand distinct addresses.
  type RpcRow = { page: string; clicks: number | string; impressions: number | string; pos_weighted: number | string;
    top_queries: Array<{ query: string; clicks: number; impressions: number; position: number }> | null };
  const rpcRows: RpcRow[] = [];
  // THE READ'S OWN FAILURE, CARRIED RATHER THAN SWALLOWED. A PostgREST error used to `break` out of the
  // paging and hand back whatever had landed, so a statement timeout on this one GROUP BY was served to
  // every surface as a site with no search data at all and every page judged clean.
  let readError: Error | null = null;
  try {
    const since = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .rpc("gsc_page_signals_v1", { p_tenant: tenantId, p_since: since })
        .abortSignal(AbortSignal.timeout(RPC_DEADLINE_MS))
        .order("page")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.error("[gsc-page-signals] rpc read failed", { tenantId, offset, error: error.message });
        readError = new Error(`gsc_page_signals_v1 read failed at offset ${offset}: ${error.message}`);
        break;
      }
      const batch = (data ?? []) as unknown as RpcRow[];
      rpcRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (e) {
    // LOUD, not silent: this loader feeds the demand graph and every GSC surface.
    log.error("[gsc-page-signals] read threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    readError = e instanceof Error ? e : new Error(String(e));
  }
  // NOTHING READ AND AN ERROR TO SHOW FOR IT is the same claim the decay reader has always made: throw, so
  // the caller marks the source failed rather than reporting an account that has never ranked for anything.
  if (readError != null && rpcRows.length === 0) throw readError;
  if (rpcRows.length === 0) return { signals: out, incomplete: false };

  // `pos_weighted` is Σ(position × impressions); divide by impressions for the weighted average position.
  for (const r of rpcRows) {
    const page = canonicalizeCitationUrl(r.page) ?? r.page;
    const clicks = Number(r.clicks) || 0;
    const impressions = Number(r.impressions) || 0;
    const positionWeighted = Number(r.pos_weighted) || 0;
    const querySignals: GscQuerySignal[] = (r.top_queries ?? []).map((q) => {
      const qImpr = Number(q.impressions) || 0, qClicks = Number(q.clicks) || 0;
      return { query: q.query, clicks: qClicks, impressions: qImpr,
        ctr: qImpr > 0 ? qClicks / qImpr : 0, position: Number(q.position) || 0 };
    });
    out.set(page, {
      page,
      clicks90d: clicks,
      impressions90d: impressions,
      ctr90d: impressions > 0 ? clicks / impressions : 0,
      position90d: impressions > 0 ? positionWeighted / impressions : 0,
      topQueries: querySignals.slice(0, TOP_QUERIES_CAP),
      // Kept before the totals override replaces impressions90d, so the anonymized share stays computable.
      queryVisibleImpressions90d: impressions,
    });
  }

  // THE TRUE page-level numbers override the sums above: they include the low-volume queries GSC anonymizes,
  // so CTR and impressions match what the operator sees in Search Console. Top queries are kept as read.
  let totalsIncomplete = false;
  try {
    const sinceTotals = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);
    const sbTotals = getSupabaseAdmin();
    const totalsByPage = new Map<string, { clicks: number; impressions: number; positionWeighted: number }>();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sbTotals
        .rpc("gsc_page_totals_v1", { p_tenant: tenantId, p_since: sinceTotals })
        .abortSignal(AbortSignal.timeout(RPC_DEADLINE_MS))
        .order("page")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        // The true page totals carry the queries GSC anonymizes, so losing them UNDERSTATES every page's
        // impressions. A table that does not exist yet is the pre-backfill window and stays soft; anything
        // else is an outage the caller is told about rather than a quietly smaller number.
        if (!isMissingObject((error as { code?: string }).code)) {
          log.error("[gsc-page-signals] page-totals read failed", { tenantId, offset, error: error.message });
          totalsIncomplete = true;
        }
        break;
      }
      const batch = (data ?? []) as unknown as Array<{ page: string; clicks: number | string;
        impressions: number | string; pos_weighted: number | string }>;
      for (const r of batch) {
        const page = canonicalizeCitationUrl(r.page) ?? r.page;
        let acc = totalsByPage.get(page);
        if (!acc) { acc = { clicks: 0, impressions: 0, positionWeighted: 0 }; totalsByPage.set(page, acc); }
        acc.clicks += Number(r.clicks) || 0;
        acc.impressions += Number(r.impressions) || 0;
        acc.positionWeighted += Number(r.pos_weighted) || 0;
      }
      if (batch.length < PAGE_SIZE) break;
    }
    for (const [page, acc] of totalsByPage) {
      const totals = { clicks90d: acc.clicks, impressions90d: acc.impressions,
        ctr90d: acc.impressions > 0 ? acc.clicks / acc.impressions : 0,
        position90d: acc.impressions > 0 ? acc.positionWeighted / acc.impressions : 0 };
      const existing = out.get(page);
      // Seen only in page totals: every one of this page's queries is below GSC's anonymity threshold.
      out.set(page, existing ? { ...existing, ...totals }
        : { page, ...totals, topQueries: [], queryVisibleImpressions90d: 0 });
    }
  } catch (e) {
    log.error("[gsc-page-signals] page-totals read threw", {
      tenantId, error: e instanceof Error ? e.message : String(e) });
    totalsIncomplete = true;
  }

  return { signals: out, incomplete: readError != null || totalsIncomplete };
}

/** ONE STATEMENT PER ACCOUNT PER DAY IN A REQUEST. The demand graph, the trigger loader, the ownership
 *  registry and the preparation path all ask for this same expensive aggregate during one rebuild. The memo
 *  was here and did nothing: every call site handed it a fresh `new Date()` or left the argument off, and
 *  React keys a memo on the arguments it was given. The day is normalized inside the one entry every caller
 *  uses, so there is exactly one slot to share. */
const readGscPageSignalsForDay = cache(readGscPageSignalsForDayUncached);

/** The full read: the signals AND whether they are the whole window. Throws when nothing could be read. */
export const readGscPageSignalsForTenant = (tenantId: string, now: Date = new Date()): Promise<GscPageSignalsRead> =>
  readGscPageSignalsForDay(tenantId, reportingDay(now));

/** The signals alone, for the callers that already treat a thin read as thin evidence. */
export const loadGscPageSignalsForTenant = async (tenantId: string, now: Date = new Date()): Promise<Map<string, GscPageSignal>> =>
  (await readGscPageSignalsForTenant(tenantId, now)).signals;

// ── Site totals slice (2026-06-15) — light per-day site-totals read ──

export type GscSiteTotals = {
  /** Σ clicks over the trailing 90-day window. */
  clicks90d: number;
  /** Σ impressions over the trailing 90-day window. */
  impressions90d: number;
  /** Impressions-weighted average position = Σ(position×impr)/Σimpr. */
  avgPosition90d: number;
  /** Site CTR = Σclicks/Σimpressions over the window (0–1). */
  ctr90d: number;
  /** Σ clicks over the trailing 28 days (for the before/after delta). */
  clicks28d: number;
  /** Σ clicks over days 28–56 ago (the prior 28-day window). */
  clicksPrev28d: number;
  /**
   * Per-day click series over the window, ascending by date, ONE entry
   * per calendar day (clicks summed across all of the tenant's property
   * rows for that date). This is the same `gsc_daily_totals` read the
   * aggregates above come from — no extra DB round-trip — surfaced for a
   * tiny momentum sparkline on the Search card.
   */
  dailyClicks: { date: string; clicks: number }[];
};

/**
 * INSTANT GSC summary read (2026-06-15). The headline GSC stat card needs
 * only site-level totals — total clicks/impressions, impressions-weighted
 * average position, site CTR, and a 28d/prior-28d clicks split for the
 * before/after arrow. The full per-page signal loader
 * (`loadGscPageSignalsForTenant`) reads ~200 pages of page+query grain and
 * takes seconds; this reads the tiny `gsc_daily_totals` table instead —
 * ONE row per (property, day), ~91 rows for a 90-day window — and sums it
 * in a single indexed, tenant-scoped read. That makes the summary card
 * stream instantly.
 *
 * `gsc_daily_totals` is the property-level ungrouped totals row GSC reports
 * per day (the honest property truth — see sync-search-analytics.ts). If a
 * tenant has multiple `property` rows for a given date, we SUM across
 * properties (the page-signal loaders also aggregate every property the
 * tenant has). Positions are impressions-weighted using each day's
 * impressions, exactly mirroring the per-page card's position math.
 *
 * Fail-soft: missing table / no rows / Supabase error → null (→ no GSC
 * card; the caller never shows a zero/empty card).
 */
export async function loadGscSiteTotalsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<GscSiteTotals | null> {
  try {
    const since90 = reportingDay(now.getTime() - WINDOW_DAYS * 86_400_000);

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_totals")
      .select("date, clicks, impressions, position")
      .eq("tenant_id", tenantId)
      .gte("date", since90)
      .order("date", { ascending: true });
    if (error || !data || data.length === 0) return null;

    const rows = data as Array<{
      date: string;
      clicks: number | string | null;
      impressions: number | string | null;
      position: number | string | null;
    }>;

    // Anchor the 28d / prior-28d split to the LAST FINALIZED day present in the
    // data (rows arrive ascending; the sync only persists finalized days, ~3d
    // behind wall-clock). Anchoring to `now` instead would make the "current"
    // 28d window ~3 days short vs a full prior 28d, manufacturing a ~11% phantom
    // CLICK DECLINE on a perfectly flat site (and flipping the headline to
    // "declining"). Both windows are now exactly 28 finalized days.
    const end = rows[rows.length - 1]!.date;
    const endMs = Date.parse(end);
    const since28 = new Date(endMs - 27 * 86_400_000).toISOString().slice(0, 10);
    const since56 = new Date(endMs - 55 * 86_400_000).toISOString().slice(0, 10);

    let clicks90d = 0;
    let impressions90d = 0;
    let positionWeighted90d = 0;
    let clicks28d = 0;
    let clicksPrev28d = 0;
    // Per-day clicks for the momentum sparkline. A tenant with multiple
    // `property` rows for one date contributes several rows per day, so we
    // accumulate clicks per calendar day before emitting (one point/day).
    // Rows already arrive ascending by date (ORDER BY above); insertion
    // order into the Map therefore stays ascending.
    const clicksByDate = new Map<string, number>();
    for (const r of rows) {
      const clicks = Number(r.clicks) || 0;
      const impressions = Number(r.impressions) || 0;
      const position = Number(r.position) || 0;
      clicks90d += clicks;
      impressions90d += impressions;
      // Impressions-weight each day's position so the site number is
      // impressions-weighted, never an unweighted average of daily positions.
      positionWeighted90d += position * impressions;
      // 28d / prior-28d clicks split (multiple property rows per date sum
      // naturally — we accumulate per-row, not per-date).
      if (r.date >= since28) {
        clicks28d += clicks;
      } else if (r.date >= since56) {
        clicksPrev28d += clicks;
      }
      clicksByDate.set(r.date, (clicksByDate.get(r.date) ?? 0) + clicks);
    }
    if (impressions90d <= 0) return null;

    const dailyClicks = densifyDailyClicks(
      [...clicksByDate.entries()].map(([date, clicks]) => ({ date, clicks })),
    );

    return {
      clicks90d,
      impressions90d,
      avgPosition90d: positionWeighted90d / impressions90d,
      ctr90d: clicks90d / impressions90d,
      clicks28d,
      clicksPrev28d,
      dailyClicks,
    };
  } catch (e) {
    // LOUD, not silent (mirror the loud sibling at the page-signals read): this
    // feeds the State-of-Union "Your traffic trend" section, which blanks with zero
    // telemetry on a transient gsc_daily_totals failure. Surface it.
    log.warn("[gsc-site-totals] read threw — trend section will be empty", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ── Decay slice (2026-06-12) — split-window decay signals ────────────

export type GscDecaySignal = {
  page: string;
  /** Trailing 28-day window. */
  clicksNow: number;
  positionNow: number;
  impressionsNow: number;
  /** The 28 days before that. */
  clicksPrior: number;
  positionPrior: number;
  impressionsPrior: number;
  /** The last FINALIZED GSC day the "now" window ends on (the split/anchor), so a
   *  surface can name the exact window the clicksNow/clicksPrior delta was measured
   *  through. Without this the copy says "the last 4 weeks" with no defined end, and
   *  an auditor picking their own 4 weeks (including the ~3 unfinalized lag days)
   *  reproduces a DIFFERENT number. Same value for every row in one read. */
  windowNowEnd: string;
};

const DECAY_WINDOW_DAYS = 28;

/**
 * Two consecutive 28-day windows per page (56 days total), for the
 * decay/refresh rule (Animalz "two or more signals crossing
 * simultaneously"; Ahrefs "declining pages" opportunity class —
 * sources in the slice commit). Positions are impressions-weighted.
 * Fail-soft on PARTIAL reads (keeps what loaded before a later-page error);
 * THROWS on a TOTAL read failure (zero data) so the caller logs it loudly
 * rather than silently reporting "no decaying pages".
 */
async function loadGscDecaySignalsForDayUncached(
  tenantId: string,
  day: string,
): Promise<Map<string, GscDecaySignal>> {
  const out = new Map<string, GscDecaySignal>();
  const now = new Date(dayInstant(day));
  // audit-wave #4 (2026-06-23): anchor the now/prior split to the last FINALIZED
  // GSC day, not wall-clock. GSC finalizes ~2-3 days behind, so a now-anchored
  // "now" window holds fewer real data-days than the equal-width "prior" window
  // → manufactured click "declines" + false fading-page recs. Mirrors the
  // gsc_page_totals watermark fix; falls back to `now` when no finalized data
  // exists (best-effort, today's behavior).
  const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
  // The "now" window ends on the anchor: the last finalized GSC day, or the current
  // reporting day when no finalized data exists. Surfaces render this so the clicks
  // delta names its exact window end instead of an undated "last 4 weeks". Anchoring
  // on a day LABEL keeps the split arithmetic below pure day math.
  const windowNowEnd = lastFinal ?? reportingDay(now);
  const anchorMs = Date.parse(`${windowNowEnd}T00:00:00.000Z`);
  const splitMs = anchorMs - DECAY_WINDOW_DAYS * 86_400_000;
  const split = new Date(splitMs).toISOString().slice(0, 10);
  const since = new Date(splitMs - DECAY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // audit #24 (2026-06-14): server-side split-window GROUP BY via
  // gsc_decay_v1 returns ONE row per page with now/prior aggregates
  // (pos_w = Σ position*impressions per window). This replaces paging the
  // ~135k raw page+query+day rows a busy site has in the 2×28-day window
  // client-side every run — 80-160 PostgREST round-trips that ALSO risked
  // SILENTLY TRUNCATING at the 160k cap as the site grows, corrupting the
  // now-vs-prior decay sums. The result is re-canonicalized + merged
  // app-side (two raw pages can canonicalize to one); paging the RESULT by
  // `page` is just a safety net for a site with >1k distinct pages.
  const DECAY_MAX_ROWS = 160_000;
  type Acc = {
    clicks: number;
    impressions: number;
    positionWeighted: number;
  };
  type RpcRow = {
    page: string;
    clicks_now: number | string;
    impressions_now: number | string;
    pos_w_now: number | string;
    clicks_prior: number | string;
    impressions_prior: number | string;
    pos_w_prior: number | string;
  };
  const nowAcc = new Map<string, Acc>();
  const priorAcc = new Map<string, Acc>();
  let readError: Error | null = null;
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < DECAY_MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .rpc("gsc_decay_v1", {
          p_tenant: tenantId,
          p_since: since,
          p_split: split,
        })
        .abortSignal(AbortSignal.timeout(RPC_DEADLINE_MS))
        .order("page")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.error("[gsc-decay-signals] rpc read failed", {
          tenantId,
          offset,
          error: error.message,
        });
        readError = new Error(
          `gsc_decay_v1 read failed at offset ${offset}: ${error.message}`,
        );
        break;
      }
      const batch = (data ?? []) as unknown as RpcRow[];
      for (const r of batch) {
        const page = canonicalizeCitationUrl(r.page) ?? r.page;
        let n = nowAcc.get(page);
        if (!n) {
          n = { clicks: 0, impressions: 0, positionWeighted: 0 };
          nowAcc.set(page, n);
        }
        // pos_w_* already arrive impressions-weighted from the RPC.
        n.clicks += Number(r.clicks_now) || 0;
        n.impressions += Number(r.impressions_now) || 0;
        n.positionWeighted += Number(r.pos_w_now) || 0;
        let p = priorAcc.get(page);
        if (!p) {
          p = { clicks: 0, impressions: 0, positionWeighted: 0 };
          priorAcc.set(page, p);
        }
        p.clicks += Number(r.clicks_prior) || 0;
        p.impressions += Number(r.impressions_prior) || 0;
        p.positionWeighted += Number(r.pos_w_prior) || 0;
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.error("[gsc-decay-signals] rpc threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    readError = e instanceof Error ? e : new Error(String(e));
  }
  // A read failure that accumulated ZERO data is indistinguishable from a
  // genuine "no decaying pages" result — and silently returning an empty Map
  // makes the decay trigger emit nothing while the run looks healthy. Surface
  // it as a throw so the caller (which already wraps this in its own
  // try/catch) logs it loudly; the run still continues with no decay
  // candidates, but the failure is observable instead of a silent
  // false-negative. Partial reads (some data before a later-page error) keep
  // what they got — better than nothing, and the error was logged above.
  if (readError != null && nowAcc.size === 0 && priorAcc.size === 0) {
    throw readError;
  }
  if (nowAcc.size === 0 && priorAcc.size === 0) return out;
  const pages = new Set([...nowAcc.keys(), ...priorAcc.keys()]);
  for (const page of pages) {
    const n = nowAcc.get(page);
    const p = priorAcc.get(page);
    out.set(page, {
      page,
      clicksNow: n?.clicks ?? 0,
      impressionsNow: n?.impressions ?? 0,
      positionNow:
        n != null && n.impressions > 0 ? n.positionWeighted / n.impressions : 0,
      clicksPrior: p?.clicks ?? 0,
      impressionsPrior: p?.impressions ?? 0,
      positionPrior:
        p != null && p.impressions > 0 ? p.positionWeighted / p.impressions : 0,
      windowNowEnd,
    });
  }
  return out;
}

/** THE SAME ONE SLOT PER ACCOUNT PER DAY the page signals get. This read was never memoized at all, so the
 *  publish path, the lanes, Visibility and the producer each paid for their own split-window GROUP BY. */
const loadGscDecaySignalsForDay = cache(loadGscDecaySignalsForDayUncached);

export function loadGscDecaySignalsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<Map<string, GscDecaySignal>> {
  return loadGscDecaySignalsForDay(tenantId, reportingDay(now));
}
