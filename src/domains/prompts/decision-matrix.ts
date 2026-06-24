/**
 * Decision-matrix aggregator for Prompt Decision Surface v1
 * (Phase v5 Commit 1, 2026-04-24).
 *
 * Runs the per-prompt classifier over every tracked_prompt, then does a
 * cross-prompt cluster pass that groups weak prompts by location_scope
 * and topic_id. Outputs group-level summaries (with cluster notes when
 * ≥3 prompts share the same geo/topic cluster weakness) for the
 * /prompts list view to render as section headers.
 *
 * Pure. No I/O. Consumes the already-seeded canonical stores via
 * explicit arguments.
 */

import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import {
  classifyPromptOpportunity,
  type PromptOpportunity,
  type PromptOpportunityCategory,
  type PromptOpportunityTag,
  type ClassifyOptions,
} from "./opportunity-classify";
import {
  summarizeAllPromptsPrimary,
  type PromptPrimarySummary,
} from "./competitor-primary";
import { makeCompetitorRankingFilter } from "@/domains/recommendations/entity-pollution-filter";

export type ClusterWeakness = {
  type: "geo" | "topic";
  /** Human-readable cluster label (`location_scope` value or `topic_id`). */
  label: string;
  /** Category the cluster shares. "absent" + "outranked" count as weakness. */
  categories: PromptOpportunityCategory[];
  promptIds: string[];
};

export type CategoryGroupSummary = {
  category: PromptOpportunityCategory;
  count: number;
  /**
   * Operator-facing sentence describing prominent clusters in this group.
   * Empty when no cluster ≥3. Example: "8 cluster to Palo Alto · 3 cluster to Luxury Home Builder".
   */
  clusterNote: string;
};

export type DecisionMatrix = {
  /** ISO date (YYYY-MM-DD, UTC) the matrix was built for. */
  date: string;
  /** ISO date of the oldest observation considered. */
  lookbackFrom: string;
  /** Full classified list, one entry per tracked_prompt. */
  prompts: PromptOpportunity[];
  /** Cluster-weakness index (only clusters ≥ min threshold). */
  clusters: ClusterWeakness[];
  /** Per-category summary for list-view headers. Ordered by display priority. */
  groupSummaries: CategoryGroupSummary[];
  /**
   * Per-prompt competitor-primary rollup keyed by prompt_id. Describes who
   * occupies the "primary" slot in each answer (brand vs competitor), which
   * competitors dominate, and whether the prompt is fragmented. Drives the
   * competitor-primary evidence on recommendation rows + `/prompts/[id]`.
   * (Phase v6 Commit 3, 2026-04-23.)
   */
  primaryByPromptId: Record<string, PromptPrimarySummary>;
};

export type BuildDecisionMatrixArgs = {
  prompts: ReadonlyArray<TrackedPrompt>;
  observations: ReadonlyArray<PromptAnswerObservation>;
  activeEntities: ReadonlyArray<TrackedEntity>;
  /** Optional classifier options (lookback days, thresholds). */
  classifyOptions?: ClassifyOptions;
  /** Min prompts sharing a weakness to form a cluster. Defaults to 3. */
  clusterMinPrompts?: number;
  /** Cap on cluster notes per group header (readability). Defaults to 2. */
  maxClusterNotesPerGroup?: number;
  /** Today's date override (for tests). Defaults to now(). */
  now?: Date;
};

/** Category display order on /prompts. Operator-priority first. */
const CATEGORY_ORDER: PromptOpportunityCategory[] = [
  "outranked",
  "absent",
  "close",
  "winning",
  "early",
];

/** Which categories are "weaknesses" and participate in cluster detection. */
const WEAKNESS_CATEGORIES: ReadonlySet<PromptOpportunityCategory> = new Set([
  "absent",
  "outranked",
]);

export function buildPromptDecisionMatrix(
  args: BuildDecisionMatrixArgs,
): DecisionMatrix {
  const activePrompts = args.prompts.filter((p) => p.is_active);
  const now = args.now ?? new Date();
  const lookbackDays = args.classifyOptions?.lookbackDays ?? 7;
  const classifyOptions: ClassifyOptions = {
    ...args.classifyOptions,
    now,
  };

  // --- Pass 1: classify each active prompt.
  const classified: PromptOpportunity[] = activePrompts.map((prompt) =>
    classifyPromptOpportunity({
      prompt,
      observations: args.observations,
      activeEntities: args.activeEntities,
      options: classifyOptions,
    }),
  );

  // --- Pass 2: detect cluster weaknesses.
  const clusterMinPrompts = args.clusterMinPrompts ?? 3;

  // Group weak-category prompts by their prompt metadata.
  const promptById = new Map(activePrompts.map((p) => [p.id, p]));
  const byGeo = new Map<
    string,
    { categories: Set<PromptOpportunityCategory>; promptIds: string[] }
  >();
  const byTopic = new Map<
    string,
    { categories: Set<PromptOpportunityCategory>; promptIds: string[] }
  >();
  for (const op of classified) {
    if (!WEAKNESS_CATEGORIES.has(op.category)) continue;
    const meta = promptById.get(op.prompt_id);
    if (!meta) continue;
    if (meta.location_scope) {
      const entry = byGeo.get(meta.location_scope) ?? {
        categories: new Set(),
        promptIds: [],
      };
      entry.categories.add(op.category);
      entry.promptIds.push(op.prompt_id);
      byGeo.set(meta.location_scope, entry);
    }
    if (meta.topic_id) {
      const entry = byTopic.get(meta.topic_id) ?? {
        categories: new Set(),
        promptIds: [],
      };
      entry.categories.add(op.category);
      entry.promptIds.push(op.prompt_id);
      byTopic.set(meta.topic_id, entry);
    }
  }

  const clusters: ClusterWeakness[] = [];
  for (const [label, entry] of byGeo.entries()) {
    if (entry.promptIds.length >= clusterMinPrompts) {
      clusters.push({
        type: "geo",
        label,
        categories: [...entry.categories],
        promptIds: entry.promptIds,
      });
    }
  }
  for (const [label, entry] of byTopic.entries()) {
    if (entry.promptIds.length >= clusterMinPrompts) {
      clusters.push({
        type: "topic",
        label,
        categories: [...entry.categories],
        promptIds: entry.promptIds,
      });
    }
  }

  // Attach cluster tags onto individual prompt opportunities so rows can
  // render a "part of Palo Alto cluster (8)" chip next to the category.
  const promptIdToClusterLabels = new Map<string, PromptOpportunityTag[]>();
  for (const c of clusters) {
    const tagPrefix: PromptOpportunityTag =
      c.type === "geo"
        ? (`geo_cluster:${c.label}` as PromptOpportunityTag)
        : (`topic_cluster:${c.label}` as PromptOpportunityTag);
    for (const pid of c.promptIds) {
      const list = promptIdToClusterLabels.get(pid) ?? [];
      list.push(tagPrefix);
      promptIdToClusterLabels.set(pid, list);
    }
  }
  for (const op of classified) {
    const extra = promptIdToClusterLabels.get(op.prompt_id);
    if (extra) op.tags = [...op.tags, ...extra];
  }

  // --- Pass 3: per-category group summaries with cluster notes.
  const groupSummaries: CategoryGroupSummary[] = CATEGORY_ORDER.map(
    (category) => {
      const inGroup = classified.filter((c) => c.category === category);
      if (inGroup.length === 0) {
        return { category, count: 0, clusterNote: "" };
      }
      // Cluster notes: only for weakness categories.
      if (!WEAKNESS_CATEGORIES.has(category)) {
        return { category, count: inGroup.length, clusterNote: "" };
      }
      const memberIds = new Set(inGroup.map((c) => c.prompt_id));
      const notes: Array<{ text: string; count: number }> = [];
      for (const cluster of clusters) {
        // Count how many of the group's prompts are in this cluster.
        const overlap = cluster.promptIds.filter((id) => memberIds.has(id));
        if (overlap.length < clusterMinPrompts) continue;
        // Only include the cluster if it shares this category's weakness.
        if (!cluster.categories.includes(category)) continue;
        const typeLabel = cluster.type === "geo" ? cluster.label : cluster.label;
        notes.push({
          text: `${overlap.length} cluster to ${typeLabel}`,
          count: overlap.length,
        });
      }
      notes.sort((a, b) => b.count - a.count);
      const maxNotes = args.maxClusterNotesPerGroup ?? 2;
      const clusterNote = notes
        .slice(0, maxNotes)
        .map((n) => n.text)
        .join(" · ");
      return { category, count: inGroup.length, clusterNote };
    },
  );

  const lookbackFromMs = now.getTime() - lookbackDays * 86_400_000;
  const lookbackFrom = new Date(lookbackFromMs).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const ownedEntityNames = new Set(
    args.activeEntities
      .filter((e) => e.is_owned)
      .map((e) => e.name)
      .filter((n): n is string => Boolean(n)),
  );
  const primarySummaries = summarizeAllPromptsPrimary({
    promptIds: activePrompts.map((p) => p.id),
    observations: args.observations,
    ownedEntityNames,
    // audit-wave4 #1: exclude directory/generic-noun entities from the primary
    // slot so the decision matrix never names a directory as the winner.
    competitorFilter: makeCompetitorRankingFilter(args.activeEntities),
  });
  const primaryByPromptId: Record<string, PromptPrimarySummary> = {};
  for (const [id, summary] of primarySummaries.entries()) {
    primaryByPromptId[id] = summary;
  }

  return {
    date: today,
    lookbackFrom,
    prompts: classified,
    clusters,
    groupSummaries,
    primaryByPromptId,
  };
}
