/**
 * investigation/collect-evidence (2026-07-02, master plan item 53) - bounded,
 * fail-soft evidence collectors for the four forensic sources rank-causes.ts
 * needs. Every collector is individually try/caught and returns an empty
 * result on any failure - a collector hiccup narrows the diagnosis, it never
 * crashes the investigation.
 *
 * Cost posture (HARD RULE: $0 paid calls per investigation):
 *   - indexability: live page fetches via the existing polite-fetch helper
 *     (competitor-intel/polite-fetch.ts) - free HTTP, capped at MAX_LIVE_FETCHES
 *     pages per investigation, sequential + robots-respecting.
 *   - serp: reads from dataforseo_serp_history only (serp-history.ts) - cached
 *     rows already paid for by whatever nightly pass wrote them, no new call.
 *   - recentChanges: reads the push ledger only (caps.ts) - $0, already
 *     persisted.
 *   - weather: reads the algorithm-weather store only (algorithm-weather-store.ts)
 *     - $0, already computed by the nightly CUSUM pass (item 32).
 */

import "server-only";

import { load as cheerioLoad } from "cheerio";

import { fetchPageHtml } from "@/domains/competitor-intel/polite-fetch";
import { rankSeriesFor, computeRankDelta } from "@/domains/serp/serp-history";
import { loadTopQueriesForPages } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { readPushLedgerForTenant } from "@/domains/push/caps";
import { readAlgorithmWeatherSummary } from "@/domains/algorithm-weather/algorithm-weather-store";
import { buildShockWindows, overlappingShock } from "@/domains/algorithm-weather/algorithm-weather";
import type { IndexabilityFinding, RecentChangeFinding, SerpFinding, WeatherFinding } from "./rank-causes";

/** Hard cap: at most this many live page fetches per investigation (the plan's
 *  "max 3 pages/investigation, polite" rule). */
export const MAX_LIVE_FETCHES = 3;
/** How many of the family's top queries to pull cached SERP history for. */
export const MAX_SERP_QUERIES = 5;
/** A rank delta inside this many days of the collapse date counts as
 *  same-window evidence. */
export const SERP_WINDOW_DAYS = 14;
/** A shipped change further back than this is background churn, not a
 *  plausible cause - matches rank-causes.ts's CHANGE_PROXIMITY_DAYS window
 *  plus slack for "changed the week before, drop showed up a few days later". */
export const LEDGER_LOOKBACK_DAYS = 21;
/** Lookahead past the collapse date for a change that landed just after (still
 *  reported, but rank-causes.ts never treats it as a cause). */
export const LEDGER_LOOKAHEAD_DAYS = 3;

/** Defensive: never let one slow origin block the whole nightly pass. */
const LIVE_FETCH_TIMEOUT_MS = 10_000;

/** Parse the bits rank-causes.ts needs out of raw HTML - a minimal sibling of
 *  pages/extractor.ts's extractPageSnapshot (canonical + robots meta only;
 *  the investigation doesn't need the full page-snapshot extraction). PURE. */
export function parseLiveNoindexSignals(html: string, url: string): { noindex: boolean; canonicalMismatch: boolean } {
  const $ = cheerioLoad(html);
  const robotsMeta = $('meta[name="robots"]').attr("content")?.trim().toLowerCase() ?? "";
  const noindex = robotsMeta
    .split(/[,;]/)
    .map((t) => t.trim())
    .some((t) => t === "noindex" || t === "none" || (t.startsWith("noindex") && /^noindex(\s|$)/.test(t)));
  const canonicalHref = $('link[rel="canonical"]').attr("href")?.trim() || null;
  let canonicalMismatch = false;
  if (canonicalHref) {
    try {
      const canonicalUrl = new URL(canonicalHref, url).toString().replace(/\/$/, "");
      const pageUrl = new URL(url).toString().replace(/\/$/, "");
      canonicalMismatch = canonicalUrl.toLowerCase() !== pageUrl.toLowerCase();
    } catch {
      canonicalMismatch = false;
    }
  }
  return { noindex, canonicalMismatch };
}

/**
 * Live-check up to MAX_LIVE_FETCHES pages: fetch each politely, parse for a
 * noindex tag / bad status / canonical mismatch. Fail-soft per page - a
 * fetch failure on one page never blocks the others or throws.
 */
export async function collectIndexabilityEvidence(
  urls: ReadonlyArray<string>,
  now: Date = new Date(),
): Promise<IndexabilityFinding[]> {
  const targets = urls.filter(Boolean).slice(0, MAX_LIVE_FETCHES);
  if (targets.length === 0) return [];
  const robotsCache = new Map<string, string[]>();
  const out: IndexabilityFinding[] = [];
  // Sequential (not Promise.all) - polite means one request in flight per
  // investigation, matching the competitor-intel posture this helper follows.
  for (const url of targets) {
    try {
      const result = await fetchPageHtml(url, robotsCache, { timeoutMs: LIVE_FETCH_TIMEOUT_MS });
      if (!result.ok) {
        if (result.reason === "robots_blocked") {
          out.push({
            url,
            noindexNow: false,
            badStatusNow: false,
            liveStatus: null,
            blockedByRobots: true,
            canonicalMismatch: false,
            checkedAt: now.toISOString(),
          });
          continue;
        }
        // fetch_failed: detail carries "http_NNN" for a bad status, or a
        // network error message. Only surface a NUMERIC status as a finding;
        // a transient network error is not evidence of anything.
        const statusMatch = result.detail?.match(/^http_(\d+)$/);
        if (statusMatch) {
          const status = Number(statusMatch[1]);
          out.push({
            url,
            noindexNow: false,
            badStatusNow: true,
            liveStatus: status,
            blockedByRobots: false,
            canonicalMismatch: false,
            checkedAt: now.toISOString(),
          });
        }
        continue;
      }
      const { noindex, canonicalMismatch } = parseLiveNoindexSignals(result.html, url);
      out.push({
        url,
        noindexNow: noindex,
        badStatusNow: false,
        liveStatus: result.status,
        blockedByRobots: false,
        canonicalMismatch,
        checkedAt: now.toISOString(),
      });
    } catch {
      // Fail-soft: skip this page's finding entirely rather than guess.
      continue;
    }
  }
  return out;
}

/**
 * Cached SERP rank deltas for the family's top queries (by GSC impressions,
 * over the pages the family sampled). $0 - reads dataforseo_serp_history
 * only, no live SERP call. Fail-soft -> [].
 */
export async function collectSerpEvidence(
  tenantId: string,
  familyPages: ReadonlyArray<string>,
  collapseDate: string,
  now: Date = new Date(),
): Promise<SerpFinding[]> {
  if (!tenantId || familyPages.length === 0) return [];
  try {
    const queryMap = await loadTopQueriesForPages(tenantId, [...familyPages]);
    const queries = new Set<string>();
    for (const list of queryMap.values()) {
      for (const q of list) queries.add(q.query);
      if (queries.size >= MAX_SERP_QUERIES) break;
    }
    if (queries.size === 0) return [];
    const collapseMs = Date.parse(`${collapseDate.slice(0, 10)}T00:00:00Z`);
    const anchorDate = Number.isFinite(collapseMs)
      ? new Date(collapseMs + SERP_WINDOW_DAYS * 86_400_000)
      : now;
    const out: SerpFinding[] = [];
    for (const query of [...queries].slice(0, MAX_SERP_QUERIES)) {
      const points = await rankSeriesFor(tenantId, query);
      if (points.length === 0) continue;
      const delta = computeRankDelta(points, SERP_WINDOW_DAYS * 2, anchorDate);
      if (!delta) continue;
      out.push({ query, fromRank: delta.fromRank, toRank: delta.toRank, direction: delta.direction });
    }
    return out;
  } catch {
    return [];
  }
}

/** PURE: humanize a push-ledger detail/edit id into a short description for
 *  the diagnosis sentence, e.g. "edit_meta" -> "meta description". Falls back
 *  to the raw edit id fragment when nothing recognizable matches. */
export function describeChange(editId: string): string {
  const id = editId.toLowerCase();
  if (id.includes("meta")) return "meta description";
  if (id.includes("title")) return "title tag";
  if (id.includes("h1")) return "H1 heading";
  if (id.includes("answer") || id.includes("faq")) return "answer block";
  if (id.includes("schema")) return "structured data";
  if (id.includes("link")) return "internal links";
  if (id.includes("canonical")) return "canonical tag";
  if (id.includes("robots") || id.includes("noindex")) return "robots settings";
  return "page content";
}

/** PURE: normalize a URL to its lowercased path (no scheme, no host, no
 *  trailing slash) so ledger target_urls match GSC page URLs regardless of
 *  which host/scheme variant each system recorded (the push service records
 *  canonical https://example.com/... while GSC tables key the raw
 *  https://www.example.com/... form). A bare path input passes through. */
export function normalizeToPath(url: string): string {
  let p: string;
  try {
    p = new URL(url).pathname || "/";
  } catch {
    p = url.startsWith("/") ? url : `/${url}`;
  }
  const trimmed = p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p;
  return trimmed.toLowerCase();
}

/**
 * Shipped changes to the family's own pages near the collapse date, from the
 * push ledger. $0 - reads push_ledger only. Fail-soft -> [].
 */
export async function collectRecentChangeEvidence(
  tenantId: string,
  familyPages: ReadonlyArray<string>,
  collapseDate: string,
): Promise<RecentChangeFinding[]> {
  if (!tenantId || familyPages.length === 0) return [];
  try {
    const pageSet = new Set(familyPages.map(normalizeToPath));
    const collapseMs = Date.parse(`${collapseDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(collapseMs)) return [];
    const lookbackMs = collapseMs - LEDGER_LOOKBACK_DAYS * 86_400_000;
    const lookaheadMs = collapseMs + LEDGER_LOOKAHEAD_DAYS * 86_400_000;
    const ledger = await readPushLedgerForTenant(tenantId);
    const out: RecentChangeFinding[] = [];
    for (const entry of ledger) {
      if (entry.result !== "pushed") continue;
      const url = normalizeToPath(entry.target_url ?? "");
      if (!pageSet.has(url)) continue;
      const pushedMs = Date.parse(entry.pushed_at);
      if (!Number.isFinite(pushedMs) || pushedMs < lookbackMs || pushedMs > lookaheadMs) continue;
      const daysBeforeCollapse = Math.round((collapseMs - pushedMs) / 86_400_000);
      out.push({
        url: entry.target_url,
        description: describeChange(entry.edit_id),
        pushedAt: entry.pushed_at,
        daysBeforeCollapse,
      });
    }
    return out.sort((a, b) => a.daysBeforeCollapse - b.daysBeforeCollapse);
  } catch {
    return [];
  }
}

/**
 * Sitewide algorithm-weather shock windows overlapping the collapse date's
 * measurement window (the same collapse week). $0 - reads the already-
 * computed nightly changepoint summary (item 32), never re-detects. Fail-soft
 * -> [].
 */
export async function collectWeatherEvidence(
  tenantId: string,
  collapseDate: string,
): Promise<WeatherFinding[]> {
  if (!tenantId) return [];
  try {
    const row = await readAlgorithmWeatherSummary(tenantId);
    const priorChangepoints = row ? [...row.clicksChangepoints, ...row.impressionsChangepoints] : [];
    const shocks = buildShockWindows({ dailySeries: [], priorChangepoints });
    const collapseMs = Date.parse(`${collapseDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(collapseMs)) return [];
    const windowEnd = new Date(collapseMs + 6 * 86_400_000).toISOString().slice(0, 10);
    const hit = overlappingShock(collapseDate.slice(0, 10), windowEnd, shocks);
    if (!hit) return [];
    return [{ label: hit.label, start: hit.start, end: hit.end, kind: hit.kind }];
  } catch {
    return [];
  }
}
