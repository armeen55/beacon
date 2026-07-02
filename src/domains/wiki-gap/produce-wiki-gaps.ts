import "server-only";

import { log } from "@/lib/logger";
import { findWikiCitations, humanizeWikiTitle, type WikiCitationHit } from "./find-wiki-citations";
import { fetchArticleFacts } from "./wikipedia-client";
import { scoreBeatability, type BeatabilityBand } from "./beatability";
import { writeWikiGapResults, type WikiGap, type StoredWikiGaps } from "./wiki-gap-store";
import { readAllCachedKeywordDemand, type KeywordDemand } from "@/domains/serp/dataforseo-keywords";

/**
 * produce-wiki-gaps (2026-07-02, master plan item 23) - the OPERATOR-TRIGGERED
 * bounded batch behind "Check the Wikipedia pages AI prefers". NO cron wiring.
 *
 * Hard ceilings, by construction:
 *   - at most MAX_ARTICLES_PER_RUN distinct Wikipedia articles looked up
 *     (bounded to ~20 per run per the master-plan directive)
 *   - the Wikipedia REST + action API are FREE - no spend ledger involved,
 *     but the polite throttle in wikipedia-client.ts still caps request rate
 *   - every lookup is served from the 30-day cache when fresh, so a re-run
 *     within a month costs zero new Wikipedia requests
 */

export const MAX_ARTICLES_PER_RUN = 20;

export type WikiGapRunResult = {
  status: "ok" | "no_citations" | "error";
  articlesFound: number;
  articlesChecked: number;
  beatable: number;
  gaps: WikiGap[];
  /** Operator-facing receipt. First person, concrete numbers, no dashes. */
  message: string;
};

export type ProduceWikiGapsDeps = {
  now: () => Date;
  findCitations: (tenantId: string) => Promise<WikiCitationHit[]>;
  fetchFacts: typeof fetchArticleFacts;
  loadKeywordDemand: () => Promise<KeywordDemand[]>;
  writeResults: (r: StoredWikiGaps) => Promise<void>;
};

const defaultDeps: ProduceWikiGapsDeps = {
  now: () => new Date(),
  findCitations: (tenantId) => findWikiCitations(tenantId),
  fetchFacts: fetchArticleFacts,
  loadKeywordDemand: () => readAllCachedKeywordDemand().catch(() => [] as KeywordDemand[]),
  writeResults: (r) => writeWikiGapResults(r),
};

const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "is", "are", "what", "how", "why"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Best-effort, tenant-agnostic demand lookup: highest-volume cached keyword
 *  that shares at least 2 tokens with the query/article text, else null (never
 *  guessed). Deliberately simple - this only breaks ties among already-thin
 *  or already-stale articles, it never gates beatability on its own. */
function findDemand(text: string, keywords: readonly KeywordDemand[]): number | null {
  const textTokens = new Set(tokenize(text));
  if (textTokens.size === 0) return null;
  let best: number | null = null;
  for (const kw of keywords) {
    if ((kw.searchVolume ?? 0) <= 0) continue;
    const kwTokens = tokenize(kw.keyword);
    const shared = kwTokens.filter((t) => textTokens.has(t));
    if (shared.length < 2) continue;
    if (best == null || (kw.searchVolume ?? 0) > best) best = kw.searchVolume;
  }
  return best;
}

const usd0 = "$0"; // the Wikipedia API is free - every receipt says so honestly

/**
 * Run the bounded beat-Wikipedia batch for one tenant. Never throws. Persists
 * results only when at least one Wikipedia citation was found, so an empty
 * run never clobbers a previous real run.
 */
export async function produceWikiGaps(tenantId: string, depsOverride: Partial<ProduceWikiGapsDeps> = {}): Promise<WikiGapRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };

  let hits: WikiCitationHit[] = [];
  try {
    hits = await deps.findCitations(tenantId);
  } catch (e) {
    log.warn("[wiki-gap] citation mining failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  if (hits.length === 0) {
    return {
      status: "no_citations",
      articlesFound: 0,
      articlesChecked: 0,
      beatable: 0,
      gaps: [],
      message:
        "I did not find any AI answers citing Wikipedia in your space yet. Sync your AI citation data first, then run this again.",
    };
  }

  const bounded = hits.slice(0, MAX_ARTICLES_PER_RUN);
  const keywords = await deps.loadKeywordDemand();

  const gaps: WikiGap[] = [];
  for (const hit of bounded) {
    const facts = await deps.fetchFacts(hit.articleTitle);
    const demand = findDemand(`${hit.queryText ?? ""} ${humanizeWikiTitle(hit.articleTitle)}`, keywords);
    const beatability = scoreBeatability({
      words: facts.words,
      lastRevisionAt: facts.lastRevisionAt,
      sections: facts.sections,
      exists: facts.exists,
      demand,
    });
    gaps.push({
      articleTitle: hit.articleTitle,
      displayTitle: humanizeWikiTitle(hit.articleTitle),
      queryText: hit.queryText,
      words: facts.words,
      sections: facts.sections,
      lastRevisionAt: facts.lastRevisionAt,
      exists: facts.exists,
      demand,
      ...beatability,
    });
  }

  gaps.sort((a, b) => b.score - a.score || a.displayTitle.localeCompare(b.displayTitle));

  const beatable = gaps.filter((g) => (g.band as BeatabilityBand) !== "low").length;
  const now = deps.now();
  try {
    await deps.writeResults({
      tenant_id: tenantId,
      computed_at: now.toISOString(),
      articlesChecked: gaps.length,
      gaps,
    });
  } catch (e) {
    log.warn("[wiki-gap] persist failed (results still returned)", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  return {
    status: "ok",
    articlesFound: hits.length,
    articlesChecked: gaps.length,
    beatable,
    gaps,
    message: `I checked ${gaps.length} Wikipedia articles AI cites in your space for ${usd0}: ${beatable} ${beatable === 1 ? "is" : "are"} thin or stale enough to beat. The best ones are on the New Pages board now.`,
  };
}
