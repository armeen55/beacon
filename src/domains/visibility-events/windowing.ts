/**
 * Visibility Event Engine — event windowing with memory.ts integration (E1.3).
 *
 * This module owns the "which changes landed in the 1/3/7/14 days before an
 * event" primitive. It replaces the legacy `buildEventWindows` in
 * spike-forensics.ts.
 *
 * Reuse rules:
 *   - Cluster classification comes from the legacy `clusterChange` helper in
 *     spike-forensics.ts — do not duplicate that logic here.
 *   - Topic scoping comes from a local helper that mirrors the legacy
 *     overlapsKeywords semantics.
 *   - Memory insights (direction, per-change before/after metric data,
 *     data-quality gates) come from `computeAllChangeInsights` in memory.ts.
 *     When caller provides daily metric snapshots, we pipe them through
 *     memory.ts so the attribution stage can tell a candidate with real
 *     outcome evidence apart from one that only has raw timestamp proximity.
 *
 * Design notes:
 *   - memory.ts cannot be modified (plan rule), so we call its exported
 *     entry point and consume MemoryInsight objects.
 *   - memory.ts's `computeAllChangeInsights` skips changes that fail the
 *     data-quality gate (e.g., <5 days after the change, <3 observations per
 *     window). For spike attribution we DO still include those candidates —
 *     the insight map is additive context, not a gate.
 *   - The site-change filter (excluding off-site tooling like review pings)
 *     is applied here because memory.ts does not expose its isSiteChange
 *     helper. We mirror the same set of rules locally.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import {
  computeAllChangeInsights,
  type MemoryInsight,
} from "@/domains/attribution/memory";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { ChangePattern } from "@/domains/learning/change-patterns";
import { clusterChange } from "../forensics/spike-forensics";
import type {
  Spike,
  SpikePlatform,
  WindowedChange,
  ChangeQualityEvidence,
} from "./types";

// ---------------------------------------------------------------------------
// Site-change filter (local copy — memory.ts does not export this helper)
// ---------------------------------------------------------------------------
// Keep in sync with `isSiteChange` in memory.ts. The intent is the same:
// exclude off-site activity (reviews, directory citations) and tooling
// signals that are not real site edits.

const OFF_SITE_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  "review",
  "citation",
  "off_page_seo",
  "measurement",
]);

const TOOLING_URL_PATTERNS: readonly string[] = [
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
  if (OFF_SITE_SIGNAL_TYPES.has(change.signal_type)) return false;
  if (change.url?.startsWith("/")) return true;
  const urlLower = (change.url ?? "").toLowerCase();
  if (TOOLING_URL_PATTERNS.some((p) => urlLower.includes(p))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Topic scoping (local helper — mirrors legacy overlapsKeywords semantics)
// ---------------------------------------------------------------------------

function normalizeForOverlap(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/shield:\s*/g, "")
      .replace(/\(bay area\)/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function topicsOverlap(a: string, b: string): boolean {
  const setA = normalizeForOverlap(a);
  const setB = normalizeForOverlap(b);
  let overlap = 0;
  for (const w of setA) if (setB.has(w)) overlap += 1;
  return overlap >= 2;
}

function scopeChangelogToSpike(
  spike: Spike,
  changelog: ChangelogEntry[],
): ChangelogEntry[] {
  const spikeScope = spike.scopeId.toLowerCase();
  return changelog.filter((c) => {
    // Infrastructure / site-wide changes have no topic — always in scope.
    if (!c.topic_targeted || c.topic_targeted.length === 0) return true;
    const changeTopic = c.topic_targeted.toLowerCase();
    return (
      changeTopic.includes(spikeScope) ||
      spikeScope.includes(changeTopic) ||
      topicsOverlap(changeTopic, spikeScope)
    );
  });
}

// ---------------------------------------------------------------------------
// Window filtering — the replacement for legacy buildEventWindows
// ---------------------------------------------------------------------------

export type VisibilityEventWindows = {
  oneDay: WindowedChange[];
  threeDays: WindowedChange[];
  sevenDays: WindowedChange[];
  fourteenDays: WindowedChange[];
  /**
   * Map of changeId → ChangeQualityEvidence. Populated in priority order:
   *   1. From pre-materialized `change-outcomes.json` (E1.4) when outcomes
   *      are supplied. No recomputation cost.
   *   2. From live `computeAllChangeInsights` (E1.3) when snapshots are
   *      supplied but outcomes are not. Memory.ts gates apply.
   *   3. Empty when neither outcomes nor snapshots are supplied.
   *
   * Downstream uses this as a data-quality signal only — presence means
   * "we have enough metric context around this change to evaluate it."
   * Direction / delta fields are surfaced for future impact weighting.
   */
  qualityEvidence: Map<string, ChangeQualityEvidence>;
};

function msAtNoonUtc(dateYmd: string): number {
  return new Date(`${dateYmd}T12:00:00Z`).getTime();
}

function calendarDayMs(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

// ---------------------------------------------------------------------------
// E1.5 — learned engine-timing windows from change-patterns.ts
// ---------------------------------------------------------------------------
// `change-patterns.ts` stores per-pattern (signal_type × asset_type)
// engine_timing data with median/earliest/latest days to signal, broken
// out by platform. We use the learned `latest_days + tolerance` as an
// upper cap on the 14-day window: a change that lands beyond its
// pattern's historical latest window is unlikely to be the trigger for
// *this* spike even if it's within 14 calendar days.
//
// Guardrails:
//   - Only apply when the pattern has confidence >= medium (≥3 samples).
//   - Only apply when the pattern has engine_timing data for the spike's
//     platform (some patterns only track one platform's response).
//   - Tolerance of +2 days above latest_days absorbs minor observational
//     noise without blowing the filter open.
//   - Never tighter than the 1-day window (a learned window of 0 days
//     would exclude every change).
//
// When no pattern matches or the guardrails fail, we fall back to the
// hardcoded 14-day cap — the same as before E1.5.

const LEARNED_WINDOW_TOLERANCE_DAYS = 2;
const LEARNED_WINDOW_FLOOR = 1;

function spikePlatformToEngineKey(platform: SpikePlatform): string | null {
  // engine_timing rows use lowercase platform names matching
  // `daily_metric_snapshots.platform`. Beacon normalizes to these:
  //   "chatgpt", "google_aio", "perplexity".
  // `"all"` is an aggregate and has no learned row.
  if (platform === "all") return null;
  return platform;
}

function buildPatternLookup(
  patterns: ChangePattern[],
): Map<string, ChangePattern> {
  const m = new Map<string, ChangePattern>();
  for (const p of patterns) m.set(p.id, p);
  return m;
}

function learnedLatestDaysForChange(
  change: ChangelogEntry,
  platformKey: string,
  patternsById: Map<string, ChangePattern>,
): number | null {
  const pattern = patternsById.get(
    `${change.signal_type}::${change.asset_type}`,
  );
  if (!pattern) return null;
  if (pattern.confidence === "low") return null;
  const timing = pattern.engine_timing.find((t) => t.platform === platformKey);
  if (!timing) return null;
  if (timing.sample_count < 2) return null;
  return Math.max(
    LEARNED_WINDOW_FLOOR,
    timing.latest_days + LEARNED_WINDOW_TOLERANCE_DAYS,
  );
}

function outcomeToQualityEvidence(
  outcome: ChangeOutcome,
): ChangeQualityEvidence {
  return {
    changeId: outcome.change_id,
    source: "outcome",
    direction: outcome.direction,
    citationDeltaPct: outcome.citation_delta_pct,
    mentionDeltaPct: outcome.mention_delta_pct,
  };
}

function insightToQualityEvidence(
  insight: MemoryInsight,
): ChangeQualityEvidence {
  // MemoryInsight exposes before/after window metrics but not pre-computed
  // percentages. Derive them here to match the outcome shape.
  const before = insight.metricsBefore;
  const after = insight.metricsAfter;
  const citationDeltaPct =
    before.avgCitations > 0
      ? Math.round(
          ((after.avgCitations - before.avgCitations) / before.avgCitations) *
            1000,
        ) / 10
      : after.avgCitations > 0
        ? 100
        : 0;
  const mentionDeltaPct =
    before.avgMentions > 0
      ? Math.round(
          ((after.avgMentions - before.avgMentions) / before.avgMentions) *
            1000,
        ) / 10
      : after.avgMentions > 0
        ? 100
        : 0;
  return {
    changeId: insight.changeId,
    source: "insight",
    direction: insight.direction,
    citationDeltaPct,
    mentionDeltaPct,
  };
}

/**
 * Build 1/3/7/14 day visibility-event windows for a spike.
 *
 * Quality-evidence population order (highest-priority wins):
 *   1. `outcomes` (E1.4) — pre-materialized ChangeOutcome rows from
 *      change-outcomes.json. No recomputation.
 *   2. `snapshots` (E1.3 fallback) — live compute via
 *      `computeAllChangeInsights` from memory.ts.
 *   3. Neither supplied — empty qualityEvidence map.
 *
 * Temporal cap (E1.5): when `patterns` is supplied, per-change learned
 * engine_timing windows from change-patterns.ts replace the hardcoded
 * 14-day ceiling. A change with a matching pattern (confidence ≥ medium,
 * ≥2 samples on the spike's platform) is only kept when its
 * `daysBeforeSpike ≤ latest_days + tolerance`. Without a matching
 * pattern the fallback is the hardcoded 14-day cap.
 *
 * Scope filter: changes whose `topic_targeted` matches the spike's scope OR
 * changes with no topic (infrastructure / site-wide) are included. Off-site
 * activity and tooling signals are excluded via the site-change filter
 * (same rules as memory.ts `isSiteChange`).
 */
export function buildVisibilityEventWindows(opts: {
  spike: Spike;
  changelog: ChangelogEntry[];
  snapshots?: DailyMetricSnapshot[];
  outcomes?: ChangeOutcome[];
  /**
   * Learned change patterns from change-patterns.ts. When provided, the
   * engine uses per-pattern engine_timing to cap the temporal window for
   * each change, replacing the hardcoded 14-day cap when a pattern match
   * exists. Falls back to the hardcoded cap when a pattern is unavailable
   * or under-sampled.
   */
  patterns?: ChangePattern[];
}): VisibilityEventWindows {
  const { spike, changelog, snapshots, outcomes, patterns } = opts;

  // 1. Scope the changelog to the spike's topic (allow infra passthrough).
  const scopedChangelog = scopeChangelogToSpike(spike, changelog);

  // 2. Apply site-change filter (exclude off-site + tooling).
  const siteChangelog = scopedChangelog.filter(isSiteChange);

  // 3. Temporal filter — changes BEFORE spike start, within 14 days OR
  //    within each change's learned engine_timing window (E1.5).
  const spikeDayMs = calendarDayMs(msAtNoonUtc(spike.startDate));
  const platformKey = spikePlatformToEngineKey(spike.platform);
  const patternsById =
    patterns && patterns.length > 0 && platformKey !== null
      ? buildPatternLookup(patterns)
      : null;

  const relevant: WindowedChange[] = [];
  for (const c of siteChangelog) {
    const changeMs = new Date(c.timestamp).getTime();
    if (Number.isNaN(changeMs)) continue;
    const changeDayMs = calendarDayMs(changeMs);
    if (changeDayMs >= spikeDayMs) continue;
    const daysBefore = Math.round((spikeDayMs - changeDayMs) / 86_400_000);

    // Determine the upper window cap for this change. Learned pattern
    // wins when available; otherwise the hardcoded 14-day fallback.
    let maxDaysForChange = 14;
    if (patternsById && platformKey) {
      const learned = learnedLatestDaysForChange(c, platformKey, patternsById);
      if (learned !== null) {
        maxDaysForChange = learned;
      }
    }

    if (daysBefore > maxDaysForChange) continue;

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

  const filterWindow = (maxDays: number): WindowedChange[] =>
    relevant.filter((r) => r.daysBeforeSpike <= maxDays);

  // 4. Enrich with quality evidence — outcomes first (E1.4), then the
  //    live-compute fallback via memory.ts (E1.3).
  const qualityEvidence = new Map<string, ChangeQualityEvidence>();
  if (outcomes && outcomes.length > 0) {
    for (const outcome of outcomes) {
      qualityEvidence.set(
        outcome.change_id,
        outcomeToQualityEvidence(outcome),
      );
    }
  } else if (snapshots && snapshots.length > 0) {
    // Run memory.ts over the FULL unfiltered changelog so its scope
    // filters apply consistently with how change-outcomes.json is built.
    const allInsights = computeAllChangeInsights({
      changes: changelog,
      snapshots,
    });
    for (const insight of allInsights) {
      qualityEvidence.set(insight.changeId, insightToQualityEvidence(insight));
    }
  }

  return {
    oneDay: filterWindow(1),
    threeDays: filterWindow(3),
    sevenDays: filterWindow(7),
    fourteenDays: filterWindow(14),
    qualityEvidence,
  };
}
