import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Pattern } from "@/domains/patterns/types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type {
  OpportunityCandidate,
} from "./types";
import { scoreCandidate } from "./scoring";

/** Multi-property (2026-06-10): founder-default geo-expansion list.
 * Tenant-aware callers pass their own `cities` into generateCandidates;
 * absent → this list, so Ritz behavior is unchanged. */
const DEFAULT_EXPANSION_CITIES = [
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

/**
 * Generate opportunity candidates from patterns, clusters, and existing opportunities.
 * All generation is deterministic and explainable.
 */
export function generateCandidates(
  patterns: Pattern[],
  clusters: ActionCluster[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[],
  /** Tenant geo-expansion vocabulary. Defaults to the founder list. */
  cities: ReadonlyArray<string> = DEFAULT_EXPANSION_CITIES,
  /** Tenant service vocabulary for topic-expansion adjacency. Empty (default)
   *  → no synthetic topic-expansion candidates (vertical-neutral). */
  serviceVocab: ReadonlyArray<string> = [],
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
      ...generateAdjacentCityCandidates(pattern, existingCities, existingTopics, clusters, changes, cities)
    );
    candidates.push(
      ...generateTopicExpansionCandidates(pattern, existingTopics, clusters, changes, serviceVocab)
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
  changes: ChangelogEntry[],
  cities: ReadonlyArray<string>,
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  const patternCities = new Set(pattern.dominantGeo);

  if (patternCities.size === 0) return candidates;

  for (const targetCity of cities) {
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
      reasoning: `Pattern "${pattern.label}" (${pattern.successRate}% success) is well supported in ${[...patternCities].slice(0, 2).join(", ")}. ${targetCity} is a serviceable adjacent market.`,
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
  changes: ChangelogEntry[],
  serviceVocab: ReadonlyArray<string>
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  const topicBase = extractTopicBase(pattern, changes);
  if (!topicBase) return candidates;

  const adjacentTopics = findAdjacentTopics(topicBase, serviceVocab);
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
      reasoning: `Pattern "${pattern.label}" is well supported (${pattern.successRate}% success) but hasn't been applied to "${opp.title}". This is a coverage gap.`,
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

/**
 * Vertical-neutral topic adjacency: if the proven topic corresponds to one of
 * the tenant's OWN services, suggest expanding the same change strategy into
 * the tenant's OTHER services. No hardcoded vertical vocabulary — a tenant with
 * no configured services gets no synthetic topic-expansion candidates.
 */
function findAdjacentTopics(
  topicBase: string,
  serviceVocab: ReadonlyArray<string>
): string[] {
  const services = serviceVocab
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  if (services.length < 2) return [];

  const lower = topicBase.toLowerCase();
  const matched = services.find(
    (s) => lower.includes(s.toLowerCase()) || s.toLowerCase().includes(lower)
  );
  if (!matched) return [];

  return services
    .filter((s) => s.toLowerCase() !== matched.toLowerCase())
    .slice(0, 4);
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
