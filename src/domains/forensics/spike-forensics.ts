/**
 * Spike Forensics — detect major metric spikes, build event windows,
 * cluster preceding changes, and produce directional attribution.
 *
 * Pure functions only. No side effects. No persistence. Testable in isolation.
 *
 * @deprecated (E1.8) New code should use `@/domains/visibility-events/engine`
 * instead. This module remains as a compatibility layer: detection math
 * (`detectSpikes`, `clusterChange`) and shared helpers are still used by the
 * new engine, but the legacy `analyzeSpike`, `attributeSpike`, and
 * `buildEventWindows` paths are retained only so existing tests and the
 * `/diagnostics/spikes` dev route keep compiling while the migration
 * finishes. Do not add new consumers of the legacy analyze path.
 */

import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type {
  Spike,
  SpikeMetric,
  SpikePlatform,
  WindowedChange,
  ChangeClusterLabel,
  ClusterBurst,
  ClusterAttribution,
  AttributionVerdict,
  PlatformInterpretation,
  SpikeForensics,
} from "./types";

// ---------------------------------------------------------------------------
// Constants — tuned for first-pass detection
// ---------------------------------------------------------------------------

const RELATIVE_THRESHOLD = 1.75; // day_value >= baseline * 1.75
const BASELINE_WINDOW_DAYS = 7;
const MIN_BASELINE_DAYS = 4;
const MERGE_GAP_DAYS = 3; // spikes within 3 days merge into one event

const ABSOLUTE_MIN: Record<SpikeMetric, number> = {
  citations: 3,
  mentions: 2,
  visibility: 10,
};

/** Emerging-signal floor when baseline is effectively zero. */
const EMERGING_ABSOLUTE_FLOOR: Record<SpikeMetric, number> = {
  citations: 3,
  mentions: 3,
  visibility: 20,
};

// ---------------------------------------------------------------------------
// Spike detection
// ---------------------------------------------------------------------------

type MetricGetter = (s: DailyMetricSnapshot) => number;

function metricGetter(metric: SpikeMetric): MetricGetter {
  switch (metric) {
    case "citations":
      return (s) => s.citation_count;
    case "mentions":
      return (s) => s.mention_count;
    case "visibility":
      return (s) => s.visibility_score ?? 0;
  }
}

function toSpikePlatform(raw: string): SpikePlatform | null {
  const normalized = raw.toLowerCase().replace(/[\s-]/g, "_");
  if (normalized.includes("chatgpt")) return "chatgpt";
  if (normalized.includes("google") || normalized === "google_aio" || normalized === "google_ai_overviews") return "google_aio";
  if (normalized.includes("perplexity")) return "perplexity";
  if (normalized === "all") return "all";
  return null;
}

/** Trailing 7-day median of values prior to `index` (exclusive). */
function trailingMedian(values: number[], index: number, windowSize: number): number | null {
  const start = Math.max(0, index - windowSize);
  const window = values.slice(start, index);
  if (window.length < MIN_BASELINE_DAYS) return null;
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Detect spike days within a single (scope, platform, metric) time series.
 * Returns contiguous spike day groups merged into Spike events.
 */
export function detectSpikes(opts: {
  snapshots: DailyMetricSnapshot[];
  metric: SpikeMetric;
}): Spike[] {
  const { snapshots, metric } = opts;
  if (snapshots.length < MIN_BASELINE_DAYS + 1) return [];

  // Group by scope + platform
  const groups = new Map<string, DailyMetricSnapshot[]>();
  for (const s of snapshots) {
    const platform = toSpikePlatform(s.platform);
    if (!platform) continue;
    const key = `${s.scope_id}::${platform}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  const allSpikes: Spike[] = [];
  const getValue = metricGetter(metric);
  const absMin = ABSOLUTE_MIN[metric];
  const emergingFloor = EMERGING_ABSOLUTE_FLOOR[metric];

  for (const [key, snaps] of groups) {
    snaps.sort((a, b) => a.date.localeCompare(b.date));
    const [scopeId, platformStr] = key.split("::");
    const platform = platformStr as SpikePlatform;

    // Daily aggregated values — sum across duplicate same-day entries
    const byDate = new Map<string, number>();
    for (const s of snaps) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + getValue(s));
    }
    const dates = [...byDate.keys()].sort();
    const values = dates.map((d) => byDate.get(d) ?? 0);

    if (values.length < MIN_BASELINE_DAYS + 1) continue;

    // Detect spike days
    const spikeDays: { date: string; value: number; baseline: number; isEmerging: boolean }[] = [];
    for (let i = MIN_BASELINE_DAYS; i < values.length; i++) {
      const baseline = trailingMedian(values, i, BASELINE_WINDOW_DAYS);
      if (baseline === null) continue;

      const value = values[i];
      const isEmerging = baseline < 0.5;

      let qualifies = false;
      if (isEmerging) {
        // Emerging: baseline is effectively zero → require hard absolute floor
        qualifies = value >= emergingFloor;
      } else {
        // Normal: relative + absolute
        const ratio = value / baseline;
        const absoluteDelta = value - baseline;
        const requiredAbsolute = Math.max(baseline * 0.5, absMin);
        qualifies = ratio >= RELATIVE_THRESHOLD && absoluteDelta >= requiredAbsolute;
      }

      if (!qualifies) continue;

      // Sustained check: max of next 2 days >= 0.4 * value
      const next1 = i + 1 < values.length ? values[i + 1] : 0;
      const next2 = i + 2 < values.length ? values[i + 2] : 0;
      const nextPeak = Math.max(next1, next2);
      // Single-day spike with full collapse = noise
      if (value > absMin * 2 && nextPeak < value * 0.4 && !isEmerging) continue;

      spikeDays.push({ date: dates[i], value, baseline, isEmerging });
    }

    // Merge spike days within MERGE_GAP_DAYS into single events
    if (spikeDays.length === 0) continue;
    let currentGroup: typeof spikeDays = [spikeDays[0]];
    const eventGroups: (typeof spikeDays)[] = [];

    for (let j = 1; j < spikeDays.length; j++) {
      const prevDate = currentGroup[currentGroup.length - 1].date;
      const daysBetween = daysBetweenIso(prevDate, spikeDays[j].date);
      if (daysBetween <= MERGE_GAP_DAYS) {
        currentGroup.push(spikeDays[j]);
      } else {
        eventGroups.push(currentGroup);
        currentGroup = [spikeDays[j]];
      }
    }
    eventGroups.push(currentGroup);

    // Convert each group to a Spike
    for (const group of eventGroups) {
      const peak = group.reduce((a, b) => (b.value > a.value ? b : a));
      const relativeRatio = peak.baseline > 0 ? peak.value / peak.baseline : Infinity;
      allSpikes.push({
        id: `spike-${scopeId}-${platform}-${metric}-${peak.date}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
        metric,
        platform,
        scopeId,
        startDate: group[0].date,
        peakDate: peak.date,
        peakValue: peak.value,
        baseline: peak.baseline,
        absoluteDelta: peak.value - peak.baseline,
        relativeRatio,
        dayCount: group.length,
        isEmerging: peak.isEmerging,
      });
    }
  }

  return allSpikes.sort((a, b) => b.peakDate.localeCompare(a.peakDate));
}

// ---------------------------------------------------------------------------
// Change clustering
// ---------------------------------------------------------------------------

/** Classify a changelog entry into a cluster family. */
export function clusterChange(change: ChangelogEntry): ChangeClusterLabel {
  const desc = change.change_description.toLowerCase();
  const signal = change.signal_type;

  // FAQ / Schema — highest-priority cluster (matches our Apr 10 ChatGPT case)
  if (
    signal === "faq" ||
    desc.includes("faqpage") ||
    desc.includes("faq schema") ||
    (signal === "technical" && (desc.includes("json-ld") || desc.includes("schema")) && desc.includes("faq"))
  ) {
    return "faq_schema";
  }

  // Page launch / major rebuild
  if (signal === "page" || desc.includes("created new") || desc.includes("rebuilt") || desc.includes("new page")) {
    return "page_launch";
  }

  // Technical / rendering / performance
  if (
    signal === "technical" &&
    (desc.includes("ssg") ||
      desc.includes("prerender") ||
      desc.includes("lcp") ||
      desc.includes("pagespeed") ||
      desc.includes("cls") ||
      desc.includes("render") ||
      desc.includes("performance") ||
      desc.includes("canonical") ||
      desc.includes("redirect") ||
      desc.includes("sitemap") ||
      desc.includes("robots"))
  ) {
    return "technical_rendering";
  }

  // Content structure — comparison tables, sections, H2s
  if (
    desc.includes("comparison table") ||
    desc.includes("comparison section") ||
    desc.includes("section") ||
    desc.includes("h2") ||
    desc.includes("cost") ||
    desc.includes("process") ||
    desc.includes("neighborhood") ||
    desc.includes("testimonial")
  ) {
    return "content_structure";
  }

  // Internal links
  if (desc.includes("internal link") || desc.includes("anchor")) {
    return "internal_links";
  }

  // Metadata
  if (signal === "technical" && (desc.includes("title tag") || desc.includes("meta description") || desc.includes("open graph") || desc.includes("og:"))) {
    return "metadata";
  }

  // Citations / listings (directories, GBP)
  if (signal === "citation" || desc.includes("directory") || desc.includes("google business profile") || desc.includes("yelp") || desc.includes("gbp")) {
    return "citations_listings";
  }

  // Reviews
  if (signal === "review" || desc.includes("review")) {
    return "reviews";
  }

  return "other";
}

// ---------------------------------------------------------------------------
// Event window construction
// ---------------------------------------------------------------------------

export function buildEventWindows(opts: {
  spike: Spike;
  changelog: ChangelogEntry[];
}): {
  oneDay: WindowedChange[];
  threeDays: WindowedChange[];
  sevenDays: WindowedChange[];
  fourteenDays: WindowedChange[];
} {
  const { spike, changelog } = opts;
  // Use calendar-day math: spike.startDate is YYYY-MM-DD, treat as noon UTC
  // for stable diff calculation.
  const spikeStartMs = new Date(`${spike.startDate}T12:00:00Z`).getTime();

  // Filter to changes that happened BEFORE spike start and within 14 days
  const relevant: WindowedChange[] = [];
  for (const c of changelog) {
    const changeMs = new Date(c.timestamp).getTime();
    if (Number.isNaN(changeMs)) continue;
    // Skip changes AFTER the spike start date (calendar day)
    const changeDayMs = Math.floor(changeMs / 86_400_000) * 86_400_000;
    const spikeDayMs = Math.floor(spikeStartMs / 86_400_000) * 86_400_000;
    if (changeDayMs >= spikeDayMs) continue;
    const daysBefore = Math.round((spikeDayMs - changeDayMs) / 86_400_000);
    if (daysBefore > 14) continue;

    relevant.push({
      changeId: c.id,
      timestamp: c.timestamp,
      daysBeforeSpike: daysBefore,
      cluster: clusterChange(c),
      signalType: c.signal_type,
      assetType: c.asset_type,
      url: c.url,
      description: c.change_description.slice(0, 200),
      topicTargeted: c.topic_targeted,
    });
  }

  relevant.sort((a, b) => a.daysBeforeSpike - b.daysBeforeSpike);

  const filterWindow = (maxDays: number) =>
    relevant.filter((r) => r.daysBeforeSpike <= maxDays);

  return {
    oneDay: filterWindow(1),
    threeDays: filterWindow(3),
    sevenDays: filterWindow(7),
    fourteenDays: filterWindow(14),
  };
}

// ---------------------------------------------------------------------------
// Cluster burst aggregation
// ---------------------------------------------------------------------------

export function aggregateClusterBursts(changes: WindowedChange[]): ClusterBurst[] {
  const byCluster = new Map<ChangeClusterLabel, WindowedChange[]>();
  for (const c of changes) {
    const arr = byCluster.get(c.cluster) ?? [];
    arr.push(c);
    byCluster.set(c.cluster, arr);
  }

  const bursts: ClusterBurst[] = [];
  for (const [cluster, list] of byCluster) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    bursts.push({
      cluster,
      changeCount: list.length,
      firstChange: list[0].timestamp,
      lastChange: list[list.length - 1].timestamp,
      sampleDescriptions: list.slice(0, 3).map((c) => c.description),
    });
  }

  return bursts.sort((a, b) => b.changeCount - a.changeCount);
}

// ---------------------------------------------------------------------------
// Attribution logic
// ---------------------------------------------------------------------------

/**
 * Given windowed changes, produce cluster attributions and an overall verdict.
 *
 * Rules (directional only, no causal claims):
 * - A cluster with 3+ changes in the 1-day or 3-day window → likely_primary_trigger
 * - A cluster with 2+ changes in the 7-day window → likely_amplifier
 * - A cluster with any change in the 14-day window only → weak_contributor
 *
 * - Verdict "isolated": exactly one cluster has likely_primary_trigger role
 * - Verdict "multi_trigger": 2+ clusters with likely_primary_trigger
 * - Verdict "snowball": no primary trigger, but amplifiers + weak contributors across wider windows
 * - Verdict "insufficient": <2 changes total in 14-day window
 */
export function attributeSpike(windows: {
  oneDay: WindowedChange[];
  threeDays: WindowedChange[];
  sevenDays: WindowedChange[];
  fourteenDays: WindowedChange[];
}): { attributions: ClusterAttribution[]; verdict: AttributionVerdict } {
  const { oneDay, threeDays, sevenDays, fourteenDays } = windows;

  if (fourteenDays.length < 2) {
    return { attributions: [], verdict: "insufficient" };
  }

  // Aggregate counts per cluster per window
  const countByCluster = (changes: WindowedChange[]) => {
    const m = new Map<ChangeClusterLabel, number>();
    for (const c of changes) m.set(c.cluster, (m.get(c.cluster) ?? 0) + 1);
    return m;
  };
  const counts1 = countByCluster(oneDay);
  const counts3 = countByCluster(threeDays);
  const counts7 = countByCluster(sevenDays);
  const counts14 = countByCluster(fourteenDays);

  const allClusters = new Set<ChangeClusterLabel>([
    ...counts14.keys(),
  ]);

  const attributions: ClusterAttribution[] = [];
  for (const cluster of allClusters) {
    const c1 = counts1.get(cluster) ?? 0;
    const c3 = counts3.get(cluster) ?? 0;
    const c7 = counts7.get(cluster) ?? 0;
    const c14 = counts14.get(cluster) ?? 0;

    // Primary: 3+ changes within 3-day window (or 2+ in 1-day)
    if (c1 >= 2 || c3 >= 3) {
      attributions.push({
        cluster,
        role: "likely_primary_trigger",
        changeCount: c14,
        primaryWindowDays: c1 >= 2 ? 1 : 3,
        rationale:
          c1 >= 2
            ? `${c1} changes in this cluster shipped within 1 day of spike start — tight temporal proximity`
            : `${c3} changes in this cluster shipped within 3 days of spike start — concentrated burst`,
      });
      continue;
    }

    // Amplifier: 2+ in 7-day window (and not already flagged primary)
    if (c7 >= 2) {
      attributions.push({
        cluster,
        role: "likely_amplifier",
        changeCount: c14,
        primaryWindowDays: 7,
        rationale: `${c7} changes in this cluster shipped within 7 days of spike start — plausibly amplified the effect`,
      });
      continue;
    }

    // Weak contributor: something in 14-day window
    if (c14 >= 1) {
      attributions.push({
        cluster,
        role: "weak_contributor",
        changeCount: c14,
        primaryWindowDays: 14,
        rationale: `${c14} change${c14 !== 1 ? "s" : ""} in the wider 14-day window — weak temporal link only`,
      });
    }
  }

  // Sort by role importance then count
  const roleOrder: Record<string, number> = {
    likely_primary_trigger: 0,
    likely_amplifier: 1,
    weak_contributor: 2,
  };
  attributions.sort(
    (a, b) =>
      roleOrder[a.role] - roleOrder[b.role] || b.changeCount - a.changeCount,
  );

  // Verdict classification
  const primaryCount = attributions.filter(
    (a) => a.role === "likely_primary_trigger",
  ).length;
  const amplifierCount = attributions.filter(
    (a) => a.role === "likely_amplifier",
  ).length;

  let verdict: AttributionVerdict;
  if (primaryCount === 1) {
    verdict = "isolated";
  } else if (primaryCount >= 2) {
    verdict = "multi_trigger";
  } else if (amplifierCount >= 1 || attributions.length >= 2) {
    verdict = "snowball";
  } else {
    verdict = "insufficient";
  }

  return { attributions, verdict };
}

// ---------------------------------------------------------------------------
// Platform interpretation
// ---------------------------------------------------------------------------

export function interpretPlatform(
  spike: Spike,
  verdict: AttributionVerdict,
): PlatformInterpretation {
  if (spike.platform === "google_aio") {
    // Google AIO spikes we've seen are compounding
    return verdict === "snowball" || verdict === "multi_trigger"
      ? "gradual_compounding"
      : "gradual_compounding";
  }
  if (spike.platform === "chatgpt") {
    // ChatGPT shows stepwise jumps from structural/schema changes
    return "stepwise_threshold";
  }
  if (spike.platform === "perplexity") {
    return "sparse_source";
  }
  return "mixed";
}

// ---------------------------------------------------------------------------
// Confidence tier
// ---------------------------------------------------------------------------

export function determineConfidence(
  spike: Spike,
  attributions: ClusterAttribution[],
  verdict: AttributionVerdict,
): "strong" | "moderate" | "weak" | "insufficient" {
  if (verdict === "insufficient") return "insufficient";
  if (spike.isEmerging) return "weak"; // baseline was zero — hard to interpret
  if (verdict === "isolated" && spike.relativeRatio >= 2.5) return "strong";
  if (verdict === "isolated" || verdict === "multi_trigger") return "moderate";
  return "weak";
}

// ---------------------------------------------------------------------------
// Explanation generation
// ---------------------------------------------------------------------------

function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return "from zero baseline";
  return `${Math.round((ratio - 1) * 100)}% above baseline`;
}

export function generateExplanation(
  spike: Spike,
  attributions: ClusterAttribution[],
  verdict: AttributionVerdict,
  interpretation: PlatformInterpretation,
): string {
  const metricLabel =
    spike.metric === "citations"
      ? "citation count"
      : spike.metric === "mentions"
        ? "mention count"
        : "visibility score";

  const platformLabel =
    spike.platform === "google_aio"
      ? "Google AI Overviews"
      : spike.platform === "chatgpt"
        ? "ChatGPT"
        : spike.platform === "perplexity"
          ? "Perplexity"
          : "all platforms";

  const magnitudePhrase = spike.isEmerging
    ? `emerging signal from a zero baseline (peak ${spike.peakValue.toFixed(1)})`
    : `${formatPct(spike.relativeRatio)} — peak ${spike.peakValue.toFixed(1)} vs baseline ${spike.baseline.toFixed(1)}`;

  const parts: string[] = [
    `${platformLabel} ${metricLabel} on "${spike.scopeId}" spiked on ${spike.peakDate}: ${magnitudePhrase}.`,
  ];

  if (verdict === "insufficient") {
    parts.push("Not enough changes in the 14-day window preceding the spike to form an attribution.");
    return parts.join(" ");
  }

  const primary = attributions.find((a) => a.role === "likely_primary_trigger");
  const amplifiers = attributions.filter((a) => a.role === "likely_amplifier");

  if (verdict === "isolated" && primary) {
    parts.push(
      `Pattern consistent with an isolated trigger: the "${primary.cluster}" cluster shipped ${primary.changeCount} changes in the closest window. Most likely trigger.`,
    );
  } else if (verdict === "multi_trigger") {
    const primaryClusters = attributions
      .filter((a) => a.role === "likely_primary_trigger")
      .map((a) => a.cluster);
    parts.push(
      `Pattern consistent with a multi-trigger event: ${primaryClusters.join(", ")} all shipped changes in the closest window. Effects may be interacting.`,
    );
  } else if (verdict === "snowball") {
    parts.push(
      `Pattern consistent with a cumulative / snowball effect: no single dominant trigger, but ${amplifiers.length} cluster(s) showed activity across the 7-day window. Likely a threshold crossed after accumulated improvements.`,
    );
  }

  // Platform interpretation add-on
  if (interpretation === "stepwise_threshold" && spike.platform === "chatgpt") {
    parts.push("ChatGPT spikes historically respond to schema + structural deployments with a step-function pattern — consistent with the observed jump.");
  } else if (interpretation === "gradual_compounding" && spike.platform === "google_aio") {
    parts.push("Google AI Overviews typically ramps gradually as content + schema signals compound.");
  } else if (interpretation === "sparse_source" && spike.platform === "perplexity") {
    parts.push("Perplexity signal is sparse and source-style — treat this spike as low-confidence regardless of cluster attribution.");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run full spike forensics for a single detected spike.
 * Returns a complete SpikeForensics object with windows, bursts, attributions, verdict, and explanation.
 */
export function analyzeSpike(opts: {
  spike: Spike;
  changelog: ChangelogEntry[];
}): SpikeForensics {
  const { spike, changelog } = opts;

  // Filter changelog by topic relevance if possible. The spike is scoped by
  // scope_id (e.g. topic). Include changes that either:
  //   - target the same topic (fuzzy match)
  //   - OR have no topic (infrastructure-wide changes affecting everything)
  const scopedChangelog = changelog.filter((c) => {
    if (!c.topic_targeted || c.topic_targeted.length === 0) return true; // infra
    const changeTopic = c.topic_targeted.toLowerCase();
    const spikeTopic = spike.scopeId.toLowerCase();
    return (
      changeTopic.includes(spikeTopic) ||
      spikeTopic.includes(changeTopic) ||
      overlapsKeywords(changeTopic, spikeTopic)
    );
  });

  const windows = buildEventWindows({ spike, changelog: scopedChangelog });

  const clusterBursts = [
    { windowDays: 1, clusters: aggregateClusterBursts(windows.oneDay) },
    { windowDays: 3, clusters: aggregateClusterBursts(windows.threeDays) },
    { windowDays: 7, clusters: aggregateClusterBursts(windows.sevenDays) },
    { windowDays: 14, clusters: aggregateClusterBursts(windows.fourteenDays) },
  ];

  const { attributions, verdict } = attributeSpike(windows);
  const interpretation = interpretPlatform(spike, verdict);
  const confidence = determineConfidence(spike, attributions, verdict);
  const explanation = generateExplanation(spike, attributions, verdict, interpretation);

  return {
    spike,
    windows,
    clusterBursts,
    attributions,
    verdict,
    interpretation,
    confidence,
    explanation,
  };
}

/** Keyword overlap fallback for fuzzy topic matching. */
export function overlapsKeywords(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/shield:\s*/g, "")
      .replace(/\(bay area\)/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));
  let overlap = 0;
  for (const w of setA) if (setB.has(w)) overlap++;
  return overlap >= 2;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetweenIso(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.abs(Math.floor(ms / 86_400_000));
}
