/**
 * Attribution Memory — tracks change-to-observation deltas over time.
 *
 * For each confirmed change with a targeted topic, computes before/after
 * metrics from daily metric snapshots, producing human-readable insights
 * like "10 days ago you added FAQ to /kitchen-remodel — citations up 50%."
 *
 * Design: conservative — only shows insights when sufficient data exists.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryDirection = "improving" | "stable" | "declining";

export type MemoryInsight = {
  changeId: string;
  changeDescription: string;
  changeSummary: string;
  pageUrl: string | null;
  pagePath: string | null;
  topicTargeted: string;
  changedAt: string;
  daysSince: number;
  direction: MemoryDirection;
  /** Headline for display: "Your FAQ change on /page is working — mentions up 40%" */
  headline: string;
  /** Detailed explanation */
  detail: string;
  /** Before-window aggregate metrics */
  metricsBefore: WindowMetrics;
  /** After-window aggregate metrics */
  metricsAfter: WindowMetrics;
  /** Per-platform breakdown */
  platformBreakdown: PlatformDelta[];
  /** For sparkline visualization: daily mention counts with change marker */
  trendLine: TrendPoint[];
  /** Index of the change date in trendLine (for vertical marker) */
  changeIndex: number;
};

export type WindowMetrics = {
  avgMentions: number;
  avgCitations: number;
  avgVisibility: number;
  totalObservations: number;
};

export type PlatformDelta = {
  platform: string;
  mentionsBefore: number;
  mentionsAfter: number;
  citationsBefore: number;
  citationsAfter: number;
  direction: MemoryDirection;
};

export type TrendPoint = {
  date: string;
  mentions: number;
  citations: number;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MIN_BEFORE_DAYS = 3;
const MIN_AFTER_DAYS = 5;
const MIN_OBSERVATIONS_PER_WINDOW = 3;
const BEFORE_WINDOW_DAYS = 7;
const IMPROVING_THRESHOLD = 0.15; // 15% improvement = "improving"
const DECLINING_THRESHOLD = -0.15; // 15% decline = "declining"

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export function computeMemoryInsights(opts: {
  changes: ChangelogEntry[];
  snapshots: DailyMetricSnapshot[];
  now?: Date;
}): MemoryInsight[] {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const insights: MemoryInsight[] = [];

  // Filter to real site changes only — exclude off-site, tooling, reviews, citations
  const actionableChanges = opts.changes.filter(
    (c) =>
      c.topic_targeted &&
      c.topic_targeted.length > 0 &&
      isSiteChange(c),
  );

  // Build topic→snapshots index for fast lookups
  const topicSnapshots = buildTopicSnapshotIndex(opts.snapshots);

  for (const change of actionableChanges) {
    const changeDate = change.timestamp.slice(0, 10);
    const daysSince = daysBetween(changeDate, today);

    // Need enough time for before AND after windows
    if (daysSince < MIN_AFTER_DAYS) continue;

    // Find matching topic snapshots
    const topicKey = normalizeTopicKey(change.topic_targeted);
    const matchingSnapshots = topicSnapshots.get(topicKey);

    if (!matchingSnapshots || matchingSnapshots.length === 0) {
      // Try fuzzy match — topic names may differ slightly
      const fuzzyKey = findFuzzyTopicMatch(topicKey, topicSnapshots);
      if (!fuzzyKey) continue;
      const fuzzySnapshots = topicSnapshots.get(fuzzyKey);
      if (!fuzzySnapshots || fuzzySnapshots.length === 0) continue;
      // Use fuzzy match
      const insight = computeInsightForChange(
        change,
        fuzzySnapshots,
        changeDate,
        daysSince,
      );
      if (insight) insights.push(insight);
    } else {
      const insight = computeInsightForChange(
        change,
        matchingSnapshots,
        changeDate,
        daysSince,
      );
      if (insight) insights.push(insight);
    }
  }

  // Sort by impact magnitude (most interesting first)
  insights.sort((a, b) => {
    // Improving first, then declining, then stable
    const dirOrder = { improving: 0, declining: 1, stable: 2 };
    const dirDiff = dirOrder[a.direction] - dirOrder[b.direction];
    if (dirDiff !== 0) return dirDiff;
    // Then by days since (most recent first)
    return a.daysSince - b.daysSince;
  });

  // Deduplicate — if multiple changes target the same topic, keep the most recent
  const seenTopics = new Set<string>();
  const deduped: MemoryInsight[] = [];
  for (const insight of insights) {
    if (!seenTopics.has(insight.topicTargeted.toLowerCase())) {
      seenTopics.add(insight.topicTargeted.toLowerCase());
      deduped.push(insight);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Per-change insight computation
// ---------------------------------------------------------------------------

function computeInsightForChange(
  change: ChangelogEntry,
  snapshots: DailyMetricSnapshot[],
  changeDate: string,
  daysSince: number,
): MemoryInsight | null {
  // Split snapshots into before/after windows
  const beforeStart = addDays(changeDate, -BEFORE_WINDOW_DAYS);
  const beforeEnd = addDays(changeDate, -1); // Day before change

  const beforeSnaps = snapshots.filter(
    (s) => s.date >= beforeStart && s.date <= beforeEnd,
  );
  const afterSnaps = snapshots.filter((s) => s.date > changeDate);

  // Check minimum data requirements
  const beforeDays = new Set(beforeSnaps.map((s) => s.date)).size;
  const afterDays = new Set(afterSnaps.map((s) => s.date)).size;

  if (beforeDays < MIN_BEFORE_DAYS || afterDays < MIN_AFTER_DAYS) return null;
  if (
    beforeSnaps.length < MIN_OBSERVATIONS_PER_WINDOW ||
    afterSnaps.length < MIN_OBSERVATIONS_PER_WINDOW
  )
    return null;

  const metricsBefore = aggregateWindow(beforeSnaps);
  const metricsAfter = aggregateWindow(afterSnaps);

  // Compute direction from mention rate change
  const mentionDelta =
    metricsBefore.avgMentions > 0
      ? (metricsAfter.avgMentions - metricsBefore.avgMentions) /
        metricsBefore.avgMentions
      : metricsAfter.avgMentions > 0
        ? 1.0
        : 0;

  const citationDelta =
    metricsBefore.avgCitations > 0
      ? (metricsAfter.avgCitations - metricsBefore.avgCitations) /
        metricsBefore.avgCitations
      : metricsAfter.avgCitations > 0
        ? 1.0
        : 0;

  // Use the more meaningful signal (whichever has more data)
  const primaryDelta =
    metricsBefore.avgCitations > 0 || metricsAfter.avgCitations > 0
      ? citationDelta
      : mentionDelta;

  const direction: MemoryDirection =
    primaryDelta >= IMPROVING_THRESHOLD
      ? "improving"
      : primaryDelta <= DECLINING_THRESHOLD
        ? "declining"
        : "stable";

  // Platform breakdown
  const platformBreakdown = computePlatformBreakdown(
    beforeSnaps,
    afterSnaps,
  );

  // Build trend line (full date range)
  const allDates = [
    ...new Set(snapshots.map((s) => s.date)),
  ].sort();
  const trendLine = buildTrendLine(snapshots, allDates);
  const changeIndex = allDates.findIndex((d) => d >= changeDate);

  // Generate headline and detail
  const pagePath = change.url?.startsWith("/") ? change.url : null;
  const displayPath = pagePath ?? change.topic_targeted;
  const headline = generateHeadline(
    change,
    displayPath,
    direction,
    mentionDelta,
    citationDelta,
    daysSince,
    metricsBefore,
    metricsAfter,
  );
  const detail = generateDetail(
    change,
    metricsBefore,
    metricsAfter,
    platformBreakdown,
    daysSince,
  );

  return {
    changeId: change.id,
    changeDescription: change.change_description,
    changeSummary: `${change.signal_type}: ${change.asset_name}`,
    pageUrl: change.url,
    pagePath,
    topicTargeted: change.topic_targeted,
    changedAt: change.timestamp,
    daysSince,
    direction,
    headline,
    detail,
    metricsBefore,
    metricsAfter,
    platformBreakdown,
    trendLine,
    changeIndex: changeIndex >= 0 ? changeIndex : 0,
  };
}

// ---------------------------------------------------------------------------
// Headline and detail generation
// ---------------------------------------------------------------------------

function generateHeadline(
  change: ChangelogEntry,
  displayPath: string,
  direction: MemoryDirection,
  mentionDelta: number,
  citationDelta: number,
  daysSince: number,
  metricsBefore: WindowMetrics,
  metricsAfter: WindowMetrics,
): string {
  const primaryDelta = citationDelta !== 0 ? citationDelta : mentionDelta;
  const pct = Math.round(Math.abs(primaryDelta) * 100);
  const metric = citationDelta !== 0 ? "citations" : "mentions";
  const timeAgo =
    daysSince === 1
      ? "Yesterday"
      : `${daysSince} days ago`;

  // For very low baselines (<3/day), show absolute values instead of
  // misleading percentages (e.g. "509%" from 1.6 → 9.5/day)
  const baseline = citationDelta !== 0 ? metricsBefore.avgCitations : metricsBefore.avgMentions;
  const current = citationDelta !== 0 ? metricsAfter.avgCitations : metricsAfter.avgMentions;
  const useAbsolute = baseline < 3 && pct > 100;

  switch (direction) {
    case "improving":
      if (useAbsolute) {
        return `${timeAgo} you updated ${displayPath} — ${metric} up from ${fmtAvg(baseline)} to ${fmtAvg(current)}/day`;
      }
      return `${timeAgo} you updated ${displayPath} — ${metric} up ${pct}%`;
    case "declining":
      if (useAbsolute) {
        return `${timeAgo} you updated ${displayPath} — ${metric} down from ${fmtAvg(baseline)} to ${fmtAvg(current)}/day, worth investigating`;
      }
      return `${timeAgo} you updated ${displayPath} — ${metric} down ${pct}%, worth investigating`;
    case "stable":
      return `${timeAgo} you updated ${displayPath} — visibility holding steady`;
  }
}

function generateDetail(
  change: ChangelogEntry,
  before: WindowMetrics,
  after: WindowMetrics,
  platforms: PlatformDelta[],
  daysSince: number,
): string {
  const parts: string[] = [];

  parts.push(
    `Change: ${change.change_description.slice(0, 100)}${change.change_description.length > 100 ? "…" : ""}`,
  );

  if (before.avgMentions > 0 || after.avgMentions > 0) {
    parts.push(
      `Mentions: ${fmtAvg(before.avgMentions)}/day → ${fmtAvg(after.avgMentions)}/day`,
    );
  }

  if (before.avgCitations > 0 || after.avgCitations > 0) {
    parts.push(
      `Citations: ${fmtAvg(before.avgCitations)}/day → ${fmtAvg(after.avgCitations)}/day`,
    );
  }

  // Platform highlights — only show platforms with movement
  const movers = platforms.filter((p) => p.direction !== "stable");
  if (movers.length > 0) {
    const platformNotes = movers.map((p) => {
      const emoji = p.direction === "improving" ? "↑" : "↓";
      return `${p.platform} ${emoji}`;
    });
    parts.push(`Platform trends: ${platformNotes.join(", ")}`);
  }

  if (daysSince < 10) {
    parts.push("Still early — continue monitoring for a full 2-week signal.");
  }

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function aggregateWindow(snapshots: DailyMetricSnapshot[]): WindowMetrics {
  if (snapshots.length === 0) {
    return { avgMentions: 0, avgCitations: 0, avgVisibility: 0, totalObservations: 0 };
  }

  // Aggregate per-day first (sum across platforms), then average across days
  const byDate = new Map<string, { mentions: number; citations: number; visibility: number }>();
  for (const s of snapshots) {
    const existing = byDate.get(s.date) ?? { mentions: 0, citations: 0, visibility: 0 };
    existing.mentions += s.mention_count;
    existing.citations += s.citation_count;
    existing.visibility += s.visibility_score ?? 0;
    byDate.set(s.date, existing);
  }

  const days = [...byDate.values()];
  const n = days.length;

  return {
    avgMentions: days.reduce((a, d) => a + d.mentions, 0) / n,
    avgCitations: days.reduce((a, d) => a + d.citations, 0) / n,
    avgVisibility: days.reduce((a, d) => a + d.visibility, 0) / n,
    totalObservations: snapshots.length,
  };
}

function computePlatformBreakdown(
  beforeSnaps: DailyMetricSnapshot[],
  afterSnaps: DailyMetricSnapshot[],
): PlatformDelta[] {
  const platforms = new Set([
    ...beforeSnaps.map((s) => s.platform),
    ...afterSnaps.map((s) => s.platform),
  ]);

  const results: PlatformDelta[] = [];

  for (const platform of platforms) {
    const before = beforeSnaps.filter((s) => s.platform === platform);
    const after = afterSnaps.filter((s) => s.platform === platform);

    const beforeDays = new Set(before.map((s) => s.date)).size || 1;
    const afterDays = new Set(after.map((s) => s.date)).size || 1;

    const mentionsBefore =
      before.reduce((a, s) => a + s.mention_count, 0) / beforeDays;
    const mentionsAfter =
      after.reduce((a, s) => a + s.mention_count, 0) / afterDays;
    const citationsBefore =
      before.reduce((a, s) => a + s.citation_count, 0) / beforeDays;
    const citationsAfter =
      after.reduce((a, s) => a + s.citation_count, 0) / afterDays;

    const primaryBefore = citationsBefore > 0 ? citationsBefore : mentionsBefore;
    const primaryAfter = citationsAfter > 0 ? citationsAfter : mentionsAfter;
    const delta =
      primaryBefore > 0
        ? (primaryAfter - primaryBefore) / primaryBefore
        : primaryAfter > 0
          ? 1.0
          : 0;

    const direction: MemoryDirection =
      delta >= IMPROVING_THRESHOLD
        ? "improving"
        : delta <= DECLINING_THRESHOLD
          ? "declining"
          : "stable";

    results.push({
      platform,
      mentionsBefore,
      mentionsAfter,
      citationsBefore,
      citationsAfter,
      direction,
    });
  }

  return results;
}

function buildTrendLine(
  snapshots: DailyMetricSnapshot[],
  dates: string[],
): TrendPoint[] {
  const byDate = new Map<string, { mentions: number; citations: number }>();
  for (const s of snapshots) {
    const existing = byDate.get(s.date) ?? { mentions: 0, citations: 0 };
    existing.mentions += s.mention_count;
    existing.citations += s.citation_count;
    byDate.set(s.date, existing);
  }

  return dates.map((d) => ({
    date: d,
    mentions: byDate.get(d)?.mentions ?? 0,
    citations: byDate.get(d)?.citations ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Topic matching
// ---------------------------------------------------------------------------

function buildTopicSnapshotIndex(
  snapshots: DailyMetricSnapshot[],
): Map<string, DailyMetricSnapshot[]> {
  const index = new Map<string, DailyMetricSnapshot[]>();
  for (const s of snapshots) {
    if (s.scope_type !== "topic") continue;
    const key = normalizeTopicKey(s.scope_id);
    const existing = index.get(key) ?? [];
    existing.push(s);
    index.set(key, existing);
  }
  return index;
}

function normalizeTopicKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\s*\(bay area\)\s*/gi, "")
    .replace(/shield:\s*/gi, "")
    .trim();
}

function findFuzzyTopicMatch(
  target: string,
  index: Map<string, DailyMetricSnapshot[]>,
): string | null {
  // Try to find a topic that contains the target or vice versa
  const targetWords = target.split(/\s+/).filter((w) => w.length > 2);

  for (const key of index.keys()) {
    const keyWords = key.split(/\s+/).filter((w) => w.length > 2);

    // Check if most target words are in the key
    const overlap = targetWords.filter((w) => keyWords.includes(w));
    if (overlap.length >= Math.ceil(targetWords.length * 0.6)) {
      return key;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00Z");
  const b = new Date(dateB + "T00:00:00Z");
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtAvg(n: number): string {
  if (n === 0) return "0";
  if (n >= 10) return Math.round(n).toString();
  return n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Site change filter — only real website changes, not off-site or tooling
// ---------------------------------------------------------------------------

/** Signal types that represent off-site activity, not site changes */
const OFF_SITE_SIGNAL_TYPES = new Set([
  "review",
  "citation",
  "off_page_seo",
  "measurement",
]);

/** URL patterns that indicate tooling/platform, not a site page */
const TOOLING_URL_PATTERNS = [
  "profound",
  "google business profile",
  "yelp",
  "houzz",
  "buildzoom",
  "facebook",
  "bing places",
  "bing webmaster",
  "linkedin",
  "instagram",
  "nextdoor",
  "bbb",
];

function isSiteChange(change: ChangelogEntry): boolean {
  // Exclude off-site signal types
  if (OFF_SITE_SIGNAL_TYPES.has(change.signal_type)) return false;

  // If URL is a page path, it's a site change
  if (change.url?.startsWith("/")) return true;

  // Check for known tooling/platform URLs
  const urlLower = (change.url ?? "").toLowerCase();
  if (TOOLING_URL_PATTERNS.some((p) => urlLower.includes(p))) return false;

  // Generic site-wide changes (e.g. "All Pages", "Sitewide navigation",
  // "Homepage + Bay Area pages") — these are real site changes
  // with non-path URLs. Include them.
  return true;
}
