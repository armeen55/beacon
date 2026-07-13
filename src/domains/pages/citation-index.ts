/**
 * Build citation evidence index from cold-stored citation observations.
 * Maps pages to topics with citation frequency and platform breakdown.
 */

import type { CitationObservation } from "@/domains/citation-observations/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type {
  CitationPageRollup,
  TopicCitationSummary,
  CitationEvidenceIndex,
  PlatformCitationStats,
} from "./types";
import { normalizePageUrl, canonicalizeOwnedUrl } from "./classify";

type RollupKey = string; // `${pageUrl}|${topic}`

type RollupAcc = {
  pageUrl: string;
  domain: string;
  topic: string;
  isOwned: boolean;
  citations: number;
  answerIds: Set<string>;
  promptIds: Set<string>;
  byPlatform: Map<string, { count: number; answers: Set<string>; orders: number[]; }>;
  firstSeen: string;
  lastSeen: string;
};

/**
 * Build the citation evidence index from raw observations.
 *
 * Joins citations to prompt-answer observations for topic/platform context.
 * Uses in-memory maps for the ~85K citation join — fast enough for batch.
 */
export function buildCitationEvidenceIndex(opts: {
  citations: CitationObservation[];
  promptAnswers: PromptAnswerObservation[];
  ownedDomain: string;
  legacyOwnedDomains?: ReadonlyArray<string>;
}): CitationEvidenceIndex {
  const { citations, promptAnswers, ownedDomain, legacyOwnedDomains } = opts;
  const paMap = new Map<string, PromptAnswerObservation>();
  for (const pa of promptAnswers) {
    paMap.set(pa.id, pa);
  }

  const rollups = new Map<RollupKey, RollupAcc>();
  let processed = 0;

  for (const c of citations) {
    const pa = paMap.get(c.prompt_answer_id);
    if (!pa) continue;

    const raw = c.url ?? `https://${c.domain}/`;
    const parsed = normalizePageUrl(raw);
    if (!parsed) continue;

    const canonical = c.is_owned
      ? canonicalizeOwnedUrl(parsed, ownedDomain, legacyOwnedDomains)
      : parsed;

    const topic = pa.topic;
    const platform = pa.platform;
    const key: RollupKey = `${canonical.url}|${topic}`;

    let acc = rollups.get(key);
    if (!acc) {
      acc = {
        pageUrl: canonical.url,
        domain: canonical.domain,
        topic,
        isOwned: c.is_owned,
        citations: 0,
        answerIds: new Set(),
        promptIds: new Set(),
        byPlatform: new Map(),
        firstSeen: c.observed_at,
        lastSeen: c.observed_at,
      };
      rollups.set(key, acc);
    }

    acc.citations++;
    acc.answerIds.add(c.prompt_answer_id);
    acc.promptIds.add(pa.prompt_id);

    if (!acc.byPlatform.has(platform)) {
      acc.byPlatform.set(platform, { count: 0, answers: new Set(), orders: [] });
    }
    const platAcc = acc.byPlatform.get(platform)!;
    platAcc.count++;
    platAcc.answers.add(c.prompt_answer_id);
    if (c.citation_order != null) platAcc.orders.push(c.citation_order);

    if (c.observed_at < acc.firstSeen) acc.firstSeen = c.observed_at;
    if (c.observed_at > acc.lastSeen) acc.lastSeen = c.observed_at;
    processed++;
  }

  const byPageAndTopic: CitationPageRollup[] = [];
  const pageToTopics: Record<string, string[]> = {};

  for (const acc of rollups.values()) {
    const platRecord: Record<string, PlatformCitationStats> = {};
    for (const [plat, pAcc] of acc.byPlatform) {
      platRecord[plat] = {
        citation_count: pAcc.count,
        distinct_answers: pAcc.answers.size,
        avg_citation_order: pAcc.orders.length > 0
          ? Math.round((pAcc.orders.reduce((a, b) => a + b, 0) / pAcc.orders.length) * 10) / 10
          : null,
      };
    }

    byPageAndTopic.push({
      page_id: "",
      page_url: acc.pageUrl,
      domain: acc.domain,
      topic: acc.topic,
      is_owned: acc.isOwned,
      total_citations: acc.citations,
      distinct_answers: acc.answerIds.size,
      distinct_prompts: acc.promptIds.size,
      by_platform: platRecord,
      first_observed_at: acc.firstSeen,
      last_observed_at: acc.lastSeen,
    });

    if (!pageToTopics[acc.pageUrl]) pageToTopics[acc.pageUrl] = [];
    if (!pageToTopics[acc.pageUrl].includes(acc.topic)) {
      pageToTopics[acc.pageUrl].push(acc.topic);
    }
  }

  const byTopic = buildTopicSummaries(byPageAndTopic);

  return {
    built_at: new Date().toISOString(),
    total_citations_processed: processed,
    by_page_and_topic: byPageAndTopic,
    by_topic: byTopic,
    page_to_topics: pageToTopics,
  };
}

function buildTopicSummaries(rollups: CitationPageRollup[]): TopicCitationSummary[] {
  const topicMap = new Map<string, {
    total: number;
    owned: number;
    competitor: number;
    directory: number;
    other: number;
    ownedPages: Map<string, number>;
    competitorPages: Map<string, number>;
    directoryPages: Map<string, number>;
  }>();

  for (const r of rollups) {
    let t = topicMap.get(r.topic);
    if (!t) {
      t = {
        total: 0, owned: 0, competitor: 0, directory: 0, other: 0,
        ownedPages: new Map(), competitorPages: new Map(), directoryPages: new Map(),
      };
      topicMap.set(r.topic, t);
    }
    t.total += r.total_citations;

    if (r.is_owned) {
      t.owned += r.total_citations;
      t.ownedPages.set(r.page_url, (t.ownedPages.get(r.page_url) ?? 0) + r.total_citations);
    } else {
      const isDir = isDirectoryDomain(r.domain);
      if (isDir) {
        t.directory += r.total_citations;
        t.directoryPages.set(r.page_url, (t.directoryPages.get(r.page_url) ?? 0) + r.total_citations);
      } else {
        t.competitor += r.total_citations;
        t.competitorPages.set(r.page_url, (t.competitorPages.get(r.page_url) ?? 0) + r.total_citations);
      }
    }
  }

  const results: TopicCitationSummary[] = [];
  for (const [topic, t] of topicMap) {
    results.push({
      topic,
      total_citations: t.total,
      owned_citations: t.owned,
      competitor_citations: t.competitor,
      directory_citations: t.directory,
      other_citations: t.other,
      top_owned_pages: topN(t.ownedPages, 5),
      top_competitor_pages: topN(t.competitorPages, 5),
      top_directory_pages: topN(t.directoryPages, 5),
    });
  }

  return results.sort((a, b) => b.total_citations - a.total_citations);
}

function topN(map: Map<string, number>, n: number): { url: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([url, count]) => ({ url, count }));
}

const DIRECTORY_DOMAINS = new Set([
  "houzz.com", "yelp.com", "bbb.org", "angi.com", "homeadvisor.com",
  "thumbtack.com", "buildzoom.com", "bark.com", "nextdoor.com",
  "porch.com", "manta.com",
]);

function isDirectoryDomain(domain: string): boolean {
  return DIRECTORY_DOMAINS.has(domain);
}

// ---------------------------------------------------------------------------
// Commit 7B (2026-04-24) — native citation-evidence-index rebuild
// ---------------------------------------------------------------------------

/**
 * Minimal shape the native builder needs from a tracked entity. Matches the
 * public `TrackedEntity` but keeps the native builder's dependency narrow
 * for testing.
 */
type EntityForIndex = {
  name: string;
  domain?: string | null;
  is_owned: boolean;
  is_active: boolean;
};

/**
 * Minimal shape the native builder needs from a poll observation. Matches
 * the PromptAnswerObservation columns it reads.
 */
type ObservationForIndex = {
  id: string;
  prompt_id: string;
  observed_at: string;
  topic: string;
  platform: string;
  citation_urls?: string[] | null;
};

/**
 * Rebuild the citation evidence index from native prompt_answer_observations.
 * Parallels `buildCitationEvidenceIndex` above (which reads Profound cold-
 * store shards) but sources from `citation_urls` on the native observation
 * rows.
 *
 * INVARIANT — per Commit 7 design note: one observation contributes at most
 * 1 count per (page_url, topic) key. Duplicate citations of the same URL
 * inside a single answer are collapsed via a per-observation Set. The same
 * URL cited in two DIFFERENT observations on the same day correctly counts
 * twice (each observation is its own +1).
 *
 * Skips observations whose citation_urls is null/empty — pre-Commit-7 rows
 * don't have URL data and can't contribute. Skips observations before
 * NATIVE_REGIME_START (safety — caller should filter but we re-enforce).
 */
export function buildNativeCitationEvidenceIndex(opts: {
  observations: ObservationForIndex[];
  entities: EntityForIndex[];
  nativeRegimeStart: string;
}): CitationEvidenceIndex {
  const { observations, entities, nativeRegimeStart } = opts;

  const activeEntities = entities.filter((e) => e.is_active);
  const ownedDomains = new Set(
    activeEntities
      .filter((e) => e.is_owned)
      .map((e) => e.domain?.toLowerCase())
      .filter((d): d is string => Boolean(d)),
  );

  const rollups = new Map<RollupKey, RollupAcc>();
  let processed = 0;

  for (const obs of observations) {
    if (obs.observed_at.slice(0, 10) < nativeRegimeStart) continue;
    if (!obs.citation_urls || obs.citation_urls.length === 0) continue;

    const topic = obs.topic;
    const platform = obs.platform;

    // Per-observation dedup set: one observation contributes at most 1 per
    // (page_url, topic). Preserve FIRST citation_order per URL.
    const seenKeys = new Set<string>();
    for (let i = 0; i < obs.citation_urls.length; i++) {
      const raw = obs.citation_urls[i];
      if (!raw) continue;
      const parsed = normalizePageUrl(raw);
      if (!parsed) continue;

      const isOwned = ownedDomains.has(parsed.domain.toLowerCase());
      // Native observations already carry the tenant's current owned URL.
      // Do not rewrite them through a process-global founder alias table.
      const canonical = parsed;
      const key: RollupKey = `${canonical.url}|${topic}`;

      if (seenKeys.has(key)) continue; // INVARIANT: dedup within observation
      seenKeys.add(key);

      let acc = rollups.get(key);
      if (!acc) {
        acc = {
          pageUrl: canonical.url,
          domain: canonical.domain,
          topic,
          isOwned,
          citations: 0,
          answerIds: new Set(),
          promptIds: new Set(),
          byPlatform: new Map(),
          firstSeen: obs.observed_at,
          lastSeen: obs.observed_at,
        };
        rollups.set(key, acc);
      }

      acc.citations++;
      acc.answerIds.add(obs.id);
      acc.promptIds.add(obs.prompt_id);

      if (!acc.byPlatform.has(platform)) {
        acc.byPlatform.set(platform, { count: 0, answers: new Set(), orders: [] });
      }
      const platAcc = acc.byPlatform.get(platform)!;
      platAcc.count++;
      platAcc.answers.add(obs.id);
      platAcc.orders.push(i + 1); // 1-indexed citation order

      if (obs.observed_at < acc.firstSeen) acc.firstSeen = obs.observed_at;
      if (obs.observed_at > acc.lastSeen) acc.lastSeen = obs.observed_at;
      processed++;
    }
  }

  const byPageAndTopic: CitationPageRollup[] = [];
  const pageToTopics: Record<string, string[]> = {};

  for (const acc of rollups.values()) {
    const platRecord: Record<string, PlatformCitationStats> = {};
    for (const [plat, pAcc] of acc.byPlatform) {
      platRecord[plat] = {
        citation_count: pAcc.count,
        distinct_answers: pAcc.answers.size,
        avg_citation_order: pAcc.orders.length > 0
          ? Math.round((pAcc.orders.reduce((a, b) => a + b, 0) / pAcc.orders.length) * 10) / 10
          : null,
      };
    }

    byPageAndTopic.push({
      page_id: "",
      page_url: acc.pageUrl,
      domain: acc.domain,
      topic: acc.topic,
      is_owned: acc.isOwned,
      total_citations: acc.citations,
      distinct_answers: acc.answerIds.size,
      distinct_prompts: acc.promptIds.size,
      by_platform: platRecord,
      first_observed_at: acc.firstSeen,
      last_observed_at: acc.lastSeen,
    });

    if (!pageToTopics[acc.pageUrl]) pageToTopics[acc.pageUrl] = [];
    if (!pageToTopics[acc.pageUrl].includes(acc.topic)) {
      pageToTopics[acc.pageUrl].push(acc.topic);
    }
  }

  const byTopic = buildTopicSummaries(byPageAndTopic);

  return {
    built_at: new Date().toISOString(),
    total_citations_processed: processed,
    by_page_and_topic: byPageAndTopic,
    by_topic: byTopic,
    page_to_topics: pageToTopics,
  };
}
