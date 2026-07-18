import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import { log } from "@/lib/logger";
import { getLatestMoveDrafts, saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { getCompetitorAuditsForTenantId, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { runSerpQuery } from "./dataforseo-serp";
import { rootDomain } from "./serp-provider";
import type { SerpOrganicItem } from "./dataforseo-serp";

/**
 * displacement-check (BEACON 500 item 82, 2026-07-02) - the loss-side mirror of
 * the nightly opportunity picks. A money query the tenant already ranked for can
 * fall 3+ positions between one week and the next; today that only shows up if
 * the operator happens to look. This module: (1) finds those drops from the
 * tenant's OWN GSC history (no paid call), (2) spends ONE capped live Google
 * check per qualifying query through the EXISTING `runSerpQuery` gauntlet
 * (configured -> cache -> dry-run -> fail-closed monthly cap -> ledger; nothing
 * in that gauntlet is touched here), (3) reads off who now sits above the
 * tenant on that query, and (4) persists a compact verdict via move_drafts
 * (kind "displacement_check") so the trigger layer (a PURE predicate; see
 * triggers/displacement-check-alert.ts) can turn it into a worklist card
 * without doing any I/O itself.
 *
 * Two independent dedupe layers, per the item's "add an explicit guard too"
 * instruction:
 *   1. `runSerpQuery`'s own 14-day SERP cache (unchanged, upstream).
 *   2. An explicit per-query 14-day guard HERE, checked against the
 *      previously PERSISTED verdict's `checkedAt` - this is the one that
 *      actually stops us from re-spending the DataForSEO call at all (the
 *      cache guard only stops the parsed snapshot from costing money twice;
 *      without this guard we'd still re-run the whole detection + persist
 *      pass and touch the ledger's cache-hit path every night for the same
 *      query indefinitely).
 *
 * Money queries are read straight from `gsc_daily_rows` (site-wide, bounded,
 * clicks-ranked) exactly the way `loadTopTenantQueries` already reads GSC -
 * no new table, no new RPC.
 */

// ── PURE drop-detection math (unit-testable without a DB) ──────────────────

export type QueryPositionAgg = { clicks: number; impressions: number; posWeighted: number; page: string };

export type MoneyQueryDrop = {
  query: string;
  /** Best-guess owned page ranking for this query (highest recent clicks). */
  page: string;
  recentClicks: number;
  priorClicks: number;
  /** Impression-weighted average position, recent 7d window. */
  recentPosition: number;
  /** Impression-weighted average position, prior 7d window. */
  priorPosition: number;
  /** recentPosition - priorPosition; positive = fell down the results. */
  positionDrop: number;
  /** Rough weekly click value at risk, estimated from the recent window's
   *  daily click rate over the 7-day window (recentClicks as-is, since the
   *  window IS 7 days - no scaling needed, but named for the copy layer). */
  clicksAtRiskPerWeek: number;
};

/** A query counts as "money" when it earned real clicks in EITHER window -
 *  a query with zero clicks both windows is noise, never worth a paid check. */
const DEFAULT_MIN_CLICKS_FLOOR = 5;
/** 3+ position drop, per the item spec. */
const DEFAULT_MIN_POSITION_DROP = 3;

/**
 * PURE: compare two 7-day per-query aggregates (this window vs the one
 * before it) and return every query that (a) had real prior clicks (the
 * minimum-clicks floor - a query with 1 lucky click that "fell" from
 * position 9.0 to 12.4 is noise, not signal) and (b) fell by at least
 * `minPositionDrop` positions. Sorted worst-drop-first. Exported so the
 * windowing/threshold logic is fully unit-testable without a live DB.
 */
export function computeMoneyQueryDrops(
  recentByQuery: ReadonlyMap<string, QueryPositionAgg>,
  priorByQuery: ReadonlyMap<string, QueryPositionAgg>,
  opts: { minClicksFloor?: number; minPositionDrop?: number; cap?: number } = {},
): MoneyQueryDrop[] {
  const minClicksFloor = opts.minClicksFloor ?? DEFAULT_MIN_CLICKS_FLOOR;
  const minPositionDrop = opts.minPositionDrop ?? DEFAULT_MIN_POSITION_DROP;
  const cap = opts.cap ?? 25;

  const drops: MoneyQueryDrop[] = [];
  for (const [query, prior] of priorByQuery) {
    if (prior.impressions <= 0) continue;
    const recent = recentByQuery.get(query);
    // A query that had real prior clicks but zero recent presence didn't just
    // "drop" - it likely fell off the page entirely; still worth flagging, but
    // there's no recent position to compute a drop FROM, so skip it here (a
    // future "vanished" detector is a separate, honest signal).
    if (!recent || recent.impressions <= 0) continue;

    // Minimum-clicks floor: needs real demand in at least one window so noise
    // queries (a stray impression or two) never qualify.
    if (prior.clicks < minClicksFloor && recent.clicks < minClicksFloor) continue;

    const priorPosition = prior.posWeighted / prior.impressions;
    const recentPosition = recent.posWeighted / recent.impressions;
    if (priorPosition <= 0 || recentPosition <= 0) continue;

    const positionDrop = recentPosition - priorPosition;
    if (positionDrop < minPositionDrop) continue;

    drops.push({
      query,
      page: recent.page || prior.page,
      recentClicks: recent.clicks,
      priorClicks: prior.clicks,
      recentPosition,
      priorPosition,
      positionDrop,
      clicksAtRiskPerWeek: prior.clicks,
    });
  }

  drops.sort((a, b) => b.positionDrop - a.positionDrop);
  return drops.slice(0, cap);
}

// ── GSC read: two 7-day windows, site-wide, bounded ─────────────────────────

const WINDOW_DAYS = 7;
/** Bounded read: at page+query+day grain a 14-day span rarely exceeds this on
 *  a mid-size tenant; a hard cap keeps this a safety read, never a full scan. */
const ROW_BUDGET = 40_000;
/** PostgREST caps rows per response regardless of `.limit()` — page through in
 *  chunks of this size (same convention as gsc-page-signals.ts / gsc-decay),
 *  otherwise a window past the server's per-response cap silently truncates. */
const PAGE_SIZE = 1_000;

function isoDaysBefore(anchorMs: number, days: number): string {
  return new Date(anchorMs - days * 86_400_000).toISOString().slice(0, 10);
}

async function readQueryWindow(
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<Map<string, QueryPositionAgg>> {
  const out = new Map<string, QueryPositionAgg>();
  const sb = getSupabaseAdmin();

  // Track per-query click totals per page so we can name the single best-
  // attributed page (highest clicks) for that query in this window.
  const pageClicksByQuery = new Map<string, Map<string, number>>();

  // Page through the FULL window in PAGE_SIZE chunks, ordered by the primary
  // key columns (date, page, query) so pagination is stable across requests
  // (an impressions-desc order with no tiebreaker can reshuffle rows between
  // pages and either skip or duplicate them). Stop early on a short page.
  for (let offset = 0; offset < ROW_BUDGET; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, page, clicks, impressions, position")
      .eq("tenant_id", tenantId)
      .gte("date", fromIso)
      .lt("date", toIso)
      .order("date", { ascending: true })
      .order("page", { ascending: true })
      .order("query", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      log.warn("[displacement-check] gsc_daily_rows page read failed", {
        tenantId,
        offset,
        error: error.message,
      });
      break;
    }
    const batch = data ?? [];
    for (const r of batch) {
      const query = (r.query as string)?.trim();
      const page = (r.page as string)?.trim();
      if (!query || !page) continue;
      const impr = Number(r.impressions) || 0;
      const clicks = Number(r.clicks) || 0;
      const a = out.get(query) ?? { clicks: 0, impressions: 0, posWeighted: 0, page: "" };
      a.clicks += clicks;
      a.impressions += impr;
      a.posWeighted += (Number(r.position) || 0) * impr;
      out.set(query, a);

      const perPage = pageClicksByQuery.get(query) ?? new Map<string, number>();
      perPage.set(page, (perPage.get(page) ?? 0) + clicks);
      pageClicksByQuery.set(query, perPage);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  for (const [query, agg] of out) {
    const perPage = pageClicksByQuery.get(query);
    if (!perPage || perPage.size === 0) continue;
    agg.page = [...perPage.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return out;
}

/**
 * Load the tenant's real money-query drops: recent 7d vs the prior 7d,
 * anchored to the last FINALIZED GSC day (mirrors gsc-decay's anchoring so a
 * partially-synced "recent" window never manufactures a phantom drop).
 * Fail-soft -> [].
 */
export async function loadMoneyQueryDropsForTenant(
  tenantId: string,
  opts: { minClicksFloor?: number; minPositionDrop?: number; cap?: number } = {},
): Promise<MoneyQueryDrop[]> {
  if (!tenantId) return [];
  try {
    const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
    const anchorMs = lastFinal ? Date.parse(`${lastFinal}T00:00:00.000Z`) : Date.now();
    const recentFrom = isoDaysBefore(anchorMs, WINDOW_DAYS);
    const recentTo = isoDaysBefore(anchorMs, 0);
    const priorFrom = isoDaysBefore(anchorMs, WINDOW_DAYS * 2);
    const priorTo = recentFrom;

    const [recent, prior] = await Promise.all([
      readQueryWindow(tenantId, recentFrom, recentTo),
      readQueryWindow(tenantId, priorFrom, priorTo),
    ]);
    return computeMoneyQueryDrops(recent, prior, opts);
  } catch (e) {
    log.warn("[displacement-check] money-query drop read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── Persisted verdict shape + the paid check itself ─────────────────────────

export type DisplacerInfo = {
  domain: string;
  url: string;
  rank: number;
  /** A "what wins" one-liner from a cached competitor teardown, when one
   *  exists for this exact URL. Null when no teardown has run for it yet -
   *  the item explicitly forbids triggering a new teardown fetch here. */
  whatTheyHave: string | null;
};

export type DisplacementVerdict = {
  query: string;
  page: string;
  recentPosition: number;
  priorPosition: number;
  positionDrop: number;
  clicksAtRiskPerWeek: number;
  /** Domains now ranking ABOVE the tenant's own result, best (lowest rank) first. */
  displacers: DisplacerInfo[];
  /** True when the tenant's own URL could not be found at all in the fresh
   *  results (fell off the tracked top depth entirely). */
  fellOffPage: boolean;
  checkedAt: string;
  costUsd: number;
};

/** Stable move_drafts key for one tenant+query pair - re-checks land on the
 *  same row (latest wins per move-draft-store's own read contract). */
export function displacementDraftKey(query: string): string {
  return `displacement:${query.trim().toLowerCase()}`;
}

const DISPLACEMENT_KIND = "displacement_check";
/** Explicit re-check guard (separate from the SERP snapshot's own 14d cache -
 *  see the file header). A re-check within this window is skipped outright. */
const RECHECK_GUARD_MS = 14 * 24 * 60 * 60 * 1000;

export function parseDisplacementVerdict(content: string | null | undefined): DisplacementVerdict | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content) as DisplacementVerdict;
    return v && typeof v.query === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Pure: was the tenant's own domain ahead of us before it isn't now? Returns
 *  every organic result that outranks `ownRank`, best-first, capped. */
function displacersAbove(
  items: ReadonlyArray<SerpOrganicItem>,
  ownRank: number | null,
  ownDomain: string,
  cap = 5,
): { domain: string; url: string; rank: number }[] {
  const ceiling = ownRank ?? items.length + 1;
  return items
    .filter((it) => it.rank < ceiling && rootDomain(it.domain || it.url) !== ownDomain)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, cap)
    .map((it) => ({ domain: it.domain || rootDomain(it.url), url: it.url, rank: it.rank }));
}

export type DisplacementCheckSummary = {
  checked: number;
  cached: number;
  skippedRecent: number;
  skippedNoBudget: number;
  costUsd: number;
  verdicts: DisplacementVerdict[];
};

/**
 * Run the capped displacement check for one tenant. At most `maxChecks` money-
 * query drops get a real (or cached, or dry-run) `runSerpQuery` call each;
 * everything past the cap is honestly logged as skipped, never silently
 * dropped. A query already checked within `RECHECK_GUARD_MS` is skipped before
 * it ever reaches `runSerpQuery` (the explicit dedupe guard).
 */
export async function runDisplacementCheckForTenant(
  tenantId: string,
  opts: {
    maxChecks?: number;
    now?: () => Date;
    minClicksFloor?: number;
    minPositionDrop?: number;
    ownDomain?: string | null;
  } = {},
): Promise<DisplacementCheckSummary> {
  const maxChecks = opts.maxChecks ?? 3;
  const now = opts.now ?? (() => new Date());
  const summary: DisplacementCheckSummary = {
    checked: 0,
    cached: 0,
    skippedRecent: 0,
    skippedNoBudget: 0,
    costUsd: 0,
    verdicts: [],
  };

  const drops = await loadMoneyQueryDropsForTenant(tenantId, {
    minClicksFloor: opts.minClicksFloor,
    minPositionDrop: opts.minPositionDrop,
  });
  if (drops.length === 0) return summary;

  const ownDomain =
    opts.ownDomain ??
    (() => {
      try {
        return rootDomain(drops[0]!.page);
      } catch {
        return "";
      }
    })();

  const existingDrafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
  const nowMs = now().getTime();
  const competitorAudits = await getCompetitorAuditsForTenantId(tenantId).catch(() => new Map());

  let spent = 0;
  for (const drop of drops) {
    if (spent >= maxChecks) {
      summary.skippedNoBudget += 1;
      continue;
    }

    const draftKey = displacementDraftKey(drop.query);
    const existing = parseDisplacementVerdict(existingDrafts.get(`${draftKey}::${DISPLACEMENT_KIND}`)?.content);
    if (existing && Number.isFinite(Date.parse(existing.checkedAt)) && nowMs - Date.parse(existing.checkedAt) < RECHECK_GUARD_MS) {
      summary.skippedRecent += 1;
      continue;
    }

    spent += 1;
    let result;
    try {
      result = await runSerpQuery(drop.query, { depth: 10 });
    } catch (e) {
      log.warn("[displacement-check] runSerpQuery threw", {
        tenantId,
        query: drop.query,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // Only persist a verdict from a real read (ok) or a served cache hit -
    // never fabricate one from a dry-run/capped/disabled/error placeholder.
    if (result.status !== "ok" && result.status !== "cache_hit") {
      continue;
    }
    if (result.status === "cache_hit") summary.cached += 1;
    else summary.checked += 1;
    summary.costUsd += result.costUsd;

    const items = result.snapshot?.results.map((r) => ({ rank: r.rank, domain: r.domain, url: r.url })) ?? [];
    const ownItem = items.find((it) => rootDomain(it.domain || it.url) === ownDomain);
    const ownRank = ownItem?.rank ?? null;
    const fellOffPage = ownRank == null;

    const displacers = displacersAbove(items, ownRank, ownDomain).map((d) => {
      const key = canonicalizeCitationUrl(d.url) || d.url;
      const audit = competitorAudits.get(key);
      return {
        ...d,
        whatTheyHave: audit && audit.fetchStatus === "ok" ? whatWins(audit.facts) : null,
      };
    });

    const verdict: DisplacementVerdict = {
      query: drop.query,
      page: drop.page,
      recentPosition: drop.recentPosition,
      priorPosition: drop.priorPosition,
      positionDrop: drop.positionDrop,
      clicksAtRiskPerWeek: drop.clicksAtRiskPerWeek,
      displacers,
      fellOffPage,
      checkedAt: now().toISOString(),
      costUsd: result.costUsd,
    };
    summary.verdicts.push(verdict);
    await saveMoveDraft(tenantId, draftKey, DISPLACEMENT_KIND, JSON.stringify(verdict)).catch(() => false);
  }

  log.info("[displacement-check] done", {
    tenantId,
    drops: drops.length,
    checked: summary.checked,
    cached: summary.cached,
    skippedRecent: summary.skippedRecent,
    skippedNoBudget: summary.skippedNoBudget,
    costUsd: summary.costUsd,
  });
  return summary;
}

/**
 * Read every persisted displacement verdict for a tenant - the pure loader-
 * side read the trigger predicate consumes (predicates themselves may not do
 * I/O; see recommendation-trigger-predicates-purity). Fail-soft -> [].
 */
export async function loadDisplacementVerdictsForTenant(tenantId: string): Promise<DisplacementVerdict[]> {
  if (!tenantId) return [];
  try {
    const drafts = await getLatestMoveDrafts(tenantId);
    const out: DisplacementVerdict[] = [];
    for (const [key, row] of drafts) {
      if (!key.endsWith(`::${DISPLACEMENT_KIND}`)) continue;
      const v = parseDisplacementVerdict(row.content);
      if (v) out.push(v);
    }
    return out;
  } catch (e) {
    log.warn("[displacement-check] verdict read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
