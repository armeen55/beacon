import "server-only";

import { cache } from "react";

import {
  getCompetitorAuditsForTenant,
  isTeardownFresh,
  whatWins,
  type CompetitorPageAudit,
} from "@/domains/demand-graph/competitor-page-audit";
import { loadStealBriefsForTenant, type StealBrief } from "@/domains/serp/serp-steal-lane";
import { rootDomain } from "@/domains/serp/serp-provider";
import type { CommonalityBrief } from "@/domains/demand-graph/teardown-commonality";

/**
 * teardown-library (DREAM SITE V1, item D3, 2026-07-02) - THE single read API
 * over the existing teardown cache, shared by both scrape lanes and every UI
 * that wants "what has Beacon already read about this competitor page."
 *
 * D2 (per-prompt AI-cited teardown) and D3 (this file's GSC-beaten-keyword
 * teardown) both write into the SAME underlying cache -
 * `competitor-page-audit.ts`'s `competitor-page-audit` store (imported
 * read-only here; never re-implemented) - because they both call the same
 * `auditCompetitorPage`/`getCompetitorAuditsForTenant` functions on a URL.
 * This module does not add a new store; it adds the missing UNION view: one
 * entry per torn-down URL, tagged with which lane(s) actually asked for it
 * and, when available, the commonality brief for that lane.
 *
 * D2 STATUS (2026-07-02): `teardown-commonality.ts` + `native-teardown-runner.ts`
 * now exist (landed concurrently with this file) - the real `CommonalityBrief`
 * type is imported above. However `runNativeTeardownForTenant`'s nightly
 * result is NOT yet persisted anywhere queryable (it is returned in-memory to
 * warm-caches.ts's step receipt and then discarded) - there is no per-tenant,
 * per-prompt store to join against yet. `readCommonalityBriefs` below stays an
 * honest empty-map stub until D2 (or a follow-up) persists its per-prompt
 * briefs somewhere this module can read keyed by topic/prompt. When that
 * lands, swap the stub body for the real read - the rest of this file (lane
 * tagging, freshness, filtering) does not need to change.
 */

export type TeardownSourceLane = "ai_answers" | "google_results" | "both";

export type TeardownLibraryEntry = {
  url: string;
  domain: string;
  /** Which lane(s) asked Beacon to read this page. */
  sourceLane: TeardownSourceLane;
  /** The topic label (D2, per-prompt) or keyword (D3, per-GSC-query) that
   *  brought this URL into the library. A URL can be reached by more than
   *  one topic/keyword - this is the first one Beacon saw it for. */
  topics: string[];
  fetchStatus: CompetitorPageAudit["fetchStatus"];
  whatWins: string | null;
  auditedAt: string;
  isFresh: boolean;
  /** Present once D2's commonality extraction has run for one of this
   *  entry's topics; null otherwise (honest silence, never fabricated). */
  commonalityBrief: CommonalityBrief | null;
};

export type TeardownLibraryFilter = {
  /** Case-insensitive substring match against topics/keyword or the URL/domain. */
  topic?: string;
  keyword?: string;
  prompt?: string;
  lane?: TeardownSourceLane;
};

function urlKey(url: string): string {
  return url.toLowerCase();
}

/**
 * D2 read stub - returns {} until the native-teardown pipeline persists its
 * per-prompt CommonalityBrief results somewhere queryable (see file header).
 * Swap this for the real reader once that store exists.
 */
async function readCommonalityBriefs(_tenantId: string): Promise<Map<string, CommonalityBrief>> {
  return new Map();
}

/**
 * Build the full union library for a tenant: every URL either lane has torn
 * down, tagged with lane + topics + freshness + (when available) the
 * commonality brief. $0 - reads only existing caches, never fetches.
 * React-cache()-d so one render composing multiple filtered views costs one
 * read.
 */
export const listTeardownLibrary = cache(async (tenantId: string): Promise<TeardownLibraryEntry[]> => {
  if (!tenantId) return [];

  const [auditCache, stealBriefs, commonalityBriefs] = await Promise.all([
    getCompetitorAuditsForTenant().catch(() => new Map<string, CompetitorPageAudit>()),
    loadStealBriefsForTenant(tenantId).catch(() => [] as StealBrief[]),
    readCommonalityBriefs(tenantId).catch(() => new Map<string, CommonalityBrief>()),
  ]);

  // D3 (google_results): every steal brief with a real competitor URL names
  // the exact page + the keyword that brought it in.
  const googleTopicsByUrl = new Map<string, Set<string>>();
  for (const b of stealBriefs) {
    if (!b.competitorUrl) continue;
    const key = urlKey(b.competitorUrl);
    const set = googleTopicsByUrl.get(key) ?? new Set<string>();
    set.add(b.keyword);
    googleTopicsByUrl.set(key, set);
  }

  // D2 (ai_answers): every URL in the shared audit cache that is NOT one of
  // the google-lane URLs above is treated as AI-lane provenance - D2 is the
  // only other writer into this same cache today (competitor-page-audit.ts's
  // planTeardownTargetsForTenant reads the demand graph's AI-cited
  // competitorUrls). Once D2 exposes its own per-URL topic label, replace
  // this inference with that real join.
  const nowMs = Date.now();
  const out: TeardownLibraryEntry[] = [];
  for (const [cacheKey, audit] of auditCache) {
    const key = urlKey(audit.url || cacheKey);
    const googleTopics = googleTopicsByUrl.get(key);
    const sourceLane: TeardownSourceLane = googleTopics ? (googleTopics.size > 0 ? "both" : "ai_answers") : "ai_answers";
    // A URL ONLY reached via the google lane still needs representation even
    // when it is not (yet) in the shared audit cache under an exact key match
    // - handled in the second pass below.
    const topics = new Set<string>(googleTopics ?? []);
    const domain = audit.domain || rootDomain(audit.url);
    let commonalityBrief: CommonalityBrief | null = null;
    for (const t of topics) {
      const found = commonalityBriefs.get(t.toLowerCase());
      if (found) {
        commonalityBrief = found;
        break;
      }
    }
    out.push({
      url: audit.url,
      domain,
      sourceLane: googleTopics && googleTopics.size > 0 ? "both" : sourceLane,
      topics: [...topics],
      fetchStatus: audit.fetchStatus,
      whatWins: audit.fetchStatus === "ok" ? whatWins(audit.facts) : null,
      auditedAt: audit.auditedAt,
      isFresh: isTeardownFresh(audit.auditedAt, nowMs),
      commonalityBrief,
    });
  }

  // Second pass: a google-lane URL the audit cache has under a DIFFERENT key
  // than the steal brief's raw URL (canonicalization drift) still deserves an
  // entry - skip only URLs already represented above.
  const seen = new Set(out.map((e) => urlKey(e.url)));
  for (const b of stealBriefs) {
    if (!b.competitorUrl || seen.has(urlKey(b.competitorUrl))) continue;
    seen.add(urlKey(b.competitorUrl));
    out.push({
      url: b.competitorUrl,
      domain: b.competitorDomain ?? rootDomain(b.competitorUrl),
      sourceLane: "google_results",
      topics: [b.keyword],
      fetchStatus: b.teardownStatus === "torn_down" ? "ok" : b.teardownStatus === "blocked" ? "blocked_robots" : "fetch_failed",
      whatWins: b.whatWins,
      auditedAt: new Date(0).toISOString(),
      isFresh: false,
      commonalityBrief: null,
    });
  }

  return out;
});

/** Filtered read over the full library - topic/keyword/prompt are all the
 *  same kind of match (substring, case-insensitive) since a URL's provenance
 *  is stored as a flat topics list regardless of which lane named it. */
export async function listTeardownLibraryFiltered(
  tenantId: string,
  filter: TeardownLibraryFilter,
): Promise<TeardownLibraryEntry[]> {
  const all = await listTeardownLibrary(tenantId);
  const needle = (filter.topic ?? filter.keyword ?? filter.prompt ?? "").trim().toLowerCase();
  return all.filter((e) => {
    if (filter.lane && e.sourceLane !== filter.lane && e.sourceLane !== "both") return false;
    if (!needle) return true;
    if (e.topics.some((t) => t.toLowerCase().includes(needle))) return true;
    if (e.domain.toLowerCase().includes(needle)) return true;
    return e.url.toLowerCase().includes(needle);
  });
}

/** Small honest summary for a Research-hub header card - counts by lane, no
 *  fabricated precision. */
export type TeardownLibrarySummary = {
  total: number;
  aiOnly: number;
  googleOnly: number;
  both: number;
  freshCount: number;
};

export async function summarizeTeardownLibrary(tenantId: string): Promise<TeardownLibrarySummary> {
  const all = await listTeardownLibrary(tenantId);
  let aiOnly = 0;
  let googleOnly = 0;
  let both = 0;
  let freshCount = 0;
  for (const e of all) {
    if (e.sourceLane === "both") both += 1;
    else if (e.sourceLane === "ai_answers") aiOnly += 1;
    else googleOnly += 1;
    if (e.isFresh) freshCount += 1;
  }
  return { total: all.length, aiOnly, googleOnly, both, freshCount };
}
