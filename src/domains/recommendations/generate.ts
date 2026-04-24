/**
 * Recommendation candidate generator for Phase v6 Commit 1 (2026-04-24).
 *
 * Pure function. Takes a Phase-v5 DecisionMatrix + the active tracked
 * entity list and emits an unranked list of RecommendationCandidate[].
 * Commit 2 will sort these into a prioritized queue (Create / Strengthen
 * / Target) + a separate Watchlist (Watch).
 *
 * Design rules:
 *   - Cluster-level recs preferred (one rec per weakness cluster).
 *   - Single-prompt recs only when the prompt does NOT participate in
 *     any weakness cluster (prevents one prompt from generating three
 *     overlapping recs).
 *   - Stable keys so operator decisions persist across renders even as
 *     underlying data shifts slightly.
 *   - Watch applies only to winning CLUSTERS (≥3 winning prompts sharing
 *     a geo or topic). Single winning prompts don't generate Watch recs —
 *     it would drown the list.
 *   - No speculation about outcomes or uplift — evidence is counted,
 *     not extrapolated.
 */

import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { DecisionMatrix } from "@/domains/prompts/decision-matrix";
import type {
  PromptOpportunity,
  PromptOpportunityCategory,
} from "@/domains/prompts/opportunity-classify";

/** Action taxonomy for v1. Five types; four participate in the ranked
 *  work queue, one (watch_winning_cluster) routes to the Watchlist. */
export type RecommendationType =
  | "create_cluster_page"
  | "create_single"
  | "target_competitors"
  | "strengthen_page_copy"
  | "watch_winning_cluster";

/** Severity tiers inherited from the v5 classifier categories. */
export type RecommendationSeverity = "high" | "medium" | "low";

/** Rule-based effort hint. No estimation math; maps directly from type. */
export type RecommendationEffort = "low" | "medium" | "high";

/** Evidence aggregated across the affected prompts. No extrapolation. */
export type RecommendationEvidence = {
  promptCount: number;
  observationCount: number;
  /** Counts by v5 category (absent/outranked/close/winning/early). */
  categoryBreakdown: Partial<Record<PromptOpportunityCategory, number>>;
  /** Top 3 dominant competitors aggregated from affected prompts. */
  dominantCompetitors: string[];
  /** Descriptors AI used near the brand (only populated for Strengthen
   *  where Ritz is cited). */
  descriptorsNearBrand: string[];
  /** Highest signalStrength from the affected prompt set (for ranking). */
  maxSignalStrength: number;
};

export type RecommendationCandidate = {
  /** Stable identity for decision persistence. Survives small data shifts. */
  stableKey: string;
  type: RecommendationType;
  /** Short imperative phrase. */
  title: string;
  /** 1-2 sentence operator-facing "what this is" sentence. */
  description: string;
  /** Which prompt_ids this recommendation affects. */
  affectedPromptIds: string[];
  /** Cluster label (geo or topic) when applicable, else null. */
  clusterLabel: string | null;
  clusterKind: "geo" | "topic" | null;
  evidence: RecommendationEvidence;
  severity: RecommendationSeverity;
  effort: RecommendationEffort;
};

export type GenerateRecommendationsArgs = {
  matrix: DecisionMatrix;
  activeEntities: ReadonlyArray<TrackedEntity>;
  /** Required — provides prompt text for row titles. Passed as a
   *  ReadonlyArray to match v5 aggregator signatures. */
  trackedPrompts: ReadonlyArray<TrackedPrompt>;
};

// Effort hints are fixed per type. No scoring function; just a hint.
const EFFORT_BY_TYPE: Record<RecommendationType, RecommendationEffort> = {
  create_cluster_page: "medium",
  create_single: "medium",
  target_competitors: "medium",
  strengthen_page_copy: "low",
  watch_winning_cluster: "low",
};

/** v5 category → severity mapping. */
function severityForCategory(
  category: PromptOpportunityCategory,
): RecommendationSeverity {
  if (category === "outranked") return "high";
  if (category === "absent") return "medium";
  if (category === "close") return "medium";
  return "low"; // winning / early
}

/** Aggregate severity when many prompts are involved — worst wins. */
function aggregateSeverity(
  categories: PromptOpportunityCategory[],
): RecommendationSeverity {
  if (categories.includes("outranked")) return "high";
  if (categories.includes("absent")) return "medium";
  if (categories.includes("close")) return "medium";
  return "low";
}

export function generateRecommendations(
  args: GenerateRecommendationsArgs,
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];
  const promptById = new Map(
    args.matrix.prompts.map((p) => [p.prompt_id, p]),
  );
  const promptTextById = new Map(
    args.trackedPrompts.map((p) => [p.id, p.text]),
  );
  const ownedNames = new Set(
    args.activeEntities
      .filter((e) => e.is_owned)
      .map((e) => e.name)
      .filter((n): n is string => Boolean(n)),
  );

  // Track which prompts get covered by cluster-level recs so we don't
  // double-emit single-prompt recs for them.
  const clusteredPromptIds = new Set<string>();

  // -----------------------------------------------------------------
  // 1) Weakness clusters → Create_cluster_page recs.
  //    (v5 already filtered clusters to weakness categories only, but
  //    we re-filter here to be explicit + safe against future changes.)
  // -----------------------------------------------------------------
  for (const cluster of args.matrix.clusters) {
    const isWeakness =
      cluster.categories.includes("absent") ||
      cluster.categories.includes("outranked");
    if (!isWeakness) continue;

    const affectedOpportunities = cluster.promptIds
      .map((id) => promptById.get(id))
      .filter((p): p is PromptOpportunity => Boolean(p));
    if (affectedOpportunities.length === 0) continue;

    for (const pid of cluster.promptIds) clusteredPromptIds.add(pid);

    const categoryBreakdown = tallyCategories(affectedOpportunities);
    const observationCount = affectedOpportunities.reduce(
      (sum, o) => sum + o.evidence.observationCount,
      0,
    );
    const dominantCompetitors = aggregateCompetitors(
      affectedOpportunities,
      ownedNames,
    );
    const maxSignalStrength = Math.max(
      ...affectedOpportunities.map((o) => o.signalStrength),
    );
    const severity = aggregateSeverity(
      affectedOpportunities.map((o) => o.category),
    );

    candidates.push({
      stableKey: `create_cluster_page:${cluster.type}:${cluster.label}`,
      type: "create_cluster_page",
      title: `Create a ${cluster.label} page`,
      description: `${affectedOpportunities.length} prompts in the ${cluster.type === "geo" ? "geo" : "topic"} cluster "${cluster.label}" are ${describeCategoryMix(categoryBreakdown)}. A focused page targeting this cluster would address all of them in one move.`,
      affectedPromptIds: [...cluster.promptIds],
      clusterLabel: cluster.label,
      clusterKind: cluster.type,
      evidence: {
        promptCount: affectedOpportunities.length,
        observationCount,
        categoryBreakdown,
        dominantCompetitors,
        descriptorsNearBrand: [],
        maxSignalStrength,
      },
      severity,
      effort: EFFORT_BY_TYPE.create_cluster_page,
    });
  }

  // -----------------------------------------------------------------
  // 2) Single-prompt recs for prompts NOT in any weakness cluster.
  //    - Outranked → target_competitors
  //    - Absent    → create_single
  //    - Close     → strengthen_page_copy  (always per-prompt; page
  //                  mapping is tenant-specific and not modeled yet)
  // -----------------------------------------------------------------
  for (const opp of args.matrix.prompts) {
    if (clusteredPromptIds.has(opp.prompt_id)) {
      // Close prompts inside a weakness cluster still deserve their own
      // Strengthen rec because the action is different (copy tweak vs
      // page creation). Others skip.
      if (opp.category !== "close") continue;
    }

    const prompt = promptById.get(opp.prompt_id);
    if (!prompt) continue;

    const observationCount = opp.evidence.observationCount;
    const dominantCompetitors = opp.evidence.dominantCompetitors.slice(0, 3);
    const descriptorsNearBrand = opp.evidence.topDescriptors.slice(0, 6);

    if (opp.category === "outranked") {
      candidates.push({
        stableKey: `target_competitors:prompt:${opp.prompt_id}`,
        type: "target_competitors",
        title: `Target "${truncate(promptTextById.get(opp.prompt_id) ?? opp.prompt_id, 60)}"`,
        description: `You're absent on this prompt and ${dominantCompetitors.length} competitor${dominantCompetitors.length === 1 ? " dominates" : "s dominate"} (${dominantCompetitors.slice(0, 3).join(", ")}). Focused competitive content targeting this exact query.`,
        affectedPromptIds: [opp.prompt_id],
        clusterLabel: null,
        clusterKind: null,
        evidence: {
          promptCount: 1,
          observationCount,
          categoryBreakdown: { outranked: 1 },
          dominantCompetitors,
          descriptorsNearBrand: [],
          maxSignalStrength: opp.signalStrength,
        },
        severity: severityForCategory(opp.category),
        effort: EFFORT_BY_TYPE.target_competitors,
      });
    } else if (opp.category === "absent") {
      candidates.push({
        stableKey: `create_single:prompt:${opp.prompt_id}`,
        type: "create_single",
        title: `Build for "${truncate(promptTextById.get(opp.prompt_id) ?? opp.prompt_id, 60)}"`,
        description: `You're not mentioned in any observed answer for this prompt. This prompt sits outside your current clusters — likely a one-off content gap.`,
        affectedPromptIds: [opp.prompt_id],
        clusterLabel: null,
        clusterKind: null,
        evidence: {
          promptCount: 1,
          observationCount,
          categoryBreakdown: { absent: 1 },
          dominantCompetitors,
          descriptorsNearBrand: [],
          maxSignalStrength: opp.signalStrength,
        },
        severity: severityForCategory(opp.category),
        effort: EFFORT_BY_TYPE.create_single,
      });
    } else if (opp.category === "close") {
      candidates.push({
        stableKey: `strengthen_page_copy:prompt:${opp.prompt_id}`,
        type: "strengthen_page_copy",
        title: `Strengthen "${truncate(promptTextById.get(opp.prompt_id) ?? opp.prompt_id, 60)}"`,
        description: `You're cited or mentioned in ${opp.evidence.citedCount + opp.evidence.mentionedCount} of ${observationCount} answers, never primary. Tighten the target page's lead copy around the descriptors AI is already using near you.`,
        affectedPromptIds: [opp.prompt_id],
        clusterLabel: null,
        clusterKind: null,
        evidence: {
          promptCount: 1,
          observationCount,
          categoryBreakdown: { close: 1 },
          dominantCompetitors,
          descriptorsNearBrand,
          maxSignalStrength: opp.signalStrength,
        },
        severity: severityForCategory(opp.category),
        effort: EFFORT_BY_TYPE.strengthen_page_copy,
      });
    }
  }

  // -----------------------------------------------------------------
  // 3) Winning clusters → Watch recs.
  //    Only emits when ≥3 winning prompts share the same geo or topic.
  //    Single winning prompts don't generate Watch recs — too noisy.
  // -----------------------------------------------------------------
  const winningByGeo = new Map<string, PromptOpportunity[]>();
  const winningByTopic = new Map<string, PromptOpportunity[]>();
  for (const opp of args.matrix.prompts) {
    if (opp.category !== "winning") continue;
    // We don't have direct access to TrackedPrompt metadata here (only
    // the PromptOpportunity from v5's matrix). Cluster info comes from
    // matrix.clusters (which is weakness-only) — so for winning we mine
    // the opp's own tags (they'd carry geo_cluster / topic_cluster when
    // v5 attached them, but v5 only tags weakness clusters). The right
    // source is the prompt-level location_scope / topic_id lookup via
    // the DecisionMatrix's prompt references.
    //
    // To keep this pure and not re-fetch, we rely on the matrix
    // capturing cluster metadata for winning prompts too in a future
    // pass. v1: skip per-prompt winning aggregation unless v5's cluster
    // detection extends to winning. This is the honest limit.
    void opp;
    void winningByGeo;
    void winningByTopic;
  }

  // v1 note: generator only creates Watch recs from already-detected
  // clusters in matrix.clusters that happen to be winning-category.
  // Currently matrix.clusters is weakness-only (v5 design choice), so
  // Watch recs are empty until v5's cluster pass is extended to winning.
  // That's a 5-minute change to decision-matrix.ts when we want it;
  // keeping out of this commit to preserve v5 contract stability.

  // -----------------------------------------------------------------
  // 4) Dedupe cluster recs with identical prompt sets. In real data,
  //    a geo cluster ("Los Altos") and a topic cluster ("Los Altos
  //    Construction") often cover the same 5 prompts — surfacing both
  //    just dilutes the operator's work queue. Prefer geo (concrete
  //    location beats abstract topic label for page planning).
  // -----------------------------------------------------------------
  return dedupeOverlappingClusterRecs(candidates);
}

/** When two cluster recs share an identical affectedPromptIds set,
 *  keep the geo one. Single-prompt recs pass through unchanged. */
function dedupeOverlappingClusterRecs(
  candidates: RecommendationCandidate[],
): RecommendationCandidate[] {
  const clusterByPromptSet = new Map<string, RecommendationCandidate>();
  const passthrough: RecommendationCandidate[] = [];
  for (const c of candidates) {
    if (c.type !== "create_cluster_page") {
      passthrough.push(c);
      continue;
    }
    const key = [...c.affectedPromptIds].sort().join("|");
    const existing = clusterByPromptSet.get(key);
    if (!existing) {
      clusterByPromptSet.set(key, c);
      continue;
    }
    // Dupe. Keep the geo one.
    if (existing.clusterKind === "geo" && c.clusterKind !== "geo") continue;
    if (c.clusterKind === "geo" && existing.clusterKind !== "geo") {
      clusterByPromptSet.set(key, c);
      continue;
    }
    // Both geo or both topic — first seen wins (deterministic).
  }
  return [...clusterByPromptSet.values(), ...passthrough];
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function tallyCategories(
  opportunities: ReadonlyArray<PromptOpportunity>,
): Partial<Record<PromptOpportunityCategory, number>> {
  const out: Partial<Record<PromptOpportunityCategory, number>> = {};
  for (const o of opportunities) {
    out[o.category] = (out[o.category] ?? 0) + 1;
  }
  return out;
}

function aggregateCompetitors(
  opportunities: ReadonlyArray<PromptOpportunity>,
  ownedNames: ReadonlySet<string>,
): string[] {
  const freq = new Map<string, number>();
  for (const o of opportunities) {
    for (const name of o.evidence.dominantCompetitors) {
      if (!name || ownedNames.has(name)) continue;
      freq.set(name, (freq.get(name) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name]) => name);
}

function describeCategoryMix(
  breakdown: Partial<Record<PromptOpportunityCategory, number>>,
): string {
  const parts: string[] = [];
  if (breakdown.outranked)
    parts.push(`${breakdown.outranked} outranked`);
  if (breakdown.absent) parts.push(`${breakdown.absent} absent`);
  if (breakdown.close) parts.push(`${breakdown.close} close to breakthrough`);
  return parts.join(" · ");
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trimEnd()}…`;
}
