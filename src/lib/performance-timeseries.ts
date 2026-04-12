/**
 * Aggregates Result[] into daily time-series data for trend charts.
 * Supports filtering by date range, platform, and topic.
 */

import type { Result } from "@/domains/results/types";
import { PLATFORM_LABELS, type Platform } from "@/lib/constants";

export type DailyPoint = {
  date: string;
  citations: number;
  mentions: number;
};

export type TrendSeries = {
  points: DailyPoint[];
  totalCitations: number;
  totalMentions: number;
  citationTrend: number | null;
  mentionTrend: number | null;
};

export type PlatformOption = {
  platform: string;
  label: string;
  citations: number;
};

export type TopicOption = {
  topic: string;
  citations: number;
};

export type PerformanceTimeseries = {
  series: TrendSeries;
  /** Daily points keyed by platform id (e.g. chatgpt), for model-specific charts */
  pointsByPlatform: Record<string, DailyPoint[]>;
  platforms: PlatformOption[];
  topics: TopicOption[];
  dateRange: { from: string; to: string } | null;
  competitorRank: CompetitorRankEntry[] | null;
};

export type CompetitorRankEntry = {
  domain: string;
  label: string;
  citations: number;
  share: number;
  isOwned: boolean;
  type: "direct" | "directory" | "editorial" | "forum" | "other";
};

function computeTrend(points: DailyPoint[], field: "citations" | "mentions"): number | null {
  if (points.length < 4) return null;
  const mid = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, mid);
  const secondHalf = points.slice(mid);
  const first = firstHalf.reduce((s, p) => s + p[field], 0);
  const second = secondHalf.reduce((s, p) => s + p[field], 0);
  if (first === 0) return null;
  return Math.round(((second - first) / first) * 100);
}

/** Trend % for a citation or mention series (client-safe for filtered slices). */
export function computeSeriesTrend(
  points: DailyPoint[],
  field: "citations" | "mentions",
): number | null {
  return computeTrend(points, field);
}

function aggregateResultsToDailyPoints(rows: Result[]): DailyPoint[] {
  const byDate = new Map<string, { citations: number; mentions: number }>();
  for (const r of rows) {
    const d = r.snapshot_date;
    const agg = byDate.get(d) ?? { citations: 0, mentions: 0 };
    agg.citations += r.citation_count;
    agg.mentions += r.mention_count;
    byDate.set(d, agg);
  }
  const sortedDates = [...byDate.keys()].sort();
  return sortedDates.map((date) => ({ date, ...byDate.get(date)! }));
}

export function buildPerformanceTimeseries(
  results: Result[],
  opts?: {
    platforms?: string[];
    topic?: string | null;
  },
): PerformanceTimeseries {
  let filtered = results.filter((r) => r.platform !== "all");

  if (opts?.platforms && opts.platforms.length > 0) {
    const set = new Set(opts.platforms);
    filtered = filtered.filter((r) => set.has(r.platform));
  }
  if (opts?.topic) {
    const t = opts.topic;
    filtered = filtered.filter((r) => r.topic === t);
  }

  const points = aggregateResultsToDailyPoints(filtered);

  const platformIds = [...new Set(filtered.map((r) => r.platform))];
  const pointsByPlatform: Record<string, DailyPoint[]> = {};
  for (const pid of platformIds) {
    pointsByPlatform[pid] = aggregateResultsToDailyPoints(
      filtered.filter((r) => r.platform === pid),
    );
  }

  const sortedDates = points.map((p) => p.date);

  const totalCitations = points.reduce((s, p) => s + p.citations, 0);
  const totalMentions = points.reduce((s, p) => s + p.mentions, 0);

  const platformMap = new Map<string, number>();
  for (const r of results.filter((r) => r.platform !== "all")) {
    platformMap.set(r.platform, (platformMap.get(r.platform) ?? 0) + r.citation_count);
  }
  const platforms: PlatformOption[] = [...platformMap.entries()]
    .map(([platform, citations]) => ({
      platform,
      label: PLATFORM_LABELS[platform as Platform] ?? platform,
      citations,
    }))
    .sort((a, b) => b.citations - a.citations);

  const topicMap = new Map<string, number>();
  for (const r of results.filter((r) => r.platform !== "all" && r.topic)) {
    topicMap.set(r.topic!, (topicMap.get(r.topic!) ?? 0) + r.citation_count);
  }
  const topics: TopicOption[] = [...topicMap.entries()]
    .map(([topic, citations]) => ({ topic, citations }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 20);

  const dateRange =
    sortedDates.length >= 2
      ? { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] }
      : null;

  return {
    series: {
      points,
      totalCitations,
      totalMentions,
      citationTrend: computeTrend(points, "citations"),
      mentionTrend: computeTrend(points, "mentions"),
    },
    pointsByPlatform,
    platforms,
    topics,
    dateRange,
    competitorRank: null,
  };
}

/**
 * Build competitor citation ranking from citation evidence index.
 */
export function buildCompetitorRank(
  citationIndex: {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
      domain?: string;
    }[];
  } | null,
  ownedDomain: string,
  classifyDomain: (domain: string) => "direct" | "directory" | "editorial" | "forum" | "other",
): CompetitorRankEntry[] {
  if (!citationIndex) return [];

  const domainCits = new Map<string, { citations: number; isOwned: boolean }>();
  let total = 0;

  for (const row of citationIndex.by_page_and_topic) {
    const domain =
      row.domain ??
      (() => {
        try {
          return new URL(row.page_url).hostname.replace(/^www\./, "");
        } catch {
          return null;
        }
      })();
    if (!domain) continue;
    const norm = domain.toLowerCase().replace(/^www\./, "");
    const existing = domainCits.get(norm) ?? { citations: 0, isOwned: false };
    existing.citations += row.total_citations;
    if (row.is_owned) existing.isOwned = true;
    domainCits.set(norm, existing);
    total += row.total_citations;
  }

  if (total === 0) return [];

  return [...domainCits.entries()]
    .map(([domain, data]) => ({
      domain,
      label: domain,
      citations: data.citations,
      share: Math.round((data.citations / total) * 1000) / 10,
      isOwned: data.isOwned,
      type: classifyDomain(domain),
    }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 15);
}
