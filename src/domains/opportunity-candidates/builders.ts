import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Pattern } from "@/domains/patterns/types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type {
  OpportunityCandidate,
  OpportunityCandidateType,
  CandidateConfidence,
} from "./types";
import { scoreCandidate } from "./scoring";

const KNOWN_CITIES = [
  "Menlo Park",
  "Palo Alto",
  "Atherton",
  "Los Altos",
  "Saratoga",
  "Cupertino",
  "Woodside",
  "Portola Valley",
  "Los Altos Hills",
  "Mountain View",
  "Sunnyvale",
  "San Carlos",
  "Redwood City",
  "Hillsborough",
  "Burlingame",
];

const TOPIC_ADJACENCY: Record<string, string[]> = {
  "custom home builder": [
    "modern home builder",
    "luxury home builder",
    "design-build firm",
    "contemporary home builder",
  ],
  construction: [
    "home renovation",
    "whole home remodel",
    "new construction",
    "ADU builder",
  ],
  "home builder": [
    "custom home builder",
    "luxury home builder",
    "design-build contractor",
  ],
  renovation: [
    "whole home renovation",
    "kitchen remodel",
    "bathroom remodel",
    "home addition",
  ],
};

/**
 * Generate opportunity candidates from patterns, clusters, and existing opportunities.
 * All generation is deterministic and explainable.
 */
export function generateCandidates(
  patterns: Pattern[],
  clusters: ActionCluster[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[]
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  const existingTopics = new Set(
    opportunities.map((o) => o.topic.toLowerCase())
  );
  const existingCities = new Set(
    changes
      .map((c) => c.city_targeted)
      .filter((c): c is string => c !== null && c.length < 30)
  );

  const provenPatterns = patterns.filter(
    (p) => p.attributedEventCount >= 1 && p.confidenceBand !== "low"
  );

  for (const pattern of provenPatterns) {
    candidates.push(
      ...generateAdjacentCityCandidates(pattern, existingCities, existingTopics, clusters, changes)
    );
    candidates.push(
      ...generateTopicExpansionCandidates(pattern, existingTopics, clusters, changes)
    );
    candidates.push(
      ...generateCoverageGapCandidates(pattern, opportunities, clusters, changes)
    );
  }

  const deduped = deduplicateCandidates(candidates, existingTopics);

  return deduped.sort((a, b) => b.expectedImpact - a.expectedImpact);
}

function generateAdjacentCityCandidates(
  pattern: Pattern,
  existingCities: Set<string>,
  existingTopics: Set<string>,
  clusters: ActionCluster[],
  changes: ChangelogEntry[]
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  const patternCities = new Set(pattern.dominantGeo);

  if (patternCities.size === 0) return candidates;

  for (const targetCity of KNOWN_CITIES) {
    if (patternCities.has(targetCity)) continue;

    const topicBase = extractTopicBase(pattern, changes);
    if (!topicBase) continue;

    const label = `${topicBase} (${targetCity})`;
    const alreadyExists = existingTopics.has(label.toLowerCase());

    const evidence = [
      `Pattern "${pattern.label}" has ${pattern.successRate}% success rate`,
      `Applied in ${[...patternCities].join(", ")} with ${pattern.attributedEventCount} attributed events`,
      `${targetCity} is geographically adjacent to service area`,
    ];

    const caveats = [
      "Geographic adjacency does not guarantee same search demand or competition level",
      "Each city page must have genuinely unique local content to avoid doorway risk",
      `${pattern.executionCount} prior executions — diminishing returns possible if content is templated`,
    ];

    const { score, confidence } = scoreCandidate(
      pattern,
      "adjacent",
      existingCities.has(targetCity),
      clusters.filter((c) => pattern.clusterIds.includes(c.id))
    );

    candidates.push({
      id: `cand-adj-${pattern.id}-${normKey(targetCity)}`,
      label,
      queryTemplate: `${topicBase} in ${targetCity}`,
      sourcePatternId: pattern.id,
      sourcePatternLabel: pattern.label,
      sourceClusterIds: pattern.clusterIds,
      opportunityType: "adjacent",
      targetTopic: topicBase,
      targetCity,
      targetPlatform: pattern.dominantPlatforms[0] ?? "all",
      similarityScore: score,
      expectedImpact: score,
      reasoning: `Pattern "${pattern.label}" (${pattern.successRate}% success) is proven in ${[...patternCities].slice(0, 2).join(", ")}. ${targetCity} is a serviceable adjacent market.`,
      supportingEvidence: evidence,
      caveats,
      confidence,
      alreadyExists,
    });
  }

  return candidates;
}

function generateTopicExpansionCandidates(
  pattern: Pattern,
  existingTopics: Set<string>,
  clusters: ActionCluster[],
  changes: ChangelogEntry[]
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  const topicBase = extractTopicBase(pattern, changes);
  if (!topicBase) return candidates;

  const adjacentTopics = findAdjacentTopics(topicBase);
  if (adjacentTopics.length === 0) return candidates;

  for (const adjTopic of adjacentTopics) {
    const label = adjTopic;
    const alreadyExists = existingTopics.has(label.toLowerCase());

    const evidence = [
      `Pattern "${pattern.label}" has ${pattern.successRate}% success rate on related topic "${topicBase}"`,
      `Topic "${adjTopic}" is semantically adjacent — similar search intent expected`,
      `${pattern.clustersImpacted} clusters already validated this pattern type`,
    ];

    const caveats = [
      "Semantic adjacency does not guarantee same SERP dynamics — validate intent overlap before creating",
      "Risk of keyword cannibalization if topic is too similar to existing pages",
      "Each expansion should be validated against actual search demand",
    ];

    const { score, confidence } = scoreCandidate(
      pattern,
      "expansion",
      false,
      clusters.filter((c) => pattern.clusterIds.includes(c.id))
    );

    candidates.push({
      id: `cand-exp-${pattern.id}-${normKey(adjTopic)}`,
      label,
      queryTemplate: adjTopic,
      sourcePatternId: pattern.id,
      sourcePatternLabel: pattern.label,
      sourceClusterIds: pattern.clusterIds,
      opportunityType: "expansion",
      targetTopic: adjTopic,
      targetCity: null,
      targetPlatform: pattern.dominantPlatforms[0] ?? "all",
      similarityScore: Math.round(score * 0.85),
      expectedImpact: Math.round(score * 0.85),
      reasoning: `Pattern "${pattern.label}" works for "${topicBase}". "${adjTopic}" is a semantically adjacent topic that may respond to the same change strategy.`,
      supportingEvidence: evidence,
      caveats,
      confidence: confidence === "high" ? "medium" : confidence,
      alreadyExists,
    });
  }

  return candidates;
}

function generateCoverageGapCandidates(
  pattern: Pattern,
  opportunities: Opportunity[],
  clusters: ActionCluster[],
  changes: ChangelogEntry[]
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  const patternChangeIds = new Set(pattern.changeIds);

  const oppsWithPattern = new Set<string>();
  for (const opp of opportunities) {
    const linked = opp.linked_changelog_ids.some((id) =>
      patternChangeIds.has(id)
    );
    if (linked) oppsWithPattern.add(opp.id);
  }

  const oppsWithoutPattern = opportunities.filter(
    (o) =>
      !oppsWithPattern.has(o.id) &&
      o.current_status !== "closed" &&
      o.current_status !== "deferred" &&
      o.current_status !== "captured"
  );

  for (const opp of oppsWithoutPattern) {
    const evidence = [
      `Pattern "${pattern.label}" has ${pattern.successRate}% success rate and ${pattern.attributedEventCount} attributed events`,
      `Opportunity "${opp.title}" has no changes using this pattern yet`,
      `${oppsWithPattern.size} other opportunities already benefit from this pattern`,
    ];

    const caveats = [
      "Pattern may not transfer to all opportunity contexts — verify topic and intent alignment",
      "Opportunity may have different competitive dynamics than where pattern succeeded",
    ];

    const { score, confidence } = scoreCandidate(
      pattern,
      "gap",
      true,
      clusters.filter((c) => pattern.clusterIds.includes(c.id))
    );

    candidates.push({
      id: `cand-gap-${pattern.id}-${normKey(opp.id)}`,
      label: `Apply "${pattern.label}" to "${opp.title}"`,
      queryTemplate: opp.query_text,
      sourcePatternId: pattern.id,
      sourcePatternLabel: pattern.label,
      sourceClusterIds: pattern.clusterIds,
      opportunityType: "gap",
      targetTopic: opp.topic,
      targetCity: opp.city,
      targetPlatform: opp.platforms[0] ?? "all",
      similarityScore: score,
      expectedImpact: Math.round(score * 0.9),
      reasoning: `Pattern "${pattern.label}" is proven (${pattern.successRate}% success) but hasn't been applied to "${opp.title}". This is a coverage gap.`,
      supportingEvidence: evidence,
      caveats,
      confidence,
      alreadyExists: true,
    });
  }

  return candidates;
}

function extractTopicBase(pattern: Pattern, changes: ChangelogEntry[]): string | null {
  const patternChangeIds = new Set(pattern.changeIds);
  const topicCounts = new Map<string, number>();
  for (const c of changes) {
    if (!patternChangeIds.has(c.id)) continue;
    const t = c.topic_targeted?.trim();
    if (t) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  }
  if (topicCounts.size === 0) return null;
  return [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function findAdjacentTopics(topicBase: string): string[] {
  const lower = topicBase.toLowerCase();
  for (const [key, adjacents] of Object.entries(TOPIC_ADJACENCY)) {
    if (lower.includes(key)) return adjacents;
  }
  return [];
}

function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

function deduplicateCandidates(
  candidates: OpportunityCandidate[],
  existingTopics: Set<string>
): OpportunityCandidate[] {
  const seen = new Set<string>();
  const result: OpportunityCandidate[] = [];

  for (const c of candidates) {
    const dedupeKey = `${c.opportunityType}:${c.targetTopic}:${c.targetCity ?? "all"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    c.alreadyExists =
      c.alreadyExists ||
      existingTopics.has(c.label.toLowerCase()) ||
      existingTopics.has(c.targetTopic.toLowerCase());

    result.push(c);
  }

  return result;
}
