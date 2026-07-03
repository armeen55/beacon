import "server-only";

import { cache } from "react";

import { log } from "@/lib/logger";
import { dossierHref } from "@/lib/page-dossier-link";
import { readAllCachedKeywordDemand, type KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { readAllCachedKeywordDifficulty } from "@/domains/serp/dataforseo-labs";
import { readKeywordGapResults } from "@/domains/serp/keyword-gap-store";
import { loadLatestSerpReadingsByQuery } from "@/domains/serp/serp-history";
import { featureStealHistoryRows } from "@/domains/serp/serp-history";
import { loadQuerySpikes } from "@/domains/trend-radar/spike-store";
import { loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import { loadTopTenantQueriesWithOwner } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { currentTenant, currentTenantId } from "@/lib/tenant-context";

/**
 * keyword-library (2026-07-02, MASTER PLAN v2 UX2 first slice, the operator's
 * own idea). EVERY keyword Beacon has ever researched, merged from every cache
 * we already paid for, into one row per keyword. Fires ZERO new paid calls: it
 * only reads what earlier DataForSEO / GSC / SERP work already stored.
 *
 * CRITICAL LABEL RULE (operator correction): market search volume and GSC
 * impressions are two different numbers and must never be conflated.
 *   - `searchesPerMo` = DataForSEO's real market volume, or null when unknown
 *     (never guessed, never backfilled from impressions).
 *   - `timesShownPerMo` = GSC impressions ("times shown on Google", never call
 *     this "searches" anywhere in the UI).
 *
 * Sources merged (all $0, all cache/DB reads, no live API call here):
 *   (a) GSC query portfolio: loadTopTenantQueriesWithOwner (clicks, impressions,
 *       position, best owner page), tenant-wide bounded read.
 *   (b) DataForSEO keyword demand cache: readAllCachedKeywordDemand.
 *   (c) DataForSEO keyword difficulty cache: readAllCachedKeywordDifficulty.
 *   (d) Competitor keyword-gap store: readKeywordGapResults (competitor owners
 *       plus the volume/CPC that run already resolved).
 *   (e) SERP history: loadLatestSerpReadingsByQuery (own rank + top domains
 *       from the most recent LIVE Google reading) and featureStealHistoryRows
 *       (People Also Ask questions Google rendered for that query).
 *   (f) Trend Radar and Seasonal store: loadQuerySpikes (this-week spike tag)
 *       and loadSeasonalQueries (recurring calendar-peak tag).
 *
 * One row per keyword, normalized by trim + lowercase (matches the identity key
 * every cache above already uses). Pure merge logic below is exported and unit
 * tested without any I/O; the exported loader wires the real caches together.
 */

export type KeywordTrendTag = "spike" | "seasonal" | null;

export type KeywordLibrarySource =
  | "gsc"
  | "dataforseo_demand"
  | "dataforseo_difficulty"
  | "keyword_gap"
  | "serp_history"
  | "trend_radar";

export type KeywordLibraryRow = {
  keyword: string;
  /** Real market volume from DataForSEO, or null when we have never looked it
   *  up / it came back unknown. NEVER the same number as timesShownPerMo. */
  searchesPerMo: number | null;
  /** GSC impressions in the query-portfolio window ("times shown on Google"),
   *  or null when this keyword has no GSC history at all. */
  timesShownPerMo: number | null;
  clicks: number | null;
  /** Impression-weighted average GSC position, or the latest live Google
   *  reading when GSC has no data for this keyword. Null when neither exists. */
  yourPosition: number | null;
  /** 0-100 DataForSEO keyword-difficulty score, or null when never checked. */
  difficulty: number | null;
  trend: KeywordTrendTag;
  ownerPage: string | null;
  ownerPageHref: string | null;
  competitorOwners: string[];
  relatedQuestions: string[];
  sources: KeywordLibrarySource[];
  lastChecked: string | null;
};

export type KeywordLibrary = {
  rows: KeywordLibraryRow[];
  /** How many rows carry a real DataForSEO market-volume number. The honest
   *  coverage line ("I have volume data for N of TOTAL keywords"). */
  volumeCoverage: number;
  total: number;
  bySource: Record<KeywordLibrarySource, number>;
};

/** PURE: a "winnable gap" is a keyword nobody on this site owns yet that Beacon
 *  has already seen real demand for, either GSC impressions or a checked
 *  market-volume number (never a guess). Used for the one-line hero synthesis
 *  above the Keywords table (FP7, 2026-07-02): "298 keywords tracked. 41 are
 *  winnable gaps worth a look first." Exported for testing. */
export function countWinnableGaps(rows: KeywordLibraryRow[]): number {
  return rows.filter((r) => r.ownerPage == null && ((r.searchesPerMo ?? 0) > 0 || (r.timesShownPerMo ?? 0) > 0)).length;
}

/**
 * PURE: the single "so what" sentence for the top of the Keywords page. Picks
 * the strongest honest stat available, in order: winnable gaps (there is
 * something worth a look), else owned-vs-unowned split, else the total
 * searched-per-month volume this library already has. Exported for testing.
 */
export function summarizeKeywordLibrary(library: Pick<KeywordLibrary, "rows" | "total">): string | null {
  if (library.total === 0) return null;
  const plural = library.total === 1 ? "keyword" : "keywords";
  const winnableGaps = countWinnableGaps(library.rows);
  if (winnableGaps > 0) {
    return `${library.total.toLocaleString()} ${plural} tracked. ${winnableGaps.toLocaleString()} ${winnableGaps === 1 ? "is a winnable gap" : "are winnable gaps"} worth a look first.`;
  }
  const owned = library.rows.filter((r) => r.ownerPage != null).length;
  if (owned > 0) {
    return `${library.total.toLocaleString()} ${plural} tracked. I have a page up for ${owned.toLocaleString()} of them.`;
  }
  const totalVolume = library.rows.reduce((sum, r) => sum + (r.searchesPerMo ?? 0), 0);
  if (totalVolume > 0) {
    return `${library.total.toLocaleString()} ${plural} tracked. Together they get searched about ${totalVolume.toLocaleString()} times a month.`;
  }
  return `${library.total.toLocaleString()} ${plural} tracked so far.`;
}

type MergeInputs = {
  gscQueries: { query: string; clicks: number; impressions: number; position: number | null; ownerPage: string | null }[];
  demand: KeywordDemand[];
  difficulty: Map<string, number | null>;
  gapKeywords: { keyword: string; volume: number | null; competitorDomain: string; ownRank: number | null }[];
  serpReadings: Map<string, { capturedAt: string; ownRank: number | null; topDomains: { domain: string }[] }>;
  paaByQuery: Map<string, { question: string }[]>;
  spikeQueries: Set<string>;
  seasonalQueries: Set<string>;
  ownDomain: string | null;
};

const normKey = (k: string): string => k.trim().toLowerCase();

/**
 * PURE merge: combine every cache's rows into one row per normalized keyword.
 * No I/O, no Date.now() side effects beyond what callers pass in. Fully unit
 * testable. Exported so keyword-library.test.ts can pin the label rule and the
 * dedupe/merge behavior without touching a database.
 */
export function mergeKeywordLibrary(input: MergeInputs): KeywordLibrary {
  const rows = new Map<string, KeywordLibraryRow>();

  const getOrCreate = (rawKeyword: string): KeywordLibraryRow => {
    const key = normKey(rawKeyword);
    let row = rows.get(key);
    if (!row) {
      row = {
        keyword: rawKeyword.trim(),
        searchesPerMo: null,
        timesShownPerMo: null,
        clicks: null,
        yourPosition: null,
        difficulty: null,
        trend: null,
        ownerPage: null,
        ownerPageHref: null,
        competitorOwners: [],
        relatedQuestions: [],
        sources: [],
        lastChecked: null,
      };
      rows.set(key, row);
    }
    return row;
  };

  const addSource = (row: KeywordLibraryRow, source: KeywordLibrarySource) => {
    if (!row.sources.includes(source)) row.sources.push(source);
  };

  const bumpLastChecked = (row: KeywordLibraryRow, at: string | null) => {
    if (!at) return;
    if (!row.lastChecked || Date.parse(at) > Date.parse(row.lastChecked)) row.lastChecked = at;
  };

  // (a) GSC query portfolio: impressions/clicks/position/owner page.
  for (const q of input.gscQueries) {
    if (!q.query) continue;
    const row = getOrCreate(q.query);
    row.timesShownPerMo = (row.timesShownPerMo ?? 0) + q.impressions;
    row.clicks = (row.clicks ?? 0) + q.clicks;
    if (typeof q.position === "number") row.yourPosition = q.position;
    if (q.ownerPage) {
      row.ownerPage = q.ownerPage;
      row.ownerPageHref = dossierHref(q.ownerPage);
    }
    addSource(row, "gsc");
  }

  // (b) DataForSEO keyword demand cache: real market volume, never guessed.
  for (const d of input.demand) {
    if (!d.keyword) continue;
    const row = getOrCreate(d.keyword);
    if (typeof d.searchVolume === "number") row.searchesPerMo = d.searchVolume;
    addSource(row, "dataforseo_demand");
    bumpLastChecked(row, d.fetchedAt ?? null);
  }

  // (c) DataForSEO keyword difficulty cache.
  for (const [keyword, difficulty] of input.difficulty) {
    if (!keyword) continue;
    const row = getOrCreate(keyword);
    row.difficulty = difficulty;
    addSource(row, "dataforseo_difficulty");
  }

  // (d) Competitor keyword-gap store: competitor owners plus a volume backfill
  // when DataForSEO demand cache never covered this exact keyword string.
  for (const g of input.gapKeywords) {
    if (!g.keyword) continue;
    const row = getOrCreate(g.keyword);
    if (row.searchesPerMo == null && typeof g.volume === "number") row.searchesPerMo = g.volume;
    if (g.competitorDomain && !row.competitorOwners.includes(g.competitorDomain)) {
      row.competitorOwners.push(g.competitorDomain);
    }
    if (row.yourPosition == null && typeof g.ownRank === "number") row.yourPosition = g.ownRank;
    addSource(row, "keyword_gap");
  }

  // (e) SERP history: live-observed own rank plus who else Google shows.
  for (const [query, reading] of input.serpReadings) {
    if (!query) continue;
    const row = getOrCreate(query);
    if (row.yourPosition == null && typeof reading.ownRank === "number") row.yourPosition = reading.ownRank;
    for (const d of reading.topDomains) {
      if (d.domain && d.domain !== input.ownDomain && !row.competitorOwners.includes(d.domain)) {
        row.competitorOwners.push(d.domain);
      }
    }
    addSource(row, "serp_history");
    bumpLastChecked(row, reading.capturedAt);
  }

  // (e2) PAA questions from the same SERP history table: related questions.
  for (const [query, questions] of input.paaByQuery) {
    if (!query || questions.length === 0) continue;
    const row = getOrCreate(query);
    for (const q of questions) {
      if (q.question && !row.relatedQuestions.includes(q.question)) row.relatedQuestions.push(q.question);
    }
  }

  // (f) Seasonal store: queries with a recurring calendar peak. Applied before
  // spike so an in-season query that ALSO spiked this week shows the more
  // urgent "spike" tag (checked next).
  for (const query of input.seasonalQueries) {
    if (!query) continue;
    const row = getOrCreate(query);
    row.trend = "seasonal";
    addSource(row, "trend_radar");
  }

  // Trend Radar: this-week spike tag (takes priority over seasonal when both apply).
  for (const query of input.spikeQueries) {
    if (!query) continue;
    const row = getOrCreate(query);
    row.trend = "spike";
    addSource(row, "trend_radar");
  }

  const out = [...rows.values()].sort((a, b) => (b.timesShownPerMo ?? 0) - (a.timesShownPerMo ?? 0) || (b.searchesPerMo ?? 0) - (a.searchesPerMo ?? 0));
  const volumeCoverage = out.filter((r) => r.searchesPerMo != null).length;
  const bySource: Record<KeywordLibrarySource, number> = {
    gsc: 0,
    dataforseo_demand: 0,
    dataforseo_difficulty: 0,
    keyword_gap: 0,
    serp_history: 0,
    trend_radar: 0,
  };
  for (const r of out) for (const s of r.sources) bySource[s] += 1;

  return { rows: out, volumeCoverage, total: out.length, bySource };
}

/** Cap how many GSC queries feed the library. Keeps the merge + client table
 *  fast without a heavy virtualization dependency (per the perf note in the
 *  build brief: paginate client-side above this only via "show more"). */
const GSC_QUERY_LIMIT = 2000;

/**
 * The full merged Keywords library for the current tenant. $0: every source
 * is a cache or an already-paid-for DB table. React `cache()`-d per request so
 * the page and any nested reads share one round-trip. Fail-soft: any single
 * source failing just means that source's facts are missing from the rows
 * that need it. It never blocks the whole library from rendering.
 */
export const loadKeywordLibrary = cache(async (): Promise<KeywordLibrary> => {
  const tenantId = await currentTenantId().catch(() => "");
  const ownDomain = await currentTenant()
    .then((t) => t.domain ?? null)
    .catch(() => null);

  const [gscQueries, demand, difficulty, gapResult, serpReadings, featureStealRows, spikes, seasonal] = await Promise.all([
    loadTopTenantQueriesWithOwner(tenantId, { limit: GSC_QUERY_LIMIT }).catch((e) => {
      log.warn("[keyword-library] gsc query portfolio failed", { error: e instanceof Error ? e.message : String(e) });
      return [];
    }),
    readAllCachedKeywordDemand().catch(() => []),
    readAllCachedKeywordDifficulty().catch(() => new Map<string, number | null>()),
    readKeywordGapResults(tenantId).catch(() => null),
    loadLatestSerpReadingsByQuery(tenantId).catch(() => new Map()),
    featureStealHistoryRows(tenantId).catch(() => []),
    loadQuerySpikes(tenantId).catch(() => []),
    loadSeasonalQueries(tenantId).catch(() => []),
  ]);

  const paaByQuery = new Map<string, { question: string }[]>();
  for (const r of featureStealRows) {
    if (!r.query || r.paaQuestions.length === 0) continue;
    const existing = paaByQuery.get(r.query) ?? [];
    // Latest capture wins per query (rows arrive oldest-first from the reader).
    paaByQuery.set(r.query, r.paaQuestions.length >= existing.length ? r.paaQuestions : existing);
  }

  return mergeKeywordLibrary({
    gscQueries: gscQueries.map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position ?? null, ownerPage: q.ownerPage })),
    demand,
    difficulty,
    gapKeywords: (gapResult?.gaps ?? []).map((g) => ({ keyword: g.keyword, volume: g.volume, competitorDomain: g.competitorDomain, ownRank: g.ownRank })),
    serpReadings: new Map([...serpReadings.entries()].map(([q, r]) => [q, { capturedAt: r.capturedAt, ownRank: r.ownRank, topDomains: r.topDomains }])),
    paaByQuery,
    spikeQueries: new Set(spikes.map((s) => s.query)),
    seasonalQueries: new Set(seasonal.map((s) => s.query)),
    ownDomain,
  });
});
