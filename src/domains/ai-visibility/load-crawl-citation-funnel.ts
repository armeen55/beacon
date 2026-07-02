import "server-only";

/**
 * load-crawl-citation-funnel (2026-07-02, BEACON_500 item 7) - the I/O edge
 * that feeds the pure crawl-to-citation-to-revenue funnel. $0, existing
 * tables only, request memoized with react cache(), tenant-scoped, bounded,
 * fail-soft (any read error collapses to an empty report, never a crash and
 * never a fabricated stage).
 *
 * Sources (all REUSED where a loader already exists):
 *   - profound_bot_rows        via loadBotReferralSignals (react cache shared
 *                              with the Today AI band, so this adds no read)
 *   - profound_citation_rows   lean projection here (date, url, citation_count),
 *                              owned-domain filtered in SQL like citations-daily
 *   - prompt_answer_observations  lean projection of OWNED-citing poll rows for
 *                              the distinct-question count per page
 *   - ga4_ai_referral_daily    lean projection here (the ai-referrals loader
 *                              caps topPages at 10; the funnel needs ALL pages),
 *                              reusing its exported row mapper + source labels
 *   - gsc_page_signals via loadGscPageSignalsForTenant (demand proxy: 90d
 *                              Google impressions per page)
 *
 * Pinned by load-crawl-citation-funnel.test.ts.
 */

import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { aiSourceLabel } from "@/lib/connectors/ga4/ai-sources";
import { mapAiReferralRow } from "./ai-referrals";
import {
  buildFunnelReport,
  funnelPathKey,
  type FunnelReport,
  type FunnelJoinInputs,
} from "./crawl-citation-funnel";

/** Citation + click window. Crawl rows are unwindowed (the reused loader reads
 *  the synced set whole; per-page lastAt carries the freshness instead). */
const WINDOW_DAYS = 30;
const MAX_CITATION_ROWS = 20_000;
const MAX_OBSERVATION_ROWS = 6_000;
const MAX_GA4_ROWS = 10_000;

const EMPTY_REPORT: FunnelReport = {
  hasData: false,
  feeds: { crawl: false, cited: false, clicks: false, crawledPageCount: 0 },
  pages: [],
  stalled: [],
  stageCounts: { not_crawled: 0, crawled_not_cited: 0, cited_no_clicks: 0, converting: 0, no_signal: 0 },
};

export function emptyFunnelReport(): FunnelReport {
  return {
    ...EMPTY_REPORT,
    feeds: { ...EMPTY_REPORT.feeds },
    pages: [],
    stalled: [],
    stageCounts: { ...EMPTY_REPORT.stageCounts },
  };
}

function windowCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Bare lowercased host of a URL, or null. */
function urlHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

type CitedAgg = Map<string, { count: number; prompts: Set<string>; lastAt: string | null }>;

/** Fold one owned citation event into the per-path aggregate. Pure; exported
 *  for tests via __testing. */
function foldCitation(agg: CitedAgg, path: string, count: number, day: string | null, promptId?: string): void {
  const entry = agg.get(path) ?? { count: 0, prompts: new Set<string>(), lastAt: null };
  entry.count += count;
  if (promptId) entry.prompts.add(promptId);
  if (day && (!entry.lastAt || day > entry.lastAt)) entry.lastAt = day;
  agg.set(path, entry);
}

/** Imported Profound citation rows -> per-path aggregate entries. A row exists
 *  because a citation was counted, so a 0/null count still counts as 1 (same
 *  floor citations-daily uses). Pure; exported for tests. */
export function aggregateImportedCitations(
  rows: Array<{ date?: unknown; url?: unknown; citation_count?: unknown }>,
  agg: CitedAgg = new Map(),
): CitedAgg {
  for (const r of rows) {
    const url = typeof r.url === "string" ? r.url : null;
    if (!url) continue;
    const day = typeof r.date === "string" ? r.date.slice(0, 10) : null;
    const count = Math.max(1, Number(r.citation_count) || 1);
    foldCitation(agg, funnelPathKey(url), count, day);
  }
  return agg;
}

/** Native poll rows (owned-citing) -> per-path aggregate. One observation adds
 *  at most 1 count per page (dedup inside the answer) and one distinct
 *  question. Only URLs on the tenant's own host (needle match) count. Pure;
 *  exported for tests. */
export function aggregateNativeCitations(
  rows: Array<{ prompt_id?: unknown; observed_at?: unknown; citation_urls?: unknown }>,
  ownNeedle: string,
  agg: CitedAgg = new Map(),
): CitedAgg {
  const needle = ownNeedle.trim().toLowerCase();
  if (needle.length < 3) return agg;
  for (const r of rows) {
    const urls = Array.isArray(r.citation_urls) ? r.citation_urls : [];
    if (urls.length === 0) continue;
    const day = typeof r.observed_at === "string" ? r.observed_at.slice(0, 10) : null;
    const promptId = typeof r.prompt_id === "string" ? r.prompt_id : undefined;
    const seen = new Set<string>();
    for (const raw of urls) {
      if (typeof raw !== "string") continue;
      const host = urlHost(raw);
      if (!host || !host.includes(needle)) continue;
      const path = funnelPathKey(raw);
      if (seen.has(path)) continue;
      seen.add(path);
      foldCitation(agg, path, 1, day, promptId);
    }
  }
  return agg;
}

/** GA4 AI-referral facts -> per-path click aggregates with the top assistant
 *  labeled in plain language. Pure; exported for tests. */
export function aggregateAiClicks(
  facts: Array<{ pagePath: string; sourceDomain: string; sessions: number; engagedSessions: number; keyEvents: number }>,
): FunnelJoinInputs["clickPages"] {
  const byPath = new Map<string, { sessions: number; keyEvents: number; perSource: Map<string, number> }>();
  for (const f of facts) {
    const path = funnelPathKey(f.pagePath);
    const entry = byPath.get(path) ?? { sessions: 0, keyEvents: 0, perSource: new Map<string, number>() };
    entry.sessions += f.sessions;
    entry.keyEvents += f.keyEvents;
    entry.perSource.set(f.sourceDomain, (entry.perSource.get(f.sourceDomain) ?? 0) + f.sessions);
    byPath.set(path, entry);
  }
  return [...byPath.entries()].map(([path, e]) => {
    const top = [...e.perSource.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      path,
      sessions: e.sessions,
      keyEvents: e.keyEvents,
      topSource: top && top[1] > 0 ? aiSourceLabel(top[0]) : null,
    };
  });
}

async function loadUncached(tenantId: string, ownNeedle: string): Promise<FunnelReport> {
  if (!tenantId) return emptyFunnelReport();
  const needle = (ownNeedle ?? "").trim().toLowerCase();
  const cutoff = windowCutoff();

  // 1) AI crawler coverage - REUSE (react cache shares this with the AI band).
  const signals = await loadBotReferralSignals(tenantId).catch(() => null);
  const lastCrawlByPath = new Map<string, string>();
  for (const r of signals?.botRows ?? []) {
    if (!r.path || !r.date) continue;
    const key = funnelPathKey(r.path);
    const prev = lastCrawlByPath.get(key);
    if (!prev || r.date > prev) lastCrawlByPath.set(key, r.date);
  }
  const botPages: FunnelJoinInputs["botPages"] = (signals?.botByPath ?? []).map((b) => ({
    path: b.path,
    hits: b.totalHits,
    lastAt: lastCrawlByPath.get(funnelPathKey(b.path)) ?? null,
    bots: b.bots,
  }));

  // 2) Citations - imported Profound rows (owned domain filtered in SQL, same
  //    ilike posture as citations-daily) + native poll rows for question grain.
  const citedAgg: CitedAgg = new Map();
  if (needle.length >= 3) {
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("profound_citation_rows")
        .select("date, url, citation_count")
        .eq("tenant_id", tenantId)
        .ilike("root_domain", `%${needle}%`)
        .gte("date", cutoff)
        .limit(MAX_CITATION_ROWS);
      if (error) {
        log.warn("[crawl-citation-funnel] imported citation read failed", { tenantId, error: error.message });
      } else if (Array.isArray(data)) {
        aggregateImportedCitations(data as Array<Record<string, unknown>>, citedAgg);
      }
    } catch (e) {
      log.warn("[crawl-citation-funnel] imported citation read threw", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select("prompt_id, observed_at, citation_urls")
        .eq("tenant_id", tenantId)
        .gt("owned_citation_count", 0)
        .gte("observed_at", cutoff)
        .limit(MAX_OBSERVATION_ROWS);
      if (error) {
        log.warn("[crawl-citation-funnel] native citation read failed", { tenantId, error: error.message });
      } else if (Array.isArray(data)) {
        aggregateNativeCitations(data as Array<Record<string, unknown>>, needle, citedAgg);
      }
    } catch (e) {
      log.warn("[crawl-citation-funnel] native citation read threw", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const citedPages: FunnelJoinInputs["citedPages"] = [...citedAgg.entries()].map(([path, e]) => ({
    path,
    count: e.count,
    prompts: e.prompts.size,
    lastAt: e.lastAt,
  }));

  // 3) AI-referred GA4 sessions - lean per-page read (the ai-referrals summary
  //    caps pages at 10; the funnel joins every page), reusing its row mapper.
  let clickPages: FunnelJoinInputs["clickPages"] = [];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("ga4_ai_referral_daily")
      .select("page_path, day, source_domain, sessions, engaged_sessions, key_events")
      .eq("tenant_id", tenantId)
      .gte("day", cutoff)
      .limit(MAX_GA4_ROWS);
    if (error) {
      const missingTable = error.code === "PGRST205" || error.code === "PGRST204" || error.code === "42P01";
      if (!missingTable) {
        log.warn("[crawl-citation-funnel] ai-referral read failed", { tenantId, error: error.message });
      }
    } else if (Array.isArray(data)) {
      const facts = data
        .map((row) => mapAiReferralRow(row as Record<string, unknown>))
        .filter((f): f is NonNullable<typeof f> => f != null);
      clickPages = aggregateAiClicks(facts);
    }
  } catch (e) {
    log.warn("[crawl-citation-funnel] ai-referral read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 4) Demand proxy - REUSE the exact per-page GSC aggregate (90d impressions).
  const demandByPath = new Map<string, number>();
  try {
    const gsc = await loadGscPageSignalsForTenant(tenantId);
    for (const sig of gsc.values()) {
      const key = funnelPathKey(sig.page);
      demandByPath.set(key, Math.max(demandByPath.get(key) ?? 0, sig.impressions90d));
    }
  } catch (e) {
    log.warn("[crawl-citation-funnel] gsc demand read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return buildFunnelReport({ botPages, citedPages, clickPages, demandByPath });
}

/**
 * Request-memoized per (tenantId, ownNeedle). ownNeedle = the tenant's own
 * domain fragment (the slug callers already pass to citations-daily); with a
 * needle under 3 chars the citation stages stay dark instead of guessing.
 */
export const loadCrawlCitationFunnel = cache(
  async (tenantId: string, ownNeedle: string): Promise<FunnelReport> => {
    try {
      return await loadUncached(tenantId, ownNeedle);
    } catch (e) {
      log.warn("[crawl-citation-funnel] load failed; returning empty", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return emptyFunnelReport();
    }
  },
);

/** Test-only export of internals. */
export const __testing = { WINDOW_DAYS, MAX_CITATION_ROWS, MAX_OBSERVATION_ROWS, MAX_GA4_ROWS };
