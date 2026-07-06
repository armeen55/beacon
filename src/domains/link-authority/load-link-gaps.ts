/**
 * link-authority/load-link-gaps (RANK-7, 2026-07-06) - the loader-side I/O
 * wrapper for the link-gap engine. The detection math (link-gap.ts) is PURE, so
 * this module does the reads and hands it a pre-joined candidate list.
 *
 * IT SPENDS NOTHING. Every read is $0:
 *   1. the keyword-gap store (keyword-gap-store.ts) - competitor domain + rank +
 *      your rank + volume, already produced by an operator-triggered gap run
 *      and cached <= 30 days. This is where competitors RANK and you do not.
 *   2. the ALREADY-cached backlink summaries (readAllCachedBacklinks, $0) -
 *      referring-domain counts a PAST winnability verdict run already fetched.
 *      No fresh runBacklinksSummary call happens here (no new paid pattern).
 *   3. the ALREADY-cached keyword-difficulty reads ($0) - so a low-difficulty
 *      query stays winnable on merit even with a big link gap.
 *
 * EMPTY-SAFE + FAIL-SOFT: no gap run yet, or no cached backlink reads, returns
 * [] (byte-identical to before RANK-7). Any read failure returns [] rather than
 * breaking the recommendation pipeline. Read-only - no live crawl, no paid call.
 *
 * If a DURABLE nightly backlink snapshot is ever wanted (so the link-gap fires
 * even before any manual verdict run has warmed the cache), that belongs to
 * RANK-8's nightly scheduler as a new sync phase - NOT a new cron phase here.
 */

import "server-only";

import { readKeywordGapResults } from "@/domains/serp/keyword-gap-store";
import {
  readAllCachedBacklinks,
  readAllCachedKeywordDifficulty,
  normalizeDomainTarget,
} from "@/domains/serp/dataforseo-labs";
import { computeLinkGaps, type LinkGap, type LinkGapCandidate } from "./link-gap";

/** Map a cached-backlinks map (keyed by URL) to a best-per-domain referring
 *  count - the largest referring-domain count seen for any URL on that domain
 *  (a competitor's strongest page is the honest "how linked are they" read). */
function bestReferringByDomain(cache: ReadonlyMap<string, number | null>): Map<string, number> {
  const byDomain = new Map<string, number>();
  for (const [url, count] of cache) {
    if (typeof count !== "number" || count < 0) continue;
    const domain = normalizeDomainTarget(url);
    if (!domain) continue;
    const prev = byDomain.get(domain);
    if (prev == null || count > prev) byDomain.set(domain, count);
  }
  return byDomain;
}

/**
 * Load $0 link-authority gaps for a tenant. Joins the cached keyword-gap rows
 * with the cached backlink counts and difficulty scores, then runs the pure
 * detector. Returns the highest-value queries a link gap caps, or [] when the
 * cached data is thin. Fail-soft.
 */
export async function loadLinkGapsForTenant(
  tenantId: string,
  opts: { ownDomain?: string | null; max?: number; now?: Date } = {},
): Promise<LinkGap[]> {
  try {
    const now = opts.now ?? new Date();
    const stored = await readKeywordGapResults(tenantId, now).catch(() => null);
    if (!stored || stored.gaps.length === 0) return [];

    const ownDomain = normalizeDomainTarget(opts.ownDomain ?? stored.own_domain ?? "");

    const [backlinkCache, difficultyCache] = await Promise.all([
      readAllCachedBacklinks({ now: () => now }).catch(() => new Map<string, number | null>()),
      readAllCachedKeywordDifficulty({ now: () => now }).catch(() => new Map<string, number | null>()),
    ]);
    // No backlink reads warmed yet -> nothing to compare -> honest empty.
    if (backlinkCache.size === 0) return [];

    const referringByDomain = bestReferringByDomain(backlinkCache);
    const ownReferring = ownDomain ? referringByDomain.get(ownDomain) ?? null : null;

    const candidates: LinkGapCandidate[] = [];
    for (const gap of stored.gaps) {
      const competitorDomain = normalizeDomainTarget(gap.competitorDomain);
      if (!competitorDomain) continue;
      const competitorReferringDomains = referringByDomain.get(competitorDomain) ?? null;
      // Skip anything without both reads - the detector also guards this, but
      // dropping early keeps the candidate list honest and lean.
      if (competitorReferringDomains == null || ownReferring == null) continue;

      candidates.push({
        keyword: gap.keyword,
        volume: gap.volume,
        competitorDomain,
        competitorRank: gap.competitorRank,
        competitorUrl: null,
        ownRank: gap.ownRank,
        competitorReferringDomains,
        ownReferringDomains: ownReferring,
        difficulty: difficultyCache.get(gap.keyword.toLowerCase()) ?? null,
      });
    }

    return computeLinkGaps(candidates, opts.max ?? 20);
  } catch {
    return [];
  }
}
