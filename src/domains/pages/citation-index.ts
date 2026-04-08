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
import { normalizePageUrl } from "./classify";

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
}): CitationEvidenceIndex {
  const { citations, promptAnswers } = opts;
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

    const topic = pa.topic;
    const platform = pa.platform;
    const key: RollupKey = `${parsed.url}|${topic}`;

    let acc = rollups.get(key);
    if (!acc) {
      acc = {
        pageUrl: parsed.url,
        domain: parsed.domain,
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
