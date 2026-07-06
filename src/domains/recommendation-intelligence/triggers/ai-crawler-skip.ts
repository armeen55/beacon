/**
 * ai-crawler-skip (RANK-4, 2026-07-06) - the FIRST trigger to turn Profound's
 * AI-crawler feed (`profound_bot_rows`) into a Move.
 *
 * THE PLAY: AI assistants (ChatGPT, Perplexity, Claude) send their crawlers to
 * read your site so they know what to recommend. When those crawlers fetch the
 * rest of your site but SKIP a page that gets real Google demand, that page can
 * never be recommended - AI has literally never read it. This trigger names each
 * skipped high-value page with its own demand as proof and asks for links to it
 * from the pages the crawlers already fetch.
 *
 * Inputs are the pre-assembled CrawlerSkipGap list (the LOADER pre-reads the
 * synced bot rows + GSC demand and runs the pure crawlability math); this
 * predicate never does I/O (predicate purity invariant). It never spends a live
 * Profound or GSC call.
 *
 * PAIRS WITH, DOES NOT DUPLICATE, robots_blocks_ai_bots: that trigger checks
 * robots.txt PERMISSION (are AI bots allowed?). This one checks actual crawl
 * HITS (did they actually fetch the page?). A page can be fully allowed and
 * still never fetched because nothing links to it.
 *
 * DEDUP: the fix is add_internal_link, the same action buried_page / orphan_page
 * emit. The loader dedupes all three by cooldown_key (tenant, action, url), so a
 * page already claimed for internal links never also emits here - one link card
 * per page.
 *
 * EMPTY-SAFE: an empty gap list -> [] (byte-identical to before this trigger
 * existed). The loader only produces gaps when the crawler feed is reporting, so
 * a tenant with no Agent Analytics data emits nothing.
 *
 * Never says a lab word ("crawlability", "bot", "PageRank") on the customer
 * card; says plainly "AI assistants". No em or en dashes anywhere. PURE FUNCTION.
 */

import type { CrawlerSkipGap } from "@/domains/aeo-traffic/load-crawler-skip-gaps";

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { aiCrawlerSkipCopy } from "../customer-copy-templates";

export type AiCrawlerSkipInput = {
  tenantId: string;
  /** Pre-assembled, demand-gated skip gaps (built in the loader). */
  gaps: ReadonlyArray<CrawlerSkipGap>;
  signalAt: string;
  maxEmissions?: number;
};

const DEFAULT_MAX_EMISSIONS = 5;

/**
 * @no-classifier-required: consumes pre-assembled, demand-gated gaps whose page
 * universe already came from the GSC demand map (real owned pages with real
 * search demand); the action is a link to an existing page, so there is no
 * per-page type to classify here.
 */
export function aiCrawlerSkip(
  input: AiCrawlerSkipInput,
): RecommendationCandidateRow[] {
  const { tenantId, gaps, signalAt } = input;
  // Global emptiness guard: no gaps (empty crawler feed, everything crawled, or
  // nothing clears the demand floor) -> nothing to say. Byte-identical to before.
  if (gaps.length === 0) return [];
  const max = input.maxEmissions ?? DEFAULT_MAX_EMISSIONS;

  // Highest demand first (biggest money at stake); stable path tiebreak.
  const ordered = [...gaps].sort(
    (a, b) => b.demand - a.demand || a.path.localeCompare(b.path),
  );

  const out: RecommendationCandidateRow[] = [];
  const seenPaths = new Set<string>();
  for (const gap of ordered.slice(0, max)) {
    const key = gap.path.toLowerCase();
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);

    const actionType = "add_internal_link" as const;
    const targetUrl = gap.path;
    const topicClusterLabel = "Internal linking";
    out.push({
      tenant_id: tenantId,
      trigger_signal: "ai_crawler_skip",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot",
          ref: targetUrl,
          detail:
            "ai_crawler_skip bot_hits=" +
            String(gap.botHits) +
            "; impressions_90d=" +
            String(gap.demand) +
            "; crawled_page_count=" +
            String(gap.crawledPageCount),
        },
      ],
      confidence: "medium",
      impact_estimate: "high",
      customer_copy: aiCrawlerSkipCopy(gap.path, gap.demand, gap.crawledPageCount),
      operator_evidence:
        "signal=ai_crawler_skip; url=" +
        gap.path +
        "; bot_hits=" +
        String(gap.botHits) +
        "; impressions_90d=" +
        String(gap.demand) +
        "; crawled_page_count=" +
        String(gap.crawledPageCount) +
        "; play=ai_crawler_coverage",
      dedupe_key: dedupeKey({ tenantId, actionType, targetUrl, topicClusterLabel }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    });
  }
  return out;
}
