/**
 * Visibility Event Engine — attribution via triage.ts reuse (E1.2).
 *
 * Replaces the count-based attributeSpike() in the legacy forensics module
 * with a pipeline that:
 *
 *   1. Synthesizes an Attribution (match-strength record) for each change in
 *      the spike's 14-day window, scoped to the spike context.
 *   2. Scores each candidate via `computeConfidenceScore` — the same
 *      primitive the main attribution engine uses, so scoring semantics
 *      stay consistent across Beacon.
 *   3. Passes the candidates through `triageCandidates` — the existing
 *      triage engine that classifies candidates into primary / contributing
 *      / needs_review / suppressed tiers.
 *   4. Aggregates the triaged output to the cluster level, mapping:
 *        triage.primary       → likely_primary_trigger
 *        triage.contributing  → likely_amplifier
 *        triage.needsReview   → weak_contributor
 *        triage.suppressed    → dropped (below noise)
 *   5. Applies a cluster-burst fallback for cases where triage is too
 *      conservative because of sparse topic data (common for infrastructure
 *      changes that lack an explicit topic_targeted). If ≥3 changes in the
 *      same cluster land within a 3-day window, that cluster is promoted
 *      to likely_primary_trigger even if no single change scored at the
 *      triage primary threshold.
 *
 * E1.6 will replace the cluster-level aggregation rules with full impact
 * weighting (clusterWeight × proximityWeight × coverageWeight). This file
 * stays the integration point for future mini-steps.
 *
 * Reuse rule: do NOT reimplement topic / platform / temporal matching logic
 * that already lives in compute.ts. Where our spike context cannot populate
 * a field (e.g. url, sourceCategory), leave it "unknown" so it contributes
 * zero to the score rather than being falsely "none".
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Attribution, MatchStrength } from "@/domains/attribution/types";
import type { CandidateResult } from "@/domains/attribution/candidates";
import { computeConfidenceScore } from "@/domains/attribution/compute";
import { triageCandidates } from "@/domains/attribution/triage";
import { GEO_CONTAINMENT } from "@/domains/attribution/config";
import type { ChangePattern } from "@/domains/learning/change-patterns";
import { buildPatternsById, computeClusterImpact } from "./impact";
import type {
  Spike,
  SpikePlatform,
  WindowedChange,
  ChangeClusterLabel,
  AttributionRole,
  AttributionVerdict,
  ImpactWeightedClusterAttribution,
  ChangeQualityEvidence,
} from "./types";

// ---------------------------------------------------------------------------
// Cluster → platform affinity
// ---------------------------------------------------------------------------
// The legacy `SIGNAL_PLATFORM_MAP` keys off signal_type, but the forensics
// clusterChange() rewrites many "technical" changes into `faq_schema`,
// `content_structure`, or `technical_rendering` clusters. Keying platform
// affinity off the *cluster* captures operator intuition directly.
//
// "strong"  = this cluster reliably moves the platform when shipped
// "partial" = secondary channel — contributes but is not the primary lever
// "unknown" = no documented relationship
// "none"    = documented anti-signal (cluster does not move this platform)

const CLUSTER_PLATFORM_AFFINITY: Record<
  ChangeClusterLabel,
  Partial<Record<Exclude<SpikePlatform, "all">, MatchStrength>>
> = {
  faq_schema: {
    chatgpt: "strong",
    google_aio: "strong",
    perplexity: "strong",
  },
  content_structure: {
    chatgpt: "strong",
    google_aio: "strong",
    perplexity: "partial",
  },
  technical_rendering: {
    chatgpt: "strong",
    google_aio: "strong",
    perplexity: "partial",
  },
  internal_links: {
    chatgpt: "partial",
    google_aio: "strong",
    perplexity: "partial",
  },
  page_launch: {
    chatgpt: "strong",
    google_aio: "strong",
    perplexity: "strong",
  },
  metadata: {
    chatgpt: "partial",
    google_aio: "strong",
    perplexity: "partial",
  },
  citations_listings: {
    chatgpt: "strong",
    google_aio: "partial",
    perplexity: "partial",
  },
  reviews: {
    chatgpt: "partial",
    google_aio: "partial",
    perplexity: "unknown",
  },
  other: {
    chatgpt: "unknown",
    google_aio: "unknown",
    perplexity: "unknown",
  },
};

function synthesizePlatformMatch(
  cluster: ChangeClusterLabel,
  spikePlatform: SpikePlatform,
): MatchStrength {
  if (spikePlatform === "all") return "partial";
  return CLUSTER_PLATFORM_AFFINITY[cluster]?.[spikePlatform] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Topic match — city-aware, keyword-overlap fallback
// ---------------------------------------------------------------------------
// Mirrors the logic in memory.ts / compute.ts but works directly on the
// spike's scopeId (which is a topic string from daily_metric_snapshots).

const ALL_CITIES: readonly string[] = Object.values(GEO_CONTAINMENT).flat();

function extractCity(topic: string): string | null {
  const lower = topic.toLowerCase();
  for (const city of ALL_CITIES) {
    if (lower.includes(city)) return city;
  }
  return null;
}

function synthesizeTopicMatch(
  changeTopic: string,
  spikeTopic: string,
): MatchStrength {
  if (!changeTopic.trim() || !spikeTopic.trim()) return "unknown";

  const cLower = changeTopic.toLowerCase().trim();
  const sLower = spikeTopic.toLowerCase().trim();

  if (cLower === sLower) return "strong";

  const changeCity = extractCity(changeTopic);
  const spikeCity = extractCity(spikeTopic);
  if (changeCity && spikeCity && changeCity === spikeCity) return "strong";
  if (spikeCity && cLower.includes(spikeCity)) return "strong";
  if (changeCity && sLower.includes(changeCity)) return "partial";

  // Jaccard-style word overlap
  const cWords = new Set(
    cLower
      .replace(/[():/\-,]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const sWords = new Set(
    sLower
      .replace(/[():/\-,]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (cWords.size === 0 || sWords.size === 0) return "unknown";
  const intersection = [...cWords].filter((w) => sWords.has(w)).length;
  const union = new Set([...cWords, ...sWords]).size;
  const jaccard = intersection / union;

  if (jaccard >= 0.5) return "strong";
  if (jaccard >= 0.3) return "partial";
  return "none";
}

// ---------------------------------------------------------------------------
// Temporal match — derived from the windowed change's daysBeforeSpike
// ---------------------------------------------------------------------------
// Mirrors compute.ts matchTemporal behavior for spike-context windows.
//   0-3 days  : strong  (tight temporal proximity)
//   4-14 days : partial (within extended window)
//   >14 days  : none    (outside the widest spike window)

function synthesizeTemporalMatch(daysBeforeSpike: number): MatchStrength {
  if (daysBeforeSpike < 0) return "none";
  if (daysBeforeSpike <= 3) return "strong";
  if (daysBeforeSpike <= 14) return "partial";
  return "none";
}

// ---------------------------------------------------------------------------
// Geo match — change's city_targeted vs spike's scope
// ---------------------------------------------------------------------------

function synthesizeGeoMatch(
  changeCity: string | null,
  spikeScope: string,
): MatchStrength {
  if (!changeCity) return "unknown";
  const cLower = changeCity.toLowerCase().trim();
  const sLower = spikeScope.toLowerCase();

  if (sLower.includes(cLower)) return "strong";

  for (const [metro, cities] of Object.entries(GEO_CONTAINMENT)) {
    if (cities.includes(cLower) && sLower.includes(metro)) return "partial";
    if (cLower === metro && cities.some((c) => sLower.includes(c))) {
      return "partial";
    }
  }

  return "none";
}

// ---------------------------------------------------------------------------
// Source-category match — derived from cluster "site-wideness"
// ---------------------------------------------------------------------------
// For spike context we don't have a direct source_category signal, but
// sitewide infrastructure changes (sitemap, SSG, FAQ schema rollout) hit
// every page — they're inherently relevant to any topic-scoped spike.
// Mark these as "partial" sourceCategory so the score isn't left at zero
// when topic data is sparse.

const SITEWIDE_CLUSTERS: ReadonlySet<ChangeClusterLabel> = new Set([
  "faq_schema",
  "technical_rendering",
  "page_launch",
]);

function synthesizeSourceCategoryMatch(
  cluster: ChangeClusterLabel,
): MatchStrength {
  return SITEWIDE_CLUSTERS.has(cluster) ? "partial" : "unknown";
}

// ---------------------------------------------------------------------------
// Full attribution synthesis
// ---------------------------------------------------------------------------

function synthesizeAttribution(
  change: ChangelogEntry,
  windowed: WindowedChange,
  spike: Spike,
): Attribution {
  const matches: Attribution["matches"] = {
    topic: synthesizeTopicMatch(change.topic_targeted, spike.scopeId),
    temporal: synthesizeTemporalMatch(windowed.daysBeforeSpike),
    platform: synthesizePlatformMatch(windowed.cluster, spike.platform),
    url: "unknown",
    geo: synthesizeGeoMatch(change.city_targeted, spike.scopeId),
    sourceCategory: synthesizeSourceCategoryMatch(windowed.cluster),
  };

  return {
    change_id: change.id,
    result_id: spike.id,
    role: "primary", // triage recomputes — this is a placeholder
    confidence: "medium", // triage recomputes
    matches,
    factor_scores: {},
    evidence_tier: null,
    temporal_distance_days: windowed.daysBeforeSpike,
    within_impact_window: windowed.daysBeforeSpike <= 14,
    explanation: `${windowed.cluster}: ${change.change_description.slice(0, 80)}`,
  };
}

// ---------------------------------------------------------------------------
// Build triage candidates
// ---------------------------------------------------------------------------

/**
 * Small quality-evidence boost applied when a candidate has quality evidence
 * from either the pre-materialized change-outcomes store (E1.4) or a live
 * memory.ts insight (E1.3). Changes with evidence have passed the data-
 * quality gate upstream (≥3 days before, ≥5 days after, ≥3 observations per
 * window), so they carry meaningfully more signal than a raw timestamp-
 * proximity hit.
 *
 * Keep the boost modest: 6 points is large enough to move a borderline
 * candidate across a triage tier but not large enough to flip an otherwise
 * weak candidate into primary. This is directional, not causal. The spike
 * itself is inside the insight's after-window, so we never use the direction
 * field as a causal proof — only presence.
 */
const QUALITY_EVIDENCE_BOOST = 6;

export function buildSpikeAttributionCandidates(opts: {
  windowedChanges: WindowedChange[];
  spike: Spike;
  changelogById: Map<string, ChangelogEntry>;
  qualityEvidence?: Map<string, ChangeQualityEvidence>;
}): CandidateResult[] {
  const { windowedChanges, spike, changelogById, qualityEvidence } = opts;

  const candidates: CandidateResult[] = [];
  for (const windowed of windowedChanges) {
    const change = changelogById.get(windowed.changeId);
    if (!change) continue;

    const attribution = synthesizeAttribution(change, windowed, spike);
    let score = computeConfidenceScore(attribution.matches);

    if (qualityEvidence?.has(windowed.changeId)) {
      score = Math.min(score + QUALITY_EVIDENCE_BOOST, 100);
    }

    candidates.push({ change, attribution, score });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Cluster-level aggregation
// ---------------------------------------------------------------------------

type ClusterAcc = {
  cluster: ChangeClusterLabel;
  role: AttributionRole;
  count: number;
  minDaysBefore: number;
  rationale: string;
};

const ROLE_RANK: Record<AttributionRole, number> = {
  likely_primary_trigger: 0,
  likely_amplifier: 1,
  weak_contributor: 2,
};

function pickWindowDays(minDaysBefore: number): number {
  if (minDaysBefore <= 1) return 1;
  if (minDaysBefore <= 3) return 3;
  if (minDaysBefore <= 7) return 7;
  return 14;
}

function upsertCluster(
  map: Map<ChangeClusterLabel, ClusterAcc>,
  cluster: ChangeClusterLabel,
  role: AttributionRole,
  windowed: WindowedChange,
  rationale: string,
): void {
  const existing = map.get(cluster);
  if (!existing) {
    map.set(cluster, {
      cluster,
      role,
      count: 1,
      minDaysBefore: windowed.daysBeforeSpike,
      rationale,
    });
    return;
  }
  existing.count += 1;
  existing.minDaysBefore = Math.min(
    existing.minDaysBefore,
    windowed.daysBeforeSpike,
  );
  // Upgrade the stored role if this change qualified for a stronger tier.
  if (ROLE_RANK[role] < ROLE_RANK[existing.role]) {
    existing.role = role;
    existing.rationale = rationale;
  }
}

// ---------------------------------------------------------------------------
// Cluster-burst fallback
// ---------------------------------------------------------------------------
// Triage is tuned for Result-based attribution with rich topic/URL data.
// For spike attribution, changes that share a cluster and land in a tight
// window are a strong directional signal *even when individual candidates
// score below the triage primary threshold* (e.g., infrastructure changes
// with empty topic_targeted). This fallback promotes any cluster that has
// ≥3 changes in the 3-day window OR ≥2 changes in the 1-day window.
//
// Count-based promotion stays bounded by directional language — the
// rationale still says "concentrated burst," not "caused."
//
// E1.6 will replace the count threshold with impact-weighted scoring.

function applyClusterBurstFallback(
  clusterMap: Map<ChangeClusterLabel, ClusterAcc>,
  windowedChanges: WindowedChange[],
): void {
  const oneDayByCluster = new Map<ChangeClusterLabel, WindowedChange[]>();
  const threeDayByCluster = new Map<ChangeClusterLabel, WindowedChange[]>();

  for (const w of windowedChanges) {
    if (w.daysBeforeSpike <= 1) {
      const arr = oneDayByCluster.get(w.cluster) ?? [];
      arr.push(w);
      oneDayByCluster.set(w.cluster, arr);
    }
    if (w.daysBeforeSpike <= 3) {
      const arr = threeDayByCluster.get(w.cluster) ?? [];
      arr.push(w);
      threeDayByCluster.set(w.cluster, arr);
    }
  }

  for (const [cluster, list] of oneDayByCluster) {
    if (list.length >= 2) {
      upsertCluster(
        clusterMap,
        cluster,
        "likely_primary_trigger",
        list[0],
        `${list.length} changes in this cluster shipped within 1 day of event start — tight temporal proximity`,
      );
    }
  }
  for (const [cluster, list] of threeDayByCluster) {
    if (list.length >= 3) {
      upsertCluster(
        clusterMap,
        cluster,
        "likely_primary_trigger",
        list[0],
        `${list.length} changes in this cluster shipped within 3 days of event start — concentrated burst`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Verdict classification
// ---------------------------------------------------------------------------

function deriveVerdict(
  windowedChanges: WindowedChange[],
  attributions: ImpactWeightedClusterAttribution[],
): AttributionVerdict {
  if (windowedChanges.length < 2) return "insufficient";

  const primary = attributions.filter(
    (a) => a.role === "likely_primary_trigger",
  );
  const amplifier = attributions.filter((a) => a.role === "likely_amplifier");

  if (primary.length >= 2) return "multi_trigger";
  if (primary.length === 1) {
    // Multi-trigger if a DIFFERENT cluster amplifier is present alongside
    // the primary — two distinct clusters acting together.
    if (
      amplifier.length >= 1 &&
      amplifier.some((a) => a.cluster !== primary[0].cluster)
    ) {
      return "multi_trigger";
    }
    return "isolated";
  }
  // No primary
  if (attributions.length >= 2 || amplifier.length >= 1) return "snowball";
  return "insufficient";
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Attribute a visibility event via triage-based candidate scoring.
 *
 * Returns impact-weighted cluster attributions + verdict. Impact scores
 * in this function are still count-based (clusterWeight/proximity/coverage
 * weights = 1) — E1.6 replaces them with the real composite.
 */
export function attributeEventViaTriage(opts: {
  windowedChanges: WindowedChange[];
  spike: Spike;
  changelogById: Map<string, ChangelogEntry>;
  qualityEvidence?: Map<string, ChangeQualityEvidence>;
  /**
   * Learned change patterns. When provided, impact scoring uses pattern
   * success_rate as the per-change cluster weight. Otherwise falls back
   * to the DEFAULT_CLUSTER_WEIGHTS table in impact.ts.
   */
  patterns?: ChangePattern[];
}): {
  attributions: ImpactWeightedClusterAttribution[];
  verdict: AttributionVerdict;
} {
  const {
    windowedChanges,
    spike,
    changelogById,
    qualityEvidence,
    patterns,
  } = opts;

  if (windowedChanges.length < 2) {
    return { attributions: [], verdict: "insufficient" };
  }

  // 1. Build triage candidates with synthesized attributions + scores.
  //    Quality-gated changes (those with outcomes or memory insights)
  //    get a modest score boost so the triage ranking prefers them
  //    when available.
  const candidates = buildSpikeAttributionCandidates({
    windowedChanges,
    spike,
    changelogById,
    qualityEvidence,
  });

  // 2. Pass through the shared triage engine.
  const triage = triageCandidates(candidates);

  // Build id → WindowedChange lookup for cluster aggregation.
  const windowedById = new Map<string, WindowedChange>();
  for (const w of windowedChanges) windowedById.set(w.changeId, w);

  // 3. Aggregate triage tiers to cluster level.
  const clusterMap = new Map<ChangeClusterLabel, ClusterAcc>();

  if (triage.primary) {
    const w = windowedById.get(triage.primary.change.id);
    if (w) {
      upsertCluster(
        clusterMap,
        w.cluster,
        "likely_primary_trigger",
        w,
        `Triage primary — ${triage.primary.triageReason}`,
      );
    }
  }

  for (const c of triage.contributing) {
    const w = windowedById.get(c.change.id);
    if (w) {
      upsertCluster(
        clusterMap,
        w.cluster,
        "likely_amplifier",
        w,
        `Secondary candidate — ${c.triageReason}`,
      );
    }
  }

  for (const c of triage.needsReview) {
    const w = windowedById.get(c.change.id);
    if (w) {
      upsertCluster(
        clusterMap,
        w.cluster,
        "weak_contributor",
        w,
        `Moderate signal — ${c.triageReason}`,
      );
    }
  }

  // 4. Cluster-burst fallback for tight bursts that triage scored conservatively.
  applyClusterBurstFallback(clusterMap, windowedChanges);

  // 5. Compute impact-weighted scores per cluster (E1.6). Each change
  //    contributes clusterWeight × proximityWeight × coverageWeight;
  //    sums roll up to a cluster-level impactScore with a breakdown of
  //    the average factors.
  const patternsById = buildPatternsById(patterns);
  const changesByCluster = new Map<ChangeClusterLabel, WindowedChange[]>();
  for (const w of windowedChanges) {
    const arr = changesByCluster.get(w.cluster) ?? [];
    arr.push(w);
    changesByCluster.set(w.cluster, arr);
  }

  const attributions: ImpactWeightedClusterAttribution[] = Array.from(
    clusterMap.values(),
  )
    .map((acc): ImpactWeightedClusterAttribution => {
      const clusterChanges = changesByCluster.get(acc.cluster) ?? [];
      const impact = computeClusterImpact({
        cluster: acc.cluster,
        changes: clusterChanges,
        patternsById,
      });
      return {
        cluster: acc.cluster,
        role: acc.role,
        changeCount: impact.breakdown.changeCount,
        primaryWindowDays: pickWindowDays(acc.minDaysBefore),
        impactScore: impact.score,
        impactBreakdown: impact.breakdown,
        rationale: acc.rationale,
      };
    })
    .sort((a, b) => {
      // Role wins; within same role, impact score wins; count is tiebreak.
      const roleDiff = ROLE_RANK[a.role] - ROLE_RANK[b.role];
      if (roleDiff !== 0) return roleDiff;
      if (a.impactScore !== b.impactScore) {
        return b.impactScore - a.impactScore;
      }
      return b.changeCount - a.changeCount;
    });

  const verdict = deriveVerdict(windowedChanges, attributions);

  return { attributions, verdict };
}
