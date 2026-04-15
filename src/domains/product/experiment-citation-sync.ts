/**
 * Post-import experiment sync — updates active experiments with current
 * citation counts, mention averages, and visibility from daily metric
 * snapshots. Appends a daily timeline entry for each experiment.
 */

import "server-only";

import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { readStore } from "@/lib/persistence/json-store";
import {
  getActiveExperiments,
  updateExperimentMetrics,
  persistExperiments,
} from "@/domains/product/experiment-store";

type DMS = {
  date: string;
  scope_type: string;
  scope_id: string;
  platform: string;
  mention_count: number;
  citation_count: number;
  visibility_score: number;
};

export async function runExperimentCitationSync(): Promise<{
  updated: number;
  total: number;
}> {
  // 1. Build citation map from citation evidence index (per page URL)
  const citMap = new Map<string, number>();
  if (citationEvidenceIndex) {
    for (const r of citationEvidenceIndex.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  // 2. Build topic metrics from daily-metric-snapshots (7-day trailing average)
  const snapshots = readStore<DMS>("daily-metric-snapshots");
  const topicMetrics = new Map<
    string,
    { mentions: number; visibility: number; platforms: Record<string, { citations: number; mentions: number }> }
  >();

  // Group by topic, take last 7 dates
  const byTopic = new Map<string, DMS[]>();
  for (const s of snapshots) {
    if (s.scope_type !== "topic") continue;
    const key = (s.scope_id || "").toLowerCase();
    if (!key) continue;
    const arr = byTopic.get(key) ?? [];
    arr.push(s);
    byTopic.set(key, arr);
  }

  for (const [topic, entries] of byTopic) {
    const dates = [...new Set(entries.map((e) => e.date))].sort().slice(-7);
    const recent = entries.filter((e) => dates.includes(e.date));
    const dayCount = Math.max(dates.length, 1);

    const mentions = Math.round(
      recent.reduce((a, s) => a + (s.mention_count || 0), 0) / dayCount,
    );
    const visibility = Math.round(
      (recent.reduce((a, s) => a + (s.visibility_score || 0), 0) / dayCount) * 10,
    ) / 10;

    // Per-platform breakdown
    const platforms: Record<string, { citations: number; mentions: number }> = {};
    const byPlatform = new Map<string, DMS[]>();
    for (const s of recent) {
      const arr = byPlatform.get(s.platform) ?? [];
      arr.push(s);
      byPlatform.set(s.platform, arr);
    }
    for (const [plat, pEntries] of byPlatform) {
      platforms[plat] = {
        citations: Math.round(pEntries.reduce((a, s) => a + (s.citation_count || 0), 0) / dayCount),
        mentions: Math.round(pEntries.reduce((a, s) => a + (s.mention_count || 0), 0) / dayCount),
      };
    }

    topicMetrics.set(topic, { mentions, visibility, platforms });
  }

  // 3. Update each active experiment
  const activeExperiments = getActiveExperiments();
  let changed = false;
  let updated = 0;

  for (const exp of activeExperiments) {
    // Citations from URL
    let currentCit = 0;
    if (exp.targetPageUrl) {
      const normUrl = exp.targetPageUrl.replace(/\/+$/, "").toLowerCase();
      currentCit = citMap.get(normUrl) ?? 0;
    }

    // Mentions + visibility from topic
    let currentMen = 0;
    let currentVis = 0;
    let platformBreakdown: Record<string, { citations: number; mentions: number }> | undefined;

    if (exp.trackedTopic) {
      const topicLower = exp.trackedTopic.toLowerCase();
      // Try exact match first, then partial
      let match = topicMetrics.get(topicLower);
      if (!match) {
        const firstWord = topicLower.split(/\s+/)[0];
        for (const [key, val] of topicMetrics) {
          if (key.includes(firstWord)) { match = val; break; }
        }
      }
      if (match) {
        currentMen = match.mentions;
        currentVis = match.visibility;
        platformBreakdown = match.platforms;
      }
    }

    // Only update if something changed
    const citChanged = currentCit !== (exp.latestCitations ?? exp.baselineCitations ?? -1);
    const menChanged = currentMen !== (exp.latestMentions ?? -1);
    const visChanged = currentVis !== (exp.latestVisibility ?? -1);

    if (citChanged || menChanged || visChanged) {
      updateExperimentMetrics(exp.id, {
        latestCitations: currentCit,
        latestMentions: currentMen,
        latestVisibility: currentVis,
        platformBreakdown,
      });
      changed = true;
      updated++;
    }
  }

  if (changed) {
    await persistExperiments();
  }

  return { updated, total: activeExperiments.length };
}
