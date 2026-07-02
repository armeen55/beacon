/**
 * language-gap/run-language-gap-pass (2026-07-02, master plan item 24) - the
 * I/O shell around the pure language-gap matrix. Reads ONLY signals the app
 * already caches: per-page GSC query demand (loadGscPageSignalsForTenant,
 * the same $0 RPC-backed read the daily plan builder and every GSC trigger
 * use) and crawled page_snapshots text (getPageSnapshots, the same $0 read
 * build-today-preview.ts already does). No new Supabase table, no live
 * fetch, no LLM, no paid API - deterministic and free every time it runs.
 *
 * classify-query.ts + variant-folding.ts + page-language.ts + language-
 * gaps.ts stay pure; this file is the only place that touches process I/O.
 */

import "server-only";

import { loadGscPageSignalsForTenant, type GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { normalizePath } from "@/domains/experiments/daily-plan-types";
import { classifyQuery, type ClassifyQueryOptions } from "./classify-query";
import { classifyPageLanguages, type PageLanguageProfile, type PageTextSource } from "./page-language";
import { buildLanguageGaps, type LanguageGap, type PageQueryDemand } from "./language-gaps";
import { PERSIAN_FOLDING_TABLE, PERSIAN_KNOWN_LATIN_ROOTS } from "./variant-folding";

/** Passed to classifyQuery so short, otherwise-ambiguous romanizations
 *  ("chaharshanbe", "norooz", "tahdig") clear the conservative heuristic bar
 *  using the Persian table's own known-roots list, not a looser digraph
 *  threshold that would false-positive on English loanwords ("khan",
 *  "cheetah"). Swapping tenants means swapping this options object, not
 *  touching classify-query.ts itself. */
const CLASSIFY_OPTIONS: ClassifyQueryOptions = { knownLatinRoots: PERSIAN_KNOWN_LATIN_ROOTS };

export type LanguageGapPassResult = {
  ran: boolean;
  queriesClassified: number;
  farsiScriptCount: number;
  finglishCount: number;
  englishCount: number;
  gaps: LanguageGap[];
};

/** A page's own crawled text is checked for a spelling with a simple
 *  case-insensitive substring test against the same fields page-language.ts
 *  samples - good enough to say "this exact spelling appears on the page"
 *  without inventing a fuzzy-match false positive. Keyed by NORMALIZED PATH
 *  (host-insensitive), because GSC's page rows and page_snapshots can carry
 *  different hosts for the same page (e.g. "iranopedia.com/x" from GSC vs
 *  "www.iranopedia.com/x" from the crawl) - joining on the bare path is the
 *  same host-agnostic keying build-today-preview.ts already uses. */
function buildMentionsChecker(snapshots: PageTextSource[]): (path: string, variant: string) => boolean {
  const textByPath = new Map<string, string>();
  for (const s of snapshots) {
    if (!s.url) continue;
    const parts: string[] = [s.title ?? "", s.meta_description ?? "", s.h1 ?? "", ...(s.h2_list ?? []), ...(s.body_paragraph_sample ?? [])];
    for (const f of s.faqs ?? []) {
      if (f.question) parts.push(f.question);
      if (f.answer) parts.push(f.answer);
    }
    textByPath.set(normalizePath(s.url), parts.join(" ").toLowerCase());
  }
  return (path: string, variant: string) => {
    const text = textByPath.get(path);
    if (!text || !variant) return false;
    return text.includes(variant.trim().toLowerCase());
  };
}

/**
 * Run the full language-gap pass for one tenant: read cached GSC signals +
 * page snapshots, classify every query, build the page-language profile map,
 * join into gaps. Fail-soft: any read failure yields `ran: false` with an
 * empty result (never throws into the cron loop).
 */
export async function runLanguageGapPass(tenantId: string): Promise<LanguageGapPassResult> {
  const empty: LanguageGapPassResult = {
    ran: false,
    queriesClassified: 0,
    farsiScriptCount: 0,
    finglishCount: 0,
    englishCount: 0,
    gaps: [],
  };
  if (!tenantId) return empty;

  let signals: Map<string, GscPageSignal>;
  let snaps: PageTextSource[];
  try {
    [signals, snaps] = await Promise.all([
      loadGscPageSignalsForTenant(tenantId),
      getPageSnapshots() as unknown as Promise<PageTextSource[]>,
    ]);
  } catch {
    return empty;
  }
  if (signals.size === 0) return { ...empty, ran: true };

  // Classify every distinct query once (queries repeat across pages rarely,
  // but dedupe keeps the count honest for the "checked N queries" line).
  const seenQueries = new Set<string>();
  let farsiScriptCount = 0;
  let finglishCount = 0;
  let englishCount = 0;

  // Keyed by NORMALIZED PATH, not the raw URL: GSC's page rows and
  // page_snapshots can disagree on host (bare domain vs "www.") for the exact
  // same page, and keying on the full URL would silently fail every join. A
  // display URL (preferring the crawled snapshot's own URL, since that is
  // the real host the page actually resolves on) is kept alongside so the
  // emitted gap still names a real, clickable page.
  const queriesByPage = new Map<string, PageQueryDemand[]>();
  const displayUrlByPath = new Map<string, string>();
  for (const [page, signal] of signals) {
    const path = normalizePath(page);
    if (!displayUrlByPath.has(path)) displayUrlByPath.set(path, page);
    const rows: PageQueryDemand[] = [];
    for (const q of signal.topQueries) {
      if (!q.query) continue;
      rows.push({ query: q.query, impressions: q.impressions, clicks: q.clicks });
      if (!seenQueries.has(q.query)) {
        seenQueries.add(q.query);
        const c = classifyQuery(q.query, CLASSIFY_OPTIONS);
        if (c.language === "fa") farsiScriptCount += 1;
        else if (c.language === "finglish") finglishCount += 1;
        else if (c.language === "en") englishCount += 1;
      }
    }
    if (rows.length > 0) {
      const existing = queriesByPage.get(path) ?? [];
      queriesByPage.set(path, [...existing, ...rows]);
    }
  }

  const pageProfilesByUrl = classifyPageLanguages(snaps);
  const pageProfiles = new Map<string, PageLanguageProfile>();
  for (const [url, profile] of pageProfilesByUrl) {
    const path = normalizePath(url);
    if (!displayUrlByPath.has(path)) displayUrlByPath.set(path, url);
    pageProfiles.set(path, profile);
  }
  const mentionsVariant = buildMentionsChecker(snaps);

  const gapsByPath = buildLanguageGaps({
    queriesByPage,
    pageProfiles,
    pageMentionsVariant: mentionsVariant,
    foldingTable: PERSIAN_FOLDING_TABLE,
    classifyOptions: CLASSIFY_OPTIONS,
  });
  // Re-express each gap's `page` as the real display URL before returning -
  // the pure matrix only ever sees the normalized path key.
  const gaps: LanguageGap[] = gapsByPath.map((g) => ({ ...g, page: displayUrlByPath.get(g.page) ?? g.page }));

  return {
    ran: true,
    queriesClassified: seenQueries.size,
    farsiScriptCount,
    finglishCount,
    englishCount,
    gaps,
  };
}
