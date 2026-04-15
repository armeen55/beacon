/**
 * Materialized page→visibility relationships.
 *
 * Persists per-page citation totals, top topics, platform breakdown,
 * and trend direction so learning systems can query explicit page-level
 * visibility without recomputing from citation_evidence_index on every read.
 *
 * Write trigger: import pipeline (after citation_evidence_index is built).
 * Read: learning/intelligence layers (routes still compute from index).
 */

import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import { writeStore } from "@/lib/persistence/json-store";
import { syncPageVisibility } from "@/lib/persistence/dual-write";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type PageVisibilitySummary = {
  id: string;
  page_url: string;
  total_citations: number;
  mention_count: number;
  top_topics: { topic: string; citations: number }[];
  platform_breakdown: Record<string, number>;
  trend_direction:
    | "improving"
    | "declining"
    | "stable"
    | "insufficient_data";
  updated_at: string;
  /** Phase 12: page response profile (null if <2 change outcomes for this page) */
  response_profile?: {
    changes_applied: number;
    responsive_to: string[];
    avg_citation_delta: number;
    profiled: boolean;
  } | null;
};

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

const TREND_WINDOW_DAYS = 14;
const IMPROVING_THRESHOLD = 0.15;
const DECLINING_THRESHOLD = -0.15;

function computeTrendForTopics(
  topics: string[],
  snapshots: DailyMetricSnapshot[],
): PageVisibilitySummary["trend_direction"] {
  if (topics.length === 0) return "insufficient_data";

  // Get topic-level snapshots for this page's topics
  const topicSet = new Set(topics.map((t) => t.toLowerCase()));
  const relevant = snapshots.filter(
    (s) =>
      s.scope_type === "topic" &&
      topicSet.has(s.scope_id.toLowerCase()),
  );

  if (relevant.length === 0) return "insufficient_data";

  // Sort by date to find the date range
  const dates = [...new Set(relevant.map((s) => s.date))].sort();
  if (dates.length < 7) return "insufficient_data";

  // Split into recent window and prior window
  const latestDate = dates[dates.length - 1];
  const midpoint = addDays(latestDate, -TREND_WINDOW_DAYS);
  const startpoint = addDays(midpoint, -TREND_WINDOW_DAYS);

  const recentSnaps = relevant.filter(
    (s) => s.date > midpoint && s.date <= latestDate,
  );
  const priorSnaps = relevant.filter(
    (s) => s.date > startpoint && s.date <= midpoint,
  );

  const recentDays = new Set(recentSnaps.map((s) => s.date)).size;
  const priorDays = new Set(priorSnaps.map((s) => s.date)).size;

  if (recentDays < 3 || priorDays < 3) return "insufficient_data";

  // Aggregate citations per day, then average
  const recentAvg =
    recentSnaps.reduce((a, s) => a + s.citation_count, 0) / recentDays;
  const priorAvg =
    priorSnaps.reduce((a, s) => a + s.citation_count, 0) / priorDays;

  if (priorAvg === 0) {
    return recentAvg > 0 ? "improving" : "insufficient_data";
  }

  const delta = (recentAvg - priorAvg) / priorAvg;
  if (delta >= IMPROVING_THRESHOLD) return "improving";
  if (delta <= DECLINING_THRESHOLD) return "declining";
  return "stable";
}

/** Same normalization as computeMemoryInsights' normalizeTopicKey — strips
 *  "Shield:", "(Bay Area)", and lowercases for consistent topic matching. */
function normalizeTopicForJoin(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\s*\(bay area\)\s*/gi, "")
    .replace(/shield:\s*/gi, "")
    .trim();
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Materialization entry point
// ---------------------------------------------------------------------------

export async function materializePageVisibility(
  citationIndex: CitationEvidenceIndex,
  snapshots: DailyMetricSnapshot[],
  changeOutcomes?: ChangeOutcome[],
): Promise<PageVisibilitySummary[]> {
  // Aggregate per owned page URL
  const pageMap = new Map<
    string,
    {
      url: string;
      totalCitations: number;
      topicCitations: Map<string, number>;
      platformCitations: Map<string, number>;
    }
  >();

  for (const rollup of citationIndex.by_page_and_topic) {
    if (!rollup.is_owned) continue;

    const key = rollup.page_url.replace(/\/+$/, "").toLowerCase();
    let entry = pageMap.get(key);
    if (!entry) {
      entry = {
        url: rollup.page_url,
        totalCitations: 0,
        topicCitations: new Map(),
        platformCitations: new Map(),
      };
      pageMap.set(key, entry);
    }

    entry.totalCitations += rollup.total_citations;

    // Accumulate per-topic
    const prev = entry.topicCitations.get(rollup.topic) ?? 0;
    entry.topicCitations.set(rollup.topic, prev + rollup.total_citations);

    // Accumulate per-platform from rollup.by_platform
    if (rollup.by_platform) {
      for (const [plat, stats] of Object.entries(rollup.by_platform)) {
        const p = entry.platformCitations.get(plat) ?? 0;
        entry.platformCitations.set(
          plat,
          p + (stats.citation_count ?? 0),
        );
      }
    }
  }

  // Compute mention counts from topic-level snapshots
  const topicMentions = new Map<string, number>();
  for (const s of snapshots) {
    if (s.scope_type !== "topic") continue;
    const k = s.scope_id.toLowerCase();
    topicMentions.set(k, (topicMentions.get(k) ?? 0) + s.mention_count);
  }

  const summaries: PageVisibilitySummary[] = [];

  for (const [, entry] of pageMap) {
    // Top 5 topics by citation count
    const topTopics = [...entry.topicCitations.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, citations]) => ({ topic, citations }));

    // Platform breakdown
    const platformBreakdown: Record<string, number> = {};
    for (const [plat, count] of entry.platformCitations) {
      platformBreakdown[plat] = count;
    }

    // Mention count: sum mentions for this page's topics
    const pageTopics = [...entry.topicCitations.keys()];
    let mentionCount = 0;
    for (const t of pageTopics) {
      mentionCount += topicMentions.get(t.toLowerCase()) ?? 0;
    }

    // Trend direction
    const trendDirection = computeTrendForTopics(pageTopics, snapshots);

    const normalizedUrl = entry.url.replace(/\/+$/, "").toLowerCase();

    summaries.push({
      id: normalizedUrl,
      page_url: entry.url,
      total_citations: entry.totalCitations,
      mention_count: mentionCount,
      top_topics: topTopics,
      platform_breakdown: platformBreakdown,
      trend_direction: trendDirection,
      updated_at: new Date().toISOString(),
    });
  }

  // Phase 12: Page Response Profiling
  if (changeOutcomes && changeOutcomes.length > 0) {
    // Match by topic overlap, using the same normalization as computeMemoryInsights
    for (const summary of summaries) {
      const pageTopicSet = new Set(
        summary.top_topics.map((t) => normalizeTopicForJoin(t.topic)),
      );

      const matchingOutcomes = changeOutcomes.filter((o) =>
        pageTopicSet.has(normalizeTopicForJoin(o.topic_targeted)),
      );

      if (matchingOutcomes.length >= 2) {
        const improving = matchingOutcomes.filter(
          (o) => o.direction === "improving",
        );
        // Which signal_types were responsive (need changelog join — use topic as proxy)
        const responsiveTo = [
          ...new Set(
            improving.map((o) => o.topic_targeted),
          ),
        ].slice(0, 5);

        const avgDelta =
          improving.length > 0
            ? Math.round(
                (improving.reduce((a, o) => a + o.citation_delta_pct, 0) /
                  improving.length) *
                  10,
              ) / 10
            : 0;

        summary.response_profile = {
          changes_applied: matchingOutcomes.length,
          responsive_to: responsiveTo,
          avg_citation_delta: avgDelta,
          profiled: true,
        };
      } else {
        summary.response_profile = null;
      }
    }
  }

  // Sort by total citations descending
  summaries.sort((a, b) => b.total_citations - a.total_citations);

  await writeStore("page-visibility", summaries);
  await syncPageVisibility(summaries);

  return summaries;
}
