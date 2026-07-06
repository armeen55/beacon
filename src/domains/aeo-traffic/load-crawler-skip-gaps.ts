import "server-only";

/**
 * load-crawler-skip-gaps (RANK-4, 2026-07-06) - the I/O EDGE that turns the
 * previously read-only `profound_bot_rows` table into an ACTIONABLE Move input.
 *
 * THE PLAY: Profound's Agent Analytics records which AI crawlers (GPTBot,
 * PerplexityBot, ClaudeBot, ...) fetched which of your pages. That data already
 * flows into a display panel (the war-room "AI is reading your site" band), but
 * it never produced a next step. This loader finds the high-value owned pages
 * that AI crawlers are SKIPPING while they crawl the rest of the site - a page
 * AI never fetches can never be recommended - and hands the pure trigger a ready
 * list to turn into an add_internal_link Move.
 *
 * $0: reads ONLY already-synced rows (the shared react.cache bot loader + the
 * shared GSC page signals) - NEVER a live Profound or GSC API call.
 *
 * Fail-soft + empty-safe: any read error, a missing table, OR an empty crawler
 * feed all collapse to [] (no gaps). Critically, a gap is only ever emitted when
 * the crawler feed is REPORTING (it has hits on OTHER pages) - "AI skips this
 * page" is only provable once we can see AI crawling the site at all. With no
 * crawl evidence we say nothing (fail closed), never fabricate a skip.
 *
 * This pairs with the shipped robots-AI-block check (robots_blocks_ai_bots),
 * which is about robots.txt PERMISSION. This trigger is about actual crawl HITS:
 * a page can be fully allowed in robots.txt and still never get fetched because
 * nothing links to it.
 *
 * Predicate purity is preserved: ALL I/O happens here; the pure trigger consumes
 * the CrawlerSkipGap[] this returns. Pinned by load-crawler-skip-gaps.test.ts.
 */

import { cache } from "react";
import { log } from "@/lib/logger";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import {
  findCrawlabilityGaps,
  type ProfoundBotRow,
  type ValuablePage,
} from "@/domains/profound-deep/bot-coverage";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";

/** A high-value owned page AI crawlers are skipping while they crawl the site. */
export type CrawlerSkipGap = {
  /** Canonical owned page path/url the crawlers have not fetched. */
  path: string;
  /** 90-day Google impressions (the demand evidence that makes it high value). */
  demand: number;
  /** How many crawler hits this page got (0 for a true skip). */
  botHits: number;
  /** How many OTHER pages the crawler feed DID cover (the coverage evidence
   *  that proves the crawlers are active, so a skip is real). */
  crawledPageCount: number;
};

/** A page needs at least this many 90-day Google impressions before an
 *  "AI is skipping this" Move is worth showing - below this the internal-link
 *  fix does not pay for itself (same demand floor as buried-page). */
export const MIN_SKIP_DEMAND = 100;
/** At most this many skip gaps per run (highest demand first). */
export const MAX_SKIP_GAPS = 5;

/**
 * PURE assembler: bot rows + per-page demand -> the highest-demand pages the AI
 * crawlers skipped. Exported so the empty/populated contract is unit-testable
 * without a DB.
 *
 * Empty-safe / fail-closed:
 *   - NO bot rows at all -> [] (findCrawlabilityGaps returns [] with no crawl
 *     evidence; we never guess crawl status).
 *   - bot rows exist but every valuable page WAS crawled -> [].
 *   - a page below MIN_SKIP_DEMAND -> never a gap (demand gate).
 */
export function assembleCrawlerSkipGaps(
  botRows: ReadonlyArray<ProfoundBotRow>,
  demandByPath: ReadonlyMap<string, number>,
  opts: { minDemand?: number; limit?: number } = {},
): CrawlerSkipGap[] {
  const minDemand = opts.minDemand ?? MIN_SKIP_DEMAND;
  const limit = opts.limit ?? MAX_SKIP_GAPS;
  if (botRows.length === 0) return [];

  const valuablePages: ValuablePage[] = [...demandByPath.entries()]
    .filter(([, value]) => (value ?? 0) >= minDemand)
    .map(([path, value]) => ({ path, value }));
  if (valuablePages.length === 0) return [];

  // Count of distinct pages the crawler feed DID cover (the coverage evidence).
  const crawledPaths = new Set<string>();
  for (const r of botRows) if (r.path) crawledPaths.add(r.path);
  const crawledPageCount = crawledPaths.size;

  // findCrawlabilityGaps: pages with real value that crawlers hit <= 0 times.
  // minValue is already applied above; pass minHits: 0 (a true skip).
  const gaps = findCrawlabilityGaps(botRows as ProfoundBotRow[], valuablePages, {
    minHits: 0,
    minValue: minDemand,
  });

  return gaps
    .slice(0, limit)
    .map((g) => ({
      path: g.path,
      demand: g.value,
      botHits: g.botHits,
      crawledPageCount,
    }));
}

async function loadUncached(tenantId: string): Promise<CrawlerSkipGap[]> {
  if (!tenantId) return [];

  // 1) AI crawler coverage - REUSE the shared react.cache bot loader (this adds
  //    NO read; the war-room AI band already pays for it). Fail-soft -> [].
  const signals = await loadBotReferralSignals(tenantId).catch(() => null);
  const botRows = signals?.botRows ?? [];
  // Empty crawler feed -> no evidence -> no gaps (fail closed, never fabricate).
  if (botRows.length === 0) return [];

  // 2) Demand proxy - REUSE the exact per-page GSC aggregate (90d impressions).
  //    Fail-soft -> empty demand -> no valuable pages -> [].
  const demandByPath = new Map<string, number>();
  try {
    const gsc = await loadGscPageSignalsForTenant(tenantId);
    for (const sig of gsc.values()) {
      demandByPath.set(sig.page, Math.max(demandByPath.get(sig.page) ?? 0, sig.impressions90d));
    }
  } catch (e) {
    log.warn("[crawler-skip-gaps] gsc demand read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  return assembleCrawlerSkipGaps(botRows, demandByPath);
}

/**
 * Cached per-request loader. Fail-soft -> [] (no gaps). The pure trigger
 * consumes the returned list; all I/O is confined here so the predicate stays
 * pure (predicate purity invariant).
 */
export const loadCrawlerSkipGapsForTenant = cache(
  async (tenantId: string): Promise<CrawlerSkipGap[]> => {
    try {
      return await loadUncached(tenantId);
    } catch (e) {
      log.warn("[crawler-skip-gaps] load failed; returning []", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  },
);
